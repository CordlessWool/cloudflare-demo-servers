/**
 * Einstiegspunkt der Angriffs-Maschine (#37, #52). Startet einen winzigen Hono-Server nur für
 * den Health-Check (`/health`) und läuft daneben in einer Schleife: Befehl holen, bei
 * aktivem Werkzeug mit harter Rate-Untergrenze gegen das fest hinterlegte Ziel laufen,
 * Antwortklassen zählen und periodisch melden. Timer als Sicherheitsnetz: unabhängig von jedem
 * Befehl beendet sich der Prozess nach SELF_DESTRUCT_MS und wird nicht neu gestartet (systemd
 * `Restart=on-failure`, Unit aus der cloud-init der App). Das Droplet löscht die App.
 */
import { Hono } from 'hono';
import { LOOP_TICK_MS, SELF_DESTRUCT_MS } from './const.ts';
import { NonceStore } from './nonceStore.ts';
import { RateLimiter } from './rateLimiter.ts';
import { createLoopState, runLoopStep } from './loop.ts';
import { validateTargetDomain, type RunnerConfig, type RunnerDeps } from './runner.ts';

function requireEnv(name: string): string {
	const value = Bun.env[name];
	if (!value) throw new Error(`${name} fehlt (kommt per user_data/cloud-init von der App)`);
	return value;
}

const config: RunnerConfig = {
	appBaseUrl: requireEnv('APP_BASE_URL'),
	machineId: requireEnv('ATTACK_MACHINE_ID'),
	pollToken: requireEnv('ATTACK_RUNNER_POLL_TOKEN'),
	commandSecret: requireEnv('ATTACK_COMMAND_SECRET'),
	// Ziel fest aus der eigenen Umgebung, Hostname geprüft -- nie aus einem Befehl (#37/#52).
	targetDomain: validateTargetDomain(requireEnv('TARGET_DOMAIN'))
};

const deps: RunnerDeps = {
	fetchFn: fetch,
	now: () => Date.now(),
	log: (msg) => console.log(`[attack-runner] ${msg}`)
};

const app = new Hono();
app.get('/health', (c) => c.text('ok'));

async function mainLoop(): Promise<void> {
	const nonceStore = new NonceStore();
	const limiter = new RateLimiter();
	const state = createLoopState(deps.now());

	// Die Schleife tickt im Takt der Rate-Untergrenze (LOOP_TICK_MS), damit Tempo `fast` (1 s)
	// überhaupt gesendet werden kann. Befehle werden seltener geholt (COMMAND_POLL_INTERVAL_MS);
	// zwischen zwei Abholungen sendet derselbe (noch gültige) Befehl weiter (maybeSendAttackRequest
	// stoppt nach `expiresAt`). Ein fehlgeschlagener Poll stoppt das Senden (ab v5), siehe loop.ts.
	for (;;) {
		await runLoopStep(deps, config, state, nonceStore, limiter);
		await new Promise((resolve) => setTimeout(resolve, LOOP_TICK_MS));
	}
}

setTimeout(() => {
	deps.log('Selbstzerstörungs-Timer abgelaufen, Prozess beendet sich.');
	process.exit(0);
}, SELF_DESTRUCT_MS);

mainLoop().catch((err) => {
	console.error('[attack-runner] Loop abgebrochen:', err);
	process.exit(1);
});

const port = Number(Bun.env.PORT ?? 8080);
Bun.serve({ port, fetch: app.fetch });
console.log(`attack-runner läuft auf Port ${port} (machineId=${config.machineId})`);
