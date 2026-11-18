/**
 * Einstiegspunkt. Mit `bun build --compile` wird daraus ein einzelnes Binary (siehe
 * Containerfile), das direkt `Bun.serve` nutzt (kein separater Webserver-Prozess nötig).
 */
import { createApp, loadConfigFromEnv } from './app.tsx';
import { EnvName } from './lib/const.ts';

const config = loadConfigFromEnv();
const { app } = createApp(config);
const port = Number(Bun.env[EnvName.PORT] ?? 8080);
// Auf dem Droplet 127.0.0.1 (nur Caddy davor erreichbar), lokal/im Container alle Schnittstellen.
const hostname = Bun.env[EnvName.BIND_HOST] ?? '0.0.0.0';

Bun.serve({ port, hostname, fetch: app.fetch });
console.log(`practice-origin läuft auf ${hostname}:${port} (capacityRps=${config.capacityRps}, hardLimitRps=${config.hardLimitRps})`);
