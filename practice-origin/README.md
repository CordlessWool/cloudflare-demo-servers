# practice-origin – Übungs-Origin "Bohnenkraft" (#13, #15, #53)

Fiktiver Online-Shop (Kaffeerösterei "Bohnenkraft") als echter Origin außerhalb von
Cloudflare. Bun + Hono, serverseitiges HTML (Hono JSX), **kein Client-JavaScript**. Läuft als
ein einziges kompiliertes Binary (`bun build --compile`) auf einem DigitalOcean-Droplet hinter
Caddy (#53: ein Anbieter für Origin und Angriffs-Maschinen).

## Routen

| Route | Zweck |
|---|---|
| `/` | Startseite, kein Cache-Header (HTML wird von Cloudflare per Default nicht gecacht) |
| `/produkte`, `/produkte/<slug>` | 6 Kaffees mit Bild/Preis/Beschreibung |
| `/assets/<name>.<hash>.<ext>` | CSS/SVG, `Cache-Control: public, max-age=31536000, immutable` |
| `/suche?q=` | absichtlich langsam (300–800 ms, **nur Timer, keine CPU-Schleife**) |
| `/warenkorb`, `/dynamisch` (Alias) | Session-Cookie + zufällige Kennung; `/warenkorb/hinzufuegen` (POST, kein JS) legt ein Produkt hinein |
| `/login` | GET-Formular, POST mit beliebiger Eingabe |
| `/admin`, `/admin/bestellungen`, `/admin/*` | Backoffice, **case-insensitive** (auch `/ADMIN`) |
| `/impressum` | Platzhalter |
| `/health` | lokaler Health-Check (cloud-init wartet darauf), **nicht gezählt** |
| `/__stats?host=&since=` | Zähler, nur mit `Authorization: Bearer <STATS_TOKEN>`, sonst 404 |

## Zähler und Last

RAM-Ringpuffer (`COUNTER_CAP`, Default 20000 Einträge). Jeder Eintrag enthält Host, Pfad,
Zeit, Anzeige-IP, `CF-Connecting-IP`, Gegenstelle, `CF-Ray` – grob geschätzt ~150–250
Byte/Eintrag inkl. JS-Objekt-Overhead, bei 20000 Einträgen **ca. 3–4 MB** (siehe
`src/lib/counter.ts`). Oberhalb von `HARD_LIMIT_RPS` (Default 60 Req/s, pro Domain getrennt
gemessen) antwortet die Domain mit 503, andere Domains bleiben unbeeinflusst.

**Client-IP:** Caddy terminiert TLS und setzt `X-Forwarded-For` auf die Gegenstelle (mit
Cloudflare davor ist das eine Cloudflare-Adresse). Cloudflare liefert zusätzlich
`CF-Connecting-IP`, die für die Teilnehmenden sichtbare Adresse (z. B. die einer Angriffs-Maschine, #20).
Der Zähler speichert beide getrennt (`cfIp`, `peerIp`); die Anzeige-/Stats-IP (`ip`) bevorzugt
`CF-Connecting-IP`.

## Betrieb auf DigitalOcean (#53)

Die Schulungs-App (privates Repo, `games/cloudflare-zone`, Schritt „Übungs-Server“ der Sitzung) startet und stoppt den
Origin per Knopf. Ein ausgeschaltetes Droplet kostet bei DigitalOcean voll, deshalb heißt Stoppen
löschen und Starten neu anlegen (etwa 1–2 Minuten, #94).

- **Droplet:** Größe je Sitzung wählbar (#113, Reihe Basic / Regular, stundengenau), Standard die
  kleinste in der Region (heute `s-1vcpu-512mb-10gb`, 4 USD/Monat), Debian 13 (DO hat das Debian-12-Image eingestellt),
  Tags `cfs-origin` + `cfs-s:<Sitzung>`. Die App fasst nur Droplets mit ihren Tags an.
- **Feste IP je Sitzung (#94):** beim ersten Start legt die App eine Reserved IP in `fra1` an und
  weist sie jedem neuen Origin-Droplet der Sitzung zu. Über Stoppen/Starten bleibt die Adresse
  gleich (Export vom Altanbieter, #10, A-Records der Teilnehmenden gelten weiter); freigegeben
  wird sie beim Beenden der Sitzung. Kosten laut DigitalOcean
  (<https://docs.digitalocean.com/products/networking/reserved-ips/details/pricing/>, geprüft 17.11.2026):
  zugewiesen kostenlos, nicht zugewiesen 0,01 USD/Stunde, unter 1 USD je IP nichts.
- **cloud-init** (erzeugt von der App, `src/lib/server/cloudInit.ts`): lädt das Binary aus dem
  GitHub-Release (`PRACTICE_ORIGIN_VERSION`) und Caddy, startet beide als systemd-Dienste
  (die App lauscht nur auf `127.0.0.1:8080`), schaltet SSH ab und meldet sich bei der App
  bereit, sobald `/health` lokal antwortet.
- **TLS (Cloudflare "Full (strict)"):** Caddy holt per On-Demand-TLS ein Zertifikat je
  Seminar-Domain beim ersten Handshake. Vorher fragt Caddy die App
  (`/api/practice-origin/tls-ask?domain=`), die nur als Zone vergebene Domains laufender Sitzungen und deren
  `www.` erlaubt. Teilnehmende tragen dafür nichts ein.

### Binary bauen und veröffentlichen

Gebaut wird von GitHub Actions (`.github/workflows/release.yml`): ein Tag pushen, den Rest
macht die Action (prüfen, testen, Linux-Binary bauen, Release mit
`practice-origin-linux-x64` anlegen). cloud-init lädt die Datei ohne Anmeldung.

```sh
git tag practice-origin-v2
git push origin practice-origin-v2
```

Danach `PRACTICE_ORIGIN_VERSION` in der App (`games/cloudflare-zone/wrangler.jsonc`) auf den
neuen Tag setzen und deployen.

## Build & Test

```sh
bun install
bun test              # siehe test/app.test.ts
bunx tsc --noEmit -p tsconfig.json
bun run build         # Binary für das eigene System; build:linux für die Droplets
```

`Containerfile` bleibt für lokale Tests (`podman build` / `docker build`).

## Umgebungsvariablen

| Name | Default | Zweck |
|---|---|---|
| `PORT` | `8080` | Port |
| `BIND_HOST` | `0.0.0.0` | Adresse; auf dem Droplet `127.0.0.1` (nur Caddy davor) |
| `STATS_TOKEN` | – | Bearer-Token für `/__stats`; fehlt er, antwortet die Route 404. Auf dem Droplet per cloud-init. |
| `CAPACITY_RPS` | `20` | ausgewiesene Kapazität je Domain in `/__stats` |
| `HARD_LIMIT_RPS` | `60` | harte Grenze je Domain, oberhalb 503 |
| `COUNTER_CAP` | `20000` | Ringpuffer-Obergrenze |
