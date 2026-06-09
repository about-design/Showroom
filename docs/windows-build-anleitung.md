# META Showroom – Windows-Build erstellen

Kurzanleitung für **dich** (Ersteller des Builds). Ziel: zwei installierbare Artefakte für Windows
erzeugen, die du **mit der IT beim Kollegen** installieren kannst.

> **Wichtig:** Der finale Windows-Build muss auf einem **Windows-Rechner** laufen.
> Auf macOS/Linux wären `node_modules` und die `.exe` für die falsche Plattform gebaut.

---

## Die zwei Artefakte – was wann?

| Artefakt | Inhalt | Zielrechner braucht | Wann nehmen |
|----------|--------|---------------------|-------------|
| **A) `META Showroom Setup 1.0.0.exe`** (NSIS-Installer, Electron) | Nur **3D-Showroom-Viewer** mit den aktuell in `src/data/products.json` hinterlegten Produkten | **nichts extra** (kein Node/Python/Blender) | Schnell beim Kollegen zeigen / nur ansehen |
| **B) `meta-showroom-1.0.0-win-x64.zip`** (voller Stack) | Showroom **+ Dashboard + CAD-Konverter** | Node 20+, Python 3.10+, Blender 4.x, Memurai (Redis) | Voller Funktionsumfang inkl. Konvertierung |

Für „mal eben beim Kollegen installieren und zeigen" ist **A** ideal. Wenn der Kollege auch
**konvertieren / Produkte pflegen** soll, zusätzlich **B** (mehr IT-Aufwand, siehe
[`windows-it-rollout.md`](windows-it-rollout.md)).

---

## Voraussetzungen auf dem Build-Rechner (Windows)

- **Node.js 20.11+ LTS** (https://nodejs.org/)
- **Git** (zum Klonen) – oder Projekt als ZIP kopieren
- Für **B** zusätzlich: der Blender-Converter muss als Ordner `blender-exporter\` im Projektroot
  liegen (oder als Junction). Ohne ihn bricht `package:win` mit klarer Fehlermeldung ab.

---

## Schritt 0: Projekt auf den Windows-Rechner

```powershell
git clone <repo-url> C:\meta\build\showroom
cd C:\meta\build\showroom
npm install
```

(Alternativ den Projektordner inkl. `package.json` auf den Windows-Rechner kopieren – aber **ohne**
das macOS-`node_modules`; danach `npm install`.)

---

## Schritt 0b: 3D-Modelle bereitstellen (separat – NICHT im Repo)

Die 3D-Modelle (`public/models/products/`, ~2,6 GB) sind aus dem Git-Repo **bewusst
ausgeschlossen** (`.gitignore`). Nach `git clone` sind sie also **nicht** vorhanden.
**Ohne diese Dateien baut der Showroom zwar, zeigt aber keine Produkte.**

Vor dem Build die Modelle in den Projektordner kopieren:

```
<Projekt>\public\models\products\   <- hierhin die GLB-Modelle kopieren
```

Quelle: vom Showroom-Team / Netzlaufwerk / externe Platte. Beispiel (PowerShell):

```powershell
Copy-Item -Recurse "\\server\share\showroom-models\*" "C:\meta\build\showroom\public\models\products\"
```

Hinweise:
- Die Einträge `public\models\obj` und `public\models\output` sind auf dem Mac nur Symlinks
  auf externe Laufwerke und gehören **nicht** ins Repo. Auf Windows bei Bedarf als normale
  Ordner anlegen bzw. die Inhalte hineinkopieren.
- Erst **nach** dem Kopieren der Modelle den Build (`npm run dist:win` / `npm run package:win`)
  ausführen, damit sie in `dist\` landen und im Installer enthalten sind.

---

## Artefakt A: Standalone-Installer (.exe)

```powershell
npm run dist:win
```

Das führt aus: `npm run build` (Showroom nach `dist\`) und danach `electron-builder --win`.

Ergebnis in `release\`:

- **`META Showroom Setup 1.0.0.exe`** ← das ist der Installer zum Weitergeben
- `win-unpacked\` ← entpackte App (optional, portabel startbar via `META Showroom.exe`)

### Beim Kollegen installieren (mit IT)

1. `META Showroom Setup 1.0.0.exe` ausführen.
2. Installationsordner bestätigen (Standard ok). Bei „SmartScreen"-Hinweis: *Weitere Informationen →
   Trotzdem ausführen* (Setup ist nicht signiert – mit der IT abklären; ggf. Code-Signing-Zertifikat).
3. Fertig: Eintrag im **Startmenü** und Verknüpfung auf dem **Desktop** („META Showroom").
4. App startet als eigenes Fenster (intern auf `127.0.0.1:5050`), kein Browser/Node nötig.

> Inhalt = Showroom-Viewer. **Dashboard/Konverter** sind in dieser Version sichtbar, brauchen aber
> die Dienste aus Artefakt B, um wirklich zu konvertieren.

---

## Artefakt B: Voller Stack (ZIP für IT)

Voraussetzung: `blender-exporter\` liegt im Projektroot (siehe oben).

```powershell
npm run package:win
```

Ergebnis: `release\meta-showroom-1.0.0-win-x64.zip` (enthält `dist\`, `node_modules\`, Skripte,
`install-windows.ps1`, `start-/stop-showroom.cmd`, Doku, Converter).

### Übergabe an die IT

Mitliefern:

1. `meta-showroom-1.0.0-win-x64.zip`
2. Drittsoftware-Installer (Node 20+, Python 3.10+, Blender 4.x, Memurai)
3. [`docs/windows-it-rollout.md`](windows-it-rollout.md) (Schritt-für-Schritt für die IT)

Installation beim Kollegen dann exakt nach `windows-it-rollout.md` (ZIP nach `C:\meta\showroom`,
`install-windows.ps1 -Unattended`).

---

## App-Icon (optional neu erzeugen)

Das META-„M"-Icon liegt unter `electron\icon.ico` / `electron\icon.png` und ist bereits eingebunden.
Neu erzeugen (z. B. nach Markenanpassung):

```powershell
node scripts\generate-icon.mjs
```

---

## Schnell-Checkliste

- [ ] Auf **Windows**-Rechner, `npm install` ohne Fehler
- [ ] **A:** `npm run dist:win` → `release\META Showroom Setup 1.0.0.exe` vorhanden
- [ ] A getestet: Setup installiert, App-Fenster zeigt den Showroom
- [ ] **B (falls nötig):** `blender-exporter\` vorhanden → `npm run package:win` → ZIP in `release\`
- [ ] Drittsoftware-Installer + `windows-it-rollout.md` für die IT bereitgelegt
- [ ] Beim Kollegen: SmartScreen/AV mit IT abgeklärt
```
