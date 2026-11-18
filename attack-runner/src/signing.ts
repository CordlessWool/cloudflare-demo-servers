/**
 * Prüft die Signatur signierter Befehle der App (#37). Muss byte-identisch zur kanonischen
 * JSON-Form in games/cloudflare-zone/src/lib/server/attackSigning.ts sein (Schlüssel sortiert,
 * kein Whitespace) -- siehe docs/attack-protocol.md für die verbindliche Beschreibung. Auch
 * zum SIGNIEREN von Meldungen genutzt (gleicher Algorithmus, gleiches geteiltes Secret).
 */
export interface SignedEnvelope<T> {
	payload: T;
	signature: string;
}

function canonicalJson(value: unknown): string {
	if (value === null || typeof value !== 'object') return JSON.stringify(value);
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
	const keys = Object.keys(value as Record<string, unknown>).sort();
	const entries = keys.map((k) => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`);
	return `{${entries.join(',')}}`;
}

async function hmacHex(secret: string, message: string): Promise<string> {
	const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
	const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
	return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export class InvalidSignatureError extends Error {}
export class ExpiredCommandError extends Error {}

export async function signPayload<T>(secret: string, payload: T): Promise<SignedEnvelope<T>> {
	const signature = await hmacHex(secret, canonicalJson(payload));
	return { payload, signature };
}

export async function verifySignedCommand<T extends { expiresAt: number }>(
	secret: string,
	envelope: SignedEnvelope<T>,
	now: number
): Promise<T> {
	const expected = await hmacHex(secret, canonicalJson(envelope.payload));
	if (expected !== envelope.signature) throw new InvalidSignatureError('Signatur ungültig');
	if (now > envelope.payload.expiresAt) throw new ExpiredCommandError('Befehl abgelaufen');
	return envelope.payload;
}
