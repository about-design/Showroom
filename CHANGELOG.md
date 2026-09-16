# Changelog

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
