#!/usr/bin/env node
/**
 * Ersetzt console.* durch createLogger (src: logger.js, scripts: logger.mjs).
 *   node scripts/migrate-console-to-logger.mjs           # dry-run + logs/migration-report.json
 *   node scripts/migrate-console-to-logger.mjs --apply  # schreibt Dateien
 *
 * Überspringt: node_modules, dist, release, public, blender-exporter, *.cjs, Logger-Module.
 */
import { readdir, readFile, writeFile, mkdir, stat } from 'node:fs/promises'
import { join, relative, dirname, basename, extname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const APPLY = process.argv.includes('--apply')

const SKIP_REL = new Set([
  'src/lib/logger.js',
  'src/lib/loggerInit.js',
  'scripts/lib/logger.mjs',
  'scripts/migrate-console-to-logger.mjs',
  'scripts/logs-tail.mjs',
  'scripts/logs-clear.mjs',
  'vite.config.js',
])

const SKIP_DIR = new Set(['node_modules', 'dist', 'release', 'public', 'blender-exporter', '.git'])

const METHOD_MAP = {
  log: 'info',
  info: 'info',
  warn: 'warn',
  error: 'error',
  debug: 'debug',
  trace: 'trace',
}

/** @returns {number} */
function findClosingParen(src, openIdx) {
  let depth = 0
  let inStr = /** @type {string|null} */ (null)
  let escaped = false
  let tplDepth = 0
  for (let i = openIdx; i < src.length; i++) {
    const c = src[i]
    if (inStr === '`') {
      if (escaped) {
        escaped = false
        continue
      }
      if (c === '\\') {
        escaped = true
        continue
      }
      if (c === '$' && src[i + 1] === '{') {
        tplDepth++
        i++
        continue
      }
      if (c === '}' && tplDepth > 0) {
        tplDepth--
        continue
      }
      if (c === '`' && tplDepth === 0) {
        inStr = null
        continue
      }
      continue
    }
    if (inStr) {
      if (escaped) {
        escaped = false
        continue
      }
      if (c === '\\') {
        escaped = true
        continue
      }
      if (c === inStr) inStr = null
      continue
    }
    if (c === '"' || c === "'" || c === '`') {
      inStr = c
      escaped = false
      tplDepth = 0
      continue
    }
    if (c === '(') depth++
    else if (c === ')') {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

const BRACKET = /^\[([^\]]+)\]\s*(.*)$/

/**
 * @param {string} inner
 * @returns {{ kind: 'plain', args: string } | { kind: 'scoped', tag: string, args: string } | { kind: 'skip', reason: string }}
 */
function rewriteInner(inner) {
  const t = inner.trim()
  if (!t) return { kind: 'plain', args: '' }
  let i = 0
  while (i < t.length && /\s/.test(t[i])) i++
  const q = t[i]
  if (q !== '"' && q !== "'") {
    if (q === '`') return { kind: 'skip', reason: 'leading-template' }
    return { kind: 'plain', args: inner }
  }
  let j = i + 1
  let decoded = ''
  while (j < t.length) {
    const ch = t[j]
    if (ch === '\\') {
      const n = t[j + 1]
      if (n === undefined) return { kind: 'skip', reason: 'bad-escape' }
      decoded += n
      j += 2
      continue
    }
    if (ch === q) break
    decoded += ch
    j++
  }
  if (j >= t.length || t[j] !== q) return { kind: 'skip', reason: 'unclosed-string' }
  const after = t.slice(j + 1)
  const afterTrim = after.trim()
  const hasComma = afterTrim.startsWith(',')
  const tail = hasComma ? afterTrim.slice(1).trim() : afterTrim

  const bm = decoded.match(BRACKET)
  if (!bm) return { kind: 'plain', args: inner.trimEnd() }

  const tag = bm[1].replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80) || 'tag'
  const msg = bm[2] ?? ''
  const first = JSON.stringify(msg)
  const args = tail ? `${first}, ${tail}` : first
  return { kind: 'scoped', tag, args }
}

function importLine(rel) {
  const p = importPathFrom(rel)
  return `import { createLogger } from '${p}'`
}

function importPathFrom(rel) {
  const fromDir = dirname(rel)
  const target = rel.startsWith('src/') ? 'src/lib/logger.js' : 'scripts/lib/logger.mjs'
  let r = relative(fromDir, target).replace(/\\/g, '/')
  if (!r.startsWith('.')) r = `./${r}`
  return r
}

function defaultScope(rel) {
  return basename(rel, extname(rel))
}

function hasLoggerImport(src) {
  return /from\s+['"][^'"]*\/lib\/logger\.(js|mjs)['"]/.test(src) ||
    /from\s+['"][^'"]*logger\.mjs['"]/.test(src)
}

/** Bereits createLogger(…)-Aufruf (z. B. httpLog) → kein zweites `const log` */
function hasAnyCreateLoggerBinding(src) {
  return /createLogger\s*\(/.test(src)
}

/**
 * @param {string} rel
 * @param {string} content
 */
function migrateContent(rel, content) {
  const defScope = defaultScope(rel)
  const multiline = []
  const re = /console\.(log|info|warn|error|debug|trace)\s*\(/g
  let last = 0
  let out = ''
  let mm
  while ((mm = re.exec(content)) !== null) {
    const start = mm.index
    out += content.slice(last, start)
    const rawMethod = mm[1]
    const method = METHOD_MAP[rawMethod] || 'info'
    const openParen = start + mm[0].length - 1
    const close = findClosingParen(content, openParen)
    const lineStart = content.lastIndexOf('\n', start) + 1
    let indent = content.slice(lineStart, start)
    if (!/^[\t ]*$/.test(indent)) indent = ''
    if (close < 0) {
      multiline.push({ rel, reason: 'unbalanced-paren', at: start })
      out += content.slice(start)
      break
    }
    const inner = content.slice(openParen + 1, close)
    if (inner.includes('\n')) {
      multiline.push({ rel, reason: 'multiline-args', at: start })
      out += content.slice(start, close + 1)
      last = close + 1
      re.lastIndex = last
      continue
    }
    const rw = rewriteInner(inner)
    let replacement
    if (rw.kind === 'skip') {
      multiline.push({ rel, reason: rw.reason, inner: inner.slice(0, 80) })
      replacement = `${indent}log.${method}(${inner.trim()})`
    } else if (rw.kind === 'scoped') {
      replacement = `${indent}log.scoped(${JSON.stringify(rw.tag)}).${method}(${rw.args})`
    } else {
      replacement = `${indent}log.${method}(${rw.args})`
    }
    let end = close + 1
    if (content[end] === ';') end++
    out += replacement + (content[close + 1] === ';' ? ';' : '')
    last = end
    re.lastIndex = last
  }
  out += content.slice(last)

  if (!hasLoggerImport(out)) {
    const imp = `${importLine(rel)}\n`
    const shebang = out.startsWith('#!') ? out.indexOf('\n') + 1 : 0
    let insertAt = 0
    if (shebang > 0) insertAt = shebang
    else if (out.startsWith('/**')) {
      const endBlock = out.indexOf('*/')
      if (endBlock !== -1) insertAt = endBlock + 2
    }
    if (insertAt > 0) {
      const rest = out.slice(insertAt).replace(/^\s*\n/, '\n')
      out = out.slice(0, insertAt) + (out[insertAt - 1] === '\n' ? '' : '\n') + imp + rest.replace(/^\n+/, '\n')
    } else {
      out = imp + out
    }
  }
  if (!hasAnyCreateLoggerBinding(out)) {
    const line = `const log = createLogger(${JSON.stringify(defScope)})\n`
    const mImp = out.match(/import\s*\{[^}]*createLogger[^}]*\}\s*from\s*['"][^'"]+['"]/)
    if (mImp) {
      const ii = mImp.index + mImp[0].length
      out = out.slice(0, ii) + '\n' + line + out.slice(ii)
    } else {
      out = line + out
    }
  }
  return { out, multiline }
}

async function walk(dir, baseRel, files) {
  const entries = await readdir(dir, { withFileTypes: true })
  for (const e of entries) {
    if (SKIP_DIR.has(e.name)) continue
    const abs = join(dir, e.name)
    const rel = join(baseRel, e.name).replace(/\\/g, '/')
    if (e.isDirectory()) await walk(abs, rel, files)
    else if (e.isFile()) {
      if (!/\.(mjs|js)$/.test(e.name)) continue
      if (e.name.endsWith('.cjs')) continue
      if (SKIP_REL.has(rel)) continue
      files.push(rel)
    }
  }
}

async function main() {
  const files = []
  await walk(join(ROOT, 'src'), 'src', files)
  await walk(join(ROOT, 'scripts'), 'scripts', files)

  const report = { apply: APPLY, changed: [], multiline: [], unchanged: [] }
  await mkdir(join(ROOT, 'logs'), { recursive: true }).catch(() => {})

  for (const rel of files.sort()) {
    const abs = join(ROOT, rel)
    const raw = await readFile(abs, 'utf-8')
    if (!/console\.(log|info|warn|error|debug|trace)\s*\(/.test(raw)) {
      report.unchanged.push(rel)
      continue
    }
    const { out, multiline } = migrateContent(rel, raw)
    for (const x of multiline) report.multiline.push(x)
    if (out !== raw) {
      report.changed.push(rel)
      if (APPLY) await writeFile(abs, out, 'utf-8')
    }
  }

  await writeFile(join(ROOT, 'logs', 'migration-report.json'), JSON.stringify(report, null, 2), 'utf-8')
  console.log(APPLY ? 'APPLY: Dateien geschrieben.' : 'Dry-run: keine Dateien geändert (nutze --apply).')
  console.log('Geändert:', report.changed.length, '| Multiline/Skip-Hinweise:', report.multiline.length)
  console.log('Bericht: logs/migration-report.json')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
