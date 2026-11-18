import { describe, expect, test } from 'bun:test';
import { RateLimiter } from '../src/rateLimiter.ts';

describe('RateLimiter', () => {
	test('erste Anfrage ist sofort erlaubt', () => {
		const limiter = new RateLimiter(5000);
		expect(limiter.msUntilNextAllowed(0)).toBe(0);
	});

	test('direkt nach einer Anfrage ist die volle Untergrenze zu warten', () => {
		const limiter = new RateLimiter(5000);
		limiter.recordRequest(1000);
		expect(limiter.msUntilNextAllowed(1000)).toBe(5000);
	});

	test('nach Ablauf der Untergrenze wieder 0', () => {
		const limiter = new RateLimiter(5000);
		limiter.recordRequest(1000);
		expect(limiter.msUntilNextAllowed(6000)).toBe(0);
		expect(limiter.msUntilNextAllowed(6001)).toBe(0);
	});

	test('mittendrin: Restwartezeit korrekt', () => {
		const limiter = new RateLimiter(5000);
		limiter.recordRequest(1000);
		expect(limiter.msUntilNextAllowed(3000)).toBe(3000);
	});
});
