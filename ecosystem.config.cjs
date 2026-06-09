/**
 * pm2-Prozesskonfiguration für den META-Showroom-Stack.
 *
 * Ziel: MCP-Server, API-Gateway und Vite-Devserver laufen dauerhaft im
 * Hintergrund – unabhängig von Cursor/Terminal – und starten bei Abstürzen
 * oder Code-Änderungen automatisch neu.
 *
 * Start-Pfad-Problem: pm2 wrappt Scripts intern in `bash -c "<path>"` ohne
 * Leerzeichen zu escapen. Damit unser Projektpfad ("/Volumes/My Passport/…")
 * funktioniert, werden die Services NICHT direkt hier, sondern über
 * `scripts/services-launch.mjs` gestartet. Dieses Skript legt einen Symlink
 * `~/.meta-showroom` → Projekt-Root an und ruft pm2 mit diesem cwd auf.
 *
 * Die Script-Pfade unten sind daher RELATIV und werden von pm2 mit dem
 * leerzeichenfreien cwd kombiniert.
 *
 * Verwendung (via npm-scripts):
 *   npm run services:start     # alle drei Services starten
 *   npm run services:status    # Statusübersicht
 *   npm run services:logs      # Live-Logs (aggregiert)
 *   npm run services:restart   # alle Services neu laden
 *   npm run services:stop      # stoppen
 *   npm run services:delete    # aus pm2 entfernen
 *
 * Boot-Persistenz (macOS/Linux):
 *   npm run services:startup   # einmalig – gibt einen sudo-Befehl aus
 *   npm run services:save      # aktuellen Prozessstand persistieren
 */

const path = require('path')

// Absoluter Pfad! Der MCP-Server läuft mit cwd=mcp-server (via Symlink
// blender-exporter → GLB export Blender), und Python resolved den Symlink auf
// den echten Pfad. Eine relative Variable würde dadurch zu einem nicht
// existenten Verzeichnis (`.../mcp-server/blender-exporter/.../outputs`)
// aufgelöst → "Output file was not created by Blender".
const commonEnv = {
  BLENDER_OUTPUT_DIR: path.resolve(__dirname, 'blender-exporter/blender-mcp-converter/outputs'),
  // GLB ist die Wahrheit: Blue-Kompensation beim USDZ-Export aus, damit
  // USDZ und GLB dieselben Material-Farben haben (RAL 5010 wurde sonst um
  // Faktor 0.78 abgedunkelt für iOS Quick Look).
  USDZ_BLUE_COMPENSATION: 'false',
  EXPORT_USDZ_OVERWRITE: 'true',
}

const commonDefaults = {
  autorestart: true,
  max_restarts: 20,
  restart_delay: 2000,
  kill_timeout: 8000,
  // Node explizit als Interpreter – verhindert pm2's bash-Fallback.
  interpreter: 'node',
}

module.exports = {
  apps: [
    {
      ...commonDefaults,
      name: 'showroom-mcp',
      script: './scripts/pm2/mcp.cjs',
      env: {
        ...commonEnv,
        WATCH_MODE: '1',
        PYTHONUNBUFFERED: '1',
      },
    },
    {
      ...commonDefaults,
      name: 'showroom-api',
      script: './scripts/pm2/api.cjs',
      env: {
        ...commonEnv,
        WATCH_MODE: '1',
        NODE_ENV: 'development',
      },
    },
    {
      ...commonDefaults,
      name: 'showroom-vite',
      script: './scripts/pm2/vite.cjs',
      env: {
        NODE_ENV: 'development',
      },
    },
  ],
}
