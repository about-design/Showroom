# Changelog

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
