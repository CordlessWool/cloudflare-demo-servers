# attack-runner – Angriffs-Runner für das DDoS-Spiel (#37, #52, Teil von #20)

Kleines Bun-Programm, das auf den Angriffs-Maschinen (DigitalOcean-Droplets, #52) läuft. Holt
signierte Befehle von der Schulungs-App (privates Repo, `games/cloudflare-zone`), hält sich an
eine harte Rate-Untergrenze, zählt Antwortklassen und meldet sie über denselben Kanal. Format
der Befehle/Meldungen: [`PROTOCOL.md`](PROTOCOL.md).

Dieses Package braucht für
seine Tests (`bun test`) keine Credentials: es testet die reine Logik (Signatur, Klassifikation,
Rate, Nonce) und den Ablauf gegen einen lokalen Test-Server (`test/runner.test.ts`).

## Wer steuert die Maschine?

Nur die App (Cloudflare Worker). Sie allein hält das DigitalOcean-Token, legt die Droplets an
und löscht sie. Die Maschine bekommt beim Anlegen per `user_data` (cloud-init, erzeugt in
`games/cloudflare-zone/src/lib/server/cloudInit.ts`) ihre Werte in `/etc/attack-runner.env` und
startet den Runner als systemd-Dienst. Auf der Maschine gibt es kein DO-Token, SSH ist aus,
Teilnehmer haben keinen Zugang.

## Sicherheit (#37, #52)

- **Ziel fest, nicht wählbar:** Die App schreibt die Domain der Gegengruppe beim Anlegen als
  `TARGET_DOMAIN` in die Maschine, nie per Befehl. (Dass der Runner das Ziel nur noch hieraus
  liest, ist der Fix aus dem PR zu #37.)
- **Signierte Befehle mit Ablaufzeit + Nonce:** HMAC-SHA256 über kanonisches JSON (siehe
  `src/signing.ts`), abgelaufene Befehle werden abgelehnt, jede Nonce nur einmal akzeptiert
  (`src/nonceStore.ts`, im RAM, die Maschine lebt nur eine Runde).
- **Harte Rate-Obergrenze im Programm:** `RATE_FLOOR_MS` (5 s) wird unabhängig vom Befehlsinhalt
  erzwungen (`src/rateLimiter.ts`).
- **Timer:** Der Prozess beendet sich nach `SELF_DESTRUCT_MS` (45 min) auf jeden Fall und wird
  nicht neu gestartet (`Restart=on-failure`). Das ist kein Steuerungsweg, nur ein
  Sicherheitsnetz. Das Droplet selbst löscht die App: "Spiel beenden", Notaus oder der Cron
  Trigger, der getaggte Angriffs-Droplets älter als die maximale Spieldauer löscht.

## Env-Variablen (von der App per user_data gesetzt)

| Variable | Zweck |
|---|---|
| `APP_BASE_URL` | Basis-URL der App, für `/api/attack/command` und `/api/attack/report` |
| `ATTACK_MACHINE_ID` | App-eigene ID der Maschine (`attack_machines.id`), steht in jedem Befehl |
| `ATTACK_RUNNER_POLL_TOKEN` | Geteiltes Secret für den Netzzugriff auf die beiden Endpunkte (grobe Hürde, nicht die eigentliche Absicherung) |
| `ATTACK_COMMAND_SECRET` | Geteiltes HMAC-Secret für Befehle/Meldungen (gleicher Wert wie in der App) |
| `TARGET_DOMAIN` | Domain der Gegengruppe, fest beim Anlegen |
| `PORT` | Port für `/health` (Default 8080) |

## Binary für die Droplets bauen und veröffentlichen

cloud-init lädt `attack-runner-linux-x64` ohne Anmeldung aus dem Release dieses Repos mit dem
Tag aus der App-Variable `ATTACK_RUNNER_VERSION` (Standard `attack-runner-v1`). Gebaut wird von
GitHub Actions (`.github/workflows/release.yml`): ein Tag pushen, den Rest macht die Action
(prüfen, testen, Linux-Binary bauen, Release anlegen).

```sh
git tag attack-runner-v2
git push origin attack-runner-v2
```

Danach `ATTACK_RUNNER_VERSION` in der App (`wrangler.jsonc`) auf den neuen Tag setzen und
deployen.

Schneller als der Download bei jedem Start: ein eigener DO-Snapshot, in dem das Binary schon
unter `/usr/local/bin/attack-runner` liegt. Dessen ID in der App-Variable `DO_ATTACK_IMAGE`
eintragen; cloud-init überspringt den Download dann.

`Containerfile` bleibt für lokale Tests (`podman build` / `docker build`).

## Tests

```sh
bun test
```

`test/*.test.ts` deckt Signatur-Prüfung, Antwortklassen, Rate-Untergrenze und Nonce-Store ab;
`test/runner.test.ts` lässt den ganzen Zyklus (Befehl holen -> angreifen -> melden) gegen
einen lokalen `Bun.serve`-Server laufen, inklusive der Fehlerfälle (abgelaufener Befehl,
falsche Signatur, Replay).
