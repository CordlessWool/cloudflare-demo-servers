import { describe, expect, test } from 'bun:test';
import { AttackTool, buildToolRequest, isAttackTool, SCRIPT_USER_AGENT, DISGUISE_USER_AGENT, SEARCH_TERMS, SWEEP_PATHS } from '../src/tools.ts';

describe('isAttackTool', () => {
	test('erkennt die festen Werkzeuge, lehnt alles andere ab', () => {
		expect(isAttackTool('search_flood')).toBe(true);
		expect(isAttackTool('login_rush')).toBe(true);
		expect(isAttackTool('direct_ip')).toBe(false);
		expect(isAttackTool(null)).toBe(false);
		expect(isAttackTool(42)).toBe(false);
	});
});

describe('buildToolRequest', () => {
	test('Suche-Flut: GET /suche?q= mit Begriff aus der festen Liste', () => {
		const req = buildToolRequest(AttackTool.SEARCH_FLOOD, { rng: () => 0 });
		expect(req.method).toBe('GET');
		expect(req.path).toBe(`/suche?q=${encodeURIComponent(SEARCH_TERMS[0])}`);
		expect(req.userAgent).toBe(SCRIPT_USER_AGENT);
	});

	test('wechselnde Begriffe über rng', () => {
		const a = buildToolRequest(AttackTool.SEARCH_FLOOD, { rng: () => 0 }).path;
		const b = buildToolRequest(AttackTool.SEARCH_FLOOD, { rng: () => 0.99 }).path;
		expect(a).not.toBe(b);
	});

	test('Login-Ansturm: POST /login', () => {
		expect(buildToolRequest(AttackTool.LOGIN_RUSH)).toMatchObject({ method: 'POST', path: '/login' });
	});

	test('Seiten-Abgrasen: GET auf einen Pfad aus der Liste (auch nicht vorhandene)', () => {
		const req = buildToolRequest(AttackTool.PAGE_SWEEP, { rng: () => 0.99 });
		expect(req.method).toBe('GET');
		expect(SWEEP_PATHS as readonly string[]).toContain(req.path);
	});

	test('Auffälliger User-Agent: immer der Skript-UA, Tarnung wird ignoriert', () => {
		expect(buildToolRequest(AttackTool.SUSPICIOUS_UA).userAgent).toBe(SCRIPT_USER_AGENT);
		expect(buildToolRequest(AttackTool.SUSPICIOUS_UA, { disguise: true }).userAgent).toBe(SCRIPT_USER_AGENT);
	});

	test('Fremdes Land: unauffällige GET / mit Browser-UA (Merkmal ist die Region)', () => {
		expect(buildToolRequest(AttackTool.FOREIGN_COUNTRY)).toMatchObject({ method: 'GET', path: '/', userAgent: DISGUISE_USER_AGENT });
	});

	test('Tarnung schaltet bei den anderen Werkzeugen auf Browser-UA um', () => {
		expect(buildToolRequest(AttackTool.SEARCH_FLOOD, { disguise: true, rng: () => 0 }).userAgent).toBe(DISGUISE_USER_AGENT);
		expect(buildToolRequest(AttackTool.PAGE_SWEEP, { disguise: true, rng: () => 0 }).userAgent).toBe(DISGUISE_USER_AGENT);
	});
});
