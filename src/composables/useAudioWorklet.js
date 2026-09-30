// composables/useAudioWorklet.js
// Compilation "à la volée" du code d'un AudioWorkletProcessor écrit dans le
// panneau de propriétés (paramètre `code` du module `audioworklet`).
//
// Le code est une simple chaîne : on ne peut pas l'exécuter telle quelle, Web
// Audio n'acceptant qu'une URL de script. On l'empaquette donc dans un Blob,
// served par une object-URL, et on la déclare via `audioWorklet.addModule()`.
//
// Deux contraintes de l'API guident l'implémentation :
//
//  1. `registerProcessor()` lève `NotSupportedError` si le nom est déjà déclaré
//     dans le contexte. Or l'utilisateur écrit un nom lisible ("tremolo") et
//     deux modules peuvent l'utiliser. `registerProcessor` est donc masqué par
//     un wrapper qui impose un nom unique dérivé du code source.
//
//  2. `addModule()` est asynchrone alors que l'instanciation des modules est
//     synchrone (voir instantiateModule dans usePatchVoice.js). Chaque code est
//     donc compilé à l'avance (preloadWorklets) et l'instanciation ne fait que
//     lire le registre. Le registre est indexé par le SOURCE LUI-MÊME (pas par
//     son hash) : aucune collision possible, le hash ne sert qu'à fabriquer le
//     nom du processor.
//
// Un code déjà compilé n'est jamais recompilé : changer un paramètre du module
// (p1..p8, channels…) ne touche pas au hash, donc rien ne se recompile. Seul le
// mode a-rate/k-rate est discriminant, car il est figé dans les descripteurs
// injectés dans le blob.

/* =========================================================
 * CODE PAR DÉFAUT (installé dans le textarea d'un module neuf)
 * ========================================================= */

const DEFAULT_WORKLET_CODE = `// Traitement maison : le DSP se lit/écrit dans ce textarea.
// Il est compilé au chargement du patch (aucun changement à chaud pendant
// la lecture : on écrit le code, on recharge, ça joue).
//
//   p1..p8     paramètres modulables depuis le graphe (une enveloppe, un gain,
//              une constante… se câblent dessus). a-rate par défaut :
//              awParam(parameters.p1, i) lit le sample i, que le paramètre soit
//              a-rate (Float32Array) ou k-rate (nombre).
//   sampleRate fréquence d'échantillonnage
//   currentTime / currentFrame horloge du contexte
//   options.processorOptions contenu JSON du champ "options" du panneau
//
// Le nom donné à registerProcessor est ignoré (le moteur impose un nom unique).
// Déclarez un constructeur ? alors transmettez les options à super(), sinon
// p1..p8 ne seront pas déclarés. Ne rien déclarer, c'est le plus simple.
class Passthrough extends AudioWorkletProcessor {
  process(inputs, outputs) {
    const inp = inputs[0] || []
    const out = outputs[0] || []
    for (let ch = 0; ch < out.length; ch++) {
      const src = inp[ch] ?? inp[0]
      if (src) out[ch].set(src)
      else out[ch].fill(0)
    }
    return true
  }
}
registerProcessor("audioworklet", Passthrough)
`

const DEFAULT_WORKLET_OPTIONS = '{"params":{}}'

export function getWorkletDefaults() {
  return { code: DEFAULT_WORKLET_CODE, options: DEFAULT_WORKLET_OPTIONS }
}

/* =========================================================
 * HASH (synchrone : instantiateModule en a besoin)
 * ========================================================= */

// FNV-1a, deux passes avec des graines différentes. Le hash ne sert QU'à
// fabriquer un nom lisible et unique — l'égalité des codes est testée par
// comparaison de source, donc une collision de hash ne peut pas faire tourner
// le mauvais DSP (elle ferait seulement réutiliser un nom, cf. claimName).
function fnv1a(str, seed) {
  let h = seed >>> 0
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return (h >>> 0).toString(36)
}

const hashSource = (src) => `${fnv1a(src, 0x811c9dc5)}${fnv1a(src, 0x9e3779b1)}`

/* =========================================================
 * EMPAQUETAGE DU CODE
 * ========================================================= */

// Noms des AudioParams exposés au DSP. Partagés avec le moteur (usePatchVoice)
// qui les câble, donc exportés.
export const WORKLET_PARAM_NAMES = ["p1", "p2", "p3", "p4", "p5", "p6", "p7", "p8"]

const PARAM_MIN = -10
const PARAM_MAX = 10

/* =========================================================
 * EMPAQUETAGE DU CODE
 *
 * Deux helpers sont injectés AVANT le code de l'utilisateur, et un contrôle
 * après. Rien n'est réécrit dans son code : il reste tel qu'il est écrit.
 *
 * 1. `registerProcessor` est MASQUÉ (const de portée module) par un wrapper
 *    qui (a) impose notre nom unique — `registerProcessor` lève
 *    NotSupportedError si le nom est déjà pris, or l'utilisateur écrit un nom
 *    lisible et deux modules peuvent l'utiliser — et (b) sous-classe la classe
 *    de l'utilisateur pour y injecter les descripteurs de p1..p8.
 *
 * 2. Pourquoi (b) est indispensable : `parameterDescriptors` n'existe QUE sur
 *    le constructeur de `AudioWorkletProcessor`. Le passer à `new
 *    AudioWorkletNode()` est ignoré silencieusement (clé inconnue dans
 *    AudioWorkletNodeOptions) et `node.parameters` reste vide. Les AudioParams
 *    sont donc déclarés côté processor via `super({ parameterDescriptors })`.
 *
 *    Conséquence : si l'utilisateur déclare un constructeur, il doit
 *    transmettre les options — `constructor(options) { super(options) }` —
 *    sinon `super()` à vide efface nos descripteurs. Le cas le plus fréquent
 *    (pas de constructeur) est couvert : le constructeur implicite d'une classe
 *    dérivée transmet tous les arguments à `super()`.
 *
 * 3. `awParam` : un AudioParam a-rate est un Float32Array (une valeur par
 *    sample), un k-rate est un simple nombre. Sans ce helper l'utilisateur
 *    devrait écrire deux branches selon le mode.
 */

function buildPrelude(name, rate) {
  return `const __awNativeRegister = globalThis.registerProcessor;
const __awParamNames = ${JSON.stringify(WORKLET_PARAM_NAMES)};
let __awRegistered = false;
const awParam = (v, i = 0) => (ArrayBuffer.isView(v) ? v[i] : v);
const registerProcessor = (nom, Classe) => {
  __awRegistered = true;
  __awNativeRegister(${JSON.stringify(name)}, class extends Classe {
    constructor(options) {
      super(Object.assign({}, options, {
        parameterDescriptors: __awParamNames.map((n) => ({
          name: n,
          defaultValue: 0,
          minValue: ${PARAM_MIN},
          maxValue: ${PARAM_MAX},
          automationRate: ${JSON.stringify(rate)},
        })),
      }));
    }
  });
};
`
}

const EPILOGUE = `
if (!__awRegistered) {
  throw new Error(
    "registerProcessor() introuvable ou non appelee : le code doit contenir " +
    'registerProcessor("un-nom", MaClasse).'
  );
}
`

/**
 * Empaquette le code de l'utilisateur : prélude + code + contrôle.
 * @returns {{ ok: boolean, code?: string, error?: string }}
 */
function wrapSource(src, name, rate) {
  return { ok: true, code: `${buildPrelude(name, rate)}${src}${EPILOGUE}` }
}

/* =========================================================
 * REGISTRE (par AudioContext)
 * ========================================================= */

const registries = new WeakMap()

const getRegistry = (ctx) => {
  let reg = registries.get(ctx)
  if (!reg) {
    reg = new Map() // source -> record
    registries.set(ctx, reg)
  }
  return reg
}

// Nom unique dans le contexte : aw_<hash>, suffixe si jamais pris.
function claimName(reg, hash) {
  const taken = new Set()
  for (const rec of reg.values()) if (rec.name) taken.add(rec.name)
  let name = `aw_${hash}`
  let i = 1
  while (taken.has(name)) name = `aw_${hash}_${i++}`
  return name
}

/**
 * Compile le code d'un worklet dans le contexte (idempotent).
 *
 * `rate` ("a-rate" | "k-rate") fait partie de la clé : il est figé dans les
 * descripteurs de p1..p8 injectés dans le blob, donc le même code compilé en
 * a-rate ne peut pas servir à un module k-rate.
 * @returns {Promise<{ key, name, status: "ok"|"error", error: string|null }>}
 */
export async function ensureWorklet(ctx, src, rate = "a-rate") {
  const source =
    typeof src === "string" && src.trim() ? src : DEFAULT_WORKLET_CODE
  const key = `${rate}\u0000${source}`

  const aw = ctx?.audioWorklet
  if (!aw) {
    return {
      key,
      name: null,
      status: "error",
      error: "AudioWorklet indisponible dans ce navigateur",
    }
  }

  const reg = getRegistry(ctx)

  const known = reg.get(key)
  if (known) {
    return known.status === "pending" ? known.promise : known
  }

  const rec = {
    key,
    name: null,
    status: "pending",
    error: null,
    promise: null,
  }
  rec.name = claimName(reg, hashSource(key))
  reg.set(key, rec)

  rec.promise = (async () => {
    const wrapped = wrapSource(source, rec.name, rate)
    if (!wrapped.ok) {
      rec.status = "error"
      rec.error = wrapped.error
      return rec
    }

    let url = null
    try {
      url = globalThis.URL.createObjectURL(
        new globalThis.Blob([wrapped.code], { type: "application/javascript" })
      )
      await aw.addModule(url)
      rec.status = "ok"
    } catch (e) {
      rec.status = "error"
      rec.error = e?.message ? String(e.message) : String(e)
    } finally {
      // le script est déjà récupéré par addModule à ce stade
      if (url) {
        try { globalThis.URL.revokeObjectURL(url) } catch {}
      }
    }
    return rec
  })()

  return rec.promise
}

/**
 * Lecture synchrone du registre, pour l'instanciation des modules.
 * @returns {{ key, name, status, error }|null} null si le code n'a jamais
 *   été compilé (le module tombe alors sur son repli pass-through).
 */
export function peekWorklet(ctx, src, rate = "a-rate") {
  const source =
    typeof src === "string" && src.trim() ? src : DEFAULT_WORKLET_CODE
  const rec = getRegistry(ctx).get(`${rate}\u0000${source}`)
  if (!rec || rec.status === "pending") return null
  return rec
}

/** Compile tous les worklets référencés par un graphe (avant construction). */
export async function preloadGraphWorklets(ctx, graph) {
  for (const mod of graph?.modules ?? []) {
    if (mod?.type !== "audioworklet") continue
    await ensureWorklet(ctx, mod.params?.code, mod.params?.rate)
  }
}
