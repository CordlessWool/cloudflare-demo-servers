/**
 * Feste Wertemengen, dupliziert zu games/cloudflare-zone/src/lib/server/const.ts (eigenes
 * Bun-Package, andere Runtime als der SvelteKit-Worker -- gemeinsame Quelle ist
 * docs/attack-protocol.md, nicht ein geteiltes npm-Package). Bei Änderung an der App-Seite
 * HIER NACHZIEHEN, sonst verifiziert der Runner Befehle/Meldungen falsch.
 */
export const ResponseClass = {
	PASSED: 'passed',
	BLOCKED: 'blocked',
	CACHED: 'cached',
	ORIGIN_OVERLOAD: 'origin_overload'
} as const;
export type ResponseClass = (typeof ResponseClass)[keyof typeof ResponseClass];

/** Harte Rate-Obergrenze: ~1 Anfrage/5s je Machine (#37). Der Runner erzwingt das SELBST, egal
 * was ein (kompromittierter) Befehl verlangen würde. */
export const RATE_FLOOR_MS = 5000;

/** Selbstzerstörungs-Timer als Sicherheitsnetz, unabhängig von Befehlen/Netzwerk. */
export const SELF_DESTRUCT_MS = 45 * 60 * 1000;

/** Abstand zwischen zwei Befehls-Abholungen. */
export const COMMAND_POLL_INTERVAL_MS = 5000;

/** Abstand zwischen zwei Meldungen der Antwortklassen-Zählung an die App. */
export const REPORT_INTERVAL_MS = 15000;
