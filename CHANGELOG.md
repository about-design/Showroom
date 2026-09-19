# Changelog

## MARA09.19.aa - 2026-09-19

- Farbsteuerung bleibt unten und klappt per Pfeil vollständig ein/aus. Nur der kompakte Griff bleibt sichtbar; Zustand lokal gespeichert. Die bisherige Positionsumschaltung entfällt, Farb- und RAL-Logik bleiben erhalten.

## MARA09.19.z - 2026-09-19

- Farbfilter und RAL-Palette als gemeinsame Farbsteuerung per Pfeil oben/unten positionierbar. Lokale Speicherung, responsive Begrenzung auf den 3D-Viewport und Abstand zum ViewCube in allen drei Positionen. Farb- und Modelllogik unverändert.
- Build-Ausgabe aus der Entwicklungsserver-Dateiüberwachung ausgeschlossen, damit ein Build unter Windows keinen EBUSY-Absturz des Showroom-Webservers auslöst.

## MARA09.19.y - 2026-09-19

- Performance-Anzeige gegen noch nicht geladene Statistiken abgesichert; keine Null-Zugriffe beim Showroom-Start. Ausgefallenen lokalen Webserver auf Port 5050 wieder gestartet.

## MARA09.19.x - 2026-09-19

- ViewCube proportional auf 125 % skaliert: Darstellung, Beschriftungen und Klickbereiche wachsen gemeinsam. Zentrale CSS-Variable mit passendem Skalierungsursprung je Position; Kamera- und Synchronisationslogik unverändert.

## MARA09.19.w - 2026-09-19

- Einstellungsdialog mit viewportbegrenzter Höhe und scrollbarerer Inhaltsmitte. Kopf und Fußleiste bleiben sichtbar, auch bei kleinen Fensterhöhen und weiteren Einstellungsbereichen. Bestehende Einstellungen und Speicherlogik bleiben unverändert.

## MARA09.19.v - 2026-09-19

- F und ein Navigationsbutton passen die sichtbaren Produkt-Meshes mit Rand in den aktuellen 3D-Viewport ein. Berücksichtigt Mesh-Isolation, aktuelle Blickrichtung, Fensterformat und Zoom; ausschließlich Kamera und Orbit-Ziel werden angepasst.
- Texteingaben, Tastenkombinationen und laufende Texteingabe bleiben ausgenommen. ViewCube und Einpassen verwenden dieselbe Kamera; Modellgeometrie, Position, Orientierung und GLB bleiben unverändert.

## MARA09.19.u - 2026-09-19

- ViewCube in Showroom und Produktdetail-Vorschau mit sechs Hauptansichten, Kanten/Ecken und synchroner Kameraorientierung. Weiche Wechsel mit bestehenden OrbitControls, ohne Produktrotation oder GLB zu bearbeiten.
- Zentraler Bereich 3D-Ansicht: ViewCube standardmäßig sichtbar, Position Links/Mittig/Rechts (Standard Rechts); dauerhaft gespeichert und nach Speichern sofort angewendet, auch in anderen offenen Tabs.

## MARA09.19.t - 2026-09-19

- Sidebar-Mindestbreite auf 25 % reduziert; Mesh-Liste, RAL, Vertexzahl, Stammdaten und Footer passen sich an schmale Sidebar-Breiten an. Maximum 60 %, Standard/Reset 45 % und lokale Speicherung unveraendert.

## MARA09.19.s - 2026-09-19

- Vertikaler Splitter für die Produktdetail-Sidebar: live 35–60 %, Standard und Doppelklick-Reset 45 %, dauerhaft lokal gespeichert. Dashboard und Kartenraster folgen der Breite; Textauswahl beim Ziehen ist gesperrt. Separate Prozent-Auswahl entfernt, bestehende Mindestbreite kleiner Fenster erhalten.

## MARA09.19.r - 2026-09-19

- Zentrale Darstellungseinstellung „Breite Produktdetail-Sidebar“ mit 35 %, 40 %, 45 %, 50 % und 55 % ergänzt (Standard 45 %). Dauerhaft gespeichert und nach Speichern ohne Neuladen wirksam. Sidebar und Dashboard verwenden dieselbe Breite; das Kartenraster passt sich an und erhält beim Schließen wieder die gesamte Breite. Für kleine Fenster wird die Sidebar auf mindestens 480 px, höchstens 94 % der Fensterbreite begrenzt; bestehende responsive Regeln bleiben erhalten. Mesh-Namen nutzen den zusätzlichen Platz, die rechten Mesh-Spalten bleiben fest.

## MARA09.19.q - 2026-09-19

- RAL/Verzinkt, Vertex-Anzahl und Kamera in festen Mesh-Spalten ausgerichtet; der Name nutzt den flexiblen Restplatz. Bei deaktivierter RAL-Anzeige entfällt deren Spalte vollständig. Klick/Doppelklick auf einen Mesh-Namen öffnet den vollständigen auswählbaren Text direkt unter der Zeile. Beliebige Textteile können über das bestehende Kontextmenü als Namens-Farbregel übernommen werden; erneuter Klick oder Klick außerhalb schließt die Anzeige. Gespeicherte Mesh-Namen bleiben unverändert.

## MARA09.19.p - 2026-09-19

- Kompakte RAL-Anzeige mit echtem Farbpunkt in der Mesh-Zeile vor der Vertex-Anzahl ergänzt. Sie nutzt dieselben Regex-Treffer und dieselbe Regelpriorität wie das Kontextmenü und aktualisiert sich bei Änderungen im Menü oder Regelbereich sofort. Ohne RAL bleibt sie leer; RAL 9007 zeigt Verzinkt im Tooltip. Die zentrale Option „RAL-Farbe in Mesh-Liste anzeigen“ ist standardmäßig eingeschaltet, wird dauerhaft gespeichert und gibt ausgeschaltet den Platz für den Mesh-Namen frei. Farbregeln, Konvertierung und GLB bleiben von der Darstellungsoption unberührt.

## MARA09.19.o - 2026-09-19

- Statistik, Suche, Filter, Sortierung, Exportrotation, Queue-/Auswahlaktionen, Ansicht und Seitennavigation in einem deckenden Sticky-Steuerbereich unter der META-Kopfzeile zusammengefasst. Ein mittiger Pfeil klappt den gesamten Inhalt animiert auf eine schmale Leiste ein; der Zustand bleibt lokal gespeichert. Bestehende Bedienelemente und Einstellungen bleiben erhalten, die Breite folgt der Produkt-Sidebar. Bei geringer Bildschirmhöhe ist der aufgeklappte Inhalt scrollbar, der Griff bleibt erreichbar; reduzierte Bewegung wird berücksichtigt.

## MARA09.19.n - 2026-09-19

- Mesh-Kontextmenü wählt die aktuelle RAL-Farbe aus den bestehenden Treffern der grünen Mesh-Markierung voraus. Wie bei der Farbanwendung gewinnt die letzte passende Farbregel. Eine neue RAL-Auswahl aktualisiert genau diese Regel statt eines Duplikats; Regex, Ziel und Flags bleiben erhalten, RAL 9007 setzt Verzinkt und andere RAL-Farben Pulver. Regelanzeige und Mesh-Markierung werden unmittelbar aktualisiert.

## MARA09.19.m - 2026-09-19

- Produktkarten zeigen den unter „Freigabe & Qualität“ gespeicherten Prüfstatus nach Übernehmen korrekt an. Die Aktualisierung ersetzt jetzt das Statusleisten-Element statt eines Leerraum-Textknotens; die aktive Statusauswahl wird explizit in das vorhandene Feld `_review.status` übernommen. Karten verwenden die vorhandenen Statusfarben; Liste, Statusfilter und Zähler werden nach dem Speichern neu geladen.

## MARA09.19.l - 2026-09-19

- Dashboard-Sortierungen „Kurztext A–Z“ und „Kurztext Z–A“ für das gespeicherte Feld `shortText` ergänzt. Groß-/Kleinschreibung und äußere Leerzeichen werden ignoriert; leere Werte und Strich-Platzhalter stehen in beiden Richtungen am Ende. Sortierung erfolgt nach Suche und Filtern vor der Seiteneinteilung, ohne erneute Excel-/SAP-Abfrage.

## MARA09.19.k - 2026-09-19

- Die aktuell in der Produktdetail-Sidebar geöffnete Produktkarte erhält einen deutlich sichtbaren roten META-Rahmen ohne Layoutverschiebung. Die Markierung folgt der Detail-Navigation, bleibt bei Karten-Reflows erhalten und wird beim Schließen entfernt.

## MARA09.19.j - 2026-09-19

- Bei geöffneter Produktdetail-Sidebar wird der Dashboard-Inhaltsbereich um exakt deren Breite reduziert. Das vorhandene Kartenraster nutzt die linke Restbreite, ordnet vollständig sichtbare Karten neu an und stellt beim Schließen sofort die volle Breite wieder her.

## MARA09.19.i - 2026-09-19

- Produktdetail-Sidebar einschließlich Scrollbereich und „Einzelteile (Meshes)“ gegen durchscheinende Dashboard-Inhalte abgesichert: deckende Hintergründe und isolierter Stacking-Context bei unverändertem Detail-Layout.

## MARA09.19.h - 2026-09-19

- Lange Hilfetexte im Produktdetail sind platzsparend einklappbar. Namens-Farbregeln, Vertex-Reduktion und Sichtbarkeit zeigen zuerst eine Kurzzeile; vollständige Erklärung und vorhandene Links bleiben über „Mehr anzeigen“ erreichbar.

## MARA09.19.g - 2026-09-19

- Das Kontextmenü eines Meshes bietet eine zentrale RAL-Auswahl. Sie erzeugt und speichert sofort eine editierbare Mesh-Namens-Farbregel mit Pulver beziehungsweise Verzinkt für RAL 9007; exakte vorhandene Mesh-Regeln werden gezielt aktualisiert.

## MARA09.19.f - 2026-09-19

- Neue Produkt-Namens-Farbregeln verwenden standardmäßig das Ziel „Mesh (Geometrie)“. Bei aktiver RAL-Auswahl wird die Oberfläche auf Pulver, bei RAL 9007 auf Verzinkt und ohne RAL auf Automatisch vorbelegt; manuelle Änderungen bleiben möglich.

## MARA09.19.e - 2026-09-19

- Automatische Dashboard-Queue wartet nach STEP-Uploads auf den Karten-Refresh. Die tatsächlich gestarteten Slots verwenden dadurch die bestehende Produktkarten-Liveanzeige mit Job-ID und Laufzeit.

## MARA09.19.d - 2026-09-19

- Dashboard-Drop startet nach erfolgreichem STEP-Upload bei aktivierter Automatik die gemeinsame Konvertierungsqueue. Manuelle Auswahl- und Gesamtkonvertierungen verwenden denselben Scheduler und die zentrale Parallelgrenze.

## MARA09.19.c - 2026-09-19

- Automatische STEP-Konvertierung nach Drag & Drop wartet auf den initialen Abruf der zentral gespeicherten Einstellungen. Dadurch wird die gemeinsame Warteschlange auch unmittelbar nach dem Öffnen des Konverters mit der konfigurierten Parallelgrenze gestartet.

## MARA09.19.b - 2026-09-19

- Zentrale Einstellungen für automatische STEP-Konvertierungen nach Drag & Drop und die parallele Warteschlange ergänzt. Die Anzahl gleichzeitiger Konvertierungen (1 bis 5, Standard 3) bleibt dauerhaft gespeichert und gilt auch für manuell gestartete Stapel.

## MARA09.19.a - 2026-09-19

- Drag-&-Drop-Konvertierungen mit einstellbarer paralleler Warteschlange (1–5, Standard 3). Nach Abschluss oder Fehler eines Jobs startet automatisch die nächste wartende Datei.

## MARA09.18.h - 2026-09-18

- FreeCommander wird für „Im Dateimanager anzeigen“ ohne `/N` und ohne nicht dokumentierten `/O`-Parameter mit dem gespeicherten GLB-Pfad aufgerufen. Dadurch verwendet FreeCommander seine vorhandene Single-Instance-Weiterleitung; bei bereits laufendem FreeCommander wird kein weiteres Fenster erzwungen.

## MARA09.18.g - 2026-09-18

- Produktkarten haben eine kompakte Ordner-Aktion für die gespeicherte GLB-Datei. Sie markiert die Datei lokal im gewählten Dateimanager und verwendet weder STEP-/Quelldateien noch eine erneute Dateisuche.
- In den Dateimanager-Einstellungen sind Windows Explorer und FreeCommander mit dauerhaft gespeichertem EXE-Pfad auswählbar. Fehlende GLB- oder FreeCommander-Dateien werden verständlich gemeldet; bei FreeCommander ist Windows Explorer als Alternative verfügbar.

## MARA09.18.f - 2026-09-18

- FreeCAD-Prozessausgabe als Bytes erfassen und mit Ersatzzeichen decodieren; vollständige Ausgabe auch bei Fehlern und Timeouts erhalten.
- Gemeinsames FreeCAD-Zeitbudget von 600 Sekunden statt separater 60-Sekunden-Limits; über `STEP_CONVERSION_TIMEOUT_SECONDS` konfigurierbar. Ersatzversuche verwenden nur die verbleibende Zeit, nach Budgetverbrauch wird sauber abgebrochen.
- Fehlerursachen aller Versuche erfassen und den letzten Fehler melden; HTTP-Konvertierungsbudget auf 30 Minuten an das vorhandene MCP-Budget von 25 Minuten angepasst.
- Fortschritt je Form (`Tessellierung n/N`), Laufzeiten der Hauptschritte und verarbeitete/exportierte Formen protokollieren. Tessellierungsqualität, Geometrie, Farben, STEP-Namenszuordnung und Gruppierung unverändert.
- Große Datei `4026212455489_315868` vollständig mit 114 Meshes in 61,5 Sekunden und kleine Datei in 2,14 Sekunden getestet; beide GLBs bytegleich zur bisherigen FreeCAD-Auswertung. Fünf Prozess-/Timeout-Regressionstests und Frontend-Build bestanden. Details: [Prüfbericht](docs/step-conversion-MARA09.18.f.md).

## MARA09.18.e - 2026-09-18

- Kurztext (SAP) im Produktdetail unter der Überschrift und schreibgeschützt in den Stammdaten angezeigt.

## MARA09.18.d - 2026-09-18

- Produktsuche um Kurztext (SAP) erweitert.

## MARA09.18.c - 2026-09-18

- SAP-Kurztexte aus `SAP_Artnr.xlsx` über EAN (Spalte A), ersatzweise Artikelnummer (Spalte B), aus Spalte E übernommen.
- Vorhandenen Bestand einmalig abgeglichen und automatische Kurztextsuche nach erfolgreicher Konvertierung ergänzt; Excel-Fehler blockieren die Konvertierung nicht.

## MARA09.18.b - 2026-09-18

- Eigenständigen Kurztext (SAP) auf Produktkarten vorbereitet und angezeigt.

## MARA09.18.a - 2026-09-18

- Farbregel-Status mit zugeordneten und gesamten Einzelteilen auf Produktkarten ergänzt.

## 1.0.13 - 2026-09-17

- Mesh-Liste zeigt wieder vollständige Namen; STEP-Produktdefinitionen bestimmen die Zeichnungsnummer je Bauteil vor der Instanzzählung.

## 1.0.12 - 2026-09-17

- Mesh-Liste blendet EAN und Artikelnummer nur in der Anzeige aus; Aktionen verwenden weiterhin den vollständigen GLB-Namen.

## 1.0.11 - 2026-09-17

- STEP-Meshes werden je Zeichnungsnummer in der Reihenfolge der STEP-Bauteile ab `1` nummeriert.

## 1.0.10 - 2026-09-17

- Archivierung überschreibt vorhandene Zielartefakte rückrollbar und zeigt sie in der Vorschau als „Wird überschrieben“ an.

## 1.0.9 - 2026-09-17

- STEP-Exporte benennen Meshes künftig deterministisch als EAN_Artikelnummer_Zeichnungsnummer_laufendeNummer.

## MARA09.16.ad - 2026-09-16

- Detail-Footer weiter verdichtet, damit alle Aktionen bei normaler Breite in einer Zeile bleiben.

## MARA09.16.ac - 2026-09-16

- Detail-Footer mit kompakter rechter Aktionsgruppe und vollständig sichtbarem Übernehmen-Button ausgerichtet.

## MARA09.16.ab - 2026-09-16

- Produktentfernen-Aktion in der Detailleiste klar beschriftet und horizontal ausgerichtet.

## MARA09.16.aa - 2026-09-16

- Archivdialog mit kompakten Spalten, gekürzten Pfaden und vollständigen Tooltips verbessert.

## MARA09.16.z - 2026-09-16

- Archivierung beim Produktentfernen umfasst auch eindeutig zugeordnete CAD- und Originaldateien.

## MARA09.16.y - 2026-09-16

- Produktentfernung archiviert zugehörige GLB-, USDZ- und Vorschaudateien nach bestätigter Vorschau.

## MARA09.16.x - 2026-09-16

- Neu-Konvertierung eines Produkts kann direkt aus der Produktdetailansicht gestartet werden.

## MARA09.16.w - 2026-09-16

- Mesh-Schublade wird beim Sprung zu einer Namens-Farbregel zuverlässig eingeklappt.

## MARA09.16.v - 2026-09-16

- Über Mesh-Kontextmenü kann direkt zu einer vorhandenen Namens-Farbregel gesprungen werden.

## MARA09.16.u - 2026-09-16

- Einzelteile-Schublade horizontal an den Stammdaten ausgerichtet.

## MARA09.16.t - 2026-09-16

- Mesh-Liste zeigt Auswahl und vorhandene Namens-Farbregeln farblich an; Schublade schließt nach Regelübernahme automatisch.

## MARA09.16.s - 2026-09-16

- Namens-Farbregel kann wahlweise den vollständigen oder einen markierten Teil des Mesh-Namens übernehmen.

## MARA09.16.r - 2026-09-16

- Eingeklappte Einzelteile-Schublade in den fixierten Vorschaubereich aufgenommen.

## MARA09.16.q - 2026-09-16

- Fixierten Vorschaubereich erweitert und Abstände der Einzelteile-Schublade optimiert.

## MARA09.16.p - 2026-09-16

- 3D-Vorschau in der Produktdetailansicht fixiert und Einzelteile-Bereich ein- und ausklappbar gestaltet.

## MARA09.16.o - 2026-09-16

- Übernahme von Einzelteilnamen in Namens-Farbregeln ohne ^- und $-Begrenzung.

## MARA09.16.n - 2026-09-16

- Einzelteile können per Rechtsklick direkt als Namens-Farbregel übernommen werden.

## MARA09.16.m - 2026-09-16

- Geöffnetes Produkt wird im Showroom automatisch in der Produktliste markiert.

## MARA09.16.l - 2026-09-16

- Sichtbarkeit der Buttons in der Kopfzeile der Produktverwaltung verbessert.

## MARA09.16.k - 2026-09-16

- Löschen-Button für die Suche in der Produktverwaltung ergänzt.

## MARA09.16.j - 2026-09-16

- Löschen-Button für die Produktsuche im Showroom ergänzt.

## MARA09.16.i - 2026-09-16

- Live-Konvertierungsanzeige aus der Kopfzeile in die jeweilige Produktkarte verschoben.

## MARA09.16.h - 2026-09-16

- Separaten Konvertierungsstatus für jedes Einzelteil ergänzt.

## MARA09.16.g - 2026-09-16

- Darstellung der Versions-Hover-History verbessert.

## MARA09.16.f - 2026-09-16

- Änderungshistorie über die Versionsanzeige in Showroom und Produktverwaltung hinzugefügt.

## MARA09.16.e - 2026-09-16

- Showroom-Produktliste zeigt beim Überfahren eines Produkts das vorhandene Vorschaubild an.

## MARA09.16.d - 2026-09-16

- Showroom-Produktliste um eine Live-Suche nach Name und ID sowie eine begrenzt verstellbare Breite erweitert.

## MARA09.16.c - 2026-09-16

- Kopfzeilen von Showroom und Produktverwaltung mit rotem META-Logo und einheitlichem, rahmenlosem Versionshinweis vereinheitlicht.

## MARA09.16.a - 2026-09-16

- Initiale Versions- und Historie-Notierung für Showroom und Produktverwaltung eingeführt.
- Format: MARA = Matthias Radix, 09 = September, 16 = Tag, a = fortlaufende Änderung am Tag.

## 1.0.8 - 2026-08-24

- Windows-Stack-Launcher setzt den API-Port verbindlich auf `3000`, damit eine vorhandene `PORT`-Umgebungsvariable den MCP-Port `8001` nicht mehr blockiert.

## 1.0.7 - 2026-08-24

- Windows-Launcher verwendet eine eigene Stack-Startdatei; der vollständige Dienst-Stack startet damit ohne fehleranfällige verschachtelte CMD-Anführungszeichen und schreibt `stack.log`.

## 1.0.6 - 2026-08-24

- Root-Launcher delegiert an die aktuelle Projektkopie `about-design-Showroom`.
- Windows-Launcher startet den vollständigen Vite-, API- und MCP-Stack statt einer statischen Vite-Preview.

## 1.0.5 - 2026-08-24

- Namensfarbregeln werten jede Regex pro Zielstring isoliert aus; globale/sticky Regex-Flags verlieren keinen Trefferzustand mehr.
- Mesh-/Knotenregeln trennen gemeinsam genutzte Materialien pro Primitive, damit ein Treffer keine anderen Bauteile überschreibt.

## 1.0.4 - 2026-08-24

- Farb-Bake erzeugt für materiallose GLB-Primitives eigene Materialien; Standardfarbe sowie Namens- und Geometrie-Regeln werden dadurch zuverlässig im GLB gespeichert.
- Draco-Kompression läuft nach den Farb- und Oberflächenänderungen.

## 1.0.3 - 2026-08-24

- Windows-STEP-Konvertierung nutzt jetzt den farberhaltenden Exporter mit STEP-Stilzuordnung sowie OBJ-/MTL-Materialzuweisungen; Farben werden in das GLB übernommen.

## 1.0.2 - 2026-08-24

- STEP-Import behält importierte Komponenten als getrennte OBJ-/Blender-Meshes bei; bewegliche Teleskopteile werden nicht mehr zu einem Teil zusammengefasst.

## 1.0.1 - 2026-08-24

- Windows-Setup setzt `BLENDER_PATH` ohne Administratorrechte in der Benutzer-Umgebung.
- Startmenü-Verknüpfungen werden benutzerspezifisch angelegt.
- Lokale Windows-Assets und der Produktkatalog für den aktualisierten Clone eingerichtet.
- STEP/Blender-Konvertierungen dürfen bis zu 1500 Sekunden laufen.
