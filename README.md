# cloudflare-demo-servers

Server für die Droplets der Cloudflare-Schulung. Die Schulungs-App legt die Droplets an und
richtet sie per cloud-init ein; die Droplets laden die Binaries ohne Anmeldung aus den Releases
dieses Repos.

| Ordner | Zweck | Release-Tag | Datei |
|---|---|---|---|
| [`practice-origin`](practice-origin) | Übungs-Origin, Demo-Shop „Bohnenkraft“ (Bun + Hono, hinter Caddy) | `practice-origin-v<n>` | `practice-origin-linux-x64` |
| [`attack-runner`](attack-runner) | Lastgenerator für das DDoS-Spiel, nur signierte Befehle, Ziel fest beim Anlegen | `attack-runner-v<n>` | `attack-runner-linux-x64` |

## Entwicklung

```sh
bun install
bun run check   # TypeScript
bun run test
```

## Release

Ein Tag `<ordner>-v<n>` pushen. GitHub Actions prüft, testet, baut das Linux-Binary und legt
das Release an (`.github/workflows/release.yml`):

```sh
git tag practice-origin-v2
git push origin practice-origin-v2
```

Download-URL für cloud-init:
`https://github.com/CordlessWool/cloudflare-demo-servers/releases/download/<tag>/<datei>`
