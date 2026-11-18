/**
 * Zähler für Requests (#13): RAM-Ringpuffer mit fester Obergrenge, je Eintrag Host, Pfad,
 * Zeit, CF-Connecting-IP und CF-Ray. `/health` wird nicht gezählt. Neustart = leer ist ok.
 *
 * Billig halten: kein Logging pro Request auf die Platte, keine Datei pro Request (siehe #13,
 * Abschnitt "Ein Kern, 512 MB").
 */

export interface RequestRecord {
	host: string;
	path: string;
	time: number; // ms epoch
	/** Anzeige-IP: bevorzugt CF-Connecting-IP (Cloudflare davor), sonst die Gegenstelle. */
	ip: string;
	/** `CF-Connecting-IP`, falls Cloudflare vorgeschaltet ist (sonst null). */
	cfIp: string | null;
	/** Gegenstelle laut `X-Forwarded-For` (von Caddy gesetzt, sonst null, z.B. in Tests). */
	peerIp: string | null;
	ray: string;
}

export class RequestCounter {
	private buf: RequestRecord[];
	private cap: number;
	private writeIndex = 0;
	private size = 0;

	constructor(cap: number) {
		this.cap = Math.max(1, cap);
		this.buf = new Array(this.cap);
	}

	add(record: RequestRecord): void {
		this.buf[this.writeIndex] = record;
		this.writeIndex = (this.writeIndex + 1) % this.cap;
		this.size = Math.min(this.size + 1, this.cap);
	}

	/** Alle Einträge für einen Host seit `since` (ms epoch), neueste zuletzt. */
	entriesSince(host: string, since: number): RequestRecord[] {
		const out: RequestRecord[] = [];
		for (let i = 0; i < this.size; i++) {
			const rec = this.buf[i];
			if (rec && rec.host === host && rec.time >= since) out.push(rec);
		}
		out.sort((a, b) => a.time - b.time);
		return out;
	}

	/** Requests/Sekunde über die letzten `windowMs` (Default 10s) für einen Host, aktuell. */
	currentRatePerSecond(host: string, now: number, windowMs = 10_000): number {
		let count = 0;
		for (let i = 0; i < this.size; i++) {
			const rec = this.buf[i];
			if (rec && rec.host === host && rec.time >= now - windowMs) count++;
		}
		return count / (windowMs / 1000);
	}

	sizeOf(): number {
		return this.size;
	}
}

export interface StatsResult {
	host: string;
	since: number;
	now: number;
	totalRequests: number;
	requestsPerSecond: number;
	capacityPerSecond: number;
	utilization: number; // requestsPerSecond / capacityPerSecond
	byPath: Record<string, number>;
}

export function computeStats(
	counter: RequestCounter,
	host: string,
	since: number,
	now: number,
	capacityPerSecond: number
): StatsResult {
	const entries = counter.entriesSince(host, since);
	const byPath: Record<string, number> = {};
	for (const e of entries) byPath[e.path] = (byPath[e.path] ?? 0) + 1;
	const requestsPerSecond = counter.currentRatePerSecond(host, now);
	return {
		host,
		since,
		now,
		totalRequests: entries.length,
		requestsPerSecond,
		capacityPerSecond,
		utilization: capacityPerSecond > 0 ? requestsPerSecond / capacityPerSecond : 0,
		byPath
	};
}
