import { describe, expect, test } from 'bun:test';
import { createLoopState, runLoopStep } from '../src/loop.ts';
import { COMMAND_POLL_INTERVAL_MS, REPORT_INTERVAL_MS } from '../src/const.ts';
import { NonceStore } from '../src/nonceStore.ts';
import { RateLimiter } from '../src/rateLimiter.ts';
import { signPayload } from '../src/signing.ts';
import { AttackIdentity, AttackPace, AttackTarget } from '../src/tools.ts';
import type { AttackCommandPayload, RunnerConfig, RunnerDeps } from '../src/runner.ts';

const SECRET = 'test-secret';
const MACHINE_ID = 'mock-attack-1';
const T0 = 1_000_000;

const config: RunnerConfig = { appBaseUrl: 'http://app.test', machineId: MACHINE_ID, pollToken: 'tok', commandSecret: SECRET, targetDomain: 'team-b.example.test' };

let nonceCounter = 0;
function makePayload(): AttackCommandPayload {
	return {
		sessionId: 's1',
		teamId: 't1',
		machineId: MACHINE_ID,
		toolEnabled: true,
		protocolVersion: 2,
		target: AttackTarget.SEARCH,
		identity: AttackIdentity.SCRIPT,
		cacheBust: false,
		pace: AttackPace.FAST,
		minIntervalMs: 1000,
		issuedAt: T0,
		expiresAt: T0 + 1_000_000,
		nonce: `n-${nonceCounter++}`
	};
}

interface Harness {
	clock: { t: number };
	calls: string[];
	/** Schalter: Befehls-Abholung / Meldung schlagen fehl. */
	failCommand: boolean;
	failReport: boolean;
	deps: RunnerDeps;
}

function harness(): Harness {
	const h: Harness = { clock: { t: T0 }, calls: [], failCommand: false, failReport: false, deps: undefined as unknown as RunnerDeps };
	const fetchFn = (async (input: string | URL | Request) => {
		const url = String(input);
		if (url.startsWith('http://app.test/api/attack/command')) {
			h.calls.push('command');
			if (h.failCommand) return new Response('boom', { status: 500 });
			return Response.json(await signPayload(SECRET, makePayload()));
		}
		if (url.startsWith('http://app.test/api/attack/report')) {
			h.calls.push('report');
			if (h.failReport) throw new TypeError('network down');
			return new Response('ok');
		}
		h.calls.push('attack');
		return new Response('ok', { status: 200 });
	}) as unknown as typeof fetch;
	h.deps = { fetchFn, now: () => h.clock.t, log: () => {}, targetScheme: 'http' };
	return h;
}

function step(h: Harness, state: ReturnType<typeof createLoopState>, nonces: NonceStore, limiter: RateLimiter) {
	return runLoopStep(h.deps, config, state, nonces, limiter);
}

describe('runLoopStep', () => {
	test('gültiger Befehl sendet Anfragen', async () => {
		const h = harness();
		const state = createLoopState(T0);
		await step(h, state, new NonceStore(), new RateLimiter());
		expect(h.calls).toEqual(['command', 'attack']);
	});

	test('fehlgeschlagener Poll stoppt das Senden sofort', async () => {
		const h = harness();
		const state = createLoopState(T0);
		const nonces = new NonceStore();
		const limiter = new RateLimiter();
		await step(h, state, nonces, limiter);
		h.calls.length = 0;

		h.failCommand = true;
		h.clock.t += COMMAND_POLL_INTERVAL_MS;
		await step(h, state, nonces, limiter);
		expect(h.calls).toEqual(['command']);

		// Weitere Ticks bis zum nächsten Poll: nichts wird gesendet.
		h.calls.length = 0;
		h.clock.t += 1000;
		await step(h, state, nonces, limiter);
		expect(h.calls).toEqual([]);

		// Ein späterer erfolgreicher Poll nimmt das Senden wieder auf.
		h.failCommand = false;
		h.clock.t += COMMAND_POLL_INTERVAL_MS;
		await step(h, state, nonces, limiter);
		expect(h.calls).toEqual(['command', 'attack']);
	});

	test('nach fehlgeschlagenem Poll wird mit dem letzten guten Befehl weiter gemeldet', async () => {
		const h = harness();
		const state = createLoopState(T0);
		const nonces = new NonceStore();
		const limiter = new RateLimiter();
		await step(h, state, nonces, limiter);
		const goodNonce = state.reportPayload?.nonce;
		expect(goodNonce).toBeDefined();

		h.failCommand = true;
		h.calls.length = 0;
		h.clock.t += REPORT_INTERVAL_MS;
		await step(h, state, nonces, limiter);
		expect(h.calls).toEqual(['command', 'report']);
		expect(state.reportPayload?.nonce).toBe(goodNonce!);
		// Zählung wurde gemeldet und zurückgesetzt.
		expect(Object.values(state.counts).reduce((a, b) => a + b, 0)).toBe(0);
	});

	test('fehlgeschlagene Meldung wirft nicht, behält die Zählung und wiederholt beim nächsten Tick', async () => {
		const h = harness();
		const state = createLoopState(T0);
		const nonces = new NonceStore();
		const limiter = new RateLimiter();
		await step(h, state, nonces, limiter);
		const before = JSON.stringify(state.counts);
		expect(before).not.toBe(JSON.stringify(createLoopState(T0).counts));

		h.failReport = true;
		h.clock.t += REPORT_INTERVAL_MS;
		await step(h, state, nonces, limiter);
		const afterFail = state.counts;
		expect(Object.values(afterFail).reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
		expect(state.lastReportAt).toBe(T0);

		// Nächster Tick: erneuter Versuch, Erfolg setzt zurück und rückt lastReportAt vor.
		h.failReport = false;
		h.calls.length = 0;
		h.clock.t += 1000;
		await step(h, state, nonces, limiter);
		expect(h.calls).toContain('report');
		expect(Object.values(state.counts).reduce((a, b) => a + b, 0)).toBe(0);
		expect(state.lastReportAt).toBe(h.clock.t);
	});
});
