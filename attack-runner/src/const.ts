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

/** Harte Rate-Obergrenze: 1 Anfrage/s je Machine (#37, ab v4 für Tempo `fast`). Der Runner erzwingt
 * das SELBST, egal was ein (kompromittierter) Befehl verlangen würde. */
export const RATE_FLOOR_MS = 1000;

/** Takt der Hauptschleife: so oft wird geprüft, ob die nächste Anfrage fällig ist (= Untergrenze). */
export const LOOP_TICK_MS = RATE_FLOOR_MS;

/** Selbstzerstörungs-Timer als Sicherheitsnetz, unabhängig von Befehlen/Netzwerk. */
export const SELF_DESTRUCT_MS = 45 * 60 * 1000;

/** Abstand zwischen zwei Befehls-Abholungen. */
export const COMMAND_POLL_INTERVAL_MS = 5000;

/** Abstand zwischen zwei Meldungen der Antwortklassen-Zählung an die App. */
export const REPORT_INTERVAL_MS = 15000;
