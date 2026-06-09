# Regel: Ständer- und Boden-Positionierung

Diese Regel kann auf **alle Maße** angewendet werden. Sie legt fest, wie Ständer und Böden zueinander positioniert werden.

## Grundprinzip

1. **Ständer 1 Pivot** = Startpunkt (Referenz, z. B. x = 0).
2. **Böden-Pivot** = Ständer 1 + **503 mm** (bei 1000 mm Bodenbreite und 3 mm Spiel).
3. **Ständer 2 Pivot** = Ständer 1 + **1006 mm** (1000 mm + 2×3 mm).

## Formeln (allgemein)

- **clearanceMm** = 3 (Spiel zwischen Bodenkante und Profil, je Seite).
- **shelfToStanderMm** = `shelfWidthMm / 2 + clearanceMm`  
  → Abstand vom Ständer-1-Pivot bis zum Boden-Pivot (Mitte des Bodens).
- **Ständer 2 Abstand** = `shelfWidthMm + 2 × clearanceMm`  
  → Abstand Ständer 1 Pivot bis Ständer 2 Pivot.

## Beispiele

| Bodenbreite (mm) | shelfToStanderMm | Ständer 2 Abstand (mm) |
|------------------|------------------|------------------------|
| 1000             | 503              | 1006                   |
| 1200             | 603              | 1206                   |
| 800              | 403              | 806                    |

## In products.json

Unter `shelves`:

- `shelfWidthMm`: Bodenbreite (lange Seite).
- `shelfToStanderMm`: Wert aus Formel (Ständer 1 → Boden-Mitte).
- Ständer-Positionen in `parts`: Ständer 1 mit x = 0 (oder gewünschter Startpunkt), Ständer 2 mit x = (Ständer 2 Abstand) / 1000 in Metern.

Die Platzierungslogik in `ProductPlacement.js` verwendet den linkesten Ständer-Pivot (min X aus allen Part-Positionen) und setzt die Böden bei `staender1PivotX + shelfToStanderMm/1000`.

---

## T-Profil-Lochung und Aussteifung

- Am **T-Profil** der Ständer gibt es eine **Lochung** (Lochraster): vertikal auf der **Vorderseite**. **Erstes Loch:** Mitte bei **25 mm** (ab Referenz/Boden), danach **alle 50 mm** (Loch 2 = 75 mm, Loch 3 = 125 mm, Loch 4 = 175 mm usw.). Formel: Loch N (von unten) = `loch1OffsetMm + (N − 1) × lochabstandMm`.
- **Aussteifung:** Die Aussteifung wird an der **Rückseite** befestigt und greift in **Loch 4 von unten** → Höhe = **175 mm**. Die Stange der Aussteifung hat **5 mm Durchmesser**; der Pivot (Mitte der Stange) liegt in Tiefenrichtung bei **538,5 mm** (Ständertiefe 536 mm + 2,5 mm = 536 + Durchmesser/2). **Platzierung:** Pivot der Aussteifung bei **Y = 175 mm**, **Z = 538,5 mm** (gleiche Tiefen-Referenz wie Ständer, z. B. Vorderseite = 0). Formel Z: `staenderTiefeMm + (stangeDurchmesserMm / 2)`.
- **Pivot des Aussteifungs-GLB:** Der Nullpunkt des Modells muss **in Loch 4 eingehängt** sein (Mitte der 5-mm-Stange in Lochmitte).
- **Produkte:** Aussteifung `4026212036336_2001694_VZK.glb` hat `aussteifungLochVonUnten`: 4 und `stangeDurchmesserMm`: 5. Ständer hat Lochraster und `staenderTiefeMm` (536). Beim Platzieren: Y = 175 mm (aus Lochraster + Loch 4), Z = 536 + 2,5 = 538,5 mm.
- Im Showroom-Code ist die Aussteifung derzeit **nicht** als eigenes Teil platziert; wenn sie später ergänzt wird, werden Ständer-Daten (Lochraster) und Aussteifungs-Daten (`aussteifungLochVonUnten`) verwendet.
- **Szenenstruktur prüfen:** Beim Laden eines GLB wird in der Entwicklungsumgebung (`npm run dev`) die komplette Szenenstruktur (alle Objekt-/Mesh-Namen) in der Konsole ausgegeben (`[ProductLoader] Szenenstruktur`). Damit können Loch- oder Aussteifungs-Meshes im Modell identifiziert werden.
