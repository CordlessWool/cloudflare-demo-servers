import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { fetchAndVerifyCommand, maybeSendAttackRequest, sendReport, mergeCounts, validateTargetDomain, ReplayedNonceError, InvalidTargetDomainError, type AttackCommandPayload, type RunnerConfig, type RunnerDeps } from '../src/runner.ts';
import { NonceStore } from '../src/nonceStore.ts';
import { RateLimiter } from '../src/rateLimiter.ts';
import { signPayload, verifySignedCommand } from '../src/signing.ts';
import { emptyCounts } from '../src/classify.ts';
import { AttackTool } from '../src/tools.ts';

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
		tool: AttackTool.SEARCH_FLOOD,
		disguise: false,
		minIntervalMs: 5000,
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

	test('Werkzeug bestimmt Methode, Pfad und User-Agent des Requests (#38)', async () => {
		const seen: { value: { method: string; path: string; ua: string | null } | null } = { value: null };
		targetServer = Bun.serve({
			port: 0,
			fetch: (req) => {
				const u = new URL(req.url);
				seen.value = { method: req.method, path: u.pathname, ua: req.headers.get('user-agent') };
				return new Response('ok', { status: 200 });
			}
		});
		const config = makeConfig({ targetDomain: `127.0.0.1:${targetServer.port}` });
		await maybeSendAttackRequest({ ...deps(fetch), targetScheme: 'http' }, config, makePayload({ tool: AttackTool.LOGIN_RUSH }), new RateLimiter(5000));
		expect(seen.value).toEqual({ method: 'POST', path: '/login', ua: 'BohnenkraftLastTest/1.0 (+Cloudflare-Schulung)' });
	});

	test('Werkzeug an, aber tool=null -> kein Request', async () => {
		const result = await maybeSendAttackRequest(deps(fetch), makeConfig(), makePayload({ tool: null }), new RateLimiter(5000));
		expect(result).toBeNull();
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
