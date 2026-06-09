# Farbsystem – Single Source: ralColors.json

**Alle RAL- und Standard-Farben laufen über `ralColors.json`.**

- **Showroom** (index): Produkt-Standard-Farbe, Farbfilter, Farbauswahl → Hex aus `ralColors.json`
- **Produktverwaltung** (dashboard): `defaultColor` (RAL-Code) → Anzeige und Konvertierung nutzen `ralColors.json` für Hex
- **Konvertierung**: Geladenes Farb-Mapping (matchRal) wird mit `ralColors.json` auf Hex aufgelöst → einheitliche RAL-Werte
- **Colormatching-Tool** (tools/mtl-color-matching.html): RAL-Palette aus `ralColors.json` laden; Export speichert RAL-Keys (`matchRal`), Hex kommt bei der Nutzung aus derselben Datei

**Vorteil:** Eine zentrale Datei für alle Hex-Werte; Änderungen (z. B. neuer RAL, Korrektur) gelten überall. Mappings speichern nur RAL-Keys, keine doppelten Hex-Werte.
