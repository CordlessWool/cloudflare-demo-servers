import { describe, expect, test } from 'bun:test';
import {
	ADMIN_PATHS,
	AttackIdentity,
	AttackPace,
	AttackTarget,
	buildRequest,
	DISGUISE_USER_AGENT,
	GOOGLEBOT_USER_AGENT,
	intervalForPace,
	isAttackIdentity,
	isAttackPace,
	isAttackTarget,
	LOGIN_NAMES,
	LOGIN_PASSWORD,
	SCRIPT_USER_AGENT,
	SEARCH_TERMS,
	SWEEP_PATHS,
	type AttackBlocks
} from '../src/tools.ts';

function blocks(overrides: Partial<AttackBlocks> = {}): AttackBlocks {
	return { target: AttackTarget.HOME, identity: AttackIdentity.SCRIPT, cacheBust: false, pace: AttackPace.NORMAL, ...overrides };
}

describe('Validierung', () => {
	test('erkennt nur feste Werte', () => {
		expect(isAttackTarget('search')).toBe(true);
		expect(isAttackTarget('login')).toBe(true);
		expect(isAttackTarget('admin')).toBe(true);
		expect(isAttackTarget('sweep')).toBe(true);
		expect(isAttackTarget('home')).toBe(true);
		expect(isAttackTarget('search_flood')).toBe(false);
		expect(isAttackTarget(null)).toBe(false);
		expect(isAttackIdentity('script')).toBe(true);
		expect(isAttackIdentity('none')).toBe(true);
		expect(isAttackIdentity('curl')).toBe(false);
		expect(isAttackIdentity(42)).toBe(false);
		expect(isAttackPace('normal')).toBe(true);
		expect(isAttackPace('slow')).toBe(true);
		expect(isAttackPace('fast')).toBe(false);
		expect(isAttackPace(undefined)).toBe(false);
	});
});

describe('buildRequest: target', () => {
	test('search: GET /suche?q= mit Begriff aus der Liste', () => {
		const req = buildRequest(blocks({ target: AttackTarget.SEARCH }), () => 0);
		expect(req.method).toBe('GET');
		expect(req.path).toBe(`/suche?q=${encodeURIComponent(SEARCH_TERMS[0])}`);
		expect(req.body).toBeUndefined();
	});

	test('search: wechselnde Begriffe über rng', () => {
		const a = buildRequest(blocks({ target: AttackTarget.SEARCH }), () => 0).path;
		const b = buildRequest(blocks({ target: AttackTarget.SEARCH }), () => 0.99).path;
		expect(a).not.toBe(b);
	});

	test('login: POST /login, Formular-Body mit Name aus der Liste und festem Passwort', () => {
		const req = buildRequest(blocks({ target: AttackTarget.LOGIN }), () => 0);
		expect(req.method).toBe('POST');
		expect(req.path).toBe('/login');
		expect(req.headers['content-type']).toBe('application/x-www-form-urlencoded');
		expect(req.body).toBe(`username=${encodeURIComponent(LOGIN_NAMES[0])}&password=${LOGIN_PASSWORD}`);
		expect(LOGIN_PASSWORD).toBe('geheim123');
	});

	test('login: Name wechselt über rng und stammt aus der Liste', () => {
		const req = buildRequest(blocks({ target: AttackTarget.LOGIN }), () => 0.99);
		const name = new URLSearchParams(req.body).get('username') ?? '';
		expect(LOGIN_NAMES as readonly string[]).toContain(name);
		expect(name).toBe(LOGIN_NAMES[LOGIN_NAMES.length - 1]!);
	});

	test('admin: GET auf einen der drei Admin-Pfade', () => {
		expect(ADMIN_PATHS).toEqual(['/admin', '/ADMIN', '/Admin/bestellungen']);
		expect(buildRequest(blocks({ target: AttackTarget.ADMIN }), () => 0)).toMatchObject({ method: 'GET', path: '/admin' });
		expect(buildRequest(blocks({ target: AttackTarget.ADMIN }), () => 0.99)).toMatchObject({ method: 'GET', path: '/Admin/bestellungen' });
	});

	test('sweep: GET auf einen Pfad aus SWEEP_PATHS', () => {
		const req = buildRequest(blocks({ target: AttackTarget.SWEEP }), () => 0.99);
		expect(req.method).toBe('GET');
		expect(SWEEP_PATHS as readonly string[]).toContain(req.path);
	});

	test('home: GET /', () => {
		expect(buildRequest(blocks({ target: AttackTarget.HOME }))).toMatchObject({ method: 'GET', path: '/' });
	});
});

describe('buildRequest: identity', () => {
	test('script, browser, googlebot setzen den jeweiligen User-Agent', () => {
		expect(buildRequest(blocks({ identity: AttackIdentity.SCRIPT })).headers['user-agent']).toBe(SCRIPT_USER_AGENT);
		expect(SCRIPT_USER_AGENT).toBe('BohnenkraftLastTest/1.0 (+Cloudflare-Schulung)');
		expect(buildRequest(blocks({ identity: AttackIdentity.BROWSER })).headers['user-agent']).toBe(DISGUISE_USER_AGENT);
		expect(buildRequest(blocks({ identity: AttackIdentity.GOOGLEBOT })).headers['user-agent']).toBe(GOOGLEBOT_USER_AGENT);
		expect(GOOGLEBOT_USER_AGENT).toBe('Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)');
	});

	test('none: Header user-agent ist vorhanden, aber leer', () => {
		const req = buildRequest(blocks({ identity: AttackIdentity.NONE }));
		expect('user-agent' in req.headers).toBe(true);
		expect(req.headers['user-agent']).toBe('');
	});
});

describe('buildRequest: cacheBust', () => {
	test('ohne cacheBust kein v=', () => {
		expect(buildRequest(blocks({ target: AttackTarget.HOME })).path).toBe('/');
	});

	test('hängt ?v=<8 Hex> an einen Pfad ohne Query', () => {
		expect(buildRequest(blocks({ cacheBust: true }), () => 0).path).toMatch(/^\/\?v=[0-9a-f]{8}$/);
	});

	test('hängt &v=<8 Hex> an einen Pfad mit Query', () => {
		const req = buildRequest(blocks({ target: AttackTarget.SEARCH, cacheBust: true }), () => 0.5);
		expect(req.path).toMatch(/^\/suche\?q=[^&]+&v=[0-9a-f]{8}$/);
	});

	test('wechselnder Wert über rng', () => {
		const a = buildRequest(blocks({ cacheBust: true }), () => 0.1).path;
		const b = buildRequest(blocks({ cacheBust: true }), () => 0.9).path;
		expect(a).not.toBe(b);
	});
});

describe('intervalForPace', () => {
	test('normal = 5000, slow = 20000, nie unter 5000', () => {
		expect(intervalForPace(AttackPace.NORMAL)).toBe(5000);
		expect(intervalForPace(AttackPace.SLOW)).toBe(20000);
		expect(intervalForPace(AttackPace.NORMAL)).toBeGreaterThanOrEqual(5000);
	});
});
