# Stückliste Katalog S. 134 – Batch-Neukonvertierung

Alle **Ständerrahmen** aus den drei Tabellen (Profil **85/20**, **100/20**, **120/20**) sind in `scripts/reconvert-catalog-p134.mjs` als **92 Artikelnummern** hinterlegt (entspricht den Zeilen im Katalog inkl. Höhen bis 12 000 mm).

## Voraussetzungen

1. **Converter-API** läuft (`localhost:3000`) – wie bei `npm run dev:full`.
2. **Vite** mit Dashboard-Middleware (`/__api/convert-product`) – z. B. Port **5050**.

## Befehle

```bash
# Nur prüfen, welche Produkte angesprochen würden
npm run catalog:reconvert-p134:dry

# Alle Jobs nacheinander starten (1,5 s Pause zwischen Starts)
npm run catalog:reconvert-p134
```

Anderer Dev-Port:

```bash
SHOWROOM_URL=http://localhost:5173 npm run catalog:reconvert-p134
```

Längere Pause (weniger Last auf der API):

```bash
RECONVERT_DELAY_MS=3000 npm run catalog:reconvert-p134
```

## Welche Einstellungen gelten?

Es wird dieselbe Route genutzt wie **„Konvertieren“ im Dashboard**. Die Formular-Defaults kommen aus `vite.config.js` (`tessellationQuality`, `decimateRatio`, Draco, `materialFinish*`, `preserveMtlColors`, MTL-Mapping usw.).

Optional wie im Dashboard eine **Rotation vor der Konvertierung**:

```bash
ROTATE_AXIS=X ROTATE_DEGREES=90 npm run catalog:reconvert-p134
```

## Nach dem Lauf

Jobs laufen asynchron auf dem Converter. Status wie gewohnt im **Converter-UI** prüfen. Wenn das Dashboard offen ist, übernimmt das Polling die **Registrierung** der neuen GLB/USDZ in `products.json` pro Produkt – andernfalls `register-converted` manuell oder erneut im UI abschließen.
