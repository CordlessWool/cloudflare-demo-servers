import { describe, expect, test } from 'bun:test';
import { createApp, loadConfigFromEnv, type AppConfig } from '../src/app.tsx';

function testConfig(overrides: Partial<AppConfig> = {}): AppConfig {
	const base = loadConfigFromEnv({});
	let t = 1_000_000;
	return {
		...base,
		statsToken: 'test-token',
		capacityRps: 20,
		hardLimitRps: 5, // niedrig für den Test, damit 503 ohne Lasttest auslösbar ist
		counterCap: 1000,
		now: () => t,
		sleep: async () => {}, // Tests dürfen nicht wirklich 300-800ms warten
		randomId: () => 'fixed-id-123',
		...overrides
	};
}

function advance(config: AppConfig, ms: number) {
	const current = config.now();
	config.now = () => current + ms;
}

describe('Routen und Header', () => {
	test('/ liefert HTML mit Banner für den Host', async () => {
		const { app } = createApp(testConfig());
		const res = await app.request('/', { headers: { host: 'team1.example.com' } });
		expect(res.status).toBe(200);
		const text = await res.text();
		expect(text).toContain('team1.example.com');
		expect(text).toContain('Bohnenkraft');
	});

	test('/produkte/<slug> liefert das Produkt', async () => {
		const { app } = createApp(testConfig());
		const res = await app.request('/produkte/aequatortraum', { headers: { host: 'team1.example.com' } });
		expect(res.status).toBe(200);
		expect(await res.text()).toContain('Äquatortraum');
	});

	test('/produkte/<unbekannt> gibt 404', async () => {
		const { app } = createApp(testConfig());
		const res = await app.request('/produkte/nicht-da', { headers: { host: 'team1.example.com' } });
		expect(res.status).toBe(404);
	});

	test('/assets/<name>.<hash>.<ext> ist immutable gecacht', async () => {
		const { app } = createApp(testConfig());
		const first = await app.request('/', { headers: { host: 'team1.example.com' } });
		const html = await first.text();
		const match = html.match(/\/assets\/style\.[a-f0-9]+\.css/);
		expect(match).not.toBeNull();
		const res = await app.request(match![0]!, { headers: { host: 'team1.example.com' } });
		expect(res.status).toBe(200);
		expect(res.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
		expect(res.headers.get('content-type')).toContain('text/css');
	});

	test('unbekanntes Asset gibt 404', async () => {
		const { app } = createApp(testConfig());
		const res = await app.request('/assets/nope.deadbeef.css', { headers: { host: 'team1.example.com' } });
		expect(res.status).toBe(404);
	});
});

describe('/suche', () => {
	test('nutzt nur den Timer, keine CPU-Schleife (sleep wird aufgerufen, Antwort kommt sofort durch)', async () => {
		let sleptMs: number | null = null;
		const { app } = createApp(
			testConfig({
				sleep: async (ms) => {
					sleptMs = ms;
				}
			})
		);
		const res = await app.request('/suche?q=espresso', { headers: { host: 'team1.example.com' } });
		expect(res.status).toBe(200);
		expect(sleptMs).not.toBeNull();
		const ms = sleptMs ?? -1;
		expect(ms).toBeGreaterThanOrEqual(300);
		expect(ms).toBeLessThanOrEqual(800);
	});

	test('ohne Query kein Treffer, aber kein Fehler', async () => {
		const { app } = createApp(testConfig());
		const res = await app.request('/suche', { headers: { host: 'team1.example.com' } });
		expect(res.status).toBe(200);
	});
});

describe('/warenkorb und /dynamisch', () => {
	test('setzt ein Session-Cookie, leerer Warenkorb initial', async () => {
		const { app } = createApp(testConfig());
		const res = await app.request('/warenkorb', { headers: { host: 'team1.example.com' } });
		expect(res.status).toBe(200);
		expect(res.headers.get('set-cookie')).toContain('bohnenkraft_session=');
		expect(await res.text()).toContain('Warenkorb ist leer');
	});

	test('/dynamisch ist ein Alias mit identischem Verhalten', async () => {
		const { app } = createApp(testConfig());
		const res = await app.request('/dynamisch', { headers: { host: 'team1.example.com' } });
		expect(res.status).toBe(200);
		expect(res.headers.get('set-cookie')).toContain('bohnenkraft_session=');
	});

	test('POST /warenkorb/hinzufuegen legt ein Produkt in den Warenkorb der Session', async () => {
		const { app } = createApp(testConfig());
		const form = new FormData();
		form.set('slug', 'aequatortraum');
		const addRes = await app.request('/warenkorb/hinzufuegen', {
			method: 'POST',
			body: form,
			headers: { host: 'team1.example.com' }
		});
		expect(addRes.status).toBe(303);
		const cookie = addRes.headers.get('set-cookie');
		expect(cookie).toContain('bohnenkraft_session=');
		const sessionId = cookie!.split('bohnenkraft_session=')[1]!.split(';')[0]!;
		const cartRes = await app.request('/warenkorb', {
			headers: { host: 'team1.example.com', cookie: `bohnenkraft_session=${sessionId}` }
		});
		const html = await cartRes.text();
		expect(html).toContain('Äquatortraum');
		expect(html).not.toContain('Warenkorb ist leer');
	});
});

describe('/impressum', () => {
	test('liefert eine Platzhalter-Seite', async () => {
		const { app } = createApp(testConfig());
		const res = await app.request('/impressum', { headers: { host: 'team1.example.com' } });
		expect(res.status).toBe(200);
		expect(await res.text()).toContain('Impressum');
	});
});

describe('/login', () => {
	test('GET liefert ein Formular', async () => {
		const { app } = createApp(testConfig());
		const res = await app.request('/login', { headers: { host: 'team1.example.com' } });
		expect(res.status).toBe(200);
		expect(await res.text()).toContain('<form');
	});

	test('POST mit beliebiger Eingabe liefert eine sichtbare Antwort', async () => {
		const { app } = createApp(testConfig());
		const form = new FormData();
		form.set('username', "' OR 1=1 --");
		form.set('password', 'x');
		const res = await app.request('/login', { method: 'POST', body: form, headers: { host: 'team1.example.com' } });
		expect(res.status).toBe(200);
		expect(await res.text()).toContain('Anmeldeversuch');
	});
});

describe('/admin case-insensitive', () => {
	for (const path of ['/admin', '/ADMIN', '/Admin']) {
		test(`${path} wird vom Backoffice bedient`, async () => {
			const { app } = createApp(testConfig());
			const res = await app.request(path, { headers: { host: 'team1.example.com' } });
			expect(res.status).toBe(200);
			expect(await res.text()).toContain('Backoffice');
		});
	}
	for (const path of ['/admin/bestellungen', '/ADMIN/BESTELLUNGEN', '/Admin/Bestellungen']) {
		test(`${path} wird von der Bestellübersicht bedient`, async () => {
			const { app } = createApp(testConfig());
			const res = await app.request(path, { headers: { host: 'team1.example.com' } });
			expect(res.status).toBe(200);
			expect(await res.text()).toContain('Bestellungen');
		});
	}
});

describe('Zähler (Host-Trennung, Obergrenze)', () => {
	test('zählt pro Host getrennt', async () => {
		const config = testConfig();
		const { app, counter } = createApp(config);
		await app.request('/', { headers: { host: 'team1.example.com' } });
		await app.request('/', { headers: { host: 'team1.example.com' } });
		await app.request('/', { headers: { host: 'team2.example.com' } });
		expect(counter.entriesSince('team1.example.com', 0).length).toBe(2);
		expect(counter.entriesSince('team2.example.com', 0).length).toBe(1);
	});

	test('/health wird nicht gezählt', async () => {
		const config = testConfig();
		const { app, counter } = createApp(config);
		await app.request('/health', { headers: { host: 'team1.example.com' } });
		expect(counter.entriesSince('team1.example.com', 0).length).toBe(0);
	});

	test('Ringpuffer überschreibt älteste Einträge ab der Obergrenze', async () => {
		const config = testConfig({ counterCap: 3 });
		const { app, counter } = createApp(config);
		for (let i = 0; i < 5; i++) {
			await app.request('/', { headers: { host: 'team1.example.com' } });
			advance(config, 1);
		}
		expect(counter.sizeOf()).toBe(3);
	});
});

describe('/__stats', () => {
	test('ohne Token 404', async () => {
		const { app } = createApp(testConfig({ statsToken: undefined }));
		const res = await app.request('/__stats?host=team1.example.com&since=0');
		expect(res.status).toBe(404);
	});

	test('mit falschem Token 404', async () => {
		const { app } = createApp(testConfig());
		const res = await app.request('/__stats?host=team1.example.com&since=0', {
			headers: { authorization: 'Bearer falsch' }
		});
		expect(res.status).toBe(404);
	});

	test('mit korrektem Token liefert Stats inkl. Kapazität', async () => {
		const config = testConfig({ hardLimitRps: 1000 });
		const { app } = createApp(config);
		await app.request('/', { headers: { host: 'team1.example.com' } });
		const res = await app.request('/__stats?host=team1.example.com&since=0', {
			headers: { authorization: 'Bearer test-token' }
		});
		expect(res.status).toBe(200);
		const body = (await res.json()) as { host: string; capacityPerSecond: number; totalRequests: number };
		expect(body.host).toBe('team1.example.com');
		expect(body.capacityPerSecond).toBe(20);
		expect(body.totalRequests).toBeGreaterThanOrEqual(1);
	});
});

describe('503 oberhalb der harten Grenze', () => {
	test('antwortet 503 wie ein überlasteter Server', async () => {
		const config = testConfig({ hardLimitRps: 2 });
		const { app } = createApp(config);
		// hardLimitRps=2: currentRatePerSecond im 10s-Fenster erreicht nach wenigen Requests >= 2.
		let last!: Response;
		for (let i = 0; i < 30; i++) {
			last = await app.request('/', { headers: { host: 'team1.example.com' } });
		}
		expect(last.status).toBe(503);
	});

	test('andere Domain bleibt unbeeinträchtigt (Host-Trennung bei 503)', async () => {
		const config = testConfig({ hardLimitRps: 2 });
		const { app } = createApp(config);
		for (let i = 0; i < 30; i++) {
			await app.request('/', { headers: { host: 'team1.example.com' } });
		}
		const res = await app.request('/', { headers: { host: 'team2.example.com' } });
		expect(res.status).toBe(200);
	});
});

describe('Zähler: Gegenstelle (Caddy) und CF-Connecting-IP (#53)', () => {
	test('CF-Connecting-IP gewinnt, wenn beide gesetzt sind (Cloudflare vor Caddy)', async () => {
		const { app, counter } = createApp(testConfig());
		await app.request('/', {
			headers: { host: 'team1.example.com', 'cf-connecting-ip': '203.0.113.9', 'x-forwarded-for': '198.51.100.9' }
		});
		const [entry] = counter.entriesSince('team1.example.com', 0);
		expect(entry?.ip).toBe('203.0.113.9');
		expect(entry?.cfIp).toBe('203.0.113.9');
		expect(entry?.peerIp).toBe('198.51.100.9');
	});

	test('ohne Cloudflare fällt die Anzeige-IP auf die erste X-Forwarded-For-Adresse zurück', async () => {
		const { app, counter } = createApp(testConfig());
		await app.request('/', { headers: { host: 'team1.example.com', 'x-forwarded-for': '198.51.100.9, 10.0.0.1' } });
		const [entry] = counter.entriesSince('team1.example.com', 0);
		expect(entry?.ip).toBe('198.51.100.9');
		expect(entry?.cfIp).toBeNull();
	});
});
