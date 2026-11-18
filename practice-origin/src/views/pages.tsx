/**
 * Layout + Seiten als serverseitiges HTML (Hono JSX, kein Client-JS - #13).
 */
import type { FC, PropsWithChildren } from 'hono/jsx';
import type { ResolvedAsset } from '../lib/assets.ts';
import { PRODUCTS, type Product } from '../lib/shop-data.ts';

export interface LayoutProps extends PropsWithChildren {
	title: string;
	host: string;
	styleHref: string;
	logoHref: string;
}

export const Layout: FC<LayoutProps> = ({ title, host, styleHref, logoHref, children }) => (
	<html lang="de">
		<head>
			<meta charset="utf-8" />
			<meta name="viewport" content="width=device-width, initial-scale=1" />
			<title>{title} – Bohnenkraft</title>
			<link rel="stylesheet" href={styleHref} />
		</head>
		<body>
			<div class="banner">Diese Seite läuft als Übungs-Origin für die Domain {host}</div>
			<header class="site">
				<img src={logoHref} alt="Bohnenkraft Logo" />
				<nav>
					<a href="/">Start</a>
					<a href="/produkte">Produkte</a>
					<a href="/warenkorb">Warenkorb</a>
					<a href="/login">Login</a>
					<a href="/suche">Suche</a>
				</nav>
			</header>
			<main>{children}</main>
			<footer class="site">
				Kaffeerösterei Bohnenkraft – fiktive Übungsseite, kein echtes Geschäft. <a href="/impressum">Impressum</a>
			</footer>
		</body>
	</html>
);

export const HomePage: FC<{ assets: { style: ResolvedAsset; logo: ResolvedAsset }; host: string }> = ({ assets, host }) => (
	<Layout title="Start" host={host} styleHref={assets.style.urlPath} logoHref={assets.logo.urlPath}>
		<h1>Willkommen bei Bohnenkraft</h1>
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

export const ProductListPage: FC<{ assets: { style: ResolvedAsset; logo: ResolvedAsset }; host: string; productImages: Map<string, ResolvedAsset> }> = ({
	assets,
	host,
	productImages
}) => (
	<Layout title="Produkte" host={host} styleHref={assets.style.urlPath} logoHref={assets.logo.urlPath}>
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

export const ProductDetailPage: FC<{
	assets: { style: ResolvedAsset; logo: ResolvedAsset };
	host: string;
	product: Product;
	image: ResolvedAsset | undefined;
}> = ({ assets, host, product, image }) => (
	<Layout title={product.name} host={host} styleHref={assets.style.urlPath} logoHref={assets.logo.urlPath}>
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

export const ImpressumPage: FC<{ assets: { style: ResolvedAsset; logo: ResolvedAsset }; host: string }> = ({ assets, host }) => (
	<Layout title="Impressum" host={host} styleHref={assets.style.urlPath} logoHref={assets.logo.urlPath}>
		<h1>Impressum</h1>
		<p>Platzhalter – fiktive Übungsseite, kein echtes Impressum.</p>
		<p>Bohnenkraft Rösterei GmbH (fiktiv) · Musterstraße 1 · 12345 Musterstadt</p>
	</Layout>
);

export const SearchPage: FC<{
	assets: { style: ResolvedAsset; logo: ResolvedAsset };
	host: string;
	query: string | null;
	results: Product[];
	tookMs: number | null;
}> = ({ assets, host, query, results, tookMs }) => (
	<Layout title="Suche" host={host} styleHref={assets.style.urlPath} logoHref={assets.logo.urlPath}>
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

export const CartPage: FC<{
	assets: { style: ResolvedAsset; logo: ResolvedAsset };
	host: string;
	cartId: string;
	items: { product: Product; quantity: number }[];
}> = ({ assets, host, cartId, items }) => (
	<Layout title="Warenkorb" host={host} styleHref={assets.style.urlPath} logoHref={assets.logo.urlPath}>
		<h1>Ihr Warenkorb</h1>
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

export const LoginPage: FC<{
	assets: { style: ResolvedAsset; logo: ResolvedAsset };
	host: string;
	result: { username: string } | null;
}> = ({ assets, host, result }) => (
	<Layout title="Login" host={host} styleHref={assets.style.urlPath} logoHref={assets.logo.urlPath}>
		<h1>Anmelden</h1>
		<form class="login" method="post" action="/login">
			<input type="text" name="username" placeholder="Benutzername" autocomplete="username" />
			<input type="password" name="password" placeholder="Passwort" autocomplete="current-password" />
			<button type="submit">Anmelden</button>
		</form>
		{result && (
			<p class="hinweis">
				Anmeldeversuch für „{result.username}“ wurde verarbeitet (dies ist eine Übungsseite, es gibt keine echten
				Konten).
			</p>
		)}
	</Layout>
);

export const AdminPage: FC<{
	assets: { style: ResolvedAsset; logo: ResolvedAsset };
	host: string;
	path: string;
}> = ({ assets, host, path }) => (
	<Layout title="Backoffice" host={host} styleHref={assets.style.urlPath} logoHref={assets.logo.urlPath}>
		<h1>Bohnenkraft Backoffice</h1>
		<p>
			Aufgerufener Pfad: <code>{path}</code>
		</p>
		<p>
			<a href="/admin/bestellungen">Bestellungen ansehen</a>
		</p>
	</Layout>
);

export const AdminOrdersPage: FC<{
	assets: { style: ResolvedAsset; logo: ResolvedAsset };
	host: string;
}> = ({ assets, host }) => (
	<Layout title="Bestellungen" host={host} styleHref={assets.style.urlPath} logoHref={assets.logo.urlPath}>
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
