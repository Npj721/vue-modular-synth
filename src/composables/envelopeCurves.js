/* =========================================================
 * Courbes d'enveloppe : SOURCE UNIQUE partagée par le dessin
 * (GraphEnvelopeEditor) et le moteur audio (usePatchVoice).
 *
 * Un stage porte `curve` parmi :
 *   - "linear"      -> linearRampToValueAtTime
 *   - "exponential" -> exponentialRampToValueAtTime (rampe NATIVE Web Audio)
 *   - "scurve" | "arc" | "log" -> setValueCurveAtTime (courbe échantillonnée,
 *     un seul évènement d'automation, pas N stages)
 *
 * L'ancien alias "exp" (outil de tracé) est normalisé vers "exponential".
 * ========================================================= */

export const EPS = 0.0001

/* Nombre d'échantillons pour les courbes non natives. Assez fin pour être
 * lisse à l'oreille et à l'œil, mais c'est UN seul évènement d'automation
 * (setValueCurveAtTime), pas N. */
export const CURVE_SAMPLES = 128

export const ENVELOPE_CURVES = ["linear", "exponential", "scurve", "arc", "log"]

export function normalizeCurve(curve) {
  if (curve === "exp") return "exponential"
  return ENVELOPE_CURVES.includes(curve) ? curve : "linear"
}

/* Courbes rendues nativement par une rampe Web Audio : "linear" et
 * "exponential" n'ont pas besoin d'être échantillonnées. */
export function isNativeRamp(curve) {
  const c = normalizeCurve(curve)
  return c === "linear" || c === "exponential"
}

/* Valeur absolue de la courbe pour une progression f ∈ [0,1].
 *
 * "exponential" reproduit EXACTEMENT la rampe Web Audio
 * (v = v0 * (v1/v0)^f, ratio-dépendante) : le dessin correspond donc au son
 * réellement produit, contrairement à une forme à exposant fixe. */
export function curveValue(curve, from, to, f) {
  switch (normalizeCurve(curve)) {
    case "exponential": {
      const a = Math.max(EPS, from)
      const b = Math.max(EPS, to)
      return a * Math.pow(b / a, f)
    }
    case "scurve":
      return from + (to - from) * ((1 - Math.cos(Math.PI * f)) / 2)
    case "arc":
      return from + (to - from) * Math.sin((Math.PI * f) / 2)
    case "log":
      return from + (to - from) * (Math.log(1 + 4 * f) / Math.log(5))
    default:
      return from + (to - from) * f
  }
}

/* Échantillonne une courbe en Float32Array (format attendu par
 * setValueCurveAtTime). */
export function sampleCurve(curve, from, to, count = CURVE_SAMPLES) {
  const n = Math.max(2, count)
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) out[i] = curveValue(curve, from, to, i / (n - 1))
  return out
}
