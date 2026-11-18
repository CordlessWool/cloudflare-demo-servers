/**
 * Statische Assets (#13: /assets/<name>.<hash>.<ext>, Cache-Control: public, max-age=31536000,
 * immutable - Fall A aus sheets/02-cdn/00-Rahmen.md). Inhalte liegen als Strings im Code (kein
 * Build-Schritt, einfacher für `bun build --compile` in ein Binary). Der Hash wird beim Start
 * aus dem Inhalt berechnet, damit sich die URL bei einer Änderung automatisch ändert.
 */
// Bun-eigene Hash-API statt node:crypto, damit kein zusätzliches @types/node nötig ist
// (Projekt-Vorgabe: bun-only).

export interface AssetDef {
	name: string; // ohne Hash, z.B. "style"
	ext: string; // "css" | "svg"
	contentType: string;
	content: string;
}

const STYLE_CSS = `
:root { color-scheme: light; }
* { box-sizing: border-box; }
body {
	margin: 0;
	font-family: Georgia, 'Times New Roman', serif;
	background: #f6f1ea;
	color: #2b1d13;
	line-height: 1.55;
}
.banner {
	background: #2b1d13;
	color: #f6f1ea;
	padding: 0.4rem 1rem;
	font-size: 0.85rem;
	text-align: center;
	letter-spacing: 0.02em;
}
header.site {
	display: flex;
	align-items: center;
	gap: 1rem;
	padding: 1rem 2rem;
	border-bottom: 1px solid #d8cdbd;
	background: #fffdf9;
}
header.site img { height: 42px; }
header.site nav a {
	color: #2b1d13;
	text-decoration: none;
	margin-right: 1.2rem;
	font-size: 0.95rem;
}
header.site nav a:hover { text-decoration: underline; }
main { max-width: 860px; margin: 0 auto; padding: 2rem; }
h1 { font-size: 1.9rem; margin-top: 0; }
h2 { font-size: 1.3rem; }
.product-list { display: grid; gap: 1.4rem; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); }
.product-card {
	border: 1px solid #d8cdbd;
	border-radius: 8px;
	padding: 1rem;
	background: #fffdf9;
}
.product-card img { width: 100%; border-radius: 4px; }
.price { font-weight: bold; color: #6b3f1d; }
form.search, form.login { display: flex; gap: 0.6rem; margin-bottom: 1.4rem; flex-wrap: wrap; }
input[type="text"], input[type="password"] {
	padding: 0.5rem 0.7rem;
	border: 1px solid #c3b6a1;
	border-radius: 4px;
	font-size: 1rem;
}
button, input[type="submit"] {
	background: #6b3f1d;
	color: #fff;
	border: none;
	border-radius: 4px;
	padding: 0.55rem 1.1rem;
	font-size: 1rem;
	cursor: pointer;
}
table.orders { border-collapse: collapse; width: 100%; }
table.orders th, table.orders td { border: 1px solid #d8cdbd; padding: 0.5rem 0.7rem; text-align: left; }
footer.site { text-align: center; padding: 2rem; color: #8a7a65; font-size: 0.85rem; }
.hinweis { background: #f0e6d8; border: 1px solid #d8cdbd; border-radius: 6px; padding: 0.8rem 1rem; margin: 1rem 0; }
`.trim();

function svgBag(color: string): string {
	return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" role="img" aria-label="Kaffeetüte">
<rect width="200" height="200" fill="#f6f1ea"/>
<path d="M60 40 h80 l10 140 a10 10 0 0 1 -10 10 h-80 a10 10 0 0 1 -10 -10 z" fill="${color}"/>
<rect x="70" y="20" width="60" height="30" rx="6" fill="#2b1d13"/>
<text x="100" y="120" font-family="Georgia, serif" font-size="16" fill="#fffdf9" text-anchor="middle">Bohnenkraft</text>
</svg>`;
}

function svgLogo(): string {
	return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 48" role="img" aria-label="Bohnenkraft Logo">
<rect width="160" height="48" fill="none"/>
<circle cx="24" cy="24" r="18" fill="#6b3f1d"/>
<text x="50" y="30" font-family="Georgia, serif" font-size="20" fill="#2b1d13">Bohnenkraft</text>
</svg>`;
}

const RAW_ASSETS: Omit<AssetDef, 'content'>[] = [
	{ name: 'style', ext: 'css', contentType: 'text/css; charset=utf-8' },
	{ name: 'kaffeetuete-rot', ext: 'svg', contentType: 'image/svg+xml' },
	{ name: 'kaffeetuete-schwarz', ext: 'svg', contentType: 'image/svg+xml' },
	{ name: 'kaffeetuete-gelb', ext: 'svg', contentType: 'image/svg+xml' },
	{ name: 'logo', ext: 'svg', contentType: 'image/svg+xml' }
];

function contentFor(name: string): string {
	switch (name) {
		case 'style':
			return STYLE_CSS;
		case 'kaffeetuete-rot':
			return svgBag('#b4432a');
		case 'kaffeetuete-schwarz':
			return svgBag('#2b1d13');
		case 'kaffeetuete-gelb':
			return svgBag('#c98a2b');
		case 'logo':
			return svgLogo();
		default:
			throw new Error(`Unbekanntes Asset: ${name}`);
	}
}

function hashOf(content: string): string {
	const hasher = new Bun.CryptoHasher('sha256');
	hasher.update(content);
	return hasher.digest('hex').slice(0, 10);
}

export interface ResolvedAsset extends AssetDef {
	hash: string;
	fileName: string; // "<name>.<hash>.<ext>"
	urlPath: string; // "/assets/<fileName>"
}

/** Baut die Asset-Tabelle einmal beim Start (Name -> Asset, Dateiname -> Asset). */
export function buildAssetRegistry(): { byName: Map<string, ResolvedAsset>; byFileName: Map<string, ResolvedAsset> } {
	const byName = new Map<string, ResolvedAsset>();
	const byFileName = new Map<string, ResolvedAsset>();
	for (const raw of RAW_ASSETS) {
		const content = contentFor(raw.name);
		const hash = hashOf(content);
		const fileName = `${raw.name}.${hash}.${raw.ext}`;
		const asset: ResolvedAsset = { ...raw, content, hash, fileName, urlPath: `/assets/${fileName}` };
		byName.set(raw.name, asset);
		byFileName.set(fileName, asset);
	}
	return { byName, byFileName };
}
