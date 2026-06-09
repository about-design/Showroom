# Benennung & Farbauswahl – Übersicht und Konventionen

## 1. Begriffe (einheitlich)

| Begriff | Bedeutung | Verwendung in UI / Daten |
|--------|-----------|---------------------------|
| **Standard-Farbe** | Die RAL-Farbe, die einem Produkt zugeordnet ist (z. B. für Showroom/Export). | Dashboard: Label „Standard-Farbe“, Daten: `defaultColor` (RAL-Code, z. B. `"RAL 7035"`). |
| **Override (Standard-Farbe)** | Wenn aktiv: Im Showroom und in Vorschauen wird die Standard-Farbe angewendet; sonst werden die in der GLB gespeicherten Farben angezeigt. | Dashboard: Checkbox „Override“, Daten: `defaultColorOverride` (boolean/string). |
| **— Keine** | Keine RAL als Standard-Farbe hinterlegt. | Dashboard: Option im Dropdown `defaultColor`. |
| **Farbfilter** | Showroom: Produktliste auf eine RAL-Farbe einschränken. | Showroom: „Farbfilter:“, Chips „Alle“ + RAL-Codes. |
| **RAL-Farbe / RAL** | Farbe aus der RAL-Palette (z. B. RAL 7035, RAL 9007). | Überall: `ralColors.json`, ColorService, Konverter-Preflight. |
| **Färbbar** | Meshes, die im Showroom umgefärbt werden können (Namen mit `_colorable` oder Fallback). | Dashboard: Label „Färbbar“, Daten: `colorableMeshes` (Array). |

### Oberfläche (Finish)

- **Verzinkt (RAL 9007):** metallisch (metallic 0,75 / roughness 0,25).
- **Alle anderen RAL:** matt, nicht metallisch (metallic 0 / roughness 0,35).
- Diese Zuordnung gilt in: ColorService, MaterialManager (Showroom), Dashboard-Vorschau, bake-glb-yup.js.

---

## 2. Wo wird was angezeigt / gesetzt?

### 2.1 Dashboard (Produktverwaltung)

| Element | Bedeutung |
|--------|-----------|
| **Standard-Farbe** (Dropdown) | RAL-Code für dieses Produkt. „— Keine“ = kein RAL hinterlegt. |
| **Override** (Checkbox) | An: In Showroom und Dashboard-Vorschau wird die Standard-Farbe angewendet (und matt/metallisch nach RAL-Regel). Aus: Es werden die Farben aus der GLB-Datei angezeigt. |
| **Färbbar** | Komma-getrennte Liste der Mesh-Namen, die als färbbar gelten (optional; sonst Konvention `_colorable`). |
| Karten-Vorschau / Detail-Vorschau | Zeigen das GLB; bei Override + Standard-Farbe wird diese Farbe inkl. Finish angewendet. |

### 2.2 Showroom (3D-Ansicht)

| Element | Bedeutung |
|--------|-----------|
| **Farbfilter** | Filtert die Produktliste nach `defaultColor` (bzw. „Alle“ = kein Filter). |
| **Farbpalette (unten)** | Gewählte RAL-Farbe für das aktuell platzierte Produkt. |
| Beim Platzieren | Wenn Produkt **Override** + **Standard-Farbe** hat → diese Farbe (inkl. Finish). Sonst → Farben aus der GLB; Sidebar zeigt neutrale Standardfarbe (RAL 7035). |

### 2.3 Konverter (CAD → GLB)

| Element | Bedeutung |
|--------|-----------|
| **Preflight / Farben** | MTL-Quellfarben → Zuordnung zu RAL (oder Hex). „Produkt-Standard (RAL)“ = `defaultColor` des Produkts (wenn in URL). |
| **Override** (Konverter) | Beim Dashboard-Aufruf „Konvertieren“: `defaultColorOverride` + `defaultColorHex` werden nur genutzt, wenn kein Projekt-Mapping geladen ist. |

---

## 3. Datenmodell (products.json)

```json
{
  "defaultColor": "RAL 7035",
  "defaultColorOverride": false,
  "colorableMeshes": []
}
```

- **defaultColor:** RAL-Code oder `""` (keine).
- **defaultColorOverride:** `true` / `"1"` = Override an; sonst GLB-Farben nutzen.
- **colorableMeshes:** Optional; sonst gilt `_colorable` im Mesh-/Materialnamen.

---

## 4. Ablauf Farbauswahl (Kurz)

1. **Produkt ohne Override:** Showroom und Vorschau zeigen die in der GLB gespeicherten Farben („Standardexport“).
2. **Produkt mit Override + Standard-Farbe:** Showroom und Vorschau zeigen die gewählte RAL-Farbe; Finish: nur RAL 9007 metallisch, alle anderen RAL matt.
3. **Nutzer wählt in Showroom eine andere RAL:** Die gewählte Farbe (inkl. Finish) wird auf das platzierte Modell angewendet; unabhängig von Override.
4. **Konverter:** Farben kommen aus Projekt-Mapping (mtl-ral-color-mapping.json) oder Preflight; optional aus Produkt-Standard-Farbe bei Dashboard-Konvertierung.

---

## 5. Einheitliche Formulierungen (Empfehlung)

- Im UI immer **„Standard-Farbe“** (mit Bindestrich), wenn die Produkt-RAL gemeint ist.
- Override-Checkbox: Kurz **„Override“**; Tooltip z. B.: „An: Im Showroom und in Vorschauen wird die Standard-Farbe angezeigt. Aus: Farben aus der GLB-Datei.“
- „— Keine“ nur für die leere Option im Standard-Farbe-Dropdown.

Diese Begriffe sind in `docs/benennung-farbauswahl.md` und in den genannten UIs/Daten referenziert.
