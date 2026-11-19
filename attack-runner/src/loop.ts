/**
 * Ein Schritt der Hauptschleife (aus index.ts herausgelöst, damit er ohne Umgebung/Server testbar
 * ist). Verhalten ab v5: Ein fehlgeschlagener Befehls-Poll stoppt das Senden sofort (`sendPayload`
 * wird null), der letzte gute Befehl bleibt aber für Meldungen erhalten (`reportPayload`). Eine
 * fehlgeschlagene Meldung beendet den Prozess nicht: die Zählung bleibt erhalten und wird beim
 * nächsten Tick erneut gemeldet.
 */
import { COMMAND_POLL_INTERVAL_MS, REPORT_INTERVAL_MS } from './const.ts';
import { emptyCounts, type ResponseClassCounts } from './classify.ts';
import type { NonceStore } from './nonceStore.ts';
import type { RateLimiter } from './rateLimiter.ts';
import { fetchAndVerifyCommand, maybeSendAttackRequest, mergeCounts, sendReport, type AttackCommandPayload, type RunnerConfig, type RunnerDeps } from './runner.ts';

export interface LoopState {
	/** Befehl, mit dem gesendet wird. Null nach fehlgeschlagenem Poll oder vor dem ersten Befehl. */
	sendPayload: AttackCommandPayload | null;
	/** Letzter gültiger Befehl, nur für Meldungen (sessionId/teamId/nonce). */
	reportPayload: AttackCommandPayload | null;
	counts: ResponseClassCounts;
	lastReportAt: number;
	lastCommandPollAt: number;
}

export function createLoopState(now: number): LoopState {
	return { sendPayload: null, reportPayload: null, counts: emptyCounts(), lastReportAt: now, lastCommandPollAt: 0 };
}

export async function runLoopStep(
	deps: RunnerDeps,
	config: RunnerConfig,
	state: LoopState,
	nonceStore: NonceStore,
	limiter: RateLimiter
): Promise<void> {
	const now = deps.now();
	if (now - state.lastCommandPollAt >= COMMAND_POLL_INTERVAL_MS) {
		state.lastCommandPollAt = now;
		try {
			const payload = await fetchAndVerifyCommand(deps, config, nonceStore);
			state.sendPayload = payload;
			state.reportPayload = payload;
		} catch (err) {
			// Fehlgeschlagener Poll: nichts mehr senden, bis ein späterer Poll gelingt.
			state.sendPayload = null;
			deps.log(`Befehl übersprungen: ${err instanceof Error ? err.message : String(err)}`);
		}
	}

	if (state.sendPayload) {
		try {
			const requestCounts = await maybeSendAttackRequest(deps, config, state.sendPayload, limiter);
			if (requestCounts) state.counts = mergeCounts(state.counts, requestCounts);
		} catch (err) {
			deps.log(`Anfrage übersprungen: ${err instanceof Error ? err.message : String(err)}`);
		}
	}

	if (state.reportPayload && deps.now() - state.lastReportAt >= REPORT_INTERVAL_MS) {
		try {
			await sendReport(deps, config, state.reportPayload, state.counts);
			state.counts = emptyCounts();
			state.lastReportAt = deps.now();
		} catch (err) {
			// Zählung behalten, lastReportAt nicht vorrücken: Wiederholung im nächsten Tick (1 s).
			deps.log(`Meldung fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}`);
		}
	}
}
