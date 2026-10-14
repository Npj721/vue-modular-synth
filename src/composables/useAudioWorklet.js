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
// (p1..p8, channels…) ne touche pas au hash, donc rien ne se recompile. Seuls
// le mode a-rate/k-rate et les plages de p1..p8 sont discriminants, car ils sont
// figés dans les descripteurs injectés dans le blob.
//
// Le nom, lui, dépend du préambule (cf. nameSeed) : corriger le moteur change
// les noms, donc un processor compilé par une version antérieure n'est plus
// confondu avec le nouveau. C'est aussi ce qui rend le rechargement à chaud
// possible — le registre mémoire étant perdu, réutiliser un nom déjà pris ferait
// rejeter `registerProcessor`.
//
// Conséquence à garder en tête : un processor enregistré reste vivant jusqu'à la
// fermeture de l'AudioContext, qui est le seul moyen de le décharger
// (registerProcessor n'a pas de pendant de unregister). Après une correction du
// moteur, un rechargement de page reste nécessaire.

/* =========================================================
 * CODE PAR DÉFAUT (installé dans le textarea d'un module neuf)
 * ========================================================= */

const DEFAULT_WORKLET_CODE = `// Traitement maison : le DSP se lit/écrit dans ce textarea.
// Il est compilé au chargement du patch (aucun changement à chaud pendant
// la lecture : on écrit le code, on recharge, ça joue).
//
//   p1..p8     paramètres modulables depuis le graphe (une enveloppe, un gain,
//              une constante… se câblent dessus). a-rate par défaut. On les lit
//              dans le 3e argument de process() (parameters), qui est la seule
//              forme garantie par la spec — le global "parameters" n'existe
//              pas, et this.parameters n'est pas fiable selon les navigateurs :
//              awParam(parameters.p1, i) lit le sample i. Attention, le tableau
//              n'a que 128 valeurs si le paramètre bouge ; sinon il en a UNE
//              (valeur constante du bloc, a-rate comme k-rate) — c'est
//              awParam, justement, qui gère les deux cas.
//   sampleRate fréquence d'échantillonnage
//   currentTime / currentFrame horloge du contexte
//   options.processorOptions contenu JSON du champ "options" du panneau
//
// Le nom donné à registerProcessor est ignoré (le moteur impose un nom unique).
// Si vous déclarez un constructeur, transmettez les options à super() : c'est par
// là que p1..p8 sont déclarés. Ne rien déclarer fonctionne aussi (le constructeur
// implicite transmet tout à super()).
//
// Code de départ : un bypass dont p1 est un gain.
//   p1 = 0 -> silence
//   p1 = 1 -> le signal passe tel quel (hauteur du circuit)
//   p1 > 1 -> on amplifie (l'écrêtage éventuel est inhérent à un gain)
class BypassGain extends AudioWorkletProcessor {
  constructor(options) {
    // indispensable : c'est par là que les descripteurs de p1..p8 entrent
    super(options)
  }

  process(inputs, outputs, parameters) {
    const inp = inputs[0] || []
    const out = outputs[0] || []
    // Les AudioParams : 3e argument de process() (toujours fourni par la
    // spec), this.parameters en repli. Le global "parameters" n'existe pas.
    const params = parameters ?? this.parameters
    const p1 = params.p1
    for (let ch = 0; ch < out.length; ch++) {
      const src = inp[ch] ?? inp[0]
      const dst = out[ch]
      if (!src || src.length === 0) {
        dst.fill(0)
        continue
      }
      // p1 est lu échantillon par échantillon : une modulation de p1 (LFO,
      // enveloppe) est donc appliquée à l'échantillon près. p1 absent
      // (descripteurs non déclarés) : bypass, plutôt qu'une sortie en NaN.
      for (let i = 0; i < dst.length; i++) {
        dst[i] = p1 ? src[i] * awParam(p1, i) : src[i]
      }
    }
    return true
  }
}
registerProcessor("audioworklet", BypassGain)
`

// p1 est borné à 0..100 : 0 = silence, 1 = bypass, au-delà = gain (avec le
// risque d'écrêtage que tout gain > 1 implique). Les plages sont FIGÉES dans
// les descripteurs du blob : les changer recompile le code (au prochain
// chargement du patch).
const DEFAULT_WORKLET_OPTIONS = '{"ranges":{"p1":[0,100]},"params":{}}'

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
 * PARAMÈTRES p1..p8
 * ========================================================= */

// Noms des AudioParams exposés au DSP. Partagés avec le moteur (usePatchVoice)
// qui les câble, donc exportés.
export const WORKLET_PARAM_NAMES = ["p1", "p2", "p3", "p4", "p5", "p6", "p7", "p8"]

/* Plage par défaut d'un paramètre. Symétrique autour de 0 : c'est ce qu'il faut
 * pour une modulation additive (une enveloppe 0..1 se lit directement). */
export const DEFAULT_PARAM_RANGE = { minValue: -10, maxValue: 10 }

/* =========================================================
 * PLAGES DE VALEUR (champ "options" du panneau)
 *
 * Un AudioParam ne peut prendre que des valeurs dans [minValue, maxValue] : le
 * navigateur BORNE silencieusement tout ce qu'on lui donne. Avec une plage figée
 * à ±10, impossible d'exprimer une profondeur de bits (1..16), une fréquence de
 * coupure en Hz, une durée en ms… un `constant` à 12000 se retrouve épinglé à
 * 10, définitivement, et la modulation ne sert à rien.
 *
 * L'utilisateur déclare donc ses plages dans le JSON `options` :
 *
 *   { "ranges": { "p1": [1, 16], "p2": 0.5 } }
 *
 * pN: [min, max]   -> plage explicite
 * pN: nombre       -> [-nombre, nombre] (raccourci symétrique)
 *
 * Ces plages sont FIGÉES dans le descripteur, donc dans le blob : elles font
 * partie de la clé du registre, et les modifier recompile le code (une fois,
 * au prochain chargement du patch).
 */

/** Extrait les plages déclarées dans le JSON `options`. */
export function parseRanges(optionsJson) {
  const out = {}
  let parsed = null
  try {
    parsed = JSON.parse(typeof optionsJson === "string" ? optionsJson || "{}" : "{}")
  } catch {
    return out // JSON invalide : on garde les plages par défaut
  }
  const raw = parsed && typeof parsed === "object" ? parsed.ranges : null
  if (!raw || typeof raw !== "object") return out

  for (const n of WORKLET_PARAM_NAMES) {
    const v = raw[n]
    if (v === undefined || v === null) continue
    if (Array.isArray(v) && v.length >= 2) {
      const lo = Number(v[0])
      const hi = Number(v[1])
      if (Number.isFinite(lo) && Number.isFinite(hi) && hi > lo) {
        out[n] = { minValue: lo, maxValue: hi }
      }
    } else if (typeof v === "number" && Number.isFinite(v) && v !== 0) {
      out[n] = { minValue: -Math.abs(v), maxValue: Math.abs(v) }
    }
  }
  return out
}

/** Clé canonique des plages : deux modules ayant les mêmes plages partagent
 *  le même blob compilé. */
const rangesKey = (ranges) =>
  WORKLET_PARAM_NAMES.map((n) =>
    ranges[n] ? `${n}:${ranges[n].minValue}:${ranges[n].maxValue}` : ""
  ).join("|")

/** Borne une valeur dans la plage déclarée d'un paramètre. Le moteur s'en sert
 *  pour les valeurs initiales et les bases de modulation : sans cela, la base
 *  mémorisée resterait hors plage alors que l'AudioParam est borné. */
export function clampParamValue(ranges, name, value) {
  const v = Number(value)
  const r = ranges?.[name]
  if (!r) return Number.isFinite(v) ? v : 0
  if (!Number.isFinite(v)) return r.minValue
  return Math.min(r.maxValue, Math.max(r.minValue, v))
}

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
 *    de l'utilisateur pour y porter les descripteurs de p1..p8.
 *
 * 2. Comment les descripteurs sont déclarés — LA partie qui compte :
 *
 *    a. `parameterDescriptors` n'est PAS une clé d'AudioWorkletNodeOptions :
 *       la passer à `new AudioWorkletNode()` est ignoré silencieusement. Les
 *       descripteurs appartiennent au PROCESSOR.
 *
 *    b. Et le processor ne les lit pas dans ce que son constructeur transmet à
 *       `super()` : le navigateur construit les AudioParams du nœud (et la map
 *       reçue par `process`) à partir du GETTER STATIQUE
 *       `static get parameterDescriptors()` du constructeur enregistré — c'est
 *       le seul canal qui traverse la frontière entre le thread principal et
 *       le worklet. Un DSP qui déclare ses descripteurs par `super()` se voit
 *       donc servir une map VIDE : `node.parameters` vide côté moteur,
 *       `parameters.p1` undefined côté DSP. Le getter statique est donc posé
 *       sur la classe de base injectée (hérité par la classe de l'utilisateur)
 *       ET sur la classe effectivement enregistrée.
 *
 *    c. Les descripteurs sont aussi passés par `options` (`parameterDescriptors`
 *       + `parameterData`), ce qui couvre les implémentations qui lisent le
 *       constructeur. Pour que ça survive à TOUTE forme de constructeur de la
 *       part de l'utilisateur, la pose se fait au plus profond de la chaîne
 *       d'héritage : un `super()` à vide ne peut plus l'effacer. Le
 *       constructeur absent (le plus fréquent) et `super(options)` fonctionnent
 *       aussi : le constructeur implicite d'une classe dérivée transmet tous
 *       les arguments à `super()`.
 *
 * 3. `awParam` : dans `process()`, un AudioParam est TOUJOURS un Float32Array,
 *    mais sa longueur vaut 1 ou 128. Elle vaut 1 quand le paramètre est
 *    constant sur le quantum de rendu — systématiquement pour un k-rate, et
 *    aussi pour un a-rate quand aucun évènement ne tombe dans le bloc (cas le
 *    plus courant d'un paramètre non modulé, ou modulé lentement : un LFO à
 *    4 Hz ne change pas à chaque bloc de 128 samples). Lire `arr[i]` sans
 *    vérifier la longueur renvoie alors `undefined` pour i > 0, donc NaN dans
 *    le DSP. `awParam(arr, i)` renvoie `arr[0]` si le tableau est constant,
 *    `arr[i]` sinon : l'utilisateur n'a aucune branche à écrire.
 */

function buildPrelude(name, rate, ranges) {
  return `const __awNativeRegister = globalThis.registerProcessor;
const __awNativeProcessor = globalThis.AudioWorkletProcessor;
const __awParamNames = ${JSON.stringify(WORKLET_PARAM_NAMES)};
const __awRanges = ${JSON.stringify(ranges ?? {})};
const __awDescriptors = __awParamNames.map((n) => {
  const r = __awRanges[n];
  return {
    name: n,
    defaultValue: r?.defaultValue ?? 0,
    minValue: r?.minValue ?? ${DEFAULT_PARAM_RANGE.minValue},
    maxValue: r?.maxValue ?? ${DEFAULT_PARAM_RANGE.maxValue},
    automationRate: ${JSON.stringify(rate)},
  };
});
// Descripteurs « en cours de pose », lus par la classe de base injectée plus
// bas. La déclaration est posée AU PLUS PROFOND de la chaîne de construction,
// donc elle survit au constructeur de l'utilisateur : qu'il écrive
// super(), super(options) ou qu'il ne déclare pas de constructeur, la
// déclaration arrive. (Sans cela, un super() à vide efface tout et
// node.parameters reste vide.)
let __awPending = null;
class __awProcessor extends __awNativeProcessor {
  // LE point critique : c'est ce GETTER STATIQUE, et lui seul, que le navigateur
  // lit pour construire les AudioParams du nœud — il lit l'attribut statique du
  // constructeur enregistré, pas ce qu'un constructeur d'instance transmet à
  // super() (le passage par options est une alternative que rien ne garantie).
  // Sans ce getter : node.parameters est vide, et la map reçue par process()
  // l'est aussi (parameters.p1 undefined côté DSP, this.parameters undefined).
  // Le wrapper enregistré plus bas le redéclare pour le cas où le global
  // AudioWorkletProcessor n'a pas pu être remplacé (l'utilisateur hérite alors
  // du natif, pas de cette base).
  static get parameterDescriptors() { return __awDescriptors; }
  constructor(options) {
    super(__awPending
      ? Object.assign({}, options ?? {}, {
          parameterDescriptors: __awPending,
          parameterData: __awPending.map((d) => d.defaultValue),
        })
      : options);
  }
}
// Remplace le global : nécessaire pour que le code de l'utilisateur, qui écrit
// "class X extends AudioWorkletProcessor", hérite de cette base. Si le global
// n'est pas inscriptible, le repli est le wrapper ci-dessous (qui porte alors
// lui-même le getter statique).
try { globalThis.AudioWorkletProcessor = __awProcessor; } catch (e) {}
let __awRegistered = false;
const awParam = (v, i = 0) =>
  ArrayBuffer.isView(v) ? (v.length > 1 ? v[i] : v[0]) : v;
const registerProcessor = (nom, Classe) => {
  __awRegistered = true;
  __awNativeRegister(${JSON.stringify(name)}, class extends Classe {
    static get parameterDescriptors() { return __awDescriptors; }
    constructor(options) {
      const merged = Object.assign({}, options ?? {}, {
        parameterDescriptors: __awDescriptors,
        parameterData: __awDescriptors.map((d) => d.defaultValue),
      });
      __awPending = __awDescriptors;
      try { super(merged); } finally { __awPending = null; }
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
function wrapSource(src, name, rate, ranges) {
  return { ok: true, code: `${buildPrelude(name, rate, ranges)}${src}${EPILOGUE}` }
}

// Le nom est fabriqué AVANT le blob, mais doit pourtant changer dès que le
// moteur change : on hashe donc le préambule construit avec un nom neutre (le
// préambule ne dépend du nom que pour l'enregistrement, cf. buildPrelude). Sans
// cela, corriger le préambule en HMR laisserait le même `aw_<hash>` : le
// registre mémoire étant perdu au rechargement, `registerProcessor`
// rejetterait le nom déjà pris et le module retomberait sur son repli.
const nameSeed = (source, rate, ranges) =>
  hashSource(`${buildPrelude("", rate, ranges)}${source}`)

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
 * `rate` ("a-rate" | "k-rate") et les plages de p1..p8 font partie de la clé :
 * ils sont figés dans les descripteurs injectés dans le blob, donc le même
 * code compilé en a-rate, ou avec d'autres plages, ne peut pas servir tel quel.
 * @returns {Promise<{ key, name, status: "ok"|"error", error: string|null }>}
 */
export async function ensureWorklet(ctx, src, spec = {}) {
  const { rate = "a-rate", options = "{}" } = spec ?? {}
  const source =
    typeof src === "string" && src.trim() ? src : DEFAULT_WORKLET_CODE
  const ranges = parseRanges(options)
  const key = `${rate}\u0000${rangesKey(ranges)}\u0000${source}`

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
    ranges,
    rate,
  }
  rec.name = claimName(reg, nameSeed(source, rate, ranges))
  reg.set(key, rec)

  rec.promise = (async () => {
    const wrapped = wrapSource(source, rec.name, rate, ranges)
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
    } catch (e) {      rec.status = "error"
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
 * @returns {{ key, name, status, error, ranges }|null} null si le code n'a
 *   jamais été compilé (le module tombe alors sur son repli pass-through).
 */
export function peekWorklet(ctx, src, spec = {}) {
  const { rate = "a-rate", options = "{}" } = spec ?? {}
  const source =
    typeof src === "string" && src.trim() ? src : DEFAULT_WORKLET_CODE
  const rec = getRegistry(ctx).get(
    `${rate}\u0000${rangesKey(parseRanges(options))}\u0000${source}`
  )
  if (!rec || rec.status === "pending") return null
  return rec
}

/** Compile tous les worklets référencés par un graphe (avant construction). */
export async function preloadGraphWorklets(ctx, graph) {
  for (const mod of graph?.modules ?? []) {
    if (mod?.type !== "audioworklet") continue
    await ensureWorklet(ctx, mod.params?.code, {
      rate: mod.params?.rate,
      options: mod.params?.options,
    })
  }
}
