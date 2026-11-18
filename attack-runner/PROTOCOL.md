# Angriffs-Protokoll: signierte Befehle und Antwortklassen (#37, #52)

Verbindliche Beschreibung des Formats zwischen der Schulungs-App (privates Repo,
`games/cloudflare-zone`) und dem Angriffs-Runner (dieser Ordner). Beide Seiten implementieren dieselbe Logik
unabhängig voneinander (unterschiedliche Runtimes: Cloudflare Worker vs. Bun-Binary auf einem
DigitalOcean-Droplet),
deshalb ist dieses Dokument die Quelle der Wahrheit, nicht ein geteiltes Package. Bei
Änderungen an einer Seite (`attackSigning.ts`/`responseClass.ts` bzw. `signing.ts`/
`classify.ts`) dieses Dokument und die jeweils andere Seite nachziehen.

Konsumenten: #38 (Werkzeugkasten/Angreifer-Bildschirm, legt `toolEnabled`/zukünftige
Werkzeug-IDs fest), #39 (Live-Anzeige/Messung im Schritt „WAF-Spiel“, liest `attack_reports`).

## Transportweg

- **Befehl (App -> Runner):** `GET /api/attack/command?machineId=<id>` auf der App, Header
  `Authorization: Bearer <ATTACK_RUNNER_POLL_TOKEN>` (grobe Netz-Hürde, geteiltes Secret, NICHT
  der Signierschlüssel). Antwort ist die signierte Befehls-Hülle (siehe unten). Der Runner
  pollt alle `COMMAND_POLL_INTERVAL_MS` (5 s).
- **Meldung (Runner -> App):** `POST /api/attack/report` auf der App, gleicher Bearer-Token,
  Body ist die signierte Melde-Hülle. Der Runner meldet alle `REPORT_INTERVAL_MS` (15 s) die
  seit der letzten Meldung gezählten Antwortklassen.

## Signierte Hülle

```json
{ "payload": { ... }, "signature": "<hex>" }
```

`signature` ist `HMAC-SHA256(ATTACK_COMMAND_SECRET, canonicalJson(payload))` als Hex-String.
`ATTACK_COMMAND_SECRET` ist ein Worker-Secret (App); die App schreibt denselben Wert beim
Anlegen per `user_data` in die Angriffs-Maschine -- **niemals** im Klartext in Logs/Audit.

`canonicalJson`: wie `JSON.stringify`, aber Objekt-Schlüssel alphabetisch sortiert, kein
Whitespace, rekursiv. Signierer und Prüfer MÜSSEN exakt denselben Algorithmus verwenden
(Referenzimplementierung: `attackSigning.ts`/`signing.ts`, je eine Kopie pro Seite).

## Befehls-Payload (`AttackCommandPayload`)

| Feld | Typ | Bedeutung |
|---|---|---|
| `sessionId` | string | Sitzung |
| `teamId` | string | Spielgruppe der Angreifer (`game_groups.id`, #82; der Feldname bleibt für den Runner gleich) |
| `machineId` | string | App-eigene ID der Maschine (`attack_machines.id`), für die dieser Befehl gilt |
| `toolEnabled` | boolean | Werkzeug an/aus. Die App setzt es nur dann auf `true`, wenn die Gruppe ein Werkzeug gewählt hat (`tool != null`) **und** ihr Anfragen-Budget noch nicht aufgebraucht ist (siehe unten). |
| `tool` | string \| null | Gewähltes Werkzeug (#38) aus dem festen Kasten (`AttackTool`, siehe unten) oder `null`. Bestimmt Methode, Pfad und User-Agent der Anfrage. Der Runner baut daraus den Request (`tools.ts`/`buildToolRequest`), ohne freie Parameter. |
| `disguise` | boolean | Zusatz-Werkzeug „Tarnung": Browser-User-Agent statt Skript-UA. |
| `minIntervalMs` | number | Vom Server vorgegebene Rate (informativ -- der Runner erzwingt seine EIGENE, hart codierte Untergrenze unabhängig davon, siehe `RATE_FLOOR_MS`/`ATTACK_RATE_MIN_INTERVAL_MS`, beide 5000) |
| `issuedAt` | number (ms) | Ausstellungszeitpunkt |
| `expiresAt` | number (ms) | Ablaufzeit; nach diesem Zeitpunkt lehnt der Runner den Befehl ab |
| `nonce` | string (hex) | Einmal-Kennung. Der Runner merkt sich gesehene Nonces im RAM (`NonceStore`) und lehnt eine zweite Zustellung derselben Nonce ab. Die App merkt sich jede ausgegebene Nonce in `attack_command_nonces` (D1) und erlaubt genau EINEN Verbrauch (für eine Meldung). |

**Kein `targetDomain` im Befehl (#37/#52).** Das Ziel steht fest in der Umgebung der Maschine
(`TARGET_DOMAIN`, beim Anlegen per `user_data`/cloud-init, siehe `cloudInit.ts`). Der Runner
liest es beim Start aus seiner Umgebung, prüft den Hostnamen (`validateTargetDomain`: gültiger
FQDN, optional mit Port, **keine IP-Literale**) und greift ausschließlich diese Domain an. So kann
auch ein gefälschter oder manipulierter Befehl den Angriff nicht auf ein anderes Ziel umlenken.
Die Ziel-Domain ist die verteidigte Zone der laufenden Runde; die App ermittelt sie serverseitig
(`roundTargetDomain`) nur zum Anlege-Zeitpunkt.

### Serverseitiges Anfragen-Budget (#37)

Jede Gruppe hat je Sitzung ein festes Anfragen-Budget (`ATTACK_GROUP_REQUEST_BUDGET`). Die App
summiert die bisher gemeldeten Antwortklassen über `attack_reports`
(`passed + blocked + cached + origin_overload`) je Sitzung und Gruppe. Erreicht die Summe das
Budget, gibt die App in jedem weiteren Befehl `toolEnabled = false` aus -- unabhängig davon, was
die Gruppe im Werkzeugkasten gewählt hat. Der Runner hört dann von selbst auf zu senden. Die reine
Logik steht in `attackMachinesRules.ts` (`requestBudgetStatus`, `effectiveToolEnabled`), die
Durchsetzung in `issueCommandForMachine` (`attackCommand.ts`); den Rest-Stand für die Anzeige
liefert `teamBudgetStatus` (#39).

Ablehnungsgründe des Runners: falsche Signatur, `now > expiresAt`, Nonce schon gesehen,
`machineId` im Payload ≠ eigene Machine-ID. Bei Ablehnung: kein Angriffs-Request in diesem
Zyklus, nächster Poll in `COMMAND_POLL_INTERVAL_MS`.

### Werkzeugkasten `AttackTool` (#38)

Fester Satz, von App (`const.ts`) und Runner (`tools.ts`) identisch geführt. Jedes Werkzeug
erzeugt genau EINEN beobachtbaren Request (`buildToolRequest`); variierende Teile (Suchbegriff,
Pfad) kommen aus einer festen Liste. Die Ziel-Domain bleibt getrennt (aus der Umgebung, #37).

| Wert | Request | Erkennungsmerkmal | Abwehr auf Pro |
|---|---|---|---|
| `search_flood` | `GET /suche?q=<wechselnd>` | viele Suchanfragen | Rate Limit auf `/suche` oder Custom Rule |
| `login_rush` | `POST /login` | viele Logins | Rate Limit oder Challenge auf `/login` |
| `page_sweep` | `GET <wechselnder Pfad, auch 404>` | viele verschiedene URLs | Custom Rule auf Pfadmuster, SBFM |
| `foreign_country` | `GET /` (Browser-UA) | Region der Maschine | Custom Rule auf `ip.src.country` |
| `suspicious_ua` | `GET /` mit Skript-UA | Skript-User-Agent | User-Agent-Sperre oder Custom Rule |

User-Agents: Skript-UA `BohnenkraftLastTest/1.0 (+Cloudflare-Schulung)` ist das Merkmal von
`suspicious_ua`. Das Zusatz-Werkzeug **Tarnung** (`disguise: true`) schaltet bei den übrigen
Werkzeugen auf einen Browser-User-Agent um; bei `suspicious_ua` wird es ignoriert (der Skript-UA
IST dort das Merkmal). Das Zusatz-Werkzeug **Verteilen** ist kein eigener Request, sondern dasselbe
Werkzeug auf mehreren Maschinen/Regionen (Lebenszyklus, #37/#52).

## Antwortklassen (`ResponseClass`)

Zuordnung einer einzelnen HTTP-Antwort auf den Angriffs-Request (Reihenfolge ist die
Prüf-Reihenfolge, erste zutreffende Regel gewinnt):

| Klasse | Bedingung | Bedeutung |
|---|---|---|
| `blocked` | Status 403 ODER 429 ODER `cf-mitigated`-Header vorhanden (auch bei Status 200 -- Challenge-Seiten liefern teils 200) | Cloudflare hat geblockt oder fordert eine Challenge |
| `origin_overload` | Status 503 (und `blocked` greift nicht) | Origin-Hard-Limit überschritten, Angriff kam durch |
| `cached` | Status 200 mit `cf-cache-status: HIT` | Aus dem Cache bedient, Origin nicht getroffen |
| `passed` | alles andere (i. d. R. 200 mit echtem Shop-Inhalt) | Durchgekommen |

Referenzimplementierung: `responseClass.ts` (App) / `classify.ts` (Runner), inhaltlich
identisch (siehe Testdateien je Seite).

## Melde-Payload (`AttackReportPayload`)

| Feld | Typ | Bedeutung |
|---|---|---|
| `sessionId`, `teamId`, `machineId` | string | wie oben |
| `nonce` | string | Nonce des Befehls, unter dem diese Zählung lief -- bindet die Meldung an einen echten, von der App ausgegebenen Befehl. Die App lehnt ab, wenn die Nonce unbekannt ist oder schon verbraucht wurde (Replay). |
| `counts` | `{ passed, blocked, cached, origin_overload }` | Zählung seit der letzten Meldung (nicht kumulativ über die ganze Sitzung) |
| `reportedAt` | number (ms) | Meldezeitpunkt |

Persistiert als eine Zeile in `attack_reports` (D1, Migration `0040_attack_machines.sql`) je
Meldezyklus -- append-only, roh. Aggregation/Anzeige im Schritt „WAF-Spiel“ ist #39.

## Kennzeichnung und Lebenszyklus der Angriffs-Maschinen (#52)

Angriffs-Maschinen sind DigitalOcean-Droplets (kleinste Größe, eine Region je Maschine aus der
festen Liste `AttackRegion`: `fra1`, `ams3`, `nyc3`). Nur die App startet und löscht sie; sie
allein hält das DO-Token.

**Kennzeichnung:** Jedes Droplet trägt die Tags `cfs-attack`, `cfs-s:<sessionId>` und
`cfs-g:<Spielgruppen-ID>` (`dropletRules.ts`) und hat eine Zeile in D1 (`attack_machines`: `id` =
App-eigene ID, `droplet_id` = DO-ID, Migration `0070_digitalocean.sql`). Die App fasst nur
Droplets mit ihren Tags an und prüft die Zugehörigkeit zu Sitzung und Gruppe serverseitig.

**Anlegen** (`createMachinesForRound` in `attackLifecycle.ts`) nur während einer laufenden Runde
und nur durch die Angreifer-Gruppe (#86, sonst `AttackNotAllowedError` vor jedem API-Aufruf). Obergrenze 3 Maschinen je Gruppe wird VOR jedem API-Aufruf geprüft; die D1-Zeile
entsteht vor dem Droplet und zählt damit sofort. Per `user_data` (cloud-init, `cloudInit.ts`)
bekommt die Maschine `APP_BASE_URL`, `ATTACK_MACHINE_ID`, `ATTACK_RUNNER_POLL_TOKEN`,
`ATTACK_COMMAND_SECRET` und `TARGET_DOMAIN` (verteidigte Zone der laufenden Runde). Ein DO-Token und SSH gibt
es auf der Maschine nicht.

**Regionswechsel** (`switchMachineRegion`): Droplet löschen und in der neuen Region neu anlegen
(neue App-ID, Werkzeug-Status bleibt). Kein Stoppen: Ein ausgeschaltetes Droplet kostet voll.

**Aufräumen** (`cleanupSessionMachines`, "Spiel beenden" und "erneut löschen"): löscht alle
Droplets mit `cfs-attack` + `cfs-s:<sessionId>` (über die Tags, nicht nur über D1), zieht D1
nach und liest danach den Stand über die API: `{ allClear, remaining }`. Bei
`allClear: false` zeigt der Admin die Liste mit dem Knopf "erneut löschen".

**Notaus** (`killSwitch`): setzt sofort `tool_enabled = 0` für alle Maschinen der Sitzung und
löscht dann wie beim Aufräumen.

**Sicherheitsnetz** (kein Steuerungsweg): Der Runner hört nach `SELF_DESTRUCT_MS` (45 min) auf
zu senden. Ein Cron Trigger im Worker (alle 10 min, `src/worker/scheduled.ts`) löscht getaggte
Angriffs-Droplets, die älter als `ATTACK_MACHINE_MAX_AGE_MS` (60 min) sind. Die Admin-Seite (Schritt
„Übungs-Server“) warnt, wenn nach Sitzungsende noch Droplets mit dem Tag der Sitzung existieren.
