#!/usr/bin/env node
/**
 * Erstellt meta-showroom-{version}-win-x64.zip fuer IT-Rollout.
 * Auf Windows-Referenzrechner ausfuehren nach npm install && npm run build.
 *
 *   node scripts/package-windows.mjs
 *   npm run package:win
 */
import { spawnSync, execSync } from 'node:child_process'
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const ROOT = resolve(__dirname, '..')
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
const VERSION = pkg.version || '1.0.0'
const OUT_NAME = `meta-showroom-${VERSION}-win-x64`
const STAGE = join(ROOT, 'release', OUT_NAME)
const ZIP_PATH = join(ROOT, 'release', `${OUT_NAME}.zip`)

/** Verzeichnisse/Dateien die nicht ins IT-Paket gehoeren */
const EXCLUDE_DIRS = new Set([
  'node_modules/.cache',
  '.git',
  '.cursor',
  'release',
  'logs',
  '__pycache__',
  '.venv',
  'venv',
  'outputs',
  'dist', // wird separat kopiert nach build
])

/** Dateimuster die ausgelassen werden */
const EXCLUDE_FILES = /\.(log|DS_Store)$/i

function shouldSkip(relPath) {
  const norm = relPath.replace(/\\/g, '/')
  if (EXCLUDE_FILES.test(norm)) return true
  for (const ex of EXCLUDE_DIRS) {
    if (norm === ex || norm.startsWith(`${ex}/`) || norm.includes(`/${ex}/`)) return true
  }
  return false
}

function copyTree(src, dest, base = src) {
  if (shouldSkip(relative(base, src))) return
  const st = lstatSync(src)
  if (st.isSymbolicLink()) {
    const target = readlinkSync(src)
    const resolved = resolve(src, '..', target)
    copyTree(resolved, dest, base)
    return
  }
  if (st.isDirectory()) {
    mkdirSync(dest, { recursive: true })
    for (const name of readdirSync(src)) {
      copyTree(join(src, name), join(dest, name), base)
    }
    return
  }
  if (st.isFile()) {
    mkdirSync(resolve(dest, '..'), { recursive: true })
    cpSync(src, dest)
  }
}

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', ...opts })
  if (r.status !== 0) process.exit(r.status ?? 1)
}

function ensureBuild() {
  if (!existsSync(join(ROOT, 'dist', 'index.html'))) {
    console.log('dist/ fehlt – fuehre npm run build aus...')
    // Windows: npm ist npm.cmd – spawnSync ohne shell wirft EINVAL (Node 20.12+).
    run('npm', ['run', 'build'], { cwd: ROOT, shell: process.platform === 'win32' })
  }
}

function ensureBlenderExporter() {
  const be = join(ROOT, 'blender-exporter', 'blender-mcp-converter', 'api-gateway', 'package.json')
  if (!existsSync(be)) {
    console.error(
      'FEHLER: blender-exporter/blender-mcp-converter nicht gefunden.\n' +
        'Lege den Converter als Unterordner ab oder erstelle eine Junction vor dem Packaging.',
    )
    process.exit(1)
  }
}

function stageFiles() {
  console.log(`Staging nach ${STAGE}...`)
  if (existsSync(STAGE)) rmSync(STAGE, { recursive: true, force: true })
  mkdirSync(STAGE, { recursive: true })

  const includeRoots = [
    'dist',
    'node_modules',
    'electron',
    'scripts',
    'public',
    'src',
    'tools',
    'docs',
    'blender-exporter',
    'index.html',
    'dashboard.html',
    'converter.html',
    'package.json',
    'package-lock.json',
    'vite.config.js',
    'ecosystem.config.cjs',
    'glb-export-config.json',
    'product_database.xlsx',
    'README.md',
    'README-windows.md',
    'install-windows.ps1',
    'start-showroom.cmd',
    'stop-showroom.cmd',
  ]

  for (const item of includeRoots) {
    const src = join(ROOT, item)
    if (!existsSync(src)) {
      console.warn(`  uebersprungen (fehlt): ${item}`)
      continue
    }
    const dest = join(STAGE, item)
    console.log(`  + ${item}`)
    copyTree(src, dest, src)
  }

  // IT-Hinweis ins Paket
  writeFileSync(
    join(STAGE, 'IT-INSTALL.txt'),
    [
      'META Showroom – IT-Installation',
      '================================',
      '',
      '1. Drittsoftware installieren (Node 20+, Python 3.10+, Blender 4.x, Memurai)',
      '2. ZIP nach C:\\meta\\showroom entpacken',
      '3. powershell -ExecutionPolicy Bypass -File install-windows.ps1 -Unattended',
      '',
      'Details: docs\\windows-it-rollout.md',
      '',
    ].join('\r\n'),
    'utf8',
  )
}

function createZip() {
  mkdirSync(join(ROOT, 'release'), { recursive: true })
  if (existsSync(ZIP_PATH)) rmSync(ZIP_PATH)

  if (process.platform === 'win32') {
    run(
      'powershell',
      [
        '-NoProfile',
        '-Command',
        `Compress-Archive -Path '${STAGE.replace(/'/g, "''")}\\*' -DestinationPath '${ZIP_PATH.replace(/'/g, "''")}' -Force`,
      ],
      { cwd: ROOT },
    )
  } else {
    try {
      execSync(`cd "${join(ROOT, 'release')}" && zip -r -q "${OUT_NAME}.zip" "${OUT_NAME}"`, {
        stdio: 'inherit',
      })
    } catch {
      console.warn('zip-Befehl fehlgeschlagen – Staging-Ordner bleibt unter release/')
      return
    }
  }

  const sizeMb = (statSync(ZIP_PATH).size / (1024 * 1024)).toFixed(1)
  console.log(`\nFertig: ${ZIP_PATH} (${sizeMb} MB)`)
}

function main() {
  console.log(`META Showroom Windows-Paket v${VERSION}\n`)
  ensureBlenderExporter()
  ensureBuild()
  stageFiles()
  createZip()
  console.log('\nAn IT liefern: ZIP + Drittsoftware-Installer + docs/windows-it-rollout.md')
}

main()
