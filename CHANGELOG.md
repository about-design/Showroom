# Changelog

## MARA09.30.e - 2026-10-02

- Die Produktdetail-Sidebar startet ohne gespeicherte Benutzerbreite mit 35 % statt 45 %. Splitter, Grenzen von 25 bis 60 %, lokale Breitenwiederherstellung und unabhängige Scrollbereiche von Produktbereich und Sidebar bleiben erhalten; Doppelklick und Home setzen auf die neue Standardbreite zurück.

## MARA09.30.d - 2026-10-01

- STEP→GLB: Baugruppen-Container werden über `SHAPE_REPRESENTATION_RELATIONSHIP` zwischen Shape-Repräsentationen erkannt und nicht als eigene Geometrie gezählt.
- Die echte STEP-Datei `4026212124385_276032` wurde vollständig neu konvertiert: 23 STEP-Zuordnungen, 23 exportierte Meshes, kein globaler FreeCAD-Label-Fallback.
- `31-01434` entsteht als `_1` und `_2`; `31-01436` als `_1` bis `_4`. Die Materialnamen verwenden dieselben korrigierten Mesh-Namen.
- Assembly- und Referenzregressionen für lokale Fallbacks, Reihenfolge und getrennte Instanzzähler ergänzt.

## MARA09.30.c - 2026-10-01

- STEP→GLB: Die Formation-Auswertung erkennt `PRODUCT_DEFINITION_FORMATION...` jetzt robust auch bei einem oder mehreren Whitespaces vor der öffnenden Klammer.
- Ursprüngliche Zeichnungsnummern werden wieder in STEP-Reihenfolge übernommen; Mehrfachvorkommen werden je Zeichnungsnummer separat als `_1`, `_2` usw. benannt.
- Das Testprodukt `4026212286489_177599` wurde erfolgreich neu konvertiert: acht Meshes, korrekte Namen, unveränderte Mesh-Anzahl und weiterhin angewendete Farbregeln.
- Der bestehende Fallback für nicht auswertbare STEP-Strukturen bleibt erhalten.

## MARA09.30.b - 2026-09-30

- Koordinatensystem-Hilfsobjekte werden aus Einzelteil-, Mesh-, Farbregel-, Statistik- und Exportauswertungen ausgeschlossen.
- Sie entstehen ausschließlich zur Laufzeit im Viewer und beeinflussen Produktgeometrie sowie gespeicherte GLB-Dateien nicht.

## MARA09.30.a - 2026-09-30

- Die XYZ-Achsen des Produkt-Koordinatensystems werden browserunabhängig als deutlich kräftigere 3D-Zylinder dargestellt.
- Die Ursprungsmarkierung ist vergrößert; Ursprung, Achsenrichtungen, Achsenlängen, Skalierung, Beschriftungen und Produkttransformationen bleiben unverändert.

## MARA09.24.f - 2026-09-25

- Responsive kompakte Desktop-Darstellung für kleinere Browser-Viewports (z. B. 1366 × 768) ergänzt. Sidebar, META-Kopfzeile, Suche und Produkteinträge nutzen weniger Leerraum; Produktname, SAP-Kurztext und GLB/STEP-Badges bleiben gut lesbar und der 3D-Bereich erhält mehr Fläche.
- Große Darstellungen und bestehende Funktionen bleiben unverändert; der vorhandene Mobile-Breakpoint hat weiterhin Vorrang bei kleinen Fensterbreiten.

## MARA09.24.e - 2026-09-25

- Temporäre Status-, Erfolgs-, Warn- und Fehlermeldungen der geöffneten Produkt-Sidebar werden einheitlich direkt oberhalb der festen Aktionsleiste angezeigt.
- Meldungstexte, Farben, Ein-/Ausblendzeiten, Funktionen und Scrollverhalten bleiben unverändert; die Aktionsleiste bleibt vollständig sichtbar und anklickbar.

## MARA09.24.d - 2026-09-25

- Konvertierungs-Statusmeldungen erscheinen direkt oberhalb der festen Aktionsleiste in der Produkt-Sidebar und werden innerhalb der verfügbaren Breite gestapelt.
- Die Aktionsbuttons bleiben vollständig sichtbar und anklickbar; Konvertierungslogik, Meldungstexte, Farben und Scrollverhalten bleiben unverändert.

## MARA09.24.c - 2026-09-25

- Der vorhandene SAP-Kurztext wird in der Produkt-Sidebar zusätzlich kompakt direkt unter der 3D-Vorschau und oberhalb von „Vorschaubild neu erzeugen“ angezeigt.
- Die neue Anzeige verwendet dieselbe Kurztext-Quelle wie Kopfzeile und Stammdaten; 3D-Vorschau, Thumbnail-Aktion, Stammdaten und Scrollverhalten bleiben unverändert.

## MARA09.24.b - 2026-09-24

- Die Dashboard-Shell bleibt auf die Fensterhöhe begrenzt; ihre Grid-Spalte kann nicht mehr durch Karteninhalt über die verfügbare Breite wachsen.
- Nur Produktkarten und Sidebar-Inhalt scrollen vertikal. Ihre Scrollbereiche reichen bis zum Splitter beziehungsweise rechten Fensterrand.
- Im Browser geprüft: unabhängiges Mausrad-Scrollen, keine zusätzliche Seitenscrollbar, korrekte Kanten nach Ein-/Ausklappen der Steuerleiste und nach Sidebar-Breitenänderung.

## MARA09.24.a - 2026-09-24

- Produktkarten und permanente Produktdetail-Sidebar besitzen nun vollständig unabhängige Vollhöhen-Scrollcontainer.
- Der Produktkarten-Scrollbalken sitzt direkt links neben Splitter/Sidebar; der Sidebar-Scrollbalken bleibt am rechten Sidebar-Rand.
- META-Kopfzeile, ein-/ausklappbare Steuerleiste, Sidebar-Breite, automatische Kartennachführung, Auswahl und Navigation bleiben unverändert.

## MARA09.23.f - 2026-09-23

- Neuer Einstellungsbereich „Automatische Kategoriezuordnung“ mit frei eingebbaren Kürzeln, Hauptkategorie-Pulldown sowie Funktionen zum Hinzufügen, Ändern und Löschen. Die initialen gespeicherten Zuordnungen lauten `MP → Palettenregale`, `CL → Fachbodenregale` und `KR → Kragarmregale`.
- Produkte ohne Hauptkategorie werden nach der vorhandenen SAP-Kurztext-Anreicherung anhand des getrimmten Textanfangs ohne Beachtung der Groß-/Kleinschreibung zugeordnet. Bereits gesetzte Kategorien werden nicht überschrieben; die Zuordnung stammt ausschließlich aus der gespeicherten Einstellung.
- „Nicht zugeordnete Produkte prüfen“ zeigt zunächst die Trefferzahl und übernimmt erst nach Bestätigung. Sichtbare Karten und die geöffnete Sidebar werden ohne Listen-Neurendering aktualisiert, sodass Produktauswahl, Filter und Scrollposition erhalten bleiben.
- Funktionsprüfung für `MP`, `CL`, `KR`, unbekannte Kürzel, bestehende manuelle Kategorien und mehrdeutige Regeln erfolgreich; Produktions-Build und responsiver Einstellungsdialog ebenfalls geprüft.

## MARA09.23.e - 2026-09-23

- Bei einer Textmarkierung im Mesh-Namen übernimmt „Als Namens-Farbregel übernehmen“ beziehungsweise die RAL-Auswahl exakt den markierten Text als Regex, ohne automatisch ergänzte Produktdaten oder `^`/`$`.
- Die Markierung wird vor dem Öffnen des Kontextmenüs gesichert. Eine Regel mit identischem Mesh-Ziel und Regex wird aktualisiert und für „letzter Treffer gewinnt“ ans Ende verschoben; ohne Markierung bleibt die verankerte Vollnamen-Regel erhalten.
- Browserprüfung mit echter Mausmarkierung und Rechtsklick erfolgreich: `35-00036` steht unverändert im Regex-Feld, trifft passende Geschwister-Meshes und kein Mesh ohne diesen Text.

## MARA09.23.d - 2026-09-23

- Die RAL-Auswahl direkt unter „Als Namens-Farbregel übernehmen“ erzeugt eine exakte Mesh-Regel nach dem Schema `^vollständiger Mesh-Name$`, auch wenn im Namen zuvor nur ein Textausschnitt markiert war.
- Eine vorhandene exakte Einzelregel wird aktualisiert statt dupliziert. Sie wird ans Ende der Produktregeln verschoben und überschreibt dadurch nach der bestehenden Last-wins-Logik allgemeinere Regeln ausschließlich für dieses Mesh.
- Die Mesh-Liste zeigt die neue Zuordnung sofort und kennzeichnet die erforderliche Neu-Konvertierung. Browser- und Bake-Test bestätigen: allgemeine Regel weiterhin RAL 9007/Verzinkt, einzelnes Mesh abweichend RAL 7035.

## MARA09.23.c - 2026-09-23

- Beim Löschen einer Namens-Farbregel über X wird die Mesh-Liste sofort ausschließlich anhand der aktuell vorhandenen Regeln neu ausgewertet.
- Ohne verbleibenden Treffer verschwinden RAL-/Oberflächenanzeige und gelbe Regelmarkierung unmittelbar; die Mesh-Zeile kehrt zur neutralen Darstellung zurück. Eine verbleibende passende Regel wird sofort gemäß „letzter Treffer gewinnt“ angezeigt.
- Der Kartenstatus weist weiterhin auf die erforderliche Neu-Konvertierung hin. Die bereits erzeugte GLB wird erst bei dieser Konvertierung auf Standard-Grau RAL 7035 zurückgesetzt.

## MARA09.23.b - 2026-09-23

- Beim nächsten erfolgreichen Bake werden entfernte Namens-Farbregeln mit dem zuletzt konvertierten Regelstand verglichen. Frühere Treffer ohne weitere gültige Regel erhalten wieder das zentrale Standard-Grau RAL 7035 und keine alte Regeloberfläche.
- Verbleibende passende Regeln bestimmen weiterhin mit der bestehenden Reihenfolge „letzter Treffer gewinnt“ die Farbe. Der aktuelle Regelstand bleibt bis zur erfolgreichen Neu-Konvertierung als geändert markiert; die Mesh-Anzeige entfernt gelöschte RAL-Zuordnungen sofort.
- GLB-Bake funktional geprüft: gelöschte einzige Regel setzt ein zuvor farbiges Mesh auf Grau zurück; eine verbleibende Regel gewinnt weiterhin. Export-/Sichtbarkeitsauswahl und Geometrie bleiben unverändert.

## MARA09.23.a - 2026-09-23

- STEP/STP/STPZ/P21-Uploads archivieren vorherige Versionen vor der Übernahme unter `D:\Showroom Datei Move\Ersetzte STEP\<Produkt-ID>`, auch bei identischem Dateinamen. Bestehende Archivdateien werden niemals überschrieben; Kollisionen erhalten Zeitstempel und eindeutigen Zusatz.
- Serverablauf mit temporärer Upload-Datei, geprüfter Archivkopie und Entfernung der Quelle erst nach Größenprüfung, exklusiver Übernahme, Produktaktualisierung und Rollback bei Fehlern. Bei Rollback bleibt eine zusätzliche Archivkopie erhalten. Fehler werden sichtbar gemeldet.
- Neue Erfolgsmeldungen und dauerhaftes Protokoll in `logs/step-replacements.jsonl`; der bisherige Lösch-Endpunkt lehnt STEP-Dateien ab. Persistierte STEP-Verweise haben Vorrang vor alten CAD-Index-Einträgen. GLB, USDZ und Vorschaubilder werden nicht verändert.
- Acht isolierte Tests erfolgreich: alle sechs geforderten Upload-/Fehlerfälle, STEP-Familienabgrenzung und HTTP-Integration einschließlich gespeicherter Produktverweise.

## MARA09.22.v - 2026-09-22

- Der 14 px breite Scrollbalken des mittleren Produktdetailbereichs wird direkt an der linken Sidebar-Kante neben dem Splitter angezeigt.
- Produktdetails und Formulare behalten ihre normale linksbündige Leserichtung; Header, Footer, Splitter und andere Scrollbereiche bleiben unverändert.

## MARA09.22.u - 2026-09-22

- Der mittlere Inhalt der permanenten Produktdetail-Sidebar erhält einen 14 px breiten, deutlich sichtbaren vertikalen Scrollbalken mit dezentem Track und gut greifbarem Thumb.
- Die globale dünne Scrollbar-Regel bleibt bestehen und wird ausschließlich für den Sidebar-Scrollcontainer überschrieben. Horizontaler Sidebar-Scroll sowie Änderungen an Header, Footer, Splitter und linkem Produktbereich sind ausgeschlossen.

## MARA09.22.t - 2026-09-22

- Neue Stammdaten-Aktion „Dateinamen anpassen“ bei EAN-/Artikelabweichungen mit Vorschau aller eindeutig referenzierten STEP/GLB/USDZ/PNG-Dateien.
- Erst nach Bestätigung werden Dateien kollisionssicher umbenannt und Produkt-ID, Name, Datei-URLs sowie zusammengesetzte Produktverweise atomar aktualisiert; Fehler lösen einen Rollback aus, vorhandene Ziele werden niemals überschrieben.

## MARA09.22.s - 2026-09-22

- Gemeinsame EAN-/Artikel-Plausibilitätsübersicht für alle gefundenen Abweichungen, mit Fehleranzahl, scrollbarerer Liste und manuellen Schließen-Aktionen; automatische Anzeige höchstens einmal pro Sitzung.
- Ein Klick auf einen Fehlereintrag lädt und markiert die betreffende Produktkarte und positioniert ihre Zeile mit der bestehenden Karten-Nachführung oben. Produktdaten bleiben unverändert.

## MARA09.22.r - 2026-09-22

- Kategorieänderungen in der ausgewählten Produktkarte aktualisieren nur noch den betroffenen Kategorie-Badge statt die gesamte Kartenliste neu zu rendern.
- Karte und Scrollposition bleiben dadurch bei wiederholten Änderungen pixelstabil; die automatische Nachführung für echte Produktwechsel bleibt unverändert.

## MARA09.22.q - 2026-09-22

- Produktkarten vergleichen EAN und Artikelnummer im oberen Namen mit den vorhandenen SAP-Feldern.
- Ausschließlich abweichende Nummern im Produktnamen werden rot markiert. Produktdaten, Dateinamen und die untere EAN-/Artikel-Zeile bleiben unverändert.

## MARA09.22.p - 2026-09-22

- Beim Öffnen oder Fokussieren des Kategorie-Pulldowns wird die zugehörige Produktkarte sofort ausgewählt und rot markiert; eine vorherige Auswahl verliert ihre Markierung.
- Die bestehende Zeilen-Nachführung bleibt aktiv. Das Pulldown wird beim Auswahlwechsel nicht neu gerendert und bleibt normal bedienbar; erst `change` speichert die Kategorie.

## MARA09.22.o - 2026-09-22

- Nach einer Kategorieänderung innerhalb der ausgewählten Produktkarte wird dieselbe Kartenzeile nach dem Neurendern erneut oben im sichtbaren Produktbereich positioniert.
- Die ausgewählte Produkt-ID bleibt erhalten; verwendet wird dieselbe Zeilen-Nachführung wie bei einer echten Produktauswahl.

## MARA09.22.n - 2026-09-22

- Bei Änderungen der Hauptkategorie in einer Produktkarte bleibt die aktuelle Scrollposition der Produktübersicht exakt erhalten.
- Die automatische Karten-Nachführung bleibt auf echte Produktauswahl und Produktwechsel beschränkt.

## MARA09.22.m - 2026-09-22

- Das Explorer-Symbol der Showroom-Produktliste ist in kompakte grüne GLB- und blaue STEP-Badges aufgeteilt.
- Beide markieren die jeweils vorhandene Datei direkt im Windows Explorer, ohne Produktauswahl oder Hover-Vorschau auszulösen.

## MARA09.22.l - 2026-09-22

- Die linke Showroom-Produktliste erhält ein dezentes Ordner-Symbol.
- Ein Klick markiert die vorhandene CAD-/Quelldatei im Windows Explorer, ohne Produktauswahl oder Hover-Vorschau auszulösen; fehlende Dateien werden verständlich gemeldet.

## MARA09.22.k - 2026-09-22

- Die Showroom-Produktsuche berücksichtigt zusätzlich den vorhandenen SAP-Kurztext `shortText`.
- Mehrere Suchbegriffe werden als AND-Suche über Name, Kennungen, bestehende Suchfelder und Kurztext ausgewertet; Groß-/Kleinschreibung und Teilbegriffe bleiben unterstützt.

## MARA09.22.j - 2026-09-22

- Die zweite Zeile der linken Showroom-Produktliste zeigt den vorhandenen SAP-Kurztext in Weiß.
- Lange Kurztexte umbrechen vollständig innerhalb der verfügbaren Breite; ohne Kurztext bleibt die Produktkennung als Fallback sichtbar. Produktverwaltung und Produktlogik bleiben unverändert.

## MARA09.22.i - 2026-09-22

- Die tatsächliche Oberkante der ausgewählten Kartenzeile wird ermittelt und direkt unterhalb der sichtbaren META-/Steuerleiste positioniert.
- Eine einmalige Nachmessung im nächsten Layout-Frame korrigiert verbleibende Abweichungen in beide Scrollrichtungen.

## MARA09.22.h - 2026-09-22

- Jede ausgewählte Produktkarte wird am oberen sichtbaren Rand des tatsächlichen Karten-Scrollbereichs ausgerichtet, damit auch bei der ersten Auswahl kein oberer Kartenabschnitt abgeschnitten bleibt.

## MARA09.22.g - 2026-09-22

- Die Karten-Nachführung setzt den Scrollwert direkt am tatsächlich scrollenden Element. Dadurch wird die Aufwärtskorrektur nicht mehr durch die globale Smooth-Scroll-Einstellung verzögert.

## MARA09.22.f - 2026-09-22

- Beim Wechsel in eine andere Kartenreihe wird die ausgewählte Reihe im tatsächlichen Produkt-Scrollcontainer gezielt mit 10 px Abstand nach oben nachgeführt.
- Das bestehende Verhalten für abgeschnittene Karten und die einmalige Nachmessung nach dem Layout-Frame bleiben erhalten.

## MARA09.22.e - 2026-09-22

- Der tatsächlich scrollende DOM-Container wird anhand von `overflow-y` und `scrollHeight` ermittelt; falls die Seite selbst scrollt, wird dort gezielt verschoben.
- Nach dem nächsten Layout-Frame wird die Sichtbarkeit der vollständigen Karte einschließlich Statuszeile einmalig erneut geprüft und bei Bedarf korrigiert.

## MARA09.22.d - 2026-09-22

- Die Karten-Sichtbarkeitsprüfung verwendet ausschließlich den tatsächlich sichtbaren linken Scrollcontainer und berücksichtigt einen Abstand von 10 px zu dessen Ober- und Unterkante.
- Das Browser-Clipping wird berücksichtigt, damit auch der untere Statusbereich der ausgewählten Karte vollständig sichtbar wird.

## MARA09.22.c - 2026-09-22

- Ausgewählte Produktkarten werden beim Öffnen und beim Wechsel über die Sidebar-Navigation im linken Produktbereich nur bei Bedarf vollständig sichtbar gescrollt.
- Rechte Sidebar, Steuerleiste und getrennte Scrollbereiche bleiben unverändert.

## MARA09.22.b - 2026-09-22

- Permanente Produktdetail-Sidebar reicht vom oberen bis zum unteren Fensterrand.
- META-Kopfzeile, Steuerleiste, Filter/Aktionen/Seitennavigation und Produktkarten teilen sich links die verbleibende Breite bis zum bestehenden Splitter; Collapse-Zustand, Sidebar-Breite, Scrollbereiche und Detail-Header/Footer bleiben unverändert.

## MARA09.21.i - 2026-09-21

- Obere Steuerleiste verwendet wieder die gesamte Fensterbreite; die rechte Sidebar-Breite wird dort nicht mehr reserviert. Unterhalb der Steuerleiste bleibt die Aufteilung aus Produktkarten, Splitter und Sidebar unverändert.

## MARA09.21.h - 2026-09-21

- Die bestehende Steuerleiste unter der META-Kopfzeile bleibt vollständig ein-/ausklappbar. Der gespeicherte Pfeil-Zustand, alle Kennzahlen, Filter, Aktionen und Seitennavigation bleiben unverändert; die dauerhaft sichtbare Sidebar folgt der aktuellen Steuerleistenhöhe.

## MARA09.21.g - 2026-09-21

- Die dauerhaft sichtbare Produktdetail-Sidebar wird dynamisch unter META-Kopfzeile und der vorhandenen ein-/ausklappbaren Steuerleiste positioniert. Pfeil, Kennzahlen, Suche, Filter, Sortierung, Aktionen und gespeicherter Auf-/Zuklapp-Zustand der Steuerleiste bleiben unverändert.

## MARA09.21.f - 2026-09-21

- Produktdetail-Sidebar beim Öffnen der Produktverwaltung dauerhaft sichtbar und nicht modal. Der graue Schleier entfällt; Karten links und Details rechts bleiben unabhängig scrollbar. Kartenwechsel aktualisiert nur den Sidebar-Inhalt, der vorhandene Splitter und die gespeicherte Breite bleiben erhalten.

## MARA09.21.e - 2026-09-21

- Einstellung „Produktdetail-Sidebar fixiert anzeigen“ ergänzt (Standard aktiv). Kopf und Fuß bleiben sichtbar, der mittlere Detailinhalt scrollt separat; bei Deaktivierung bleibt das bisherige Verhalten erhalten. Sidebar-Breitenanpassung bleibt unverändert.

## MARA09.21.d - 2026-09-21

- XYZ-Achsenkreuz unten links in der Produktdetail-Vorschau, X rot, Y grün, Z blau. Verwendet die bestehende Achsendarstellung und liest die aktuelle Kamerarotation nach dem Orbit-Update im vorhandenen Renderzyklus.
- Folgt Mausrotation und ViewCube-Kamerawechseln, bleibt bei 25–60 % Sidebar-Breite unten links und fängt keine Mausaktionen ab. Kein zusätzlicher Renderer; Modell, gespeicherte Orientierung, GLB und Thumbnail bleiben unverändert.

## MARA09.21.c - 2026-09-21

- Bestehender Thumbnail-Export speichert die Kamera-Weltrotation als Quaternion, sowohl automatisch als auch bei „Vorschaubild neu erzeugen“. Aufnahme und Kameradaten stammen aus demselben Frame.
- Produktkarten zeigen daraus ein kleines XYZ-SVG unten links (X rot, Y grün, Z blau), ohne Mausereignisse abzufangen. Ohne gültige Kameradaten kein Overlay. Keine Neuerzeugung alter Thumbnails, kein zusätzlicher Renderer und keine Änderung an PNG, GLB oder Produktorientierung.

## MARA09.21.b - 2026-09-21

- Der vorhandene SAP-Kurztext-Lookup übernimmt aus demselben Excel-Datensatz zusätzlich EAN (A) und Artikelnummer (B) in eigene Anzeigefelder. Keine zweite Excel-Suche, unveränderte Produkt-ID und Dateizuordnung.
- Produktkarten zeigen vorhandene Kennungen als „EAN: … · Artikel: …“, bei fehlendem Treffer weiterhin die Produkt-ID. Lange Angaben umbrechen; Bestandsabgleich verwendet den bestehenden SAP-Sync.

## MARA09.21.a - 2026-09-21

- Farbregel-Zuordnungen bleiben nach Hinzufügen, Änderung oder Löschung gelb, bis die aktuelle Regelversion erfolgreich in die GLB übernommen wurde. Mesh-Zeilen behalten RAL/Verzinkt sichtbar; vollständig zugeordnete Produktkarten erhalten erst danach Grün und ✓.
- Serverseitig gespeicherter Konvertierungsnachweis berücksichtigt Produkt- und globale Namens-Farbregeln. Fehler, Abbrüche und Teilergebnisse bestätigen keinen neuen Stand; zwischenzeitlich geänderte Regeln bleiben erhalten und gelb. Bestehende Produkte ohne Nachweis benötigen eine erfolgreiche Neu-Konvertierung.
- Geprüft mit Status- und Browser-Tests sowie isoliertem API-Test mit echter GLB-Farbübernahme, anschließender Änderung, älterem Konvertierungsstand und fehlgeschlagenem Bake.

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
