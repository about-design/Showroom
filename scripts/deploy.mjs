#!/usr/bin/env node
import { createLogger } from './lib/logger.mjs'
const log = createLogger("deploy")

/**
 * Production build and deploy preparation for META Showroom.
 * 1. Runs vite build
 * 2. Verifies dist/ output (HTML, ralColors.json, optional models)
 * 3. Optional: pass --upload=netlify|gh-pages|rsync for deploy (extend as needed)
 *
 * Usage:
 *   node scripts/deploy.mjs
 *   node scripts/deploy.mjs --upload=netlify
 *   node scripts/deploy.mjs --dry-run
 */
import { spawnSync } from 'child_process'
import { readdir, access } from 'fs/promises'
import { join, resolve } from 'path'
import { fileURLToPath } from 'url'

const __dirname = resolve(fileURLToPath(import.meta.url), '..')
const ROOT = resolve(__dirname, '..')
const DIST = join(ROOT, 'dist')

function log(msg) { log.info(msg) }
function warn(msg) { log.scoped("WARN").warn("", msg) }
function err(msg) { log.scoped("ERROR").error("", msg) }

async function exists(p) {
  try { await access(p); return true } catch { return false }
}

async function findGlbs(dir, rel = '') {
  const results = []
  try {
    const entries = await readdir(dir, { withFileTypes: true })
    for (const e of entries) {
      const childRel = rel ? `${rel}/${e.name}` : e.name
      const full = join(dir, e.name)
      if (e.isDirectory()) {
        results.push(...(await findGlbs(full, childRel)))
      } else if (e.isFile() && e.name.toLowerCase().endsWith('.glb')) {
        results.push(childRel)
      }
    }
  } catch (_) {}
  return results
}

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', cwd: ROOT, ...opts })
  return { ok: r.status === 0, stdout: r.stdout || '', stderr: r.stderr || '' }
}

async function main() {
  const args = process.argv.slice(2)
  const dryRun = args.includes('--dry-run')
  const uploadArg = args.find(a => a.startsWith('--upload='))
  const uploadTarget = uploadArg ? uploadArg.split('=')[1] : null

  log('META Showroom – Deploy (static build)\n')

  if (dryRun) {
    log('Dry-run: nur dist/ prüfen (kein Build).\n')
  }

  // 1. Build (skip when dry-run)
  if (!dryRun) {
    log('1. Building...')
    const { ok: buildOk } = run('npm', ['run', 'build'], { stdio: 'inherit' })
    if (!buildOk) {
      err('Build fehlgeschlagen.')
      process.exit(1)
    }
    log('   Build OK.\n')
  }

  // 2. Verify dist/
  log('2. Verifying dist/...')
  const required = [
    join(DIST, 'index.html'),
    join(DIST, 'dashboard.html'),
    join(DIST, 'converter.html'),
    join(DIST, 'ralColors.json'),
  ]
  let missing = []
  for (const p of required) {
    if (!(await exists(p))) missing.push(p.replace(ROOT + '/', ''))
  }
  if (missing.length) {
    err('Fehlende Dateien: ' + missing.join(', '))
    process.exit(1)
  }
  log('   Required files OK.')

  const modelsDir = join(DIST, 'models')
  const glbs = await findGlbs(modelsDir)
  if (glbs.length > 0) {
    log(`   Models: ${glbs.length} GLB-Datei(en) in dist/models/`)
  } else {
    warn('   Keine GLB-Dateien in dist/models/ – öffentliche Modelle werden aus public/models kopiert; prüfe ob public/models Inhalt hat.')
  }

  log('\n3. Deploy-Ziel: ' + (uploadTarget || 'keins (dist/ ist bereit zum manuellen Upload)'))
  if (dryRun) {
    log('   (Dry-run: kein Upload)')
  }

  if (uploadTarget === 'netlify') {
    const { ok } = run('npx', ['netlify', 'deploy', '--dir=dist', '--prod'], { stdio: 'inherit' })
    if (!ok) { err('Netlify deploy fehlgeschlagen.'); process.exit(1) }
  } else if (uploadTarget === 'gh-pages') {
    const { ok } = run('npx', ['gh-pages', '-d', 'dist'], { stdio: 'inherit' })
    if (!ok) { err('gh-pages deploy fehlgeschlagen.'); process.exit(1) }
  } else if (uploadTarget === 'rsync') {
    const dest = process.env.DEPLOY_RSYNC_DEST || 'user@server:/var/www/showroom/'
    log('   Führe rsync aus (setze DEPLOY_RSYNC_DEST für Ziel)...')
    const { ok } = run('rsync', ['-avz', '--delete', 'dist/', dest], { stdio: 'inherit' })
    if (!ok) { err('rsync fehlgeschlagen.'); process.exit(1) }
  } else if (uploadTarget) {
    warn(`   Unbekanntes Ziel "${uploadTarget}". Unterstützt: netlify, gh-pages, rsync`)
  }

  log('\nFertig. Statischer Inhalt liegt in dist/.')
}

main().catch(e => {
  err(e.message)
  process.exit(1)
})
