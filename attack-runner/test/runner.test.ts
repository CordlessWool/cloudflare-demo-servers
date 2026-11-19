import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { fetchAndVerifyCommand, maybeSendAttackRequest, sendReport, mergeCounts, validateTargetDomain, ReplayedNonceError, InvalidCommandError, InvalidTargetDomainError, type AttackCommandPayload, type RunnerConfig, type RunnerDeps } from '../src/runner.ts';
import { NonceStore } from '../src/nonceStore.ts';
import { RateLimiter } from '../src/rateLimiter.ts';
import { signPayload, verifySignedCommand } from '../src/signing.ts';
import { emptyCounts } from '../src/classify.ts';
import { AttackIdentity, AttackPace, AttackTarget, SCRIPT_USER_AGENT } from '../src/tools.ts';

const SECRET = 'test-secret';
const POLL_TOKEN = 'poll-token';
const MACHINE_ID = 'mock-attack-1';

function makePayload(overrides: Partial<AttackCommandPayload> = {}): AttackCommandPayload {
	const now = 1_000_000;
	return {
		sessionId: 's1',
		teamId: 't1',
		machineId: MACHINE_ID,
		toolEnabled: true,
		protocolVersion: 2,
			target: AttackTarget.SEARCH,
			identity: AttackIdentity.SCRIPT,
			cacheBust: false,
			pace: AttackPace.NORMAL,		minIntervalMs: 5000,
		issuedAt: now,
		expiresAt: now + 30_000,
		nonce: `nonce-${Math.random()}`,
		...overrides
	};
}

function makeConfig(overrides: Partial<RunnerConfig> = {}): RunnerConfig {
	return { appBaseUrl: 'http://127.0.0.1:0', machineId: MACHINE_ID, pollToken: POLL_TOKEN, commandSecret: SECRET, targetDomain: 'team-b.example.test', ...overrides };
}

function deps(fetchFn: typeof fetch): RunnerDeps {
	let clock = 1_000_000;
	return { fetchFn, now: () => clock++, log: () => {} };
}

describe('fetchAndVerifyCommand', () => {
	let server: ReturnType<typeof Bun.serve>;
	let reportedBodies: unknown[] = [];

	beforeEach(() => {
		reportedBodies = [];
	});

	afterEach(() => {
		server?.stop(true);
	});

	test('akzeptiert einen frischen, gültigen Befehl', async () => {
		const payload = makePayload();
		server = Bun.serve({
			port: 0,
			fetch: async (req) => {
				const url = new URL(req.url);
				if (url.pathname === '/api/attack/command') {
					return Response.json(await signPayload(SECRET, payload));
				}
				return new Response('not found', { status: 404 });
			}
		});
		const config = makeConfig({ appBaseUrl: `http://127.0.0.1:${server.port}` });
		const result = await fetchAndVerifyCommand(deps(fetch), config, new NonceStore());
		expect(result).toEqual(payload);
	});

	test('lehnt eine zweite Zustellung derselben Nonce ab (Replay)', async () => {
		const payload = makePayload();
		server = Bun.serve({
			port: 0,
			fetch: async () => Response.json(await signPayload(SECRET, payload))
		});
		const config = makeConfig({ appBaseUrl: `http://127.0.0.1:${server.port}` });
		const nonceStore = new NonceStore();
		await fetchAndVerifyCommand(deps(fetch), config, nonceStore);
		await expect(fetchAndVerifyCommand(deps(fetch), config, nonceStore)).rejects.toBeInstanceOf(ReplayedNonceError);
	});

	test('lehnt einen Befehl für eine andere Machine ab', async () => {
		const payload = makePayload({ machineId: 'andere-machine' });
		server = Bun.serve({ port: 0, fetch: async () => Response.json(await signPayload(SECRET, payload)) });
		const config = makeConfig({ appBaseUrl: `http://127.0.0.1:${server.port}` });
		await expect(fetchAndVerifyCommand(deps(fetch), config, new NonceStore())).rejects.toThrow();
	});

	const invalid: [string, Record<string, unknown>][] = [
		['protocolVersion 1', { protocolVersion: 1 }],
		['protocolVersion 3', { protocolVersion: 3 }],
		['unbekanntes target', { target: 'search_flood' }],
		['unbekannte identity', { identity: 'curl' }],
		['unbekanntes pace', { pace: 'warp' }],
		['cacheBust kein boolean', { cacheBust: 'ja' }]
	];
	for (const [name, override] of invalid) {
		test(`lehnt gültig signierten Befehl mit ${name} ab (wie falsche Signatur)`, async () => {
			const payload = makePayload(override as Partial<AttackCommandPayload>);
			server = Bun.serve({ port: 0, fetch: async () => Response.json(await signPayload(SECRET, payload)) });
			const config = makeConfig({ appBaseUrl: `http://127.0.0.1:${server.port}` });
			await expect(fetchAndVerifyCommand(deps(fetch), config, new NonceStore())).rejects.toBeInstanceOf(InvalidCommandError);
		});
	}
});

describe('maybeSendAttackRequest', () => {
	let targetServer: ReturnType<typeof Bun.serve>;
	afterEach(() => targetServer?.stop(true));

	test('deaktiviertes Werkzeug -> kein Request, null zurück', async () => {
		const payload = makePayload({ toolEnabled: false });
		const result = await maybeSendAttackRequest(deps(fetch), makeConfig(), payload, new RateLimiter(5000));
		expect(result).toBeNull();
	});

	test('aktives Werkzeug: greift NUR das Ziel aus der Umgebung an, nicht aus dem Befehl, zählt die Klasse', async () => {
		targetServer = Bun.serve({ port: 0, fetch: () => new Response('shop-inhalt', { status: 200 }) });
		const payload = makePayload({ toolEnabled: true });
		const config = makeConfig({ targetDomain: `127.0.0.1:${targetServer.port}` });
		const result = await maybeSendAttackRequest({ ...deps(fetch), targetScheme: 'http' }, config, payload, new RateLimiter(5000));
		expect(result).toEqual({ passed: 1, blocked: 0, cached: 0, origin_overload: 0 });
	});

	test('Bausteine bestimmen Methode, Pfad, Body und User-Agent des Requests', async () => {
		const seen: { value: { method: string; path: string; ua: string | null; ct: string | null; body: string } | null } = { value: null };
		targetServer = Bun.serve({
			port: 0,
			fetch: async (req) => {
				const u = new URL(req.url);
				seen.value = { method: req.method, path: u.pathname, ua: req.headers.get('user-agent'), ct: req.headers.get('content-type'), body: await req.text() };
				return new Response('ok', { status: 200 });
			}
		});
		const config = makeConfig({ targetDomain: `127.0.0.1:${targetServer.port}` });
		await maybeSendAttackRequest({ ...deps(fetch), targetScheme: 'http' }, config, makePayload({ target: AttackTarget.LOGIN }), new RateLimiter(5000));
		expect(seen.value?.method).toBe('POST');
		expect(seen.value?.path).toBe('/login');
		expect(seen.value?.ua).toBe(SCRIPT_USER_AGENT);
		expect(seen.value?.ct).toBe('application/x-www-form-urlencoded');
		expect(seen.value?.body).toMatch(/^username=[^&]+&password=geheim123$/);
	});

	test('identity none: der Server sieht einen leeren user-agent, nicht Bun/...', async () => {
		const seen: { ua: string | null } = { ua: 'unset' };
		targetServer = Bun.serve({
			port: 0,
			fetch: (req) => {
				seen.ua = req.headers.get('user-agent');
				return new Response('ok', { status: 200 });
			}
		});
		const config = makeConfig({ targetDomain: `127.0.0.1:${targetServer.port}` });
		await maybeSendAttackRequest({ ...deps(fetch), targetScheme: 'http' }, config, makePayload({ target: AttackTarget.HOME, identity: AttackIdentity.NONE }), new RateLimiter(5000));
		expect(seen.ua).toBe('');
	});

	test('cacheBust hängt v= an den gesendeten Pfad', async () => {
		const seen: { search: string } = { search: '' };
		targetServer = Bun.serve({
			port: 0,
			fetch: (req) => {
				seen.search = new URL(req.url).search;
				return new Response('ok', { status: 200 });
			}
		});
		const config = makeConfig({ targetDomain: `127.0.0.1:${targetServer.port}` });
		await maybeSendAttackRequest({ ...deps(fetch), targetScheme: 'http' }, config, makePayload({ target: AttackTarget.HOME, cacheBust: true }), new RateLimiter(5000));
		expect(seen.search).toMatch(/^\?v=[0-9a-f]{8}$/);
	});

	test('ungültige Bausteine -> kein fetch, InvalidCommandError', async () => {
		let calls = 0;
		const countingFetch = (async () => {
			calls++;
			return new Response('ok');
		}) as unknown as typeof fetch;
		const bad = makePayload({ target: 'nope' as never });
		await expect(maybeSendAttackRequest({ ...deps(countingFetch), targetScheme: 'http' }, makeConfig(), bad, new RateLimiter(5000))).rejects.toBeInstanceOf(InvalidCommandError);
		expect(calls).toBe(0);
	});

	test('pace slow: nach 5 s noch gesperrt, nach 20 s erlaubt; normal nach 5 s erlaubt', async () => {
		targetServer = Bun.serve({ port: 0, fetch: () => new Response('ok', { status: 200 }) });
		const config = makeConfig({ targetDomain: `127.0.0.1:${targetServer.port}` });
		const at = (t: number): RunnerDeps => ({ fetchFn: fetch, now: () => t, log: () => {}, targetScheme: 'http' });
		const slow = makePayload({ target: AttackTarget.HOME, pace: AttackPace.SLOW, minIntervalMs: 5000 });
		const limiter = new RateLimiter(5000);
		limiter.recordRequest(1_000_000);
		expect(await maybeSendAttackRequest(at(1_005_000), config, slow, limiter)).toBeNull();
		expect(await maybeSendAttackRequest(at(1_019_999), config, slow, limiter)).toBeNull();
		expect(await maybeSendAttackRequest(at(1_020_000), config, slow, limiter)).not.toBeNull();

		const normal = makePayload({ target: AttackTarget.HOME, pace: AttackPace.NORMAL, minIntervalMs: 1 });
		const l2 = new RateLimiter(5000);
		l2.recordRequest(1_000_000);
		expect(await maybeSendAttackRequest(at(1_004_999), config, normal, l2)).toBeNull();
		expect(await maybeSendAttackRequest(at(1_005_000), config, normal, l2)).not.toBeNull();
	});

	test('pace fast: nach 1 s erlaubt (RateLimiter mit Untergrenze 1000)', async () => {
		targetServer = Bun.serve({ port: 0, fetch: () => new Response('ok', { status: 200 }) });
		const config = makeConfig({ targetDomain: `127.0.0.1:${targetServer.port}` });
		const at = (t: number): RunnerDeps => ({ fetchFn: fetch, now: () => t, log: () => {}, targetScheme: 'http' });
		const fast = makePayload({ target: AttackTarget.HOME, pace: AttackPace.FAST, expiresAt: 1_999_999 });
		const limiter = new RateLimiter(1000);
		limiter.recordRequest(1_000_000);
		expect(await maybeSendAttackRequest(at(1_000_999), config, fast, limiter)).toBeNull();
		expect(await maybeSendAttackRequest(at(1_001_000), config, fast, limiter)).not.toBeNull();
	});

	test('abgelaufener Befehl (expiresAt erreicht): kein Request, null zurück', async () => {
		let calls = 0;
		const countingFetch = (async () => {
			calls++;
			return new Response('ok');
		}) as unknown as typeof fetch;
		const expired = makePayload({ expiresAt: 1_000_000 });
		const d: RunnerDeps = { fetchFn: countingFetch, now: () => 1_000_000, log: () => {}, targetScheme: 'http' };
		expect(await maybeSendAttackRequest(d, makeConfig(), expired, new RateLimiter(1000))).toBeNull();
		expect(calls).toBe(0);
	});

	test('Rate-Untergrenze verhindert eine zu frühe zweite Anfrage', async () => {
		targetServer = Bun.serve({ port: 0, fetch: () => new Response('ok', { status: 200 }) });
		const payload = makePayload();
		const config = makeConfig({ targetDomain: `127.0.0.1:${targetServer.port}` });
		const limiter = new RateLimiter(5000);
		limiter.recordRequest(1_000_000);
		const runnerDeps: RunnerDeps = { fetchFn: fetch, now: () => 1_000_001, log: () => {}, targetScheme: 'http' };
		const result = await maybeSendAttackRequest(runnerDeps, config, payload, limiter);
		expect(result).toBeNull();
	});
});

describe('validateTargetDomain', () => {
	test('akzeptiert eine Domain und eine Domain mit Port', () => {
		expect(validateTargetDomain('team-b.example.test')).toBe('team-b.example.test');
		expect(validateTargetDomain('  shop.beispiel.de:443 ')).toBe('shop.beispiel.de:443');
	});

	test('lehnt IP-Literale ab (nur Domains hinter Cloudflare)', () => {
		expect(() => validateTargetDomain('127.0.0.1')).toThrow(InvalidTargetDomainError);
		expect(() => validateTargetDomain('203.0.113.7:8080')).toThrow(InvalidTargetDomainError);
	});

	test('lehnt leere, schemabehaftete und einfache Labels ab', () => {
		expect(() => validateTargetDomain('')).toThrow(InvalidTargetDomainError);
		expect(() => validateTargetDomain('https://team-b.example.test/')).toThrow(InvalidTargetDomainError);
		expect(() => validateTargetDomain('localhost')).toThrow(InvalidTargetDomainError);
	});
});

describe('sendReport', () => {
	let server: ReturnType<typeof Bun.serve>;
	afterEach(() => server?.stop(true));

	test('meldet signierte Zählung an die App', async () => {
		let received: unknown = null;
		server = Bun.serve({
			port: 0,
			fetch: async (req) => {
				received = await req.json();
				return Response.json({ ok: true });
			}
		});
		const config = makeConfig({ appBaseUrl: `http://127.0.0.1:${server.port}` });
		const payload = makePayload();
		const counts = { ...emptyCounts(), passed: 3, blocked: 1 };
		await sendReport(deps(fetch), config, payload, counts);
		expect(received).not.toBeNull();
		const envelope = received as { payload: { counts: typeof counts; machineId: string } };
		const verified = await verifySignedCommand(SECRET, envelope as never, 0);
		expect(verified).toMatchObject({ counts, machineId: MACHINE_ID });
	});
});

describe('mergeCounts', () => {
	test('summiert alle Klassen', () => {
		const a = { passed: 1, blocked: 2, cached: 0, origin_overload: 0 };
		const b = { passed: 1, blocked: 0, cached: 3, origin_overload: 1 };
		expect(mergeCounts(a, b)).toEqual({ passed: 2, blocked: 2, cached: 3, origin_overload: 1 });
	});
});
