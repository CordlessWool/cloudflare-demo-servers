import { describe, expect, test } from 'bun:test';
import { NonceStore } from '../src/nonceStore.ts';

describe('NonceStore', () => {
	test('unbekannte Nonce -> has() false', () => {
		expect(new NonceStore().has('abc')).toBe(false);
	});

	test('nach add() wird sie als gesehen erkannt (Replay-Schutz)', () => {
		const store = new NonceStore();
		store.add('abc');
		expect(store.has('abc')).toBe(true);
		expect(store.has('def')).toBe(false);
	});
});
