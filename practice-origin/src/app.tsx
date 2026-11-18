/**
 * Hono-App für den Übungs-Origin "Bohnenkraft" (#13). Ein Kern, 512 MB Droplet: Langsamkeit nur
 * per Timer (/suche), nie per CPU-Schleife; Zähler im RAM-Ringpuffer, kein Logging pro Request.
 */
import { Hono, type Context } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import { buildAssetRegistry, type ResolvedAsset } from './lib/assets.ts';
import { CartStore } from './lib/cart-store.ts';
import { RequestCounter, computeStats } from './lib/counter.ts';
import {
	DEFAULT_CAPACITY_RPS,
	DEFAULT_COUNTER_CAP,
	DEFAULT_HARD_LIMIT_RPS,
	EnvName,
	MAX_USERNAME_LENGTH,
	SESSION_COOKIE_NAME,
	SESSION_MAX_AGE_S
} from './lib/const.ts';
import { LoginStore } from './lib/login-store.ts';
import { findProduct, PRODUCTS } from './lib/shop-data.ts';
import {
	AdminOrdersPage,
	AdminPage,
	CartPage,
	HomePage,
	ImpressumPage,
	LoginPage,
	ProductDetailPage,
	ProductListPage,
	SearchPage,
	type PageBase
} from './views/pages.tsx';

export interface AppConfig {
	statsToken: string | undefined;
	capacityRps: number;
	hardLimitRps: number;
	counterCap: number;
	/** Für Tests: Zeitgeber austauschbar (Default: Date.now). */
	now: () => number;
	/** Für Tests: Wartefunktion austauschbar, damit /suche nicht wirklich 300-800ms wartet. */
	sleep: (ms: number) => Promise<void>;
	/** Für Tests: Zufall für Sitzungs-/Warenkorb-IDs austauschbar. */
	randomId: () => string;
}

export function defaultSleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export function randomHex(bytes = 8): string {
	const arr = new Uint8Array(bytes);
	crypto.getRandomValues(arr);
	return Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function loadConfigFromEnv(env: Record<string, string | undefined> = Bun.env): AppConfig {
	return {
		statsToken: env[EnvName.STATS_TOKEN],
		capacityRps: Number(env[EnvName.CAPACITY_RPS] ?? DEFAULT_CAPACITY_RPS),
		hardLimitRps: Number(env[EnvName.HARD_LIMIT_RPS] ?? DEFAULT_HARD_LIMIT_RPS),
		counterCap: Number(env[EnvName.COUNTER_CAP] ?? DEFAULT_COUNTER_CAP),
		now: () => Date.now(),
		sleep: defaultSleep,
		randomId: () => randomHex(8)
	};
}

function assetMap(byName: Map<string, ResolvedAsset>) {
	const style = byName.get('style')!;
	const logo = byName.get('logo')!;
	return { style, logo };
}

export function createApp(config: AppConfig) {
	const app = new Hono();
	const { byName, byFileName } = buildAssetRegistry();
	const counter = new RequestCounter(config.counterCap);
	const cartStore = new CartStore();
	const loginStore = new LoginStore();
	const assets = assetMap(byName);

	function hostOf(c: { req: { header: (n: string) => string | undefined } }): string {
		return (c.req.header('host') ?? 'unbekannt').split(':')[0] ?? 'unbekannt';
	}

	/** Session-ID aus dem Cookie, sonst neue ID und Set-Cookie (Warenkorb und Login teilen sich die Session). */
	function ensureSession(c: Context): string {
		let sessionId = getCookie(c, SESSION_COOKIE_NAME);
		if (!sessionId) {
			sessionId = config.randomId();
			setCookie(c, SESSION_COOKIE_NAME, sessionId, { httpOnly: true, sameSite: 'Lax', path: '/', maxAge: SESSION_MAX_AGE_S });
		}
		return sessionId;
	}

	/**
	 * Basisdaten jeder Seite inkl. angemeldetem Benutzer. HTML-Seiten senden absichtlich kein
	 * Cache-Control: Mit "Eligible for cache" + erzwungener Edge-TTL landet die persönliche Seite
	 * im Cloudflare-Cache und der nächste Besucher sieht den fremden Namen (CDN-Übung).
	 */
	function pageOf(c: Context): PageBase {
		return { assets, host: hostOf(c), user: loginStore.userOf(getCookie(c, SESSION_COOKIE_NAME)) };
	}

	// Zähler für jeden Request außer /health (vor dem Routing, damit auch 404s/503 zählen).
	app.use('*', async (c, next) => {
		const path = new URL(c.req.url).pathname;
		if (path === '/health') return next();
		const host = hostOf(c);
		// Caddy terminiert TLS und setzt X-Forwarded-For auf die Gegenstelle (bei Cloudflare davor
		// eine Cloudflare-IP); Cloudflare reicht CF-Connecting-IP (die fürs Team sichtbare
		// "Angreifer"-IP, #13/#20). Beide getrennt im Zähler halten, Anzeige/Stats nutzen primär
		// CF-Connecting-IP und nur ohne Cloudflare die Gegenstelle.
		const cfIp = c.req.header('cf-connecting-ip') ?? null;
		const peerIp = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || null;
		const ip = cfIp ?? peerIp ?? 'unbekannt';
		const ray = c.req.header('cf-ray') ?? 'unbekannt';
		const now = config.now();

		// Harte Grenze pro Domain: oberhalb antwortet der Origin wie ein überlasteter Server (503).
		const currentRate = counter.currentRatePerSecond(host, now);
		if (currentRate >= config.hardLimitRps) {
			counter.add({ host, path, time: now, ip, cfIp, peerIp, ray });
			return c.text('503 Service Unavailable – Origin überlastet', 503);
		}

		counter.add({ host, path, time: now, ip, cfIp, peerIp, ray });
		await next();
	});

	app.get('/health', (c) => c.json({ ok: true }));

	app.get('/', (c) => c.html(<HomePage page={pageOf(c)} />));

	app.get('/produkte', (c) => {
		const productImages = new Map(PRODUCTS.map((p) => [p.bild, byName.get(p.bild)!]));
		return c.html(<ProductListPage page={pageOf(c)} productImages={productImages} />);
	});

	app.get('/produkte/:slug', (c) => {
		const product = findProduct(c.req.param('slug'));
		if (!product) return c.text('Produkt nicht gefunden', 404);
		return c.html(<ProductDetailPage page={pageOf(c)} product={product} image={byName.get(product.bild)} />);
	});

	app.get('/assets/:fileName', (c) => {
		const fileName = c.req.param('fileName');
		const asset = byFileName.get(fileName);
		if (!asset) return c.text('Asset nicht gefunden', 404);
		c.header('Cache-Control', 'public, max-age=31536000, immutable');
		c.header('Content-Type', asset.contentType);
		return c.body(asset.content);
	});

	app.get('/suche', async (c) => {
		const q = c.req.query('q') ?? null;
		const start = config.now();
		// Absichtlich langsam, NUR per Timer (keine CPU-Schleife - #13, "ein Kern, 512 MB").
		const delayMs = 300 + Math.floor(Math.random() * 500);
		await config.sleep(delayMs);
		const tookMs = config.now() - start;
		const results = q ? PRODUCTS.filter((p) => `${p.name} ${p.kurzbeschreibung}`.toLowerCase().includes(q.toLowerCase())) : [];
		return c.html(<SearchPage page={pageOf(c)} query={q} results={[...results]} tookMs={tookMs} />);
	});

	function cartHandler(c: Context) {
		const cartId = ensureSession(c);
		const raw = cartStore.get(cartId);
		const items = Object.entries(raw)
			.map(([slug, quantity]) => ({ product: findProduct(slug), quantity }))
			.filter((it): it is { product: ReturnType<typeof findProduct> & object; quantity: number } => !!it.product);
		return c.html(<CartPage page={pageOf(c)} cartId={cartId} items={items as { product: NonNullable<ReturnType<typeof findProduct>>; quantity: number }[]} />);
	}
	app.get('/warenkorb', cartHandler);
	app.get('/dynamisch', cartHandler);

	app.post('/warenkorb/hinzufuegen', async (c) => {
		const cartId = ensureSession(c);
		const form = await c.req.formData();
		const slug = String(form.get('slug') ?? '');
		if (findProduct(slug)) cartStore.add(cartId, slug);
		return c.redirect('/warenkorb', 303);
	});

	app.get('/impressum', (c) => c.html(<ImpressumPage page={pageOf(c)} />));

	app.get('/login', (c) => c.html(<LoginPage page={pageOf(c)} error={null} />));

	// Jeder Name gilt, das Passwort wird nicht geprüft. Login ist ein POST (wird nie gecacht), die
	// Folgeseiten per GET zeigen den Namen oben rechts - genau die kann ein Cache falsch ausliefern.
	app.post('/login', async (c) => {
		// parseBody statt formData: Der login_rush-Angriff schickt POST ohne Body.
		const body = await c.req.parseBody().catch(() => ({}) as Record<string, unknown>);
		const raw = body['username'];
		const username = (typeof raw === 'string' ? raw : '').trim().slice(0, MAX_USERNAME_LENGTH);
		if (!username) return c.html(<LoginPage page={pageOf(c)} error="Bitte einen Benutzernamen eingeben." />, 400);
		loginStore.login(ensureSession(c), username);
		return c.redirect('/', 303);
	});

	app.post('/logout', (c) => {
		const sessionId = getCookie(c, SESSION_COOKIE_NAME);
		if (sessionId) loginStore.logout(sessionId);
		return c.redirect('/', 303);
	});

	// /admin* case-insensitive (auch /ADMIN, /Admin/Bestellungen - #13).
	app.all('*', async (c, next) => {
		const pathname = new URL(c.req.url).pathname;
		if (!/^\/admin(\/|$)/i.test(pathname)) return next();
		if (pathname.toLowerCase() === '/admin/bestellungen') return c.html(<AdminOrdersPage page={pageOf(c)} />);
		return c.html(<AdminPage page={pageOf(c)} path={pathname} />);
	});

	app.get('/__stats', (c) => {
		if (!config.statsToken) return c.notFound();
		const auth = c.req.header('authorization');
		if (auth !== `Bearer ${config.statsToken}`) return c.notFound();
		const host = c.req.query('host');
		if (!host) return c.text('missing host', 400);
		const since = Number(c.req.query('since') ?? '0');
		const stats = computeStats(counter, host, since, config.now(), config.capacityRps);
		return c.json({ ...stats, counterSize: counter.sizeOf(), counterCap: config.counterCap });
	});

	return { app, counter };
}
