#!/usr/bin/env node
/**
 * Minitool: Extrahiert alle Farben aus OBJ/MTL-Daten für Colormatching.
 * Standalone – keine Integration in die Showroom-App nötig.
 *
 * Nutzung:
 *   node tools/extract-mtl-colors.js <pfad-zur.mtl|pfad-zur.obj|ordner>
 *   node tools/extract-mtl-colors.js ./modelle  --format json
 *   node tools/extract-mtl-colors.js ./model.mtl --format hex
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const COLOR_KEYS = ['Ka', 'Kd', 'Ks', 'Ke']; // ambient, diffuse, specular, emissive
const LABELS = { Ka: 'ambient', Kd: 'diffuse', Ks: 'specular', Ke: 'emissive' };

function rgbToHex(r, g, b) {
  const to255 = (v) => Math.round(Math.max(0, Math.min(1, v)) * 255);
  return '#' + [to255(r), to255(g), to255(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

function parseMtl(content, sourcePath) {
  const materials = [];
  let current = null;
  const lines = content.split(/\r?\n/);

  for (const line of lines) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;

    if (t.startsWith('newmtl ')) {
      current = { name: t.slice(7).trim(), colors: [], source: sourcePath };
      materials.push(current);
      continue;
    }

    if (!current) continue;

    for (const key of COLOR_KEYS) {
      if (t.startsWith(key + ' ')) {
        const parts = t.slice(key.length).trim().split(/\s+/).map(Number);
        if (parts.length >= 3) {
          const [r, g, b] = parts;
          const hex = rgbToHex(r, g, b);
          current.colors.push({
            type: LABELS[key],
            r, g, b,
            r255: Math.round(r * 255),
            g255: Math.round(g * 255),
            b255: Math.round(b * 255),
            hex,
          });
        }
        break;
      }
    }
  }

  return materials;
}

function collectMtlPaths(inputPath) {
  const absolute = resolve(inputPath);
  const stat = statSync(absolute);
  const mtlPaths = new Set();

  if (stat.isFile()) {
    const lower = absolute.toLowerCase();
    if (lower.endsWith('.mtl')) {
      mtlPaths.add(absolute);
    } else if (lower.endsWith('.obj')) {
      const dir = dirname(absolute);
      const content = readFileSync(absolute, 'utf8');
      const mtlMatch = content.match(/mtllib\s+(.+)/);
      if (mtlMatch) {
        const mtlName = mtlMatch[1].trim().split(/\s+/)[0];
        mtlPaths.add(join(dir, mtlName));
      }
    }
  } else if (stat.isDirectory()) {
    const scan = (dir) => {
      for (const name of readdirSync(dir).sort((a, b) => a.localeCompare(b, 'en'))) {
        const full = join(dir, name);
        try {
          const s = statSync(full);
          if (s.isDirectory()) scan(full);
          else if (name.toLowerCase().endsWith('.mtl')) mtlPaths.add(full);
          else if (name.toLowerCase().endsWith('.obj')) {
            const content = readFileSync(full, 'utf8');
            const mtlMatch = content.match(/mtllib\s+(.+)/);
            if (mtlMatch) {
              const mtlName = mtlMatch[1].trim().split(/\s+/)[0];
              mtlPaths.add(join(dir, mtlName));
            }
          }
        } catch (_) {}
      }
    };
    scan(absolute);
  }

  return [...mtlPaths].sort((a, b) => a.localeCompare(b, 'en'));
}

function extractAll(inputPath) {
  const mtlPaths = collectMtlPaths(inputPath);
  const allMaterials = [];
  const uniqueColorsByHex = new Map(); // hex -> { hex, r, g, b, sources[] }

  for (const mtlPath of mtlPaths) {
    let content;
    try {
      content = readFileSync(mtlPath, 'utf8');
    } catch (e) {
      console.error('Lesen fehlgeschlagen:', mtlPath, e.message);
      continue;
    }
    const materials = parseMtl(content, mtlPath);
    for (const mat of materials) {
      allMaterials.push({ file: mtlPath, material: mat.name, colors: mat.colors });
      for (const c of mat.colors) {
        if (!uniqueColorsByHex.has(c.hex)) {
          uniqueColorsByHex.set(c.hex, {
            hex: c.hex,
            r: c.r255,
            g: c.g255,
            b: c.b255,
            type: c.type,
            sources: [],
          });
        }
        uniqueColorsByHex.get(c.hex).sources.push({ file: mtlPath, material: mat.name, type: c.type });
      }
    }
  }

  // Deterministische IDs: Palette nach Hex sortiert (unabhängig von Erstfund-Reihenfolge)
  for (const entry of uniqueColorsByHex.values()) {
    entry.sources.sort((a, b) => {
      const fa = `${a.file}\0${a.material}\0${a.type}`
      const fb = `${b.file}\0${b.material}\0${b.type}`
      return fa.localeCompare(fb, 'en')
    })
  }
  const uniqueColors = [...uniqueColorsByHex.values()]
    .sort((a, b) => a.hex.localeCompare(b.hex, 'en'))
    .map((c, i) => ({ id: i + 1, ...c }));
  const hexToId = new Map(uniqueColors.map((c) => [c.hex, c.id]));

  // Pro Material: jede Farbe mit colorId referenzieren (Mapping für euer Tool)
  allMaterials.sort((a, b) => {
    const fa = `${a.file}\0${a.material}`
    const fb = `${b.file}\0${b.material}`
    return fa.localeCompare(fb, 'en')
  })
  const materialsWithMapping = allMaterials.map(({ file, material, colors }) => ({
    file,
    material,
    colors: colors.map((c) => ({ ...c, colorId: hexToId.get(c.hex) })),
    // Kompakt: Material → Slot → colorId (direkt für Mapping nutzbar)
    mapping: Object.fromEntries(colors.map((c) => [c.type, hexToId.get(c.hex)])),
  }));

  return {
    palette: uniqueColors,
    uniqueColors,
    allMaterials: materialsWithMapping,
    hexToId: Object.fromEntries(hexToId),
  };
}

function printResults(data, format) {
  if (format === 'json') {
    // Für euer Tool: palette (id → Farbe) + materials mit mapping (material → slot → colorId)
    console.log(JSON.stringify({
      palette: data.palette.map(({ id, hex, r, g, b, sources }) => ({ id, hex, r, g, b, sources })),
      materials: data.allMaterials.map(({ material, file, mapping, colors }) => ({
        material,
        file,
        mapping,
        colors: colors.map((c) => ({ type: c.type, colorId: c.colorId, hex: c.hex })),
      })),
      hexToId: data.hexToId,
    }, null, 2));
    return;
  }
  if (format === 'hex') {
    const hexList = data.palette.map((c) => c.hex);
    console.log('# Einzigartige Farben (Hex) – zusammengefasst, für Colormatching');
    hexList.forEach((h) => console.log(h));
    return;
  }
  // default: lesbare Liste inkl. IDs für Mapping
  console.log('=== Farben aus OBJ/MTL (gleiche Farbe = eine ID) ===\n');
  console.log('Palette (zusammengefasst, für Colormatching):');
  for (const c of data.palette) {
    console.log(`  [${c.id}] ${c.hex}  rgb(${c.r}, ${c.g}, ${c.b})`);
  }
  console.log('\n--- Mapping: Material → Slot → colorId ---');
  for (const { material, file, mapping } of data.allMaterials) {
    console.log(`\n${material}: ${JSON.stringify(mapping)}`);
  }
  console.log('\n--- Pro Material (Detail) ---');
  for (const { file, material, colors } of data.allMaterials) {
    if (colors.length === 0) continue;
    console.log(`\n${material} (${file}):`);
    for (const c of colors) {
      console.log(`  ${c.type}: ${c.hex} → colorId ${c.colorId}`);
    }
  }
}

const args = process.argv.slice(2);
const formatIndex = args.indexOf('--format');
const format = formatIndex >= 0 && args[formatIndex + 1] ? args[formatIndex + 1] : 'list';
const pathArgs = args.filter((a) => !a.startsWith('--'));

const inputPath = pathArgs[0] || '.';

try {
  const data = extractAll(inputPath);
  if (data.palette.length === 0) {
    console.error('Keine MTL-Dateien oder keine Farben gefunden. Pfad:', inputPath);
    process.exit(1);
  }
  printResults(data, format);
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
