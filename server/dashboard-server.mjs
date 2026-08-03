#!/usr/bin/env node
/**
 * Standalone Dashboard-API-Server für Produktion / Docker.
 * Registriert /__api/* (registerDashboardApi) und optional statische dist/-Dateien.
 */
import http from 'node:http'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import connect from 'connect'
import serveStatic from 'serve-static'
import { registerDashboardApi } from '../scripts/vite-plugin/dashboardApi.mjs'
import { createLogger } from '../scripts/lib/logger.mjs'

const log = createLogger('dashboard-server')

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const PORT = Number(process.env.DASHBOARD_API_PORT || process.env.PORT || 5080)
const HOST = process.env.SHOWROOM_HOST || '0.0.0.0'
const DIST = resolve(ROOT, 'dist')
const PUBLIC = resolve(ROOT, 'public')
const publicOrigin = (process.env.SHOWROOM_ORIGIN || `http://127.0.0.1:${PORT}`).replace(/\/$/, '')

const app = connect()

registerDashboardApi(app, {
  root: ROOT,
  port: PORT,
  getServerOrigin: () => publicOrigin,
})

// Laufzeit-generierte/hochgeladene Assets (Thumbnails, Uploads) – im Online-Build
// nicht Teil von dist/, liegen aber hier im showroom-public-Volume.
app.use(serveStatic(PUBLIC))

// Statische Assets (Fallback wenn kein separater nginx-Web-Container)
app.use(serveStatic(DIST, { index: ['index.html', 'dashboard.html', 'converter.html'] }))

app.use((req, res) => {
  res.statusCode = 404
  res.setHeader('Content-Type', 'text/plain; charset=utf-8')
  res.end('Not found')
})

const server = http.createServer(app)

function shutdown() {
  server.close(() => {
    import('../scripts/thumbnail/headlessThumbnail.mjs')
      .then((m) => m.closeThumbnailBrowser?.())
      .catch(() => {})
      .finally(() => process.exit(0))
  })
}

server.listen(PORT, HOST, () => {
  log.info(`listening on http://${HOST}:${PORT} (origin=${publicOrigin})`)
})

server.on('close', () => {
  import('../scripts/thumbnail/headlessThumbnail.mjs')
    .then((m) => m.closeThumbnailBrowser?.())
    .catch(() => {})
})

process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
