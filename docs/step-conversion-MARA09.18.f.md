# STEP-Konvertierung – MARA09.18.f

Die verbindliche Regel für die Übernahme ursprünglicher STEP-Zeichnungsnummern und die separate Instanznummerierung ist in [step-drawing-number-instance-rule.md](step-drawing-number-instance-rule.md) dokumentiert.

Stand: 18.09.2026. FreeCAD 1.0.2, Blender 4.5, Windows.

Die Datei `4026212455489_315868.step` (19.688.261 Bytes) wurde vollständig zu GLB konvertiert. Ihr SHA-256 entspricht dem Upload des fehlgeschlagenen Jobs `a09dc1b0-db26-4ee7-aa9e-db4de3f22fa6`: `6cffb88576868c7046123644b1a2fef3a5801ee2c32a945394c844816b3f2b55`.

## Änderung

- FreeCAD-Ausgabe wird als Bytes vollständig gelesen und anschließend mit UTF-8 und `errors='replace'` decodiert. Ungültige Zeichen werden ersetzt und als Warnung vermerkt; die restliche Ausgabe bleibt erhalten. Auch bei Timeout werden Standardausgabe und Fehlerausgabe protokolliert.
- Das gemeinsame FreeCAD-Budget beträgt standardmäßig **600 Sekunden**, konfigurierbar über `STEP_CONVERSION_TIMEOUT_SECONDS` (positiv und endlich). Alle Skriptversuche teilen dieses Budget. Nach dessen Verbrauch wird der laufende Prozess von `subprocess.run` beendet und kein neuer Versuch gestartet.
- Bei Fehlern enthält die abschließende Meldung den letzten Fehler und die Fehlerhistorie aller Versuche. Eine Timeoutmeldung enthält Budget, gemessene Dauer und den letzten erkennbaren Arbeitsschritt.
- Das Gateway wartet bei der Konvertierungsanfrage bis zu 30 Minuten auf das MCP, dessen vorhandenes Gesamtbudget 25 Minuten beträgt. Damit beendet das bisherige HTTP-Limit von 10 Minuten keinen noch berechtigt laufenden Export.
- `freecad_step_debug.log` enthält `Tessellierung n/N`, Laufzeiten je Form und je Hauptschritt. `step_status` enthält Formenanzahl, verarbeitete Formen, exportierte Meshes, Vertex-/Flächenzahlen und Laufzeiten. Über `STEP_LOG_FILE` können parallele/gezielte Tests separate Logs verwenden.
- Die OBJ-Statistik liest auch Kommentare mit ungültigen UTF-8-Zeichen zuverlässig bis zum Dateiende. Ebenso sind Versionsprüfungen und die Ausgabe des optionalen USDZ-Werkzeugs robust decodiert.

## Qualität und Tessellierung

Tessellierungsparameter (`0.1`), Platzierungen, Geometrie, Farbzuordnung, `NEXT_ASSEMBLY_USAGE_OCCURRENCE`, Zeichnungsnummern und Mesh-Gruppierung wurden nicht geändert. Ähnliche Bauteile werden nicht ohne gesicherte Gleichheit wiederverwendet; eine solche Beschleunigung könnte die Zuordnung oder Platzierung verändern. Es wurde kein unsicheres Tessellierungs-Caching und keine gröbere Approximation eingeführt.

Zur Qualitätssicherung wurden beide Produkte zusätzlich mit `freecad_macos.py` aus dem bisherigen Stand `fb4a6eb` konvertiert, bei identischer Blender-Nachverarbeitung. Für diese Referenzläufe wurde ebenfalls die robuste Prozessausgabe mit dem neuen Budget verwendet, damit die bisherige Geometrieauswertung unabhängig vom alten Timeout verglichen werden konnte.

**Beide GLBs sind bytegleich zu diesen Referenzen.** Damit stimmen auch Geometrie, Farben, Materialzuordnung, Mesh-Namen und Exportqualität überein.

## Laufzeiten des abschließenden Tests

| Schritt | Große STEP-Datei | Kleine STEP-Datei |
| --- | ---: | ---: |
| Produkt | `4026212455489_315868` | `4026212046588_2002579` |
| Dateigröße | 19.688.261 Bytes | 118.312 Bytes |
| Farbauswertung | 1,779 s | 0,018 s |
| STEP-Import | 5,806 s | 0,225 s |
| Formaufbereitung | 2,899 s | 0,065 s |
| STEP-Namenszuordnung | 0,241 s | 0,002 s |
| Farbzuordnung | 0,094 s | 0,009 s |
| Tessellierung | 34,361 s | 0,075 s |
| OBJ-/MTL-Ausgabe | 8,125 s | 0,021 s |
| FreeCAD-Phase inkl. Prozessstart und Statistik | 55,315 s | 0,778 s |
| Rest inkl. Blender-Start, Import und GLB-Export | 6,211 s | 1,358 s |
| **Gesamtdauer** | **61,526 s** | **2,136 s** |
| Referenz-Gesamtdauer | 64,314 s | 2,111 s |

Laufzeiten schwanken mit Systemlast und Cachezustand. Ein vorheriger erfolgreicher Lauf der großen Datei benötigte etwa 71,9 Sekunden insgesamt und 65,8 Sekunden für die FreeCAD-Phase; die vorhandenen Produktionslogs dokumentieren echte Abbrüche nach 60 Sekunden. Die Abweichung von 0,024 Sekunden beim kleinen Produkt liegt innerhalb normaler Laufzeitschwankungen.

## Ergebnisprüfung

- Große Datei: **114/114 Formen verarbeitet, 114/114 Meshes exportiert, 114 GLB-Meshes**, 2.843.330 Dreiecke. Farbskript erfolgreich, kein generischer Ersatzexport und kein Farb-Fallback.
- Kleine Datei: 15/15 Formen verarbeitet und 15 FreeCAD-Meshes exportiert. Die vorhandene Blender-Duplikatbereinigung reduziert sie sowohl im Referenzlauf als auch im neuen Lauf auf **11 GLB-Meshes** und 5.500 Dreiecke. Diese bestehende Produktlogik blieb unverändert.
- Kein `UnicodeDecodeError` in den abschließenden Testlogs.
- GLB-SHA-256 große Datei: `2a9e99649d7276b15ac057c45c150fdc2677d6f2f063f9a90aa8b05a8067af71`.
- GLB-SHA-256 kleine Datei: `09bd5d9125bb6d3d1b7ac50ae6645d9287c3a69264d915948fcf45bd174a6b02`.
- Fünf Prozess-Regressionstests bestanden: ungültige native Ausgabe; echter Timeout mit Prozessbeendigung und erhaltener Teilausgabe; letzter Fehler samt Versuchshistorie; gemeinsames Zeitbudget für den Ersatzversuch; ungültige Budgetwerte.
- Python-/JavaScript-Syntaxprüfung, `git diff --check` und separater Vite-Produktionsbuild bestanden.

## Artefakte und Wiederholung

Vollständige Testlogs, Ergebnisse als JSON und beide GLBs sowie Referenzen liegen unter `D:\Showroom\step-validation\MARA09.18.f`. Die Produktdatenbank wurde durch die Tests nicht verändert.

- `4026212455489_315868-freecad.log` und `4026212455489_315868-blender.log`
- `4026212046588_2002579-freecad.log` und `4026212046588_2002579-blender.log`
- `summary.json` und `comparisons.json`
- Tests: `python tests/test_step_process_budget.py -v`
- Integration und Referenzvergleich: `python D:\Showroom\step-validation\run_validation.py`

Die zentral angezeigte Version und beide HTML-Versionsanzeigen stehen auf `MARA09.18.f`.
