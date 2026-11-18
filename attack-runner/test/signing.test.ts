import { describe, expect, test } from 'bun:test';
import { ExpiredCommandError, InvalidSignatureError, signPayload, verifySignedCommand } from '../src/signing.ts';

interface SamplePayload {
	targetDomain: string;
	expiresAt: number;
}

describe('signPayload/verifySignedCommand', () => {
	test('gültige Signatur, nicht abgelaufen -> Payload kommt zurück', async () => {
		const payload: SamplePayload = { targetDomain: 'team-b.example.test', expiresAt: 1000 };
		const envelope = await signPayload('secret-1', payload);
		expect(await verifySignedCommand('secret-1', envelope, 500)).toEqual(payload);
	});

	test('falsches Secret -> InvalidSignatureError', async () => {
		const envelope = await signPayload('secret-1', { targetDomain: 'x', expiresAt: 1000 });
		await expect(verifySignedCommand('anderes-secret', envelope, 500)).rejects.toBeInstanceOf(InvalidSignatureError);
	});

	test('manipuliertes Ziel -> InvalidSignatureError (der Runner kann das Ziel nicht ändern)', async () => {
		const envelope = await signPayload('secret-1', { targetDomain: 'echtes-ziel.test', expiresAt: 1000 });
		const tampered = { ...envelope, payload: { ...envelope.payload, targetDomain: 'anderes-ziel.test' } };
		await expect(verifySignedCommand('secret-1', tampered, 500)).rejects.toBeInstanceOf(InvalidSignatureError);
	});

	test('abgelaufen -> ExpiredCommandError', async () => {
		const envelope = await signPayload('secret-1', { targetDomain: 'x', expiresAt: 1000 });
		await expect(verifySignedCommand('secret-1', envelope, 1001)).rejects.toBeInstanceOf(ExpiredCommandError);
	});
});
