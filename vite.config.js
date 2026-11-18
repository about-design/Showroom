import { defineConfig } from 'vite'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { execFileSync } from 'child_process'
import { existsSync, rmSync, readFileSync } from 'fs'
import { platform } from 'os'
import tailwindcss from '@tailwindcss/vite'
import { dashboardApi } from './scripts/vite-plugin/dashboardApi.mjs'
import { onlinePublicAssetsPlugin } from './scripts/vite-plugin/onlinePublicAssets.mjs'
import { localPublicAssetsPlugin } from './scripts/vite-plugin/localPublicAssets.mjs'
import { createLogger } from './scripts/lib/logger.mjs'

const log = createLogger('vite')

const __dirname = typeof import.meta.dirname !== 'undefined'
  ? import.meta.dirname
  : dirname(fileURLToPath(import.meta.url))

/** Vite-internes emptyDir kann auf manchen Volumes (z. B. externe HDD) mit ENOTEMPTY scheitern — dist vorher komplett löschen. */
function forceCleanDistPlugin() {
  return {
    name: 'force-clean-dist',
    apply: 'build',
    enforce: 'pre',
    buildStart() {
      const dist = resolve(__dirname, 'dist')
      if (!existsSync(dist)) return
      if (platform() !== 'win32') {
        try {
          execFileSync('/bin/rm', ['-rf', dist], { stdio: 'pipe' })
          return
        } catch (e) {
          log.warn('[vite] /bin/rm -rf dist fehlgeschlagen:', e?.message || e)
        }
      }
      try {
        rmSync(dist, { recursive: true, force: true })
      } catch (e) {
        log.warn('[vite] dist konnte nicht vollständig gelöscht werden:', e?.message || e)
      }
    },
  }
}

const isOnlineBuild = process.env.VITE_ONLINE_BUILD === '1'

/** App-Version für die Anzeige im Header: package.json + Git-Commit + Start-/Build-Zeit. */
function resolveAppVersionInfo() {
  let pkgVersion = '0.0.0'
  try {
    pkgVersion = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf-8')).version || pkgVersion
  } catch {}
  let commit = ''
  try {
    commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      cwd: __dirname,
      stdio: ['ignore', 'pipe', 'pipe'],
    }).toString().trim()
  } catch {}
  return { pkgVersion, commit, buildTime: new Date().toISOString() }
}
const appVersionInfo = resolveAppVersionInfo()

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(appVersionInfo.pkgVersion),
    __APP_COMMIT__: JSON.stringify(appVersionInfo.commit),
    __APP_BUILD_TIME__: JSON.stringify(appVersionInfo.buildTime),
  },
  plugins: [
    forceCleanDistPlugin(),
    tailwindcss(),
    dashboardApi(),
    onlinePublicAssetsPlugin(),
    localPublicAssetsPlugin(),
  ],
  // Online-Build: keine lokalen Modelle (CDN via VITE_ASSET_BASE_URL).
  // Lokaler Build: localPublicAssetsPlugin schaltet publicDir für den Build ab und
  // kopiert public/ gefiltert (ohne CAD-Quellen) — im Dev-Server bleibt es aktiv.
  publicDir: isOnlineBuild ? false : 'public',
  server: {
    port: 5050,
    strictPort: false,
    // Entwicklungsdateien niemals aus dem Browsercache verwenden; Vite-HMR
    // bleibt dadurch nach Änderungen in src der maßgebliche Aktualisierungspfad.
    headers: {
      'Cache-Control': 'no-store',
    },
    // Nur lokal binden – die /__api/*-Endpoints sind unauthentifiziert und
    // dürfen nicht aus dem LAN erreichbar sein. Für bewussten LAN-Zugriff
    // explizit via `vite --host` oder SHOWROOM_HOST=0.0.0.0 überschreiben.
    host: process.env.SHOWROOM_HOST || '127.0.0.1',
    // Browser-Öffnung wird über das Start-Skript gesteuert, damit beim Start
    // nicht doppelte Tabs im Browser entstehen.
    open: false,
    proxy: {
      '/api': { target: 'http://localhost:3000', changeOrigin: true },
      '/outputs': { target: 'http://localhost:3000', changeOrigin: true },
    },
    watch: {
      // ZuverlÃ¤ssige Ã„nderungserkennung auf Windows-/externen Laufwerken.
      // Ohne Polling kann der laufende Vite-Prozess Ã„nderungen in src Ã¼bersehen;
      // dann bleibt im Browser der alte Event-Handler aktiv, bis F5 geladen wird.
      usePolling: true,
      interval: 250,
      ignored: [
        '**/dist/**', // Build output is replaced during builds; watching it can fail with EBUSY on Windows.
        '**/public/**',
        '**/src/data/products.json',
        '**/src/data/cad-index.json',
        // Generierte Ableitung von products.json (bei jedem Speichern neu geschrieben,
        // siehe scripts/lib/publicProducts.mjs). Ohne diesen Eintrag löst jedes einzelne
        // Speichern einen Vite-Full-Reload auf ALLEN verbundenen Tabs aus – killt damit
        // z. B. die Konvertierungs-Queue im Dashboard nach dem ersten Produkt.
        '**/src/data/products.public.json',
      ],
    },
  },
  preview: {
    port: 5050,
    strictPort: true,
    host: process.env.SHOWROOM_HOST || '127.0.0.1',
    // Auch die lokale Preview darf keinen alten HTML-/JavaScript-Stand liefern.
    headers: {
      'Cache-Control': 'no-store',
    },
    proxy: {
      '/api': { target: 'http://localhost:3000', changeOrigin: true },
      '/outputs': { target: 'http://localhost:3000', changeOrigin: true },
    },
  },
  build: {
    // Auf manchen externen Volumes schlägt Vites emptyDir(…) mit ENOTEMPTY fehl — dann bleibt alter dist-Inhalt;
    // Pre-Plugin oben versucht /bin/rm -rf. Wenn das auch scheitert, verhindert false hier den zweiten Abbruch.
    emptyOutDir: false,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        dashboard: resolve(__dirname, 'dashboard.html'),
        converter: resolve(__dirname, 'converter.html'),
      },
    },
  },
})
