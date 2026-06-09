/**
 * GLB Lighting Lab – Presets (wie im ursprünglichen HTML-Tool).
 * Key: Richtlicht (Richtung + Intensität + Farbe), Fill: festes Richtlicht (−5,3,−3), Hemi: Himmel/Boden.
 */
export const GLB_LAB_PRESETS = {
  verzinkt: {
    dI: 2, dX: 5, dY: 8, dZ: 5, dC: '#f0f0ff',
    fI: 0.8, hI: 0.6, hS: '#eef2ff', hG: '#888888',
    mM: 0.85, mR: 0.4, mC: '#b4b9be', eI: 0.5, sE: 1, sB: '#1a1c20',
  },
  studio: {
    dI: 2.5, dX: 5, dY: 5, dZ: 3, dC: '#ffffff',
    fI: 1, hI: 0.8, hS: '#ffffff', hG: '#b0b0b0',
    mM: 0.85, mR: 0.35, mC: '#c0c4c8', eI: 0.8, sE: 1.1, sB: '#1a1a1a',
  },
  warehouse: {
    dI: 1.5, dX: 3, dY: 10, dZ: 2, dC: '#fff5e0',
    fI: 0.5, hI: 0.4, hS: '#fff5e0', hG: '#6b6050',
    mM: 0.8, mR: 0.45, mC: '#aab0b5', eI: 0.3, sE: 0.9, sB: '#12110e',
  },
  bright: {
    dI: 3, dX: 5, dY: 6, dZ: 5, dC: '#ffffff',
    fI: 1.2, hI: 1, hS: '#f8f8ff', hG: '#cccccc',
    mM: 0.85, mR: 0.35, mC: '#c8ccd0', eI: 1, sE: 1.3, sB: '#e8e8e8',
  },
  noenv: {
    dI: 3.5, dX: 5, dY: 8, dZ: 5, dC: '#ffffff',
    fI: 1.2, hI: 1, hS: '#ffffff', hG: '#aaaaaa',
    mM: 0.85, mR: 0.4, mC: '#b4b9be', eI: 0, sE: 1.2, sB: '#1a1c20',
  },
}

/** Fill-Richtlicht: im Original-Lab fest, nur Intensität per Regler */
export const GLB_LAB_FILL_COLOR = 0xdde0ff
export const GLB_LAB_FILL_POSITION = { x: -5, y: 3, z: -3 }
