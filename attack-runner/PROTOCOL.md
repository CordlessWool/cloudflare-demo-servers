# Angriffs-Protokoll: signierte Befehle und Antwortklassen (#37, #52)

Verbindliche Beschreibung des Formats zwischen der Schulungs-App (privates Repo,
`games/cloudflare-zone`) und dem Angriffs-Runner (dieser Ordner). Beide Seiten implementieren dieselbe Logik
unabhängig voneinander (unterschiedliche Runtimes: Cloudflare Worker vs. Bun-Binary auf einem
DigitalOcean-Droplet),
deshalb ist dieses Dokument die Quelle der Wahrheit, nicht ein geteiltes Package. Bei
Änderungen an einer Seite (`attackSigning.ts`/`responseClass.ts` bzw. `signing.ts`/
`classify.ts`) dieses Dokument und die jeweils andere Seite nachziehen.

**Aktuelle Version: Protokoll v2 (Angriffs-Baukasten, Release `attack-runner-v2`).**

Konsumenten: #38 (Baukasten/Angreifer-Bildschirm, legt `toolEnabled` und die Bausteinwerte
fest), #39 (Live-Anzeige/Messung im Schritt „WAF-Spiel“, liest `attack_reports`).

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
| `toolEnabled` | boolean | Angriff an/aus. Die App setzt es nur dann auf `true`, wenn die Maschine eingeschaltet ist **und** das Anfragen-Budget der Gruppe noch nicht aufgebraucht ist (siehe unten). |
| `protocolVersion` | number | Immer `2`. Jeder andere Wert (auch `1`) wird abgelehnt. |
| `target` | string | Baustein Ziel: `search` \| `login` \| `admin` \| `sweep` \| `home` (siehe Bausteine) |
| `identity` | string | Baustein Kennung: `script` \| `browser` \| `googlebot` \| `none` |
| `cacheBust` | boolean | Baustein „Cache umgehen": hängt `v=<8 Hex>` an den Pfad |
| `pace` | string | Baustein Tempo: `fast` (1000 ms, ab v4) \| `normal` (5000 ms) \| `slow` (20000 ms) |
| `minIntervalMs` | number | Informativ: die App setzt den Wert aus `pace`. Der Runner leitet den Abstand aus `pace` ab, nicht aus diesem Feld, und erzwingt seine EIGENE, hart codierte Untergrenze (`RATE_FLOOR_MS`, ab v4 1000). |

Entfallen gegenüber v1: `tool` und `disguise`.

**Ablehnung unbekannter Werte:** Ein Befehl mit `protocolVersion !== 2`, unbekanntem `target`,
`identity` oder `pace` oder einem `cacheBust`, das kein boolean ist, wird behandelt wie eine
falsche Signatur: der Runner lehnt ihn ab (`InvalidCommandError`) und sendet keinen Request.
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

### Baukasten (Protokoll v2)

Die Angreifer kombinieren Bausteine statt eines festen Werkzeugs. Die Wertemengen sind fest, von
App (`const.ts`/`attackBlocks.ts`) und Runner (`tools.ts`) identisch geführt; freie Werte gibt es
nicht. Jede Konfiguration erzeugt genau EINEN beobachtbaren Request je Zyklus (`buildRequest`).
Die Ziel-Domain bleibt getrennt (aus der Umgebung, #37). Die Region ist kein Befehlsfeld, sondern
Eigenschaft der Maschine (Lebenszyklus, #52).

Signatur einer Konfiguration (App, Wertung): `${target}|${identity}|${cacheBust ? 1 : 0}`
(das Tempo gehört nicht dazu).

**Ziel (`target`)**

| Wert | Request |
|---|---|
| `search` | `GET /suche?q=<Begriff aus SEARCH_TERMS>` |
| `login` | `POST /login`, `Content-Type: application/x-www-form-urlencoded`, Body `username=<Name aus LOGIN_NAMES>&password=geheim123` |
| `admin` | `GET` auf die Bestellübersicht in wechselnder Schreibweise: `['/admin/bestellungen', '/ADMIN/BESTELLUNGEN', '/Admin/Bestellungen', '/admin/Bestellungen']` (alle liefern dieselben Bestelldaten) |
| `sweep` | `GET` auf einen Pfad aus `SWEEP_PATHS` (auch nicht vorhandene, 404) |
| `home` | `GET /` (in der App „Flut": nur Menge, unveränderter Pfad) |

**Kennung (`identity`)**

| Wert | User-Agent |
|---|---|
| `script` | `BohnenkraftLastTest/1.0 (+Cloudflare-Schulung)` |
| `browser` | normaler Browser-UA (`DISGUISE_USER_AGENT`, Chrome 125 unter Windows) |
| `googlebot` | `Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)` (nur behauptet) |
| `none` | Header `user-agent` mit **leerem** Wert (Bun-`fetch` sendet sonst `Bun/<version>`) |

**Cache umgehen (`cacheBust`):** `true` hängt `v=<8 Hex>` (zufällig je Anfrage) an den Pfad,
mit `?` oder, wenn schon eine Query da ist, mit `&`.

**Tempo (`pace`):** `fast` = 1000 ms (ab v4), `normal` = 5000 ms, `slow` = 20000 ms. Abstand =
`max(RATE_FLOOR_MS, PACE_INTERVAL_MS[pace])`, aus `pace` abgeleitet, nicht aus `minIntervalMs`.

**Schleifentakt (ab v4):** Die Hauptschleife tickt im Takt von `LOOP_TICK_MS` (= `RATE_FLOOR_MS`,
1000 ms), damit `fast` überhaupt gesendet werden kann. Befehle holt sie seltener
(`COMMAND_POLL_INTERVAL_MS`, 5000 ms) und benutzt denselben Befehl mehrfach. Ein Befehl sendet nach
`expiresAt` nichts mehr (`maybeSendAttackRequest`), damit ein wiederverwendeter Befehl nicht über
seine TTL hinaus läuft; bleibt die App stumm, hört der Runner nach der TTL auf.

**Fehlgeschlagener Poll (ab v5):** Schlägt eine Befehls-Abholung fehl (Netz, HTTP-Fehler,
Signatur, Replay), sendet der Runner sofort nichts mehr, bis ein späterer Poll gelingt. Der letzte
gute Befehl dient nur noch für Meldungen, damit die aufgelaufenen Zählungen ankommen. Eine
fehlgeschlagene Meldung beendet den Prozess nicht: die Zählung bleibt erhalten und wird im nächsten
Tick erneut gemeldet.

**Kompatibilität:** `protocolVersion` bleibt `2` (nur ein zusätzlicher `pace`-Wert). Ein Runner bis
v3 lehnt `fast` als unbekanntes Tempo ab und sendet nichts; `attack-runner-v4` versteht es.

### Request-Bau im Runner

`buildRequest(blocks, rng)` in `src/tools.ts` liefert `{ method, path, headers, body? }`:

1. Methode, Pfad und gegebenenfalls Body und `content-type` aus `target`.
2. Header `user-agent` aus `identity` (immer gesetzt, bei `none` leer).
3. Bei `cacheBust` `v=<8 Hex>` an den Pfad anhängen.

Variierende Teile (Begriff, Pfad, Name, Hex) kommen aus `rng` (Tests legen sie fest). Vor dem
Bau prüft der Runner Version und Werte (`assertValidCommand`), danach den Abstand (`pace`).

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
