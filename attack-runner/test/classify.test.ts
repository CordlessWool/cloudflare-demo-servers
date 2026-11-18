import { describe, expect, test } from 'bun:test';
import { addToCounts, classifyResponse, emptyCounts } from '../src/classify.ts';
import { ResponseClass } from '../src/const.ts';

describe('classifyResponse', () => {
	test('200 -> PASSED', () => {
		expect(classifyResponse({ status: 200, headers: {} })).toBe(ResponseClass.PASSED);
	});
	test('403/429 -> BLOCKED', () => {
		expect(classifyResponse({ status: 403, headers: {} })).toBe(ResponseClass.BLOCKED);
		expect(classifyResponse({ status: 429, headers: {} })).toBe(ResponseClass.BLOCKED);
	});
	test('cf-mitigated auch bei 200 -> BLOCKED', () => {
		expect(classifyResponse({ status: 200, headers: { 'cf-mitigated': 'challenge' } })).toBe(ResponseClass.BLOCKED);
	});
	test('cf-cache-status HIT -> CACHED', () => {
		expect(classifyResponse({ status: 200, headers: { 'CF-Cache-Status': 'HIT' } })).toBe(ResponseClass.CACHED);
	});
	test('503 -> ORIGIN_OVERLOAD', () => {
		expect(classifyResponse({ status: 503, headers: {} })).toBe(ResponseClass.ORIGIN_OVERLOAD);
	});
	test('funktioniert auch mit echten Headers-Objekten', () => {
		const headers = new Headers({ 'cf-cache-status': 'HIT' });
		expect(classifyResponse({ status: 200, headers })).toBe(ResponseClass.CACHED);
	});
});

describe('emptyCounts/addToCounts', () => {
	test('zählt isoliert pro Klasse', () => {
		let counts = emptyCounts();
		counts = addToCounts(counts, ResponseClass.PASSED);
		counts = addToCounts(counts, ResponseClass.PASSED);
		counts = addToCounts(counts, ResponseClass.BLOCKED);
		expect(counts).toEqual({ passed: 2, blocked: 1, cached: 0, origin_overload: 0 });
	});
});
