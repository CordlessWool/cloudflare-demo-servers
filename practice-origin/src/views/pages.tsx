/**
 * Layout + Seiten als serverseitiges HTML (Hono JSX, kein Client-JS - #13).
 */
import type { FC, PropsWithChildren } from 'hono/jsx';
import type { ResolvedAsset } from '../lib/assets.ts';
import { MAX_USERNAME_LENGTH } from '../lib/const.ts';
import { PRODUCTS, type Product } from '../lib/shop-data.ts';

/** Was jede Seite braucht: Assets, Host fürs Banner, angemeldeter Benutzer (oder null). */
export interface PageBase {
	assets: { style: ResolvedAsset; logo: ResolvedAsset };
	host: string;
	user: string | null;
}

export const Layout: FC<PropsWithChildren<{ title: string; page: PageBase }>> = ({ title, page, children }) => (
	<html lang="de">
		<head>
			<meta charset="utf-8" />
			<meta name="viewport" content="width=device-width, initial-scale=1" />
			<title>{title} – Bohnenkraft</title>
			<link rel="stylesheet" href={page.assets.style.urlPath} />
		</head>
		<body>
			<div class="banner">Diese Seite läuft als Übungs-Origin für die Domain {page.host}</div>
			<header class="site">
				<img src={page.assets.logo.urlPath} alt="Bohnenkraft Logo" />
				<nav>
					<a href="/">Start</a>
					<a href="/produkte">Produkte</a>
					<a href="/warenkorb">Warenkorb</a>
					<a href="/suche">Suche</a>
				</nav>
				{page.user ? (
					<form class="user" method="post" action="/logout">
						<span>
							Angemeldet als <strong>{page.user}</strong>
						</span>
						<button type="submit">Abmelden</button>
					</form>
				) : (
					<a class="user" href="/login">
						Anmelden
					</a>
				)}
			</header>
			<main>{children}</main>
			<footer class="site">
				Kaffeerösterei Bohnenkraft – fiktive Übungsseite, kein echtes Geschäft. <a href="/impressum">Impressum</a>
			</footer>
		</body>
	</html>
);

export const HomePage: FC<{ page: PageBase }> = ({ page }) => (
	<Layout title="Start" page={page}>
		<h1>{page.user ? `Willkommen zurück, ${page.user}` : 'Willkommen bei Bohnenkraft'}</h1>
		<p>Wir rösten kleine Mengen Kaffee von Hand und versenden sie frisch an unsere Kundschaft.</p>
		<div class="hinweis">
			<strong>Neuigkeit:</strong> Unsere Mitternachtsröstung ist wieder verfügbar – diesmal mit größerer Charge.
		</div>
		<p>
			Schauen Sie sich unsere <a href="/produkte">Produkte</a> an, oder legen Sie direkt etwas in Ihren{' '}
			<a href="/warenkorb">Warenkorb</a>.
		</p>
	</Layout>
);

export const ProductListPage: FC<{ page: PageBase; productImages: Map<string, ResolvedAsset> }> = ({ page, productImages }) => (
	<Layout title="Produkte" page={page}>
		<h1>Unsere Produkte</h1>
		<div class="product-list">
			{PRODUCTS.map((p) => (
				<article class="product-card">
					<a href={`/produkte/${p.slug}`}>
						<img src={productImages.get(p.bild)?.urlPath ?? ''} alt={p.name} />
						<h2>{p.name}</h2>
					</a>
					<p>{p.kurzbeschreibung}</p>
					<p class="price">{p.preis}</p>
				</article>
			))}
		</div>
	</Layout>
);

export const ProductDetailPage: FC<{ page: PageBase; product: Product; image: ResolvedAsset | undefined }> = ({ page, product, image }) => (
	<Layout title={product.name} page={page}>
		<p>
			<a href="/produkte">← Zurück zu allen Produkten</a>
		</p>
		<h1>{product.name}</h1>
		<img src={image?.urlPath ?? ''} alt={product.name} style="max-width:240px;" />
		<p class="price">{product.preis}</p>
		<p>{product.beschreibung}</p>
		<form method="post" action="/warenkorb/hinzufuegen">
			<input type="hidden" name="slug" value={product.slug} />
			<button type="submit">In den Warenkorb</button>
		</form>
	</Layout>
);

export const ImpressumPage: FC<{ page: PageBase }> = ({ page }) => (
	<Layout title="Impressum" page={page}>
		<h1>Impressum</h1>
		<p>Platzhalter – fiktive Übungsseite, kein echtes Impressum.</p>
		<p>Bohnenkraft Rösterei GmbH (fiktiv) · Musterstraße 1 · 12345 Musterstadt</p>
	</Layout>
);

export const SearchPage: FC<{ page: PageBase; query: string | null; results: Product[]; tookMs: number | null }> = ({
	page,
	query,
	results,
	tookMs
}) => (
	<Layout title="Suche" page={page}>
		<h1>Suche</h1>
		<form class="search" method="get" action="/suche">
			<input type="text" name="q" value={query ?? ''} placeholder="z.B. Espresso" />
			<button type="submit">Suchen</button>
		</form>
		{query !== null && (
			<p>
				{results.length} Treffer für „{query}“{tookMs !== null ? ` (${tookMs} ms)` : ''}
			</p>
		)}
		<ul>
			{results.map((p: Product) => (
				<li>
					<a href={`/produkte/${p.slug}`}>{p.name}</a> – {p.kurzbeschreibung}
				</li>
			))}
		</ul>
	</Layout>
);

export const CartPage: FC<{ page: PageBase; cartId: string; items: { product: Product; quantity: number }[] }> = ({ page, cartId, items }) => (
	<Layout title="Warenkorb" page={page}>
		<h1>{page.user ? `Warenkorb von ${page.user}` : 'Ihr Warenkorb'}</h1>
		<p>
			Ihre Warenkorb-Kennung: <code>{cartId}</code>
		</p>
		<p>Diese Kennung ist an Ihre Sitzung gebunden (Cookie). Jeder Besuch ohne Cookie bekommt eine neue Kennung.</p>
		{items.length === 0 ? (
			<p>Ihr Warenkorb ist leer. Legen Sie etwas von den <a href="/produkte">Produkten</a> hinein.</p>
		) : (
			<table class="orders">
				<thead>
					<tr>
						<th>Produkt</th>
						<th>Menge</th>
						<th>Preis</th>
					</tr>
				</thead>
				<tbody>
					{items.map((item) => (
						<tr>
							<td>{item.product.name}</td>
							<td>{item.quantity}</td>
							<td>{item.product.preis}</td>
						</tr>
					))}
				</tbody>
			</table>
		)}
	</Layout>
);

export const LoginPage: FC<{ page: PageBase; error: string | null }> = ({ page, error }) => (
	<Layout title="Login" page={page}>
		<h1>Anmelden</h1>
		{page.user ? (
			<p class="hinweis">
				Sie sind bereits als „{page.user}“ angemeldet. Eine neue Anmeldung ersetzt den Namen in dieser Sitzung.
			</p>
		) : null}
		<form class="login" method="post" action="/login">
			<input type="text" name="username" placeholder="Benutzername" autocomplete="username" maxlength={MAX_USERNAME_LENGTH} required />
			<input type="password" name="password" placeholder="Passwort" autocomplete="current-password" />
			<button type="submit">Anmelden</button>
		</form>
		{error ? <p class="hinweis">{error}</p> : null}
		<p>Übungsseite: Jeder Benutzername funktioniert, das Passwort wird nicht geprüft.</p>
	</Layout>
);

export const AdminPage: FC<{ page: PageBase; path: string }> = ({ page, path }) => (
	<Layout title="Backoffice" page={page}>
		<h1>Bohnenkraft Backoffice</h1>
		<p>
			Aufgerufener Pfad: <code>{path}</code>
		</p>
		<p>
			<a href="/admin/bestellungen">Bestellungen ansehen</a>
		</p>
	</Layout>
);

export const AdminOrdersPage: FC<{ page: PageBase }> = ({ page }) => (
	<Layout title="Bestellungen" page={page}>
		<h1>Bestellungen</h1>
		<table class="orders">
			<thead>
				<tr>
					<th>Nr.</th>
					<th>Produkt</th>
					<th>Status</th>
				</tr>
			</thead>
			<tbody>
				<tr>
					<td>1001</td>
					<td>Äquatortraum</td>
					<td>Versendet</td>
				</tr>
				<tr>
					<td>1002</td>
					<td>Mitternachtsröstung</td>
					<td>In Bearbeitung</td>
				</tr>
			</tbody>
		</table>
	</Layout>
);
