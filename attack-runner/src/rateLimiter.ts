/**
 * Harte Rate-Obergrenze im Runner (#37: "~1 Anfrage/5s je Machine", UNABHÄNGIG davon, was ein
 * Befehl verlangt -- ein kompromittierter/fehlerhafter Befehl kann diese Untergrenze nicht
 * unterschreiten, weil der Aufrufer sie gar nicht übergibt). Reine Zeit-Logik, `now`/`sleep`
 * injiziert, damit ohne echtes Warten testbar.
 */
import { RATE_FLOOR_MS } from './const.ts';

export class RateLimiter {
	private lastRequestAt: number | null = null;

	constructor(private readonly floorMs: number = RATE_FLOOR_MS) {}

	/**
	 * Wie viele ms bis zur nächsten erlaubten Anfrage, ausgehend von `now` (0, wenn sofort erlaubt).
	 * `intervalMs` (aus dem Tempo) kann den Abstand nur VERLÄNGERN, nie unter die Untergrenze senken.
	 */
	msUntilNextAllowed(now: number, intervalMs: number = this.floorMs): number {
		if (this.lastRequestAt === null) return 0;
		return Math.max(0, Math.max(this.floorMs, intervalMs) - (now - this.lastRequestAt));
	}

	/** Muss direkt VOR jeder tatsächlich gesendeten Anfrage aufgerufen werden. */
	recordRequest(now: number): void {
		this.lastRequestAt = now;
	}
}
