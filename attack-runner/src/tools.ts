/**
 * Fester Werkzeugkasten (#38, Teil von #20) und das daraus gebaute, beobachtbare Anfragemuster.
 * Die Angreifer wählen nur aus diesem Kasten -- kein Ziel, keine URL, keine Rate, keine Header
 * frei. Jedes Werkzeug ist auf Pro mit einer Cloudflare-Einstellung abwehrbar (Tabelle in #20).
 *
 * Diese Datei ist zu games/cloudflare-zone/src/lib/server/attackTools.ts dupliziert (andere
 * Runtime). Gemeinsame Quelle ist docs/attack-protocol.md -- bei Änderung HIER UND dort nachziehen.
 */
export const AttackTool = {
	/** Suche-Flut: viele `/suche?q=` mit wechselnden Begriffen. Abwehr: Rate Limit auf `/suche` oder Custom Rule. */
	SEARCH_FLOOD: 'search_flood',
	/** Login-Ansturm: viele `POST /login`. Abwehr: Rate Limit oder Challenge auf `/login`. */
	LOGIN_RUSH: 'login_rush',
	/** Seiten-Abgrasen: viele verschiedene, auch nicht vorhandene URLs. Abwehr: Custom Rule auf Pfadmuster / SBFM. */
	PAGE_SWEEP: 'page_sweep',
	/** Fremdes Land: normale Anfragen, auffällig ist die Region der Maschine. Abwehr: Custom Rule auf ip.src.country. */
	FOREIGN_COUNTRY: 'foreign_country',
	/** Auffälliger User-Agent: Skript-User-Agent. Abwehr: User-Agent-Sperre oder Custom Rule. */
	SUSPICIOUS_UA: 'suspicious_ua'
} as const;
export type AttackTool = (typeof AttackTool)[keyof typeof AttackTool];

export function isAttackTool(value: unknown): value is AttackTool {
	return typeof value === 'string' && (Object.values(AttackTool) as string[]).includes(value);
}

/** Skript-User-Agent (ehrlich gekennzeichnet, Schulung). Das ist das Erkennungsmerkmal von SUSPICIOUS_UA. */
export const SCRIPT_USER_AGENT = 'BohnenkraftLastTest/1.0 (+Cloudflare-Schulung)';

/** Tarnungs-User-Agent (Zusatz-Werkzeug "Tarnung"): sieht aus wie ein normaler Browser. */
export const DISGUISE_USER_AGENT =
	'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

/** Wechselnde Suchbegriffe für die Suche-Flut (bewusst harmlose Shop-Begriffe). */
export const SEARCH_TERMS = ['espresso', 'filterkaffee', 'bohnen', 'mahlwerk', 'crema', 'robusta', 'arabica', 'entkoffeiniert', 'cold brew', 'kanne'] as const;

/** Pfade fürs Seiten-Abgrasen, inklusive nicht vorhandener (404) -- genau das ist das Muster. */
export const SWEEP_PATHS = ['/', '/produkte', '/suche', '/warenkorb', '/login', '/kasse', '/admin', '/wp-login.php', '/.env', '/api/intern', '/gibtsnicht', '/alt/shop'] as const;

export interface ToolRequest {
	method: 'GET' | 'POST';
	path: string;
	userAgent: string;
}

export interface BuildToolOptions {
	/** Zusatz-Werkzeug "Tarnung": Browser-User-Agent statt Skript-UA. */
	disguise?: boolean;
	/** 0..1, injizierbar für Tests (Default Math.random). */
	rng?: () => number;
}

function pick<T>(items: readonly T[], rng: () => number): T {
	return items[Math.min(items.length - 1, Math.floor(rng() * items.length))]!;
}

/**
 * Baut genau EINEN beobachtbaren Request für das gewählte Werkzeug. Kein frei wählbares Ziel --
 * die Domain kommt getrennt aus der Umgebung (#37). Variierende Teile (Suchbegriff, Pfad) über
 * `rng`, damit das Muster "wechselnd" ist und Tests es dennoch festlegen können.
 */
export function buildToolRequest(tool: AttackTool, opts: BuildToolOptions = {}): ToolRequest {
	const rng = opts.rng ?? Math.random;
	const normalUa = opts.disguise ? DISGUISE_USER_AGENT : SCRIPT_USER_AGENT;
	switch (tool) {
		case AttackTool.SEARCH_FLOOD:
			return { method: 'GET', path: `/suche?q=${encodeURIComponent(pick(SEARCH_TERMS, rng))}`, userAgent: normalUa };
		case AttackTool.LOGIN_RUSH:
			return { method: 'POST', path: '/login', userAgent: normalUa };
		case AttackTool.PAGE_SWEEP:
			return { method: 'GET', path: pick(SWEEP_PATHS, rng), userAgent: normalUa };
		case AttackTool.FOREIGN_COUNTRY:
			// Unauffällige Anfrage wie ein normaler Besucher: das Merkmal ist allein die Region der Maschine.
			return { method: 'GET', path: '/', userAgent: DISGUISE_USER_AGENT };
		case AttackTool.SUSPICIOUS_UA:
			// Das Erkennungsmerkmal IST der Skript-User-Agent -- Tarnung ergäbe hier keinen Sinn.
			return { method: 'GET', path: '/', userAgent: SCRIPT_USER_AGENT };
	}
}
