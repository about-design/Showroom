# Verbindliche STEP→GLB-Regel: Zeichnungsnummern und Instanzen

Diese Regel gilt für alle zukünftigen Änderungen am STEP-Import, an der FreeCAD-Konvertierung, der OBJ-/GLB-Erzeugung, der Mesh-Benennung und der automatischen Farbzuordnung.

## Grundregel

Die ursprüngliche Zeichnungsnummer eines Bauteils muss aus der STEP-Baugruppenstruktur übernommen werden. Wird dieselbe Zeichnungsnummer mehrfach verwendet, darf sie nicht verändert oder hochgezählt werden. Nur der Instanzzähler wird je Zeichnungsnummer erhöht:

```text
06-00434_1
06-00434_2
06-00894_1
06-00894_2
```

Es ist niemals zulässig, aus `06-00434` künstlich `06-00435` oder aus `06-00894` `06-00895` zu erzeugen.

## Quelle und Fallback

- Vorrang hat immer die ursprüngliche Zeichnungsnummer aus der STEP-Produkt-/Baugruppenstruktur.
- FreeCAD-, OBJ- oder sonstige Zwischen-/Exportnamen dürfen nicht bevorzugt als Zeichnungsnummer interpretiert werden, wenn eine STEP-Zuordnung verfügbar ist.
- Die STEP-Auswertung muss übliche Formatierungsvarianten tolerieren, insbesondere ein oder mehrere Whitespaces vor Klammern sowie unterschiedliche `PRODUCT_DEFINITION_FORMATION...`-Varianten.
- Der vorhandene Fallback über Exportnamen bleibt nur für STEP-Dateien erhalten, aus denen tatsächlich keine zuverlässige Zeichnungsnummer ermittelt werden kann.
- Ein Parserfehler darf nicht stillschweigend als gültige STEP-Zuordnung behandelt werden.

## Gemeinsame Grundlage

Die erkannte ursprüngliche Zeichnungsnummer ist die gemeinsame Grundlage für:

- Mesh- und Einzelteilnamen
- Instanznummerierung `_1`, `_2`, `_3` …
- Einzelteile-Liste
- Farbregeln und automatische Farbzuordnung
- zeichnungsnummernabhängige Regeln
- Produkt-, Mesh- und Geometrieauswertungen

Der Instanzsuffix bezeichnet ausschließlich das Vorkommen innerhalb der Baugruppe. `06-00434_1` und `06-00434_2` gehören beide zur Zeichnungsnummer `06-00434`.

## Verbindlicher Regressionstest

Bei Änderungen am STEP-Parser oder an der STEP→GLB-Pipeline muss mindestens das Produkt `4026212286489_177599` geprüft werden. Die erwartete Reihenfolge und Benennung lautet:

```text
06-00434_1
06-00434_2
06-00763_1
06-00763_2
06-00770_1
06-00770_2
06-00894_1
06-00894_2
```

Der Test muss mindestens bestätigen:

- STEP-Reihenfolge und ursprüngliche Zeichnungsnummern stimmen.
- Gleiche Zeichnungsnummern werden separat gezählt.
- Keine künstlich hochgezählten Zeichnungsnummern entstehen.
- Mesh-Anzahl und Geometrie bleiben unverändert.
- Farbregeln und automatische Farbzuordnung funktionieren weiterhin.
- Der Fallback für nicht auswertbare STEP-Strukturen bleibt funktionsfähig.
- Produkte mit nur einmal vorkommenden Zeichnungsnummern bleiben unverändert.

Die bestehende funktionierende gruppierte Nummerierungslogik darf nicht ohne ausdrücklichen technischen Grund ersetzt oder umgangen werden.
