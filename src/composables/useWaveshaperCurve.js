// composables/useWaveshaperCurve.js
// Compilation et cache de la courbe d'un WaveShaper.
//
// Le paramètre `curve` du module contient le SOURCE d'une fonction JavaScript
// écrite dans le textarea du panneau. Le code doit définir :
//
//   function buildCurve(length = 8192) { ... return Float32Array }
//
// ou retourner directement un tableau de valeurs (le return ajouté par le
// compilateur est alors simplement inatteignable). Le résultat est mis en
// cache par source : une courbe n'est calculée qu'une fois par code, quel que
// soit le nombre de voix qui instancient le module.
//
// Le code est exécuté dans le contexte de la page (comme un patch importé) :
// ne charger que du code de confiance. En cas d'erreur, le moteur conserve le
// son en utilisant la courbe par défaut.

const CURVE_LENGTH = 8192
const CACHE_LIMIT = 32

/* =========================================================
 * COURBE PAR DÉFAUT (installée dans le textarea d'un module neuf)
 * ========================================================= */

export const DEFAULT_WAVESHAPER_CURVE = `/* Courbe de distorsion "soft clip" (tangente hyperbolique), normalisée pour
 * restituer l'unité au pic (x=1 → y=1). La saturation se règle avec le
 * pré-gain "drive" devant le WaveShaper.
 *
 * Le moteur appelle buildCurve(length) et utilise le tableau retourné :
 *   - une valeur par point, de x = -1 (index 0) à x = +1 (dernier index) ;
 *   - length vaut 8192 par défaut ;
 *   - retourner un Float32Array (ou un tableau) d'au moins 2 valeurs.
 *
 * Pour une autre courbe, remplacez simplement le calcul ci-dessous. Exemple :
 *   curve[i] = Math.sin(x * Math.PI / 2)   // saturation douce
 */
function buildCurve(length = 8192) {
  const curve = new Float32Array(length)
  const norm = Math.tanh(1)
  for (let i = 0; i < length; i++) {
    const x = (i / (length - 1)) * 2 - 1 // -1..1
    curve[i] = Math.tanh(x) / norm
  }
  return curve
}
`

/* =========================================================
 * COMPILATION
 * ========================================================= */

const cache = new Map()
let defaultCurve = null

function normalizeLength(length) {
  return Number.isFinite(length)
    ? Math.max(2, Math.floor(length))
    : CURVE_LENGTH
}

function identityCurve(length) {
  const curve = new Float32Array(length)
  for (let i = 0; i < length; i++) {
    curve[i] = (i / (length - 1)) * 2 - 1
  }
  return curve
}

function coerceCurve(result) {
  if (!result || typeof result.length !== "number" || result.length < 2) {
    throw new Error("buildCurve(length) doit retourner un tableau d'au moins 2 valeurs")
  }
  const curve = result instanceof Float32Array
    ? result
    : Float32Array.from(result)
  for (let i = 0; i < curve.length; i++) {
    if (!Number.isFinite(curve[i])) {
      throw new Error(`valeur non finie à l'index ${i}`)
    }
  }
  return curve
}

function evaluateCurve(source, length) {
  // Le return ajouté récupère la fonction définie par l'utilisateur. Le nom
  // `buildTanhCurve` est accepté pour les anciens extraits. Si le code se
  // termine lui-même par un `return`, le résultat direct est accepté aussi.
  const factory = new Function(
    `${source}\n` +
      `return typeof buildCurve === "function" ? buildCurve : ` +
      `typeof buildTanhCurve === "function" ? buildTanhCurve : null;`
  )
  const builder = factory()
  if (typeof builder === "function") {
    return coerceCurve(builder(length))
  }
  return coerceCurve(builder)
}

function getDefaultCurve(length) {
  if (defaultCurve && defaultCurve.length === length) return defaultCurve
  try {
    defaultCurve = evaluateCurve(DEFAULT_WAVESHAPER_CURVE, length)
  } catch (err) {
    console.error("WaveShaper : la courbe par défaut est invalide :", err)
    defaultCurve = identityCurve(length)
  }
  return defaultCurve
}

function remember(key, entry) {
  if (cache.size >= CACHE_LIMIT) {
    cache.delete(cache.keys().next().value)
  }
  cache.set(key, entry)
}

// Résultat : { curve, error, logged }. Une entrée en erreur contient déjà la
// courbe de repli, pour que le moteur n'ait jamais à gérer un cas spécial.
function compileCurve(source, length) {
  const n = normalizeLength(length)
  const code = String(source ?? "").trim()
  const key = `${n}\u0000${code}`
  const cached = cache.get(key)
  if (cached) return cached

  let entry
  if (!code) {
    entry = { curve: getDefaultCurve(n), error: null, logged: false }
  } else {
    try {
      entry = { curve: evaluateCurve(code, n), error: null, logged: false }
    } catch (err) {
      entry = { curve: getDefaultCurve(n), error: err, logged: false }
    }
  }
  remember(key, entry)
  return entry
}

/* =========================================================
 * API PUBLIQUE
 * ========================================================= */

// Courbe à affecter à WaveShaperNode.curve. Ne lève jamais : un code invalide
// est signalé une fois dans la console puis remplacé par la courbe par défaut.
export function buildWaveshaperCurve(source, length = CURVE_LENGTH) {
  const entry = compileCurve(source, length)
  if (entry.error && !entry.logged) {
    entry.logged = true
    console.error(
      "WaveShaper : courbe invalide, repli sur la courbe par défaut :",
      entry.error
    )
  }
  return entry.curve
}

// Validation utilisée par le panneau pour afficher un statut sous le textarea.
export function validateWaveshaperCurve(source, length = CURVE_LENGTH) {
  const entry = compileCurve(source, length)
  if (!entry.error) {
    return { ok: true, message: `courbe valide (${entry.curve.length} points)` }
  }
  return {
    ok: false,
    message: `courbe invalide : ${entry.error.message} — la courbe par défaut sera utilisée`,
  }
}
