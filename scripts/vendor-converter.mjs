#!/usr/bin/env node
/**
 * Kopiert das Blender-MCP-Konverter-Projekt ins Repo (vendor/), damit Docker
 * einen self-contained Build-Context hat (Symlinks nach außen funktionieren nicht).
 *
 * Quelle (Priorität):
 *   1. CONVERTER_SOURCE=/abs/path/to/blender-mcp-converter
 *   2. blender-exporter-Symlink → …/blender-mcp-converter
 */
import { mkdir, readlink, rm, stat } from 'fs/promises'
import { execFileSync } from 'child_process'
import { dirname, join, resolve } from 'path'
import { fileURLToPath } from 'url'
import { createLogger } from './lib/logger.mjs'

const log = createLogger('vendor-converter')

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const DEST = join(ROOT, 'vendor', 'blender-mcp-converter')

async function resolveConverterSource() {
  if (process.env.CONVERTER_SOURCE) {
    return resolve(process.env.CONVERTER_SOURCE)
  }
  const linkPath = join(ROOT, 'blender-exporter')
  try {
    const st = await stat(linkPath)
    if (st.isSymbolicLink()) {
      const target = await readlink(linkPath)
      return resolve(ROOT, target, 'blender-mcp-converter')
    }
    if (st.isDirectory()) {
      const nested = join(linkPath, 'blender-mcp-converter')
      await stat(nested)
      return nested
    }
  } catch {
    /* fall through */
  }
  throw new Error(
    'Konverter-Quelle nicht gefunden. Setze CONVERTER_SOURCE oder lege den Symlink blender-exporter an.',
  )
}

async function main() {
  const src = await resolveConverterSource()
  await stat(src)
  await rm(DEST, { recursive: true, force: true })
  await mkdir(join(ROOT, 'vendor'), { recursive: true })

  const excludes = [
    'node_modules',
    'venv',
    'outputs',
    'test-output',
    'logs',
    'frontend',
    'deploy',
    '__pycache__',
    '.git',
    '.DS_Store',
    '*.log',
    'deploy/webserver-deploy-*.zip',
    '*.zip',
  ]

  const args = ['-a']
  for (const ex of excludes) args.push('--exclude', ex)
  args.push(`${src}/`, `${DEST}/`)

  log.info(`Kopiere Konverter: ${src} → ${DEST}`)
  execFileSync('rsync', args, { stdio: 'inherit' })
  log.info('Fertig.')
}

main().catch((e) => {
  log.error(e.message || e)
  process.exit(1)
})
