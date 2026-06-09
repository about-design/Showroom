import { defineConfig } from 'vite'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { execFileSync } from 'child_process'
import { existsSync, rmSync } from 'fs'
import { platform } from 'os'
import tailwindcss from '@tailwindcss/vite'
import { dashboardApi } from './scripts/vite-plugin/dashboardApi.mjs'
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

export default defineConfig({
  plugins: [forceCleanDistPlugin(), tailwindcss(), dashboardApi()],
  publicDir: 'public',
  server: {
    port: 5050,
    strictPort: false,
    // Nur lokal binden – die /__api/*-Endpoints sind unauthentifiziert und
    // dürfen nicht aus dem LAN erreichbar sein. Für bewussten LAN-Zugriff
    // explizit via `vite --host` oder SHOWROOM_HOST=0.0.0.0 überschreiben.
    host: process.env.SHOWROOM_HOST || '127.0.0.1',
    // Beim Start Root öffnen = Showroom (index.html), nicht Port 3000 (Converter-API).
    open: '/',
    proxy: {
      '/api': { target: 'http://localhost:3000', changeOrigin: true },
      '/outputs': { target: 'http://localhost:3000', changeOrigin: true },
    },
    watch: {
      ignored: [
        '**/public/**',
        '**/src/data/products.json',
        '**/src/data/cad-index.json',
      ],
    },
  },
  preview: {
    port: 5050,
    strictPort: false,
    host: process.env.SHOWROOM_HOST || '127.0.0.1',
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
