const APP_VERSION_INFO = {
  version: 'MARA09.30.e',
  history: [
    { version: 'MARA09.30.e', description: 'Produktdetail-Sidebar startet ohne gespeicherte Benutzerbreite mit 35 % statt 45 %. Der Splitter behält die Grenzen von 25 bis 60 %, lokale Breitenwiederherstellung und den Reset auf die neue Standardbreite bei; Karten- und Detailbereich bleiben unabhängig scrollbar.' },
    { version: 'MARA09.30.d', description: 'STEP→GLB: Baugruppen-Container werden anhand von SHAPE_REPRESENTATION_RELATIONSHIP zwischen Shape-Repräsentationen aus der geometrischen Occurrence-Liste ausgeschlossen. Die reale Datei 4026212124385_276032 wurde mit 23 STEP-Zuordnungen und 23 GLB-Meshes erfolgreich geprüft; 31-01434 und 31-01436 werden je Zeichnungsnummer fortlaufend instanziiert, Farb-/Materialzuordnungen bleiben erhalten.' },
    { version: 'MARA09.30.c', description: 'STEP→GLB: Die Formation-Auswertung erkennt PRODUCT_DEFINITION_FORMATION auch bei Whitespaces vor der öffnenden Klammer. Dadurch werden ursprüngliche Zeichnungsnummern wieder in STEP-Reihenfolge übernommen und mehrfach vorkommende Bauteile pro Zeichnungsnummer als _1, _2 usw. benannt; der bestehende Fallback bleibt erhalten.' },
    { version: 'MARA09.30.b', description: 'Koordinatensystem-Hilfsobjekte werden aus Einzelteil-, Mesh-, Farbregel-, Statistik- und Exportauswertungen ausgeschlossen. Sie entstehen ausschließlich zur Laufzeit im Viewer und beeinflussen die Produktgeometrie sowie gespeicherte GLB-Dateien nicht.' },
    { version: 'MARA09.30.a', description: 'XYZ-Achsen des Produkt-Koordinatensystems als deutlich kräftigere, browserunabhängige 3D-Zylinder dargestellt; die Ursprungsmarkierung ist vergrößert. Ursprung, Achsenrichtungen, Achsenlängen, Skalierung und Produkttransformationen bleiben unverändert.' },
    { version: 'MARA09.24.f', description: 'Kompakte Desktop-Darstellung für kleinere Browser-Viewports ergänzt: Sidebar, META-Kopfzeile, Suche und Produkteinträge benötigen weniger Platz, während Produktname, SAP-Kurztext und GLB/STEP-Badges lesbar bleiben. Der gewonnene Bereich steht dem 3D-Showroom zur Verfügung.' },
    { version: 'MARA09.24.e', description: 'Alle temporären Status-, Erfolgs-, Warn- und Fehlermeldungen bei geöffneter Produkt-Sidebar verwenden einheitlich den Statusbereich oberhalb der festen Aktionsleiste. Texte, Farben und Laufzeiten bleiben unverändert.' },
    { version: 'MARA09.24.d', description: 'Konvertierungs-Statusmeldungen erscheinen nun innerhalb der Produkt-Sidebar direkt oberhalb der festen Aktionsleiste und werden dort platzsparend gestapelt. Die Buttons bleiben vollständig sichtbar und anklickbar.' },
    { version: 'MARA09.24.c', description: 'Der vorhandene SAP-Kurztext wird in der Produkt-Sidebar zusätzlich kompakt direkt unter der 3D-Vorschau und oberhalb von „Vorschaubild neu erzeugen“ angezeigt. Die Anzeige verwendet dieselbe gemeinsame Kurztext-Quelle wie Kopfzeile und Stammdaten.' },
    { version: 'MARA09.24.b', description: 'Dashboard-Shell auf Fensterhöhe und eine begrenzte Grid-Spalte korrigiert. Produktkarten und Sidebar scrollen in genau zwei getrennten Inhaltscontainern; ihre Scrollbalken bleiben nach Steuerleistenwechsel und Sidebar-Resize an den jeweiligen Außenkanten. Im Browser geprüft.' },
    { version: 'MARA09.24.a', description: 'Produktkarten und permanente Produktdetail-Sidebar besitzen nun vollständig unabhängige Vollhöhen-Scrollcontainer. Der Karten-Scrollbalken sitzt direkt am Splitter, der Sidebar-Scrollbalken am rechten Rand; Steuerleiste, Sidebar-Breite und automatische Kartennachführung bleiben unverändert.' },
    { version: 'MARA09.23.f', description: 'Eine frei pflegbare Tabelle in den Einstellungen ordnet Produkten ohne Hauptkategorie anhand des Anfangs ihres SAP-Kurztexts automatisch eine Kategorie zu. Die Sammelprüfung zeigt vor der bestätigten Übernahme die Trefferzahl; vorhandene manuelle Kategorien, Produktauswahl, Filter und Scrollposition bleiben unverändert.' },
    { version: 'MARA09.23.e', description: 'Ist beim Öffnen des Mesh-Kontextmenüs Text im Mesh-Namen markiert, übernimmt die Farbregel exakt diesen Text ohne Präfix, Suffix oder automatische Anker als Regex. Ohne Markierung bleibt die verankerte Vollnamen-Regel erhalten; Priorität und duplikatfreie Aktualisierung gelten für beide Varianten.' },
    { version: 'MARA09.23.d', description: 'Die RAL-Auswahl im Mesh-Kontextmenü erzeugt eine vollständig verankerte Regel für exakt den vollständigen Mesh-Namen. Allgemeine Regeln bleiben erhalten; vorhandene Einzelregeln werden ohne Duplikat aktualisiert und für die bestehende Last-wins-Priorität ans Ende der Produktregeln gesetzt.' },
    { version: 'MARA09.23.c', description: 'Die Mesh-Liste wertet nach dem Löschen einer Namens-Farbregel ausschließlich den aktuellen Editorstand aus. Ohne verbleibenden Treffer verschwinden RAL/Oberfläche und gelbe Regelmarkierung sofort; bei einem weiteren Treffer wird unmittelbar dessen Farbe nach der bestehenden Last-wins-Priorität angezeigt.' },
    { version: 'MARA09.23.b', description: 'Gelöschte Namens-Farbregeln werden beim nächsten erfolgreichen Bake mit dem vorherigen Regelstand verglichen. Frühere Treffer ohne verbleibende passende Regel werden auf das neutrale Standard-Grau RAL 7035 zurückgesetzt; aktuelle Regeln behalten unverändert ihre Last-wins-Priorität und die Mesh-Anzeige entfernt alte RAL-Zuordnungen.' },
    { version: 'MARA09.23.a', description: 'STEP/STP/STPZ/P21-Ersetzungen archivieren vorherige Dateien vor Übernahme unter D:\\Showroom Datei Move\\Ersetzte STEP\\<Produkt-ID>. Exklusive Archivnamen, Größenprüfung, Rollback und Protokollierung sichern auch identische Dateinamen; GLB und Vorschaubilder bleiben unverändert.' },
    { version: 'MARA09.22.v', description: 'Der gut sichtbare Scrollbalken des mittleren Produktdetailbereichs sitzt nun direkt an dessen linker Kante neben dem Splitter. Die Detailinhalte behalten ihre normale linksbündige Leserichtung; Sidebar-Aufteilung und übrige Scrollbereiche bleiben unverändert.' },
    { version: 'MARA09.22.u', description: 'Der mittlere Scrollbereich der permanenten Produktdetail-Sidebar besitzt einen gezielt überschriebenen, 14 px breiten vertikalen Scrollbalken mit deutlich sichtbarer Schiene und Schieber. Horizontaler Sidebar-Scroll wird unterdrückt; Header, Footer, Splitter und linker Produktbereich bleiben unverändert.' },
    { version: 'MARA09.22.t', description: 'Die Stammdaten bieten bei EAN-/Artikelabweichungen eine bestätigungspflichtige Dateinamenkorrektur mit vollständiger Vorschau. Eindeutig referenzierte STEP/GLB/USDZ/PNG-Dateien sowie Produkt-ID, Name und interne Verweise werden kollisionsgeprüft und transaktional mit Rollback aktualisiert.' },
    { version: 'MARA09.22.s', description: 'Eine gemeinsame EAN-/Artikel-Plausibilitätsübersicht meldet alle gefundenen Abweichungen einmal pro Sitzung. Anklickbare Einträge schließen das Popup, laden die betreffende Produktkarte und positionieren ihre rote Kartenzeile mit der bestehenden Nachführungslogik oben.' },
    { version: 'MARA09.22.r', description: 'Kategorieänderungen in der ausgewählten Produktkarte aktualisieren nur noch den betroffenen Kategorie-Badge statt die gesamte Kartenliste neu zu rendern. Dadurch bleiben Karte und Scrollposition während wiederholter Änderungen pixelstabil; die Nachführung für echte Produktwechsel bleibt unverändert.' },
    { version: 'MARA09.22.q', description: 'Produktkarten vergleichen EAN und Artikelnummer im Namen visuell mit den vorhandenen SAP-Feldern. Ausschließlich abweichende Nummern im oberen Produktnamen werden rot markiert; Daten, Dateinamen und die untere EAN-/Artikel-Zeile bleiben unverändert.' },
    { version: 'MARA09.22.p', description: 'Beim Öffnen oder Fokussieren des Kategorie-Pulldowns wird die zugehörige Produktkarte sofort ausgewählt und rot markiert. Die bestehende Zeilen-Nachführung bleibt aktiv; das Select wird dabei nicht neu gerendert und bleibt normal bedienbar.' },
    { version: 'MARA09.22.o', description: 'Nach einer Kategorieänderung innerhalb der ausgewählten Produktkarte wird deren Kartenzeile nach dem tatsächlichen Neurendern erneut mit der bewährten Nachführungsfunktion oben im sichtbaren Produktbereich positioniert. Die ausgewählte Produkt-ID bleibt dabei erhalten.' },
    { version: 'MARA09.22.n', description: 'Bei Änderungen der Hauptkategorie in einer Produktkarte bleibt die aktuelle Scrollposition der Produktübersicht exakt erhalten. Die automatische Karten-Nachführung bleibt auf echte Produktauswahl und Produktwechsel beschränkt.' },
    { version: 'MARA09.22.m', description: 'Das einzelne Explorer-Symbol der Showroom-Produktliste ist in kompakte GLB- und STEP-Badges aufgeteilt. Beide markieren die jeweils vorhandene Datei direkt im Windows Explorer, ohne Produktauswahl oder Hover-Vorschau auszulösen.' },
    { version: 'MARA09.22.l', description: 'Die linke Showroom-Produktliste erhält ein gekapseltes Ordner-Symbol. Ein Klick markiert die vorhandene CAD-/Quelldatei im Windows Explorer, ohne Produktauswahl oder Hover-Vorschau auszulösen; fehlende Dateien werden verständlich gemeldet.' },
    { version: 'MARA09.22.k', description: 'Die Showroom-Produktsuche berücksichtigt zusätzlich den vorhandenen SAP-Kurztext `shortText`. Mehrere Suchbegriffe werden wie in der Produktverwaltung als AND-Suche über Name, Kennungen, bestehende Suchfelder und Kurztext ausgewertet; Groß-/Kleinschreibung und Teilbegriffe bleiben unterstützt.' },
    { version: 'MARA09.22.j', description: 'Die zweite Zeile der linken Showroom-Produktliste zeigt den vorhandenen SAP-Kurztext in Weiß und mit sauberem Zeilenumbruch; ohne Kurztext bleibt die Produktkennung als Fallback erhalten. Produktverwaltung und Produktlogik bleiben unverändert.' },
    { version: 'MARA09.22.i', description: 'Die ausgewählte Kartenzeile wird anhand der tatsächlichen Zeilenoberkante direkt unter META- und Steuerleiste positioniert und nach dem Layout-Frame einmalig nachkorrigiert.' },
    { version: 'MARA09.22.h', description: 'Jede ausgewählte Produktkarte wird im tatsächlichen Scrollcontainer mit 10 px Abstand am oberen sichtbaren Kartenrand ausgerichtet; dadurch bleiben auch obere Kartenbereiche vollständig sichtbar.' },
    { version: 'MARA09.22.g', description: 'Die Karten-Nachführung setzt die Position des tatsächlich scrollenden Elements direkt, damit globale Smooth-Scroll-Einstellungen die Aufwärtskorrektur nicht verzögern oder überlagern.' },
    { version: 'MARA09.22.f', description: 'Beim Wechsel in eine andere Kartenreihe wird die ausgewählte Reihe im ermittelten Produkt-Scrollcontainer mit 10 px Abstand an den oberen sichtbaren Rand nachgeführt; Sichtbarkeitsprüfung und Einmal-Nachmessung bleiben erhalten.' },
    { version: 'MARA09.22.e', description: 'Die Karten-Sichtbarkeit ermittelt den tatsächlich scrollenden DOM-Container anhand von overflow und scrollHeight; nach dem Layout-Frame erfolgt eine einmalige Nachmessung der Karten- und Containergrenzen.' },
    { version: 'MARA09.22.d', description: 'Die Sichtbarkeitsprüfung ausgewählter Produktkarten berücksichtigt ausschließlich den sichtbaren Ausschnitt des linken Scrollcontainers, einschließlich Browser-Clipping und 10 px Sicherheitsabstand.' },
    { version: 'MARA09.22.c', description: 'Beim Auswählen einer Produktkarte oder beim Produktwechsel über die Sidebar-Navigation wird die Karte im linken Scrollbereich nur bei Bedarf vollständig sichtbar gemacht.' },
    { version: 'MARA09.22.b', description: 'Die permanente Produktdetail-Sidebar reicht vom oberen bis zum unteren Fensterrand. META-Kopfzeile, Steuerleiste, Seitennavigation und Produktkarten nutzen links gemeinsam die verbleibende Breite; Splitter, gespeicherte Breiten- und Collapse-Zustände sowie getrennte Scrollbereiche bleiben erhalten.' },
    { version: 'MARA09.21.i', description: 'Obere Steuerleiste nutzt unabhängig von der dauerhaft sichtbaren Produktdetail-Sidebar die volle Fensterbreite. Die Sidebar-Breite reserviert weiterhin ausschließlich den Inhaltsbereich darunter; Auf-/Zuklappzustand und Splitter bleiben unverändert.' },
    { version: 'MARA09.21.h', description: 'Ein-/Ausklappbare obere Steuerleiste bleibt mit der dauerhaft sichtbaren Sidebar unabhängig funktionsfähig. Sidebar und Raster folgen dynamisch der sichtbaren Steuerleistenhöhe; gespeicherter Pfeil-Zustand bleibt erhalten.' },
    { version: 'MARA09.21.g', description: 'Die dauerhaft sichtbare Produktdetail-Sidebar beginnt dynamisch unter META-Kopfzeile und ein-/ausklappbarer Steuerleiste. Die bestehende Pfeil-Leiste, ihr gespeicherter Zustand und die unabhängigen Scrollbereiche bleiben unverändert.' },
    { version: 'MARA09.21.f', description: 'Produktdetail-Sidebar dauerhaft sichtbar und nicht modal. Produktkarten bleiben links bedienbar; Auswahl wechselt den Inhalt rechts ohne Ein-/Ausfahren. Beide Bereiche bleiben getrennt scrollbar, der bestehende 25–60-%-Splitter bleibt erhalten.' },
    { version: 'MARA09.21.e', description: 'Einstellung für eine fixierte Produktdetail-Sidebar ergänzt. Kopf und Aktionsbereich bleiben sichtbar, nur der mittlere Inhalt scrollt; Sidebar-Breite und bisheriges Verhalten bei Deaktivierung bleiben erhalten.' },
    { version: 'MARA09.21.d', description: 'Produktdetail-Vorschau mit kleinem XYZ-Achsenkreuz unten links. Es folgt live derselben Kamera wie der ViewCube, auch bei Mausrotation und variabler Sidebar-Breite; rein visuell ohne Modell-, Thumbnail- oder Orientierungsänderung.' },
    { version: 'MARA09.21.c', description: 'Neue Produkt-Thumbnails speichern ihre Kameraorientierung. Ein dezentes XYZ-Overlay unten links zeigt diese Orientierung in Rot, Grün und Blau; vorhandene Bilder ohne Kameradaten bleiben ohne Achsenkreuz. Auch manuell neu erzeugte Vorschaubilder erhalten die Kameradaten, ohne das PNG zu verändern.' },
    { version: 'MARA09.21.b', description: 'Produktkarten zeigen EAN und Artikelnummer aus demselben SAP-Excel-Treffer wie den Kurztext. Werte werden gemeinsam gespeichert, ohne zusätzliche Suche; ohne Treffer bleibt die Produkt-ID sichtbar.' },
    { version: 'MARA09.21.a', description: 'Neue, geänderte und gelöschte Farbregeln bleiben bis zur erfolgreichen Neu-Konvertierung gelb. Mesh-Zeilen und Produktkarten vergleichen den aktuellen Regelstand mit dem tatsächlich gebackenen GLB-Stand; erst dann erscheinen Grün und Häkchen. Fehlgeschlagene Konvertierungen bestätigen keine Regeln.' },
    { version: 'MARA09.19.aa', description: 'Farbsteuerung am unteren Rand ein- und ausklappbar statt verschiebbar. Eingeklappt bleibt nur der Pfeilgriff; Zustand lokal gespeichert, Farb- und RAL-Auswahl bleiben erhalten.' },
    { version: 'MARA09.19.z', description: 'Farbfilter und RAL-Palette gemeinsam per Pfeil nach oben/unten verschiebbar. Position lokal gespeichert; Layout folgt dem 3D-Viewport und wahrt Abstand zum ViewCube.' },
    { version: 'MARA09.19.y', description: 'Showroom-Start abgesichert: Performance-Anzeige behandelt noch nicht geladene Statistiken ohne JavaScript-Fehler.' },
    { version: 'MARA09.19.x', description: 'ViewCube zentral auf 125 % skaliert, inklusive Beschriftungen und Klickbereichen. Positionen Links/Mittig/Rechts und bestehende Kameralogik bleiben erhalten.' },
    { version: 'MARA09.19.w', description: 'Einstellungsdialog an die Fensterhöhe angepasst: Nur der mittlere Inhalt scrollt, Kopf und Buttons Abbrechen/Speichern bleiben sichtbar. Speicherlogik unverändert.' },
    { version: 'MARA09.19.v', description: 'F passt das sichtbare Produkt oder isolierte Meshes in die Showroom-Ansicht ein. Kamera und Orbit-Ziel werden zentriert; Texteingaben bleiben unberührt. Kompatibel mit ViewCube, ohne Modell- oder GLB-Änderungen.' },
    { version: 'MARA09.19.u', description: 'Synchroner ViewCube in Showroom und Produktvorschau: sechs Hauptansichten sowie Kanten und Ecken mit weichen Kamerawechseln. Sichtbarkeit und Position zentral gespeichert; Produktorientierung und GLB bleiben unverändert.' },
    { version: 'MARA09.19.t', description: 'Sidebar-Splitter auf 25 bis 60 % erweitert. Schmale Sidebar mit responsiver Mesh-Liste, Stammdaten und Footer-Buttons; lokale Speicherung und 45-%-Reset bleiben erhalten.' },
    { version: 'MARA09.19.s', description: 'Produktdetail-Sidebar per vertikalem Splitter live zwischen 35–60 % verstellbar, mit lokaler Speicherung und Doppelklick zurück auf 45 %. Dashboard und Kartenraster passen sich sofort an; die separate Prozent-Auswahl entfällt.' },
    { version: 'MARA09.19.r', description: 'Breite der Produktdetail-Sidebar zentral auf 35–55 % einstellbar, Standard 45 %. Die gespeicherte Auswahl wirkt sofort auf Sidebar und Dashboard-Restbreite; kleine Fenster bleiben durch Mindestbreite und Fensterbegrenzung bedienbar.' },
    { version: 'MARA09.19.q', description: 'Mesh-Liste mit festen Spalten für RAL/Verzinkt, Vertex-Anzahl und Kamera ausgerichtet. Mesh-Namen lassen sich direkt an der Zeile vollständig öffnen und frei markieren; die bestehende Kontextmenü-Übernahme verwendet auch diese Textauswahl.' },
    { version: 'MARA09.19.p', description: 'Mesh-Zeilen zeigen die zugeordnete RAL-Farbe mit Farbpunkt vor der Vertex-Anzahl und aktualisieren sich bei Regeländerungen sofort. Kontextmenü und Anzeige teilen dieselbe Regelpriorität; die zentrale Anzeigeoption ist standardmäßig aktiv und dauerhaft gespeichert.' },
    { version: 'MARA09.19.o', description: 'Dashboard-Steuerbereich einschließlich Statistik, Filter, Aktionen und Seitennavigation bleibt unter der META-Kopfzeile fixiert und lässt sich über einen mittigen Griff einklappen. Der Zustand wird lokal gespeichert; Sidebar und responsive Kartenbreite bleiben berücksichtigt.' },
    { version: 'MARA09.19.n', description: 'Mesh-Kontextmenü zeigt die RAL-Farbe der letzten passenden Namens-Farbregel vorausgewählt an. Farbwechsel aktualisieren diese Regel ohne Duplikat und setzen die passende Oberfläche; Regex, Ziel und Flags bleiben erhalten.' },
    { version: 'MARA09.19.m', description: 'Produktkarten zeigen nach Übernehmen den gespeicherten Prüfstatus mit den vorhandenen Statusfarben; Statusfilter und Zähler werden aus derselben Statusquelle aktualisiert.' },
    { version: 'MARA09.19.l', description: 'Dashboard um Kurztext A–Z und Z–A erweitert: gespeicherte SAP-Kurztexte nach Suche und Filtern ohne Beachtung der Groß-/Kleinschreibung und äußerer Leerzeichen sortiert; fehlende Kurztexte stehen immer am Ende.' },
    { version: 'MARA09.19.k', description: 'Die in der Produktdetail-Sidebar geöffnete Produktkarte bleibt auch nach Grid-Reflows eindeutig mit einem roten META-Rahmen markiert; Navigation und Schließen verschieben beziehungsweise entfernen die Markierung.' },
    { version: 'MARA09.19.j', description: 'Bei geöffneter Produktdetail-Sidebar nutzt das Dashboard nur noch die verbleibende linke Breite; das bestehende Kartenraster bricht vollständig und ohne Neuladen um.' },
    { version: 'MARA09.19.i', description: 'Produktdetail-Sidebar und Mesh-Scrollbereich sind mit deckenden Hintergründen und isoliertem Stacking-Context gegen durchscheinende Dashboard-Karten abgesichert.' },
    { version: 'MARA09.19.h', description: 'Lange Hilfetexte im Produktdetail sind gemeinsam einklappbar; Namens-Farbregeln, Vertex-Reduktion und Sichtbarkeit zeigen zunächst eine Kurzzeile.' },
    { version: 'MARA09.19.g', description: 'Mesh-Kontextmenü kann RAL direkt auswählen und speichert eine Mesh-Namens-Farbregel mit passender Oberfläche; vorhandene exakte Regeln werden aktualisiert.' },
    { version: 'MARA09.19.f', description: 'Neue Produkt-Namens-Farbregeln starten mit Ziel Mesh; eine aktiv geänderte RAL-Auswahl setzt die Oberfläche auf Pulver, bei RAL 9007 auf Verzinkt.' },
    { version: 'MARA09.19.e', description: 'Automatische Dashboard-Queue startet erst nach dem Karten-Refresh; laufende Slots verwenden die bestehende Produktkarten-Liveanzeige mit Laufzeit.' },
    { version: 'MARA09.19.d', description: 'Dashboard-Drop reicht neu angelegte STEP-Produkte bei aktivierter Automatik an die gemeinsame Konvertierungsqueue weiter; manuelle Starts verwenden denselben Scheduler.' },
    { version: 'MARA09.19.c', description: 'Automatische STEP-Konvertierung wartet beim Drag & Drop auf die zentral gespeicherten Einstellungen, bevor die gemeinsame Warteschlange startet.' },
    { version: 'MARA09.19.b', description: 'Zentrale Einstellungen steuern automatische STEP-Konvertierungen nach Drag & Drop sowie 1–5 parallele Queue-Slots; Werte bleiben dauerhaft gespeichert.' },
    { version: 'MARA09.19.a', description: 'Drag-&-Drop-Konvertierungen mit einstellbarer paralleler Warteschlange (1–5, Standard 3). Nach Abschluss oder Fehler eines Jobs startet automatisch die nächste wartende Datei.' },
    { version: 'MARA09.18.h', description: 'FreeCommander verwendet für GLB-Dateien seine bestehende Single-Instance-Weiterleitung statt ein neues Fenster zu erzwingen.' },
    { version: 'MARA09.18.g', description: 'Produktkarten markieren die gespeicherte GLB-Datei im gewählten Windows-Dateimanager; Explorer und FreeCommander sind konfigurierbar.' },
    { version: 'MARA09.18.f', description: 'Große STEP-Dateien mit gemeinsamem Zeitbudget, robuster Prozessausgabe und Laufzeit-/Tessellierungsdiagnose konvertiert.' },
    { version: 'MARA09.18.e', description: 'Kurztext (SAP) im Produktdetail unter der Überschrift und in den Stammdaten angezeigt.' },
    { version: 'MARA09.18.d', description: 'Produktsuche um Kurztext (SAP) erweitert.' },
    { version: 'MARA09.18.c', description: 'SAP-Kurztexte aus Excel über EAN mit Artikelnummer-Fallback übernommen; Bestand aktualisiert und automatische Übernahme nach Konvertierung ergänzt.' },
    { version: 'MARA09.18.b', description: 'Eigenständigen Kurztext (SAP) auf Produktkarten vorbereitet und angezeigt.' },
    { version: 'MARA09.18.a', description: 'Farbregel-Status mit zugeordneten und gesamten Einzelteilen auf Produktkarten ergänzt.' },
    { version: 'MARA09.17.d', description: 'Mesh-Liste zeigt vollständige Namen; STEP-Produktstruktur bestimmt die Zeichnungsnummer je Bauteil.' },
    { version: 'MARA09.17.c', description: 'Mesh-Liste zeigt Zeichnungsnummer und Gruppennummer ohne EAN- und Artikelnummer-Präfix.' },
    { version: 'MARA09.17.b', description: 'STEP-Meshes werden je Zeichnungsnummer in Bauteilreihenfolge ab eins nummeriert.' },
    { version: 'MARA09.17.a', description: 'Archivierung überschreibt vorhandene Zielartefakte nach bestätigter Vorschau.' },
    { version: 'MARA09.16.ad', description: 'Detail-Footer weiter verdichtet, damit alle Aktionen bei normaler Breite in einer Zeile bleiben.' },
    { version: 'MARA09.16.ac', description: 'Detail-Footer mit kompakter rechter Aktionsgruppe und vollständig sichtbarem Übernehmen-Button ausgerichtet.' },
    { version: 'MARA09.16.ab', description: 'Produktentfernen-Aktion in der Detailleiste klar beschriftet und horizontal ausgerichtet.' },
    { version: 'MARA09.16.aa', description: 'Archivdialog mit kompakten Spalten, gekürzten Pfaden und vollständigen Tooltips verbessert.' },
    { version: 'MARA09.16.z', description: 'Archivierung beim Produktentfernen umfasst auch eindeutig zugeordnete CAD- und Originaldateien.' },
    { version: 'MARA09.16.y', description: 'Produktentfernung archiviert zugehörige GLB-, USDZ- und Vorschaudateien nach bestätigter Vorschau.' },
    { version: 'MARA09.16.x', description: 'Neu-Konvertierung eines Produkts kann direkt aus der Produktdetailansicht gestartet werden.' },
    { version: 'MARA09.16.w', description: 'Mesh-Schublade wird beim Sprung zu einer Namens-Farbregel zuverlässig eingeklappt.' },
    { version: 'MARA09.16.v', description: 'Über Mesh-Kontextmenü kann direkt zu einer vorhandenen Namens-Farbregel gesprungen werden.' },
    { version: 'MARA09.16.u', description: 'Einzelteile-Schublade horizontal an den Stammdaten ausgerichtet.' },
    { version: 'MARA09.16.t', description: 'Mesh-Liste zeigt Auswahl und vorhandene Namens-Farbregeln farblich an; Schublade schließt nach Regelübernahme automatisch.' },
    { version: 'MARA09.16.s', description: 'Namens-Farbregel kann wahlweise den vollständigen oder einen markierten Teil des Mesh-Namens übernehmen.' },
    { version: 'MARA09.16.r', description: 'Einzelteile-Schublade in den fixierten Vorschaubereich aufgenommen.' },
    { version: 'MARA09.16.q', description: 'Fixierten Vorschaubereich erweitert und Abstände der Einzelteile-Schublade optimiert.' },
    { version: 'MARA09.16.p', description: '3D-Vorschau fixiert und Einzelteile-Bereich ein- und ausklappbar gestaltet.' },
    { version: 'MARA09.16.o', description: 'Übernahme von Einzelteilnamen in Namens-Farbregeln ohne ^- und $-Begrenzung.' },
    { version: 'MARA09.16.n', description: 'Einzelteile können per Rechtsklick direkt als Namens-Farbregel übernommen werden.' },
    { version: 'MARA09.16.m', description: 'Geöffnetes Produkt wird im Showroom automatisch in der Produktliste markiert.' },
    { version: 'MARA09.16.l', description: 'Sichtbarkeit der Buttons in der Kopfzeile der Produktverwaltung verbessert.' },
    { version: 'MARA09.16.k', description: 'Löschen-Button für die Suche in der Produktverwaltung ergänzt.' },
    { version: 'MARA09.16.j', description: 'Löschen-Button für die Produktsuche im Showroom ergänzt.' },
    { version: 'MARA09.16.i', description: 'Live-Konvertierungsanzeige in die jeweilige Produktkarte verschoben.' },
    { version: 'MARA09.16.h', description: 'Separaten Konvertierungsstatus für jedes Einzelteil ergänzt.' },
    { version: 'MARA09.16.g', description: 'Darstellung der Versions-Hover-History verbessert.' },
    { version: 'MARA09.16.f', description: 'Änderungshistorie über die Versionsanzeige hinzugefügt.' },
    { version: 'MARA09.16.e', description: 'Showroom-Produktliste um Hover-Vorschauen mit vorhandenen Produktbildern erweitert.' },
    { version: 'MARA09.16.d', description: 'Showroom-Produktliste um Live-Suche und verstellbare Breite erweitert.' },
    { version: 'MARA09.16.c', description: 'Kopfzeilen von Showroom und Produktverwaltung vereinheitlicht.' },
    { version: 'MARA09.16.b', description: 'Versionsanzeige und Showroom-Button in der Produktverwaltung korrigiert.' },
    { version: 'MARA09.16.a', description: 'Zentrale Versions- und Historie-Notierung eingeführt.' },
  ],
};

if (typeof window !== 'undefined') {
  window.APP_VERSION = APP_VERSION_INFO.version;
  window.APP_HISTORY = APP_VERSION_INFO.history;
}

if (typeof document !== 'undefined') {
  window.addEventListener('DOMContentLoaded', () => {
    const history = window.APP_HISTORY || APP_VERSION_INFO.history;
    const badge = document.getElementById('appVersionBadge');
    const trigger = document.querySelector('.sr-topbar-version');
    if (!badge || !trigger) return;

    badge.textContent = window.APP_VERSION || APP_VERSION_INFO.version;
    trigger.classList.add('version-history-trigger');
    trigger.tabIndex = 0;
    trigger.setAttribute('role', 'button');
    trigger.setAttribute('aria-label', 'Änderungshistorie öffnen');

    const makeEntries = (entries) => entries.map((entry) =>
      `<li><strong>${entry.version}</strong><span>${entry.description}</span></li>`,
    ).join('');

    const tooltip = document.createElement('div');
    tooltip.className = 'version-history-tooltip';
    tooltip.setAttribute('role', 'tooltip');
    tooltip.innerHTML = `<div class="version-history-heading">Letzte Änderungen</div><ul>${makeEntries(history.slice(0, 5))}</ul>`;
    trigger.append(tooltip);

    const modal = document.createElement('div');
    modal.className = 'version-history-modal';
    modal.hidden = true;
    modal.innerHTML = `<div class="version-history-dialog" role="dialog" aria-modal="true" aria-labelledby="versionHistoryTitle">
      <div class="version-history-dialog-header">
        <h2 id="versionHistoryTitle">Änderungshistorie</h2>
        <button type="button" class="version-history-close" aria-label="Historie schließen">×</button>
      </div>
      <ul class="version-history-full-list">${makeEntries(history)}</ul>
      <button type="button" class="version-history-close-button">Schließen</button>
    </div>`;
    document.body.append(modal);

    const closeModal = () => { modal.hidden = true; };
    const openModal = () => { modal.hidden = false; modal.querySelector('.version-history-close').focus(); };
    trigger.addEventListener('click', openModal);
    trigger.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        openModal();
      }
    });
    modal.addEventListener('click', (event) => { if (event.target === modal) closeModal(); });
    modal.querySelector('.version-history-close').addEventListener('click', closeModal);
    modal.querySelector('.version-history-close-button').addEventListener('click', closeModal);
    document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeModal(); });

    const style = document.createElement('style');
    style.textContent = `
      .version-history-trigger { position: relative; display: inline-flex !important; cursor: pointer; }
      .version-history-tooltip { position: absolute; top: calc(100% + 12px); left: -12px; display: none; box-sizing: border-box; width: min(480px, calc(100vw - 24px)); padding: 12px; border: 1px solid rgba(255,255,255,.16); border-radius: 8px; background: #252830; box-shadow: 0 12px 32px rgba(0,0,0,.32); color: #f8fafc; z-index: 110; }
      .version-history-trigger:hover .version-history-tooltip, .version-history-trigger:focus .version-history-tooltip { display: block; }
      .version-history-heading { margin-bottom: 8px; color: #f8fafc; font-size: .76rem; font-weight: 700; }
      .version-history-tooltip ul, .version-history-full-list { margin: 0; padding: 0; list-style: none; }
      .version-history-tooltip li, .version-history-full-list li { display: grid; gap: 3px; padding: 8px 0; border-top: 1px solid rgba(255,255,255,.1); font-size: .72rem; line-height: 1.35; }
      .version-history-tooltip li:first-child, .version-history-full-list li:first-child { border-top: 0; padding-top: 0; }
      .version-history-tooltip strong, .version-history-full-list strong { color: #f8fafc; }
      .version-history-tooltip span, .version-history-full-list span { color: rgba(248,250,252,.74); overflow-wrap: anywhere; white-space: normal; }
      .version-history-modal[hidden] { display: none; }
      .version-history-modal { position: fixed; inset: 0; z-index: 200; display: grid; place-items: center; padding: 20px; background: rgba(0,0,0,.55); }
      .version-history-dialog { width: min(560px, 100%); max-height: min(680px, calc(100vh - 40px)); overflow: auto; padding: 20px; border: 1px solid rgba(255,255,255,.16); border-radius: 8px; background: #252830; box-shadow: 0 24px 64px rgba(0,0,0,.45); color: #f8fafc; }
      .version-history-dialog-header { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 12px; }
      .version-history-dialog h2 { margin: 0; font-size: 1rem; }
      .version-history-close { border: 0; background: transparent; color: #f8fafc; font-size: 1.5rem; line-height: 1; cursor: pointer; }
      .version-history-close-button { margin-top: 16px; padding: 7px 12px; border: 1px solid rgba(255,255,255,.25); border-radius: 6px; background: rgba(255,255,255,.08); color: #f8fafc; font: inherit; font-size: .8rem; cursor: pointer; }
    `;
    document.head.append(style);
  });
}

export default APP_VERSION_INFO;
