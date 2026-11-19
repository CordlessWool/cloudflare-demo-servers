/**
 * Angriffs-Baukasten (Protokoll v2): Der Befehl wählt je Baustein einen Wert aus festen Mengen
 * (Ziel, Kennung, Cache umgehen, Tempo); der Runner baut daraus genau EINEN beobachtbaren
 * Request. Kein Ziel, keine URL, keine Rate, kein Header frei wählbar -- unbekannte Werte werden
 * abgelehnt (siehe `isAttackTarget` & Co., Aufrufer in runner.ts).
 *
 * Diese Datei ist zu games/cloudflare-zone/src/lib/server/const.ts / attackBlocks.ts dupliziert
 * (andere Runtime). Gemeinsame Quelle ist PROTOCOL.md -- bei Änderung HIER UND dort nachziehen.
 */
import { RATE_FLOOR_MS } from './const.ts';

export const AttackTarget = {
	/** Suche: `GET /suche?q=<wechselnd>` */
	SEARCH: 'search',
	/** Login: `POST /login` mit Formular-Body */
	LOGIN: 'login',
	/** Admin-Bereich: `GET` auf einen der Admin-Pfade (auch andere Schreibweise) */
	ADMIN: 'admin',
	/** Abgrasen: `GET` auf wechselnde, auch nicht vorhandene Pfade */
	SWEEP: 'sweep',
	/** Startseite: `GET /` */
	HOME: 'home'
} as const;
export type AttackTarget = (typeof AttackTarget)[keyof typeof AttackTarget];

export const AttackIdentity = {
	/** Ehrlicher Skript-User-Agent */
	SCRIPT: 'script',
	/** Normaler Browser-User-Agent */
	BROWSER: 'browser',
	/** Googlebot-User-Agent (nur behauptet, nicht echt) */
	GOOGLEBOT: 'googlebot',
	/** Kein User-Agent (leerer Header) */
	NONE: 'none'
} as const;
export type AttackIdentity = (typeof AttackIdentity)[keyof typeof AttackIdentity];

export const AttackPace = {
	NORMAL: 'normal',
	SLOW: 'slow'
} as const;
export type AttackPace = (typeof AttackPace)[keyof typeof AttackPace];

function isOneOf<T extends Record<string, string>>(set: T, value: unknown): value is T[keyof T] {
	return typeof value === 'string' && (Object.values(set) as string[]).includes(value);
}

export function isAttackTarget(value: unknown): value is AttackTarget {
	return isOneOf(AttackTarget, value);
}
export function isAttackIdentity(value: unknown): value is AttackIdentity {
	return isOneOf(AttackIdentity, value);
}
export function isAttackPace(value: unknown): value is AttackPace {
	return isOneOf(AttackPace, value);
}

/** Skript-User-Agent (ehrlich gekennzeichnet, Schulung). */
export const SCRIPT_USER_AGENT = 'BohnenkraftLastTest/1.0 (+Cloudflare-Schulung)';

/** Browser-User-Agent: sieht aus wie ein normaler Besucher. */
export const DISGUISE_USER_AGENT =
	'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

/** Googlebot-User-Agent. Die Maschine ist KEIN echter Googlebot -- nur die Behauptung im Header. */
export const GOOGLEBOT_USER_AGENT = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';

/** Wechselnde Suchbegriffe (bewusst harmlose Shop-Begriffe). */
export const SEARCH_TERMS = ['espresso', 'filterkaffee', 'bohnen', 'mahlwerk', 'crema', 'robusta', 'arabica', 'entkoffeiniert', 'cold brew', 'kanne'] as const;

/** Benutzernamen für den Login-Baustein (feste Liste, wechselnd). */
export const LOGIN_NAMES = ['admin', 'test', 'info', 'kunde', 'max', 'anna', 'shop', 'user'] as const;

/** Festes, bewusst falsches Passwort für alle Login-Versuche. */
export const LOGIN_PASSWORD = 'geheim123';

/**
 * Admin-Pfade: alle zeigen auf die Bestellübersicht (…/bestellungen), nur in wechselnder
 * Schreibweise. Der Shop behandelt den Pfad case-insensitiv, liefert also für jede Variante die
 * Bestelldaten -- eine Regel `eq "/admin/bestellungen"` greift aber nur bei genau einer Schreibweise.
 */
export const ADMIN_PATHS = ['/admin/bestellungen', '/ADMIN/BESTELLUNGEN', '/Admin/Bestellungen', '/admin/Bestellungen'] as const;

/** Pfade fürs Abgrasen, inklusive nicht vorhandener (404) -- genau das ist das Muster. */
export const SWEEP_PATHS = ['/', '/produkte', '/suche', '/warenkorb', '/login', '/kasse', '/admin', '/wp-login.php', '/.env', '/api/intern', '/gibtsnicht', '/alt/shop'] as const;

/** Tempo -> Abstand in ms. Nie unter RATE_FLOOR_MS (der Runner erzwingt das selbst). */
export function intervalForPace(pace: AttackPace): number {
	return Math.max(RATE_FLOOR_MS, pace === AttackPace.SLOW ? 20000 : 5000);
}

export interface AttackBlocks {
	target: AttackTarget;
	identity: AttackIdentity;
	cacheBust: boolean;
	pace: AttackPace;
}

export interface BuiltRequest {
	method: 'GET' | 'POST';
	/** Pfad inklusive Query. */
	path: string;
	headers: Record<string, string>;
	body?: string;
}

function pick<T>(items: readonly T[], rng: () => number): T {
	return items[Math.min(items.length - 1, Math.floor(rng() * items.length))]!;
}

function userAgentFor(identity: AttackIdentity): string {
	switch (identity) {
		case AttackIdentity.SCRIPT:
			return SCRIPT_USER_AGENT;
		case AttackIdentity.BROWSER:
			return DISGUISE_USER_AGENT;
		case AttackIdentity.GOOGLEBOT:
			return GOOGLEBOT_USER_AGENT;
		// Bun-fetch sendet ohne expliziten Header `Bun/x` -- darum ein leerer Wert statt "weglassen".
		case AttackIdentity.NONE:
			return '';
	}
}

/**
 * Baut genau EINEN Request aus den Bausteinen. Variierende Teile (Suchbegriff, Pfad, Name,
 * Cache-Umgehung) über `rng` (0..1, Default Math.random), damit Tests sie festlegen können.
 * Die Ziel-Domain kommt getrennt aus der Umgebung der Maschine.
 */
export function buildRequest(blocks: AttackBlocks, rng: () => number = Math.random): BuiltRequest {
	const headers: Record<string, string> = { 'user-agent': userAgentFor(blocks.identity) };
	let method: 'GET' | 'POST' = 'GET';
	let path: string;
	let body: string | undefined;
	switch (blocks.target) {
		case AttackTarget.SEARCH:
			path = `/suche?q=${encodeURIComponent(pick(SEARCH_TERMS, rng))}`;
			break;
		case AttackTarget.LOGIN:
			method = 'POST';
			path = '/login';
			headers['content-type'] = 'application/x-www-form-urlencoded';
			body = `username=${encodeURIComponent(pick(LOGIN_NAMES, rng))}&password=${LOGIN_PASSWORD}`;
			break;
		case AttackTarget.ADMIN:
			path = pick(ADMIN_PATHS, rng);
			break;
		case AttackTarget.SWEEP:
			path = pick(SWEEP_PATHS, rng);
			break;
		case AttackTarget.HOME:
			path = '/';
			break;
	}
	if (blocks.cacheBust) {
		const hex = Math.floor(rng() * 0x100000000).toString(16).padStart(8, '0').slice(-8);
		path += `${path.includes('?') ? '&' : '?'}v=${hex}`;
	}
	return body === undefined ? { method, path, headers } : { method, path, headers, body };
}
