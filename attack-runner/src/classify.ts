/**
 * Klassifiziert eine Antwort auf den Angriffs-Request (#37, Abschnitt "Messung" in #20). Muss
 * zur Logik in games/cloudflare-zone/src/lib/server/responseClass.ts passen (docs/attack-
 * protocol.md ist die verbindliche Beschreibung, siehe const.ts-Kopfkommentar).
 */
import { ResponseClass } from './const.ts';

export interface ClassifiableResponse {
	status: number;
	headers: Headers | Record<string, string>;
}

function header(headers: Headers | Record<string, string>, name: string): string | null {
	if (headers instanceof Headers) return headers.get(name);
	const key = Object.keys(headers).find((k) => k.toLowerCase() === name.toLowerCase());
	return key ? headers[key]! : null;
}

export function classifyResponse(res: ClassifiableResponse): ResponseClass {
	const mitigated = header(res.headers, 'cf-mitigated');
	if (res.status === 403 || res.status === 429 || mitigated) return ResponseClass.BLOCKED;
	if (res.status === 503) return ResponseClass.ORIGIN_OVERLOAD;
	if (header(res.headers, 'cf-cache-status')?.toUpperCase() === 'HIT') return ResponseClass.CACHED;
	return ResponseClass.PASSED;
}

export type ResponseClassCounts = Record<ResponseClass, number>;

export function emptyCounts(): ResponseClassCounts {
	return { [ResponseClass.PASSED]: 0, [ResponseClass.BLOCKED]: 0, [ResponseClass.CACHED]: 0, [ResponseClass.ORIGIN_OVERLOAD]: 0 };
}

export function addToCounts(counts: ResponseClassCounts, cls: ResponseClass): ResponseClassCounts {
	return { ...counts, [cls]: counts[cls] + 1 };
}
