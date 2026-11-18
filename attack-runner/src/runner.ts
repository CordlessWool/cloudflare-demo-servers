/**
 * Angriffs-Loop (#37): Befehl abholen -> prüfen (Signatur, Ablaufzeit, Nonce gegen Replay) ->
 * bei aktivem Werkzeug mit der harten Rate-Untergrenze gegen das fest hinterlegte Ziel aus dem
 * Befehl laufen -> Antwortklassen zählen -> periodisch signiert melden. Orchestrierung ist
 * absichtlich als reine, injizierbare Funktionen gehalten (fetch/now/sleep als Parameter), damit
 * der ganze Zyklus ohne echtes Netzwerk/Warten testbar ist (siehe runner.test.ts).
 */
import { COMMAND_POLL_INTERVAL_MS, REPORT_INTERVAL_MS } from './const.ts';
import { classifyResponse, addToCounts, emptyCounts, type ResponseClassCounts } from './classify.ts';
import { NonceStore } from './nonceStore.ts';
import { RateLimiter } from './rateLimiter.ts';
import { signPayload, verifySignedCommand, type SignedEnvelope } from './signing.ts';
import { buildToolRequest, isAttackTool, type AttackTool } from './tools.ts';

export interface AttackCommandPayload {
	sessionId: string;
	teamId: string;
	machineId: string;
	toolEnabled: boolean;
	/** Gewähltes Werkzeug (#38) oder null, wenn keins aktiv ist. Bestimmt Methode/Pfad/User-Agent. */
	tool: AttackTool | null;
	/** Zusatz-Werkzeug "Tarnung": Browser-User-Agent statt Skript-UA. */
	disguise: boolean;
	minIntervalMs: number;
	issuedAt: number;
	expiresAt: number;
	nonce: string;
}

export interface RunnerConfig {
	appBaseUrl: string;
	machineId: string;
	pollToken: string;
	commandSecret: string;
	/**
	 * Ziel-Domain, FEST aus der eigenen Umgebung (TARGET_DOMAIN, per user_data beim Anlegen, #37/#52).
	 * Kommt NIE aus einem Befehl: ein gefälschter/kompromittierter Befehl kann das Ziel nicht umlenken.
	 */
	targetDomain: string;
}

export class InvalidTargetDomainError extends Error {}

/**
 * Prüft die aus der Umgebung gelesene Ziel-Domain (#37: "Hostname validieren"). Erlaubt einen
 * Hostnamen mit optionalem Port (Tests gegen lokale Ziele), lehnt aber IP-Literale ab: das Spiel
 * greift nur Domains hinter Cloudflare an, nie direkt eine Server-IP (siehe #20, Werkzeugkasten).
 * Defense-in-depth zusätzlich zur Prüfung auf der App-Seite (cloudInit.ts).
 */
export function validateTargetDomain(raw: string): string {
	const value = (raw ?? '').trim();
	const DOMAIN = /^(?=.{1,253}$)[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?(?::\d{1,5})?$/;
	if (!DOMAIN.test(value)) throw new InvalidTargetDomainError(`TARGET_DOMAIN ist kein gültiger Hostname: ${JSON.stringify(raw)}`);
	const host = value.split(':')[0]!;
	if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) throw new InvalidTargetDomainError('TARGET_DOMAIN darf keine IP-Adresse sein, nur eine Domain hinter Cloudflare');
	if (!host.includes('.')) throw new InvalidTargetDomainError('TARGET_DOMAIN muss ein voll qualifizierter Domainname sein');
	return value;
}

export interface RunnerDeps {
	fetchFn: typeof fetch;
	now: () => number;
	log: (msg: string) => void;
	/** Nur für Tests: http statt https gegen einen lokalen Mock-Server. Default/Produktion: https. */
	targetScheme?: 'http' | 'https';
}

export class ReplayedNonceError extends Error {}

/** Holt den aktuellen Befehl und prüft Signatur/Ablaufzeit/Replay. Wirft bei jedem Problem. */
export async function fetchAndVerifyCommand(
	deps: RunnerDeps,
	config: RunnerConfig,
	nonceStore: NonceStore
): Promise<AttackCommandPayload> {
	const res = await deps.fetchFn(`${config.appBaseUrl}/api/attack/command?machineId=${encodeURIComponent(config.machineId)}`, {
		headers: { authorization: `Bearer ${config.pollToken}` }
	});
	if (!res.ok) throw new Error(`Befehl konnte nicht abgeholt werden: ${res.status}`);
	const envelope = (await res.json()) as SignedEnvelope<AttackCommandPayload>;
	const payload = await verifySignedCommand(config.commandSecret, envelope, deps.now());
	if (payload.machineId !== config.machineId) throw new Error('Befehl ist nicht für diese Machine bestimmt');
	if (nonceStore.has(payload.nonce)) throw new ReplayedNonceError('Nonce wurde bereits gesehen (Replay)');
	nonceStore.add(payload.nonce);
	return payload;
}

/**
 * Genau EIN Angriffs-Request, falls das Werkzeug aktiv ist und die Rate-Untergrenze es
 * erlaubt. Das Ziel kommt ausschließlich aus der Maschinen-Umgebung (`config.targetDomain`,
 * #37: "kein frei wählbares Ziel", #52: "nie per Befehl") -- der Befehl trägt keine Domain mehr,
 * also kann kein Befehl dieses Ziel umlenken. Der konkrete Pfad/Werkzeug-Muster wird in #38
 * festgelegt; hier wird der Root-Pfad als Platzhalter verwendet (trifft jede Domain).
 */
export async function maybeSendAttackRequest(
	deps: RunnerDeps,
	config: RunnerConfig,
	payload: AttackCommandPayload,
	limiter: RateLimiter
): Promise<ResponseClassCounts | null> {
	if (!payload.toolEnabled || !isAttackTool(payload.tool)) return null;
	const now = deps.now();
	if (limiter.msUntilNextAllowed(now) > 0) return null;
	limiter.recordRequest(now);
	const scheme = deps.targetScheme ?? 'https';
	const req = buildToolRequest(payload.tool, { disguise: payload.disguise });
	const res = await deps.fetchFn(`${scheme}://${config.targetDomain}${req.path}`, {
		method: req.method,
		headers: { 'user-agent': req.userAgent }
	});
	const cls = classifyResponse({ status: res.status, headers: res.headers });
	deps.log(`${req.method} ${req.path} (${payload.tool}) -> ${res.status} / ${cls}`);
	return addToCounts(emptyCounts(), cls);
}

export function mergeCounts(a: ResponseClassCounts, b: ResponseClassCounts): ResponseClassCounts {
	const merged = { ...a };
	for (const key of Object.keys(b) as (keyof ResponseClassCounts)[]) merged[key] += b[key];
	return merged;
}

export interface AttackReportPayload {
	sessionId: string;
	teamId: string;
	machineId: string;
	nonce: string;
	counts: ResponseClassCounts;
	reportedAt: number;
	expiresAt: number;
}

/** Meldet die seit dem letzten Mal gezählten Antwortklassen, signiert mit demselben Secret. */
export async function sendReport(
	deps: RunnerDeps,
	config: RunnerConfig,
	lastPayload: AttackCommandPayload,
	counts: ResponseClassCounts
): Promise<void> {
	const now = deps.now();
	const report: AttackReportPayload = {
		sessionId: lastPayload.sessionId,
		teamId: lastPayload.teamId,
		machineId: config.machineId,
		nonce: lastPayload.nonce,
		counts,
		reportedAt: now,
		expiresAt: now + REPORT_INTERVAL_MS * 10
	};
	const envelope = await signPayload(config.commandSecret, report);
	const res = await deps.fetchFn(`${config.appBaseUrl}/api/attack/report`, {
		method: 'POST',
		headers: { authorization: `Bearer ${config.pollToken}`, 'content-type': 'application/json' },
		body: JSON.stringify(envelope)
	});
	if (!res.ok) deps.log(`Meldung fehlgeschlagen: ${res.status}`);
}

export { COMMAND_POLL_INTERVAL_MS, REPORT_INTERVAL_MS };
