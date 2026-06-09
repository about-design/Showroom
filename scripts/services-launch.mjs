#!/usr/bin/env node
import { createLogger } from './lib/logger.mjs'
const log = createLogger("services-launch")

/**
 * Startet den Showroom-Stack über pm2 – robust gegen Leerzeichen im Pfad.
 *
 * Hintergrund: pm2 wrappt Scripts intern in `bash -c "<path>"` ohne zu
 * escapen. Da unser Projektpfad Leerzeichen enthält ("/Volumes/My Passport/…"),
 * schlägt das fehl. Workaround: wir legen einen Symlink im Home-Verzeichnis
 * an (`~/.meta-showroom`) und starten pm2 mit diesem leerzeichen-freien Pfad
 * als cwd. pm2 interpoliert den cwd in den bash-Aufruf, sodass bash die
 * Datei findet.
 *
 * Unterstützte Actions:
 *   start    – Pre-Flight + Symlink + pm2 start
 *   stop     – pm2 stop
 *   restart  – pm2 restart (ohne reload)
 *   reload   – pm2 reload (zero-downtime)
 *   status   – pm2 status
 *   logs     – pm2 logs (streaming)
 *   delete   – pm2 delete
 *   save     – pm2 save (für Boot-Persistenz)
 *   startup  – pm2 startup (gibt sudo-Befehl aus)
 */
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve, join } from 'node:path'
import { homedir } from 'node:os'
import { existsSync, lstatSync, realpathSync, unlinkSync, symlinkSync } from 'node:fs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const SYMLINK = join(homedir(), '.meta-showroom')
const ECOSYSTEM = 'ecosystem.config.cjs'
const PM2_BIN = join(ROOT, 'node_modules', '.bin', process.platform === 'win32' ? 'pm2.cmd' : 'pm2')

if (!existsSync(PM2_BIN)) {
  log.error(`[services] pm2 nicht gefunden unter ${PM2_BIN}. Bitte \`npm install\` ausführen.`)
  process.exit(1)
}

function ensureSymlink() {
  if (process.platform === 'win32') {
    // Windows hat kein identisches Problem; pm2 nutzt dort keinen bash-Wrapper.
    return ROOT
  }
  try {
    if (existsSync(SYMLINK)) {
      const stat = lstatSync(SYMLINK)
      if (stat.isSymbolicLink()) {
        const tgt = realpathSync(SYMLINK)
        if (tgt === realpathSync(ROOT)) return SYMLINK
        unlinkSync(SYMLINK)
      } else {
        log.error(
          `[services] Pfad ${SYMLINK} existiert und ist kein Symlink. ` +
          'Bitte manuell entfernen oder umbenennen.',
        )
        process.exit(1)
      }
    }
    symlinkSync(ROOT, SYMLINK)
    log.info(`[services] Symlink angelegt: ${SYMLINK} -> ${ROOT}`)
    return SYMLINK
  } catch (e) {
    log.warn(`[services] Symlink konnte nicht angelegt werden (${e.message}). Fallback auf ${ROOT}.`)
    return ROOT
  }
}

function preflight() {
  const preflightScript = join(ROOT, 'scripts', 'start-services.mjs')
  const r = spawnSync(process.execPath, [preflightScript], { cwd: ROOT, stdio: 'inherit' })
  if (r.status !== 0) {
        log.scoped("services").error("Pre-Flight fehlgeschlagen.")
    process.exit(r.status ?? 1)
  }
}

function pm2(args, { cwd = ROOT, interactive = false } = {}) {
  return new Promise((res) => {
    const child = spawn(PM2_BIN, args, {
      cwd,
      stdio: 'inherit',
      env: { ...process.env },
    })
    child.on('exit', (code) => res(code ?? 0))
    child.on('error', (e) => {
            log.scoped("services").error("pm2-Fehler:", e.message)
      res(1)
    })
    if (interactive) {
      for (const sig of ['SIGINT', 'SIGTERM']) {
        process.on(sig, () => { try { child.kill(sig) } catch {} })
      }
    }
  })
}

async function main() {
  const action = process.argv[2] || 'start'
  const cwd = action === 'start' ? ensureSymlink() : ROOT

  switch (action) {
    case 'start':
      preflight()
      process.exit(await pm2(['start', ECOSYSTEM], { cwd }))
      break
    case 'stop':
      process.exit(await pm2(['stop', ECOSYSTEM], { cwd }))
      break
    case 'restart':
      process.exit(await pm2(['restart', ECOSYSTEM], { cwd: ensureSymlink() }))
      break
    case 'reload':
      process.exit(await pm2(['reload', ECOSYSTEM], { cwd: ensureSymlink() }))
      break
    case 'status':
      process.exit(await pm2(['status']))
      break
    case 'logs':
      process.exit(await pm2(['logs'], { interactive: true }))
      break
    case 'delete':
      process.exit(await pm2(['delete', ECOSYSTEM], { cwd }))
      break
    case 'save':
      process.exit(await pm2(['save']))
      break
    case 'startup':
      process.exit(await pm2(['startup']))
      break
    default:
            log.error(`[services] Unbekannte Action: ${action}`)
            log.error('  start | stop | restart | reload | status | logs | delete | save | startup')
      process.exit(1)
  }
}

main()
