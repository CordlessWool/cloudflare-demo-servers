/**
 * Einstiegspunkt der Angriffs-Maschine (#37, #52). Startet einen winzigen Hono-Server nur für
 * den Health-Check (`/health`) und läuft daneben in einer Schleife: Befehl holen, bei
 * aktivem Werkzeug mit harter Rate-Untergrenze gegen das fest hinterlegte Ziel laufen,
 * Antwortklassen zählen und periodisch melden. Timer als Sicherheitsnetz: unabhängig von jedem
 * Befehl beendet sich der Prozess nach SELF_DESTRUCT_MS und wird nicht neu gestartet (systemd
 * `Restart=on-failure`, Unit aus der cloud-init der App). Das Droplet löscht die App.
 */
import { Hono } from 'hono';
import { COMMAND_POLL_INTERVAL_MS, REPORT_INTERVAL_MS, SELF_DESTRUCT_MS } from './const.ts';
import { NonceStore } from './nonceStore.ts';
import { RateLimiter } from './rateLimiter.ts';
import { emptyCounts } from './classify.ts';
import { fetchAndVerifyCommand, mergeCounts, maybeSendAttackRequest, sendReport, validateTargetDomain, type AttackCommandPayload, type RunnerConfig, type RunnerDeps } from './runner.ts';

function requireEnv(name: string): string {
	const value = Bun.env[name];
	if (!value) throw new Error(`${name} fehlt (kommt per user_data/cloud-init von der App)`);
	return value;
}

const config: RunnerConfig = {
	appBaseUrl: requireEnv('APP_BASE_URL'),
	machineId: requireEnv('ATTACK_MACHINE_ID'),
	pollToken: requireEnv('ATTACK_RUNNER_POLL_TOKEN'),
	commandSecret: requireEnv('ATTACK_COMMAND_SECRET'),
	// Ziel fest aus der eigenen Umgebung, Hostname geprüft -- nie aus einem Befehl (#37/#52).
	targetDomain: validateTargetDomain(requireEnv('TARGET_DOMAIN'))
};

const deps: RunnerDeps = {
	fetchFn: fetch,
	now: () => Date.now(),
	log: (msg) => console.log(`[attack-runner] ${msg}`)
};

const app = new Hono();
app.get('/health', (c) => c.text('ok'));

async function mainLoop(): Promise<void> {
	const nonceStore = new NonceStore();
	const limiter = new RateLimiter();
	let lastPayload: AttackCommandPayload | null = null;
	let counts = emptyCounts();
	let lastReportAt = deps.now();

	for (;;) {
		try {
			const payload = await fetchAndVerifyCommand(deps, config, nonceStore);
			lastPayload = payload;
			const requestCounts = await maybeSendAttackRequest(deps, config, payload, limiter);
			if (requestCounts) counts = mergeCounts(counts, requestCounts);
		} catch (err) {
			deps.log(`Befehl übersprungen: ${err instanceof Error ? err.message : String(err)}`);
		}

		const now = deps.now();
		if (lastPayload && now - lastReportAt >= REPORT_INTERVAL_MS) {
			await sendReport(deps, config, lastPayload, counts);
			counts = emptyCounts();
			lastReportAt = now;
		}

		await new Promise((resolve) => setTimeout(resolve, COMMAND_POLL_INTERVAL_MS));
	}
}

setTimeout(() => {
	deps.log('Selbstzerstörungs-Timer abgelaufen, Prozess beendet sich.');
	process.exit(0);
}, SELF_DESTRUCT_MS);

mainLoop().catch((err) => {
	console.error('[attack-runner] Loop abgebrochen:', err);
	process.exit(1);
});

const port = Number(Bun.env.PORT ?? 8080);
Bun.serve({ port, fetch: app.fetch });
console.log(`attack-runner läuft auf Port ${port} (machineId=${config.machineId})`);
