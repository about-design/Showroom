const CC_PBR_TOL = 0.06

/**
 * Grobe Einordnung der in der GLB gespeicherten PBR-Werte (wie ColorService / Bake-Pipeline).
 * @returns {{ label: string, kind: 'verzinkt' | 'ral' | 'other' } | null}
 */
export function classifyEmbeddedPbrFinish(metallic, roughness) {
  if (metallic == null || roughness == null || !Number.isFinite(metallic) || !Number.isFinite(roughness)) {
    return null
  }
  const verzinkt =
    Math.abs(metallic - 0.75) <= CC_PBR_TOL && Math.abs(roughness - 0.25) <= CC_PBR_TOL
  const ralTyp =
    metallic <= CC_PBR_TOL && Math.abs(roughness - 0.35) <= CC_PBR_TOL
  if (verzinkt) return { label: 'Verzinkt (typisch M 0,75 / R 0,25)', kind: 'verzinkt' }
  if (ralTyp) return { label: 'Pulver / allg. RAL (typisch M 0 / R 0,35)', kind: 'ral' }
  return { label: 'Abweichend', kind: 'other' }
}

/** Kurztext wenn Hex→RAL und eingebettete PBR sich widersprechen. */
export function glbHexVsPbrHint(hex, ralExact, metallic, roughness) {
  const pbr = classifyEmbeddedPbrFinish(metallic, roughness)
  if (!hex || !ralExact || !pbr) return ''
  const hexSaysVerzinkt = ralExact === 'RAL 9007'
  if (hexSaysVerzinkt && pbr.kind === 'ral') {
    return 'Hex steht in der Palette als RAL 9007 (Verzinkt), die GLB nutzt aber Pulver-PBR (M/R). Das Modell ist damit <strong>nicht</strong> als metallisch verzinkt gerendert – oft Zielfarbe „hellgrau“ ohne Verzinkt-Finish. Für RAL 7035 wäre die Base Color typ. <code>#D7D7D7</code>, nicht <code>#F4F4F4</code>.'
  }
  if (!hexSaysVerzinkt && pbr.kind === 'verzinkt') {
    return 'PBR wirkt wie Verzinkt, der Hex-Treffer in der Palette ist aber ein anderes RAL – prüfen.'
  }
  return ''
}
