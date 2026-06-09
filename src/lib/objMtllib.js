/**
 * Liest und ersetzt die erste Wavefront-OBJ-Zeile "mtllib …".
 * Mehrere Materialbibliotheken: Wert ist der Rest der Zeile (z. B. "a.mtl b.mtl").
 */

/**
 * @param {string} content
 * @returns {string | null} Rest der ersten mtllib-Zeile (getrimmt), oder null
 */
export function getMtllibFromObjContent(content) {
  const lines = String(content || '').split(/\r?\n/)
  if (lines.length && lines[lines.length - 1] === '') lines.pop()
  for (const line of lines) {
    const m = line.match(/^\s*mtllib\s+(.+?)\s*$/i)
    if (m) return m[1].trim() || null
  }
  return null
}

/**
 * Ersetzt die erste mtllib-Zeile oder fügt vor der ersten „Daten“-Zeile ein.
 * @param {string} content
 * @param {string} mtllibValue z. B. "170830.mtl" oder "a.mtl b.mtl"
 * @returns {string}
 */
export function setMtllibInObjContent(content, mtllibValue) {
  const raw = String(mtllibValue ?? '').trim()
  if (!raw) throw new Error('mtllib-Angabe darf nicht leer sein')
  if (raw.includes('..')) throw new Error('„..“ in mtllib ist nicht erlaubt')

  const lines = String(content || '').split(/\r?\n/)
  if (lines.length && lines[lines.length - 1] === '') lines.pop()

  const out = []
  let replaced = false
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!replaced && /^\s*mtllib\b/i.test(line)) {
      out.push(`mtllib ${raw}`)
      replaced = true
      continue
    }
    out.push(line)
  }

  if (!replaced) {
    const firstDataIdx = lines.findIndex((l) => {
      const t = l.trim()
      if (!t || t.startsWith('#')) return false
      return true
    })
    const insertIdx = firstDataIdx < 0 ? out.length : firstDataIdx
    out.splice(insertIdx, 0, `mtllib ${raw}`)
  }

  const body = out.join('\n')
  if (!body.length) return `mtllib ${raw}\n`
  return body.endsWith('\n') ? body : `${body}\n`
}
