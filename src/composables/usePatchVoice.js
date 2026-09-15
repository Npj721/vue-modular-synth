// composables/usePatchVoice.js
import { ref } from "vue"
import { useSuperModules } from "./useSuperModules"
import { getAudioBuffer } from "./useAudioBufferCache"

/* =========================================================
 * Utils
 * ========================================================= */

const EPS = 0.0001

// Enveloppes loopables : durée totale couverte par les cycles planifiés
// d'avance dans la timeline Web Audio (un très long "sustain" simulé par
// la répétition des stages press). Pas de timer pendant la lecture.
const LOOP_HORIZON_SECONDS = 180 // ≈ 3 min d'automation
const LOOP_MAX_SCHEDULES = 4096 // garde-fou si le cycle est ultracourt

const noteToFreq = (note) =>
  440 * Math.pow(2, (note - 69) / 12)

function getEnvelopeDuration(stages = []) {
  return stages.reduce((t, s) => t + s.duration, 0)
}

/* Courbe de distorsion "soft clip" (tangente hyperbolique), normalisée pour
 * restituer l'unité au pic (x=1 → y=1). La saturation se règle avec le
 * pré-gain "drive" devant le WaveShaper. */
function buildTanhCurve(length = 8192) {
  const curve = new Float32Array(length)
  const norm = Math.tanh(1)
  for (let i = 0; i < length; i++) {
    const x = (i / (length - 1)) * 2 - 1 // -1..1
    curve[i] = Math.tanh(x) / norm
  }
  return curve
}

const safeStart = (node, t, offset, duration) => {
  try {
    if (offset === undefined) node.start(t)
    else if (duration === undefined || duration <= 0) node.start(t, offset)
    else node.start(t, offset, duration)
  } catch {}
}

const safeStop = (node, t) => {
  try { node.stop(t) } catch {}
}

const safeDisconnect = (node) => {
  try { node.disconnect() } catch {}
}

const isNumericArray = (v) =>
  Array.isArray(v) ||
  (ArrayBuffer.isView(v) && !(v instanceof DataView))

/* Construit une PeriodicWave depuis le paramètre JSON "wave" d'un module
 * wavetable (format { real, imag, disableNormalization }) ou depuis une
 * frame de wavetableS (même forme, extraite du tableau de frames).
 * real/imag peuvent être des tableaux classiques ou des Float32Array
 * (wavetableS compacte les frames pour économiser la mémoire).
 * disableNormalization vaut true par défaut. En cas de JSON invalide ou de
 * tableaux vides, repli sur une onde en dents de scie (somme de 1/n).
 * Les tableaux sont bornés à MAX_HARMONICS par canal : createPeriodicWave
 * lève NotSupportedError au-delà d'une taille max (~8192 au total selon les
 * implémentations) → sans clamp, une frame trop longue échouait et gelait
 * le morphing. */
const MAX_HARMONICS = 4096

function buildPeriodicWave(ctx, raw) {
  let real = null
  let imag = null
  let disableNormalization = true

  if (raw) {
    try {
      const parsed = typeof raw === "string" ? JSON.parse(raw) : raw
      if (parsed && isNumericArray(parsed.real) && parsed.real.length > 0) {
        real = parsed.real.slice(0, MAX_HARMONICS)
      }
      if (parsed && isNumericArray(parsed.imag) && parsed.imag.length > 0) {
        imag = parsed.imag.slice(0, MAX_HARMONICS)
      }
      if (parsed && parsed.disableNormalization !== undefined) {
        disableNormalization = !!parsed.disableNormalization
      }
    } catch {
      real = null
      imag = null
    }
  }

  if (!real || !imag) {
    const harmonics = 16
    real = new Array(harmonics).fill(0)
    imag = [0]
    for (let i = 1; i < harmonics; i++) imag.push(1 / i)
  }

  try {
    return ctx.createPeriodicWave(real, imag, { disableNormalization })
  } catch {
    return null
  }
}

/* Courbes de crossfade "equal-power" (gain total constant, pas de creux en
 * plein milieu du morph) : sin rampe 0→1, cos rampe 1→0. Précalculées une
 * seule fois et réutilisées par tous les modules wavetableS. */
const MORPH_CURVE_UP = (() => {
  const c = new Float32Array(64)
  for (let i = 0; i < c.length; i++) c[i] = Math.sin((Math.PI / 2) * (i / (c.length - 1)))
  return c
})()

const MORPH_CURVE_DOWN = (() => {
  const c = new Float32Array(64)
  for (let i = 0; i < c.length; i++) c[i] = Math.cos((Math.PI / 2) * (i / (c.length - 1)))
  return c
})()

/* =========================================================
 * wavetableS — cache + construction paresseuse des frames
 * ---------------------------------------------------------
 * Une table de 256 frames × ~1000 harmoniques fait plusieurs centaines de
 * milliers de coefficients : la re-parser et reconstruire 256 PeriodicWave
 * à CHAQUE note bloquerait le thread audio. Deux garde-fous :
 *  - le JSON est parse UNE fois et mis en cache (borné en octets, LRU) ;
 *  - les PeriodicWave sont construites à la volée : frame 0/1 au départ,
 *    puis une par crossfade (un timer est toujours en avance d'un "morph")
 *    — le coût est étalé et partagé entre toutes les voix.
 * Les frames sont compactées en Float32Array (2× moins de mémoire qu'un
 * tableau de nombres JS).
 * ========================================================= */

const WT_CACHE = new Map() // wave (string) -> bundle
let WT_CACHE_BYTES = 0
const WT_CACHE_MAX_BYTES = 8 * 1024 * 1024

const toF32 = (arr) => {
  if (!isNumericArray(arr)) return new Float32Array(0)
  const f = new Float32Array(arr.length)
  for (let i = 0; i < arr.length; i++) f[i] = arr[i]
  return f
}

/* Retourne le bundle { frames, waves } d'un paramètre wave de wavetableS.
 * frames = tableau de { real: Float32Array, imag: Float32Array } (parse une
 * seule fois, mis en cache) ; waves = PeriodicWave construites paresseusement. */
function getWavetableBundle(ctx, raw) {
  if (typeof raw === "string") {
    const hit = WT_CACHE.get(raw)
    if (hit) return hit
  }

  let frames = []
  if (raw) {
    try {
      const parsed = typeof raw === "string" ? JSON.parse(raw) : raw
      if (Array.isArray(parsed)) {
        frames = parsed
          .slice(0, 256)
          .filter((f) => f && typeof f === "object")
          .map((f) => ({ real: toF32(f.real), imag: toF32(f.imag) }))
      }
    } catch {}
  }

  const bundle = { frames, waves: [] }
  if (typeof raw === "string") {
    WT_CACHE.set(raw, bundle)
    WT_CACHE_BYTES += raw.length
    while (WT_CACHE_BYTES > WT_CACHE_MAX_BYTES && WT_CACHE.size > 1) {
      const oldest = WT_CACHE.keys().next().value
      WT_CACHE_BYTES -= oldest.length
      WT_CACHE.delete(oldest)
    }
  }
  return bundle
}

/* Construit (et mémorise dans le bundle) la PeriodicWave de la frame index.
 * Jure de ne JAMAIS retourner null pour un index valide : si la frame est
 * inconstructible (createPeriodicWave trop grand, valeurs invalides…), on
 * retombe sur l'onde par défaut afin que le crossfade suivant ait TOUJOURS
 * un contenu audible — sinon l'osc resterait sur son ancienne onde et le
 * morphing gèlerait (son qui n'évolue plus). */
function getWavetableFrameWave(ctx, bundle, index) {
  if (index >= 0 && index < bundle.waves.length && bundle.waves[index]) {
    return bundle.waves[index]
  }
  const frames = bundle.frames ?? []
  let wave = null
  if (index < frames.length) {
    wave = buildPeriodicWave(ctx, frames[index])
  }
  if (!wave) {
    wave = buildPeriodicWave(ctx, null)
  }
  if (wave && index >= 0) bundle.waves[index] = wave
  return wave
}

/* Balayage du morphing du module wavetableS — mode 1, "retrigger à chaque
 * note" : à chaque noteOn le balayage repart de la frame 0 et, tant que la
 * note est tenue, la table est parcourue EN BOUCLE à la cadence du crossfade
 * (durée "morph").
 *
 * Fin de liste (paramètre "endMode") :
 *  - "loop"     : retour à la frame 0 (…, N-2, N-1, 0, 1, …) ;
 *  - "pingpong" : va-et-vient (…, N-1, N-2, …, 0, 1, …).
 *
 * Mécanique (double tampon, 2 oscillateurs) :
 *  - l'osc audible est fondu vers 0 sur une courbe cos, l'osc silencieux
 *    monte vers 1 sur une courbe sin (crossfade equal-power) ;
 *  - pendant qu'il est au silence, l'osc devenu muet est rechargé avec la
 *    frame suivante via setPeriodicWave, pour être prêt pour le crossfade
 *    suivant (setPeriodicWave sur un osc audible provoquerait une
 *    discontinuité de phase → clic) ;
 *  - les courbes sont posées dans la timeline Web Audio (échantillon
 *    précis) ; seuls les changements de PeriodicWave passent par un timer.
 *  - la PeriodicWave de chaque prochaine frame n'est construite que lorsqu'on
 *    en a besoin (une par crossfade), via getWavetableFrameWave.
 *
 * Retourne { cancel, stopAt } :
 *  - cancel() annule le timer restant (appelé au noteOff) ;
 *  - stopAt() = instant absolu d'extinction des oscillateurs : la fin du
 *    crossfade EN COURS si le noteOff tombe en plein morph ("termine le
 *    morph puis coupe"), sinon maintenant.
 */
function startMorphScan(ctx, bundle, oscs, gains, startAt, morph, endMode) {
  const N = bundle.frames.length
  if (N <= 1) return null

  // morph invalide (NaN, ≤ 0) ne doit jamais tuer le scan → valeur sûre
  const safeMorph = Number.isFinite(morph) && morph > 0 ? morph : 0.2

  // frame jouée à la position "pos" de la séquence infinie de balayage
  const seqAt =
    endMode === "pingpong" && N > 2
      ? (pos) => {
          const period = 2 * (N - 1)
          const r = pos % period
          return r <= N - 1 ? r : period - r
        }
      : (pos) => pos % N

  let cur = 0 // index de l'oscillateur audible
  let prevEnd = -Infinity
  let cancelled = false
  let pendingPreload = null
  let timer = null

  const fire = (pos, t) => {
    if (cancelled) return
    const tt = Math.max(t, ctx.currentTime)

    // Auto-réparation : tout le corps est dans le try, la re-planification
    // (setTimeout) est à l'EXTÉRIEUR → aucune exception (automatisation,
    // rechargement, construction de frame) ne peut définitivement geler le
    // scan : le son continuera toujours d'évoluer.
    try {
      // l'osc devenu muet au crossfade précédent est rechargé avec la frame
      // qui sera cible du prochain crossfade, avant que son gain ne remonte.
      if (pendingPreload) {
        try {
          pendingPreload.osc.setPeriodicWave(pendingPreload.wave)
        } catch {}
        pendingPreload = null
      }

      const other = 1 - cur
      gains[other].gain.setValueCurveAtTime(MORPH_CURVE_UP, tt, safeMorph)
      gains[cur].gain.setValueCurveAtTime(MORPH_CURVE_DOWN, tt, safeMorph)

      const faded = cur
      cur = other
      prevEnd = tt + safeMorph

      // la frame suivante est construite maintenant et posée sur oscs[faded]
      // (devenu muet) par le prochain fire, safeMorph secondes plus tard.
      // getWavetableFrameWave garantit une onde non-nulle pour tout index
      // valide → le crossfade suivant aura toujours un contenu audible.
      const nextWave = getWavetableFrameWave(ctx, bundle, seqAt(pos + 1))
      pendingPreload = { osc: oscs[faded], wave: nextWave }
    } catch {
      // non bloquant : on réessaie au fire suivant
    }

    timer = setTimeout(() => fire(pos + 1, tt + safeMorph), safeMorph * 1000)
  }

  timer = setTimeout(
    () => fire(1, Math.max(ctx.currentTime, startAt)),
    Math.max(0, (startAt - ctx.currentTime) * 1000) + 1
  )

  return {
    cancel() {
      if (cancelled) return
      cancelled = true
      if (timer) clearTimeout(timer)
    },
    stopAt() {
      return Math.max(ctx.currentTime, prevEnd) + 0.05
    },
  }
}

/* =========================================================
 * Normalisation des graphes
 * (le patch peut être vide/incomplet au démarrage)
 * ========================================================= */

const emptyGraph = () => ({ modules: [], connections: [] })

function normalizeGraph(graph) {
  if (!graph) return emptyGraph()
  return {
    modules: graph.modules ?? [],
    connections: graph.connections ?? [],
  }
}

/* =========================================================
 * Envelope scheduler
 * ========================================================= */

/* Programme un cycle complet d'enveloppe sur le param, à partir de la date
 * absolue t0, sans toucher aux évènements déjà planifiés. */
function scheduleCycle(param, stages, ctx, velocity = 1, base = 1, t0) {
  let t = t0

  for (const stage of stages) {
    let from =
      stage.from === "current"
        ? param.value
        : stage.from * base

    let to = stage.to * velocity * base

    if (stage.curve === "exponential") {
      from = Math.max(EPS, from)
      to = Math.max(EPS, to)
    }

    param.setValueAtTime(from, t)
    t += stage.duration

    if (stage.curve === "exponential") {
      param.exponentialRampToValueAtTime(to, t)
    } else {
      param.linearRampToValueAtTime(to, t)
    }
  }

  return t - t0
}

function scheduleStages(param, stages, ctx, velocity = 1, base = 1, startOffset = 0) {
  const now = ctx.currentTime
  const t0 = now + startOffset

  if (param.cancelAndHoldAtTime) {
    param.cancelAndHoldAtTime(now)
  } else {
    const v = param.value
    param.cancelScheduledValues(now)
    param.setValueAtTime(v, now)
  }

  return scheduleCycle(param, stages, ctx, velocity, base, t0)
}

/* Enveloppe LOOPABLE : répète les stages "press" N fois en incrémentant le
 * décalage de la durée totale d'un cycle. Tout est planifié d'avance dans la
 * timeline Web Audio (les évènements se touchent exactement), aucune boucle
 * JS n'est exécutée pendant la lecture → précision échantillon, même pour
 * des cycles plus courts qu'un millisecond. */
function scheduleLoopingEnvelope(param, stages, ctx, velocity = 1, base = 1, startOffset = 0) {
  const cycle = getEnvelopeDuration(stages)
  if (!(cycle > 0)) {
    return scheduleStages(param, stages, ctx, velocity, base, startOffset)
  }

  const now = ctx.currentTime

  // reset UNE seule fois : cancelAndHoldAtTime annulerait les itérations posées
  if (param.cancelAndHoldAtTime) {
    param.cancelAndHoldAtTime(now)
  } else {
    const v = param.value
    param.cancelScheduledValues(now)
    param.setValueAtTime(v, now)
  }

  const total = Math.max(1, Math.ceil(LOOP_HORIZON_SECONDS / cycle))
  const n = Math.min(total, LOOP_MAX_SCHEDULES)
  const t0 = now + startOffset

  for (let i = 0; i < n; i++) {
    scheduleCycle(param, stages, ctx, velocity, base, t0 + i * cycle)
  }
}

/* =========================================================
 * Main composable
 * ========================================================= */

export function usePatchVoice(patch) {
  const audioCtx = ref(null)
  const voices = new Map()

  // accepte un objet patch direct OU une fonction getter (doit retourner
  // l'objet patch courant). setPatch permet de changer la source vers un
  // objet/reactif renouvelé sans recréer le contexte audio.
  let patchRef = patch
  const getPatch = () =>
    typeof patchRef === "function" ? patchRef() : patchRef
  function setPatch(p) {
    patchRef = p
  }

  const { get: getSuperDef } = useSuperModules()

  // MAIN PATCH (singleton)
  let mainNodes = null
  let mainInputNode = null
  let mainStarted = [] // nœuds à cycle de vie global (oscs, constants...)
  let mainRunning = false

  // AnalyserNode branché "juste avant la sortie" (pas une partie du patch) :
  // il est inséré automatiquement dans le câblage de tout module qui se
  // connecte au module "output" (destination) : module -> analyser -> sortie.
  // Il observe donc toujours le mix final réellement entendu.
  let masterAnalyser = null

  // GainNodes indépendants par piste de séquenceur (volume par piste)
  const trackGains = new Set()

  /* =========================
   * Init (lazy safe)
   * ========================= */

  /* Garde le contexte audio "running" en continu. Sans cette boucle, Chrome
   * suspend le AudioContext après un court moment sans interaction dans la page.
   * Or jouer via un clavier MIDI externe ne compte PAS comme interaction,
   * ce qui produit des "micros coupures" (pop) au début de chaque note. */
  let keepAlive = null
  function startKeepAlive() {
    if (keepAlive || !audioCtx.value) return
    try {
      const osc = audioCtx.value.createOscillator()
      const gain = audioCtx.value.createGain()
      gain.gain.value = 0
      osc.connect(gain)
      gain.connect(audioCtx.value.destination)
      osc.start()
      keepAlive = { osc, gain }
    } catch (e) {
      /* silencieux : le keep-alive est une optimisation, pas une nécessité */
    }
  }

  async function ensureContext() {
    if (!audioCtx.value) {
      audioCtx.value = new AudioContext()
      // chaîne maîtresse créée de façon synchrone avec le contexte :
      // le prochain buildMainPatch y routera forcément le son.
      ensureMasterAnalyser()
    }
    if (audioCtx.value.state !== "running") {
      try { await audioCtx.value.resume() } catch {}
    }
    if (audioCtx.value.state === "running") {
      startKeepAlive()
      ensureMasterAnalyser()
    }
  }

  /* Crée l'analyser de sortie (une seule fois), branché sur les haut-parleurs.
   * Il est PERMANENT : jamais déconnecté. Les modules sortant vers le module
   * "output" lui sont connectés dans wireConnection. */
  function ensureMasterAnalyser() {
    if (!audioCtx.value) return
    if (masterAnalyser) return
    const ctx = audioCtx.value

    masterAnalyser = ctx.createAnalyser()
    masterAnalyser.fftSize = 2048
    masterAnalyser.smoothingTimeConstant = 0.8

    masterAnalyser.connect(ctx.destination)
  }

  async function init() {
    await ensureContext()
    if (!mainNodes) {
      buildMainPatch()
    }
  }

  /* =========================================================
   * MOTEUR DE GRAPHE GÉNÉRIQUE
   *
   * Utilisé par : le patch principal, les voix, et récursivement
   * par les super-modules. Retourne une map d'entrées :
   *   id -> { node, params, bases, modulator?, isInput?,
   *           inputsByPort?, outputsByPort?, isSuper? }
   * ========================================================= */

  function instantiateModule(ctx, mod, o) {
    const now = ctx.currentTime
    const p = mod.params ?? {}

    // --- super-module enregistré ? ---
    const superDef = getSuperDef(mod.type)
    if (superDef) return instantiateSuper(ctx, superDef, p, o)

    // --- nœuds d'interface (uniquement à l'intérieur d'un super-module) ---
    if (mod.type === "super.in" || mod.type === "super.out") {
      const map = mod.type === "super.in" ? o.boundaryIn : o.boundaryOut
      if (!map || !map.has(mod.id)) return null
      return { node: map.get(mod.id), params: {}, bases: {} }
    }

    switch (mod.type) {

      case "input": {
        const g = ctx.createGain()
        g.gain.setValueAtTime(1, now)
        return { node: g, params: { gain: g.gain }, bases: { gain: 1 }, isInput: true }
      }

      case "voice":
      case "wavetable":
      case "osc": {
        const osc = ctx.createOscillator()
        if (mod.type === "wavetable") {
          const wave = buildPeriodicWave(ctx, p.wave)
          if (wave) osc.setPeriodicWave(wave)
        } else {
          osc.type = p.type || "sine"
        }
        const isNoteDriven = mod.type === "voice" || mod.type === "wavetable"
        const freq = isNoteDriven
          ? (o.note !== undefined ? noteToFreq(o.note) : p.frequency ?? 440)
          : p.frequency ?? 440
        const detune = p.detune ?? 0
        const delay = p.delay ?? 0
        osc.frequency.setValueAtTime(freq, now)
        osc.detune.setValueAtTime(detune, now)
        const startAt = now + delay
        if (!o.deferStart) safeStart(osc, startAt)
        o.started.push({ node: osc, delay, startAt })
        return {
          node: osc,
          delay,
          params: { frequency: osc.frequency, detune: osc.detune },
          bases: { frequency: freq, detune },
        }
      }

      case "wavetableS": {
        // "WavetableS" : table de wavetables (jusqu'à 255 frames) parcourue
        // par morphing à chaque note. Deux oscillateurs en double tampon et
        // deux gains de crossfade equal-power (voir startMorphScan).
        // Les frames sont parse/construites en cache paresseux (wt bundle) :
        // une note ne construit que les 2 premières frames.
        const bundle = getWavetableBundle(ctx, p.wave)
        const N = bundle.frames.length
        const oscs = [ctx.createOscillator(), ctx.createOscillator()]
        const gains = [ctx.createGain(), ctx.createGain()]
        const master = ctx.createGain()
        master.gain.setValueAtTime(1, now)

        const freq =
          o.note !== undefined ? noteToFreq(o.note) : p.frequency ?? 440
        const detune = p.detune ?? 0
        const delay = p.delay ?? 0
        // borné à 10 ms : les setValueCurveAtTime trop courts sont rejetés
        const morph = Math.max(0.01, (p.morph ?? 200) / 1000)

        oscs[0].setPeriodicWave(getWavetableFrameWave(ctx, bundle, 0))
        oscs[1].setPeriodicWave(
          getWavetableFrameWave(ctx, bundle, Math.max(0, Math.min(1, N - 1)))
        )
        for (const osc of oscs) {
          osc.frequency.setValueAtTime(freq, now)
          osc.detune.setValueAtTime(detune, now)
        }
        gains[0].gain.setValueAtTime(1, now)
        gains[1].gain.setValueAtTime(0, now)

        const startAt = now + delay
        if (!o.deferStart) {
          safeStart(oscs[0], startAt)
          safeStart(oscs[1], startAt)
        }
        oscs.forEach((osc) => o.started.push({ node: osc, delay, startAt }))

        oscs[0].connect(gains[0])
        oscs[1].connect(gains[1])
        gains[0].connect(master)
        gains[1].connect(master)

        // balayage mode 1 : boucle tant que la note est tenue,
        // noteOff après le crossfade en cours
        const scan = startMorphScan(
          ctx,
          bundle,
          oscs,
          gains,
          startAt,
          morph,
          p.endMode
        )
        if (scan) {
          o.stopOverride.set(oscs[0], scan.stopAt)
          o.stopOverride.set(oscs[1], scan.stopAt)
          o.voiceStopHooks.push(scan.cancel)
        }

        return {
          node: master,
          delay,
          params: { frequency: oscs[0].frequency, detune: oscs[0].detune },
          bases: { frequency: freq, detune },
        }
      }

      case "fx": {
        // "Sampler" : joue un fichier audio à la fréquence de la note.
        // Le playbackRate est dérivé de la note MIDI (comme l'oscillateur voice).
        const src = ctx.createBufferSource()
        const buffer = p.buffer ? getAudioBuffer(p.buffer) : null
        if (buffer) src.buffer = buffer

        const freq =
          o.note !== undefined ? noteToFreq(o.note) : p.frequency ?? 440
        const detune = p.detune ?? 0
        // vitesse de lecture : relative à C4=261.63 Hz (fréquence de référence
        // du sample, supposée rendue en MIDI 60 → ratio 1.0 pour la note 60 ? Non :
        // on normalise sur 440 Hz / A4 pour une transposition musicale cohérente)
        src.playbackRate.setValueAtTime(freq / 440, now)
        src.detune.setValueAtTime(detune, now)

        const delay = p.delay ?? 0

        // plage de lecture (ms -> secondes) : end > 0 fixe la fin, end = 0 = fin du fichier
        let offset = Math.max(0, (p.start ?? 0) / 1000)
        let endSec = (p.end ?? 0) / 1000

        if (buffer) {
          const dur = buffer.duration
          offset = Math.min(offset, dur)
          endSec = endSec > 0 ? Math.min(Math.max(endSec, offset), dur) : dur
        }

        if (p.loop && buffer) {
          src.loop = true
          src.loopStart = offset
          src.loopEnd = endSec
        }

        const playDuration = endSec > offset ? endSec - offset : 0

        // En boucle, on NE passe PAS de "duration" à start() : dans Web Audio,
        // un start(when, offset, duration) stoppe le node après "duration"
        // secondes de SORTIE, même si loop est actif → le son couperait après
        // une durée totale du fichier. Sans duration, la boucle tourne jusqu'au
        // stop() de la voix (noteOff).
        const startArgs = p.loop && buffer ? [offset] : [offset, playDuration]

        if (buffer) {
          const startAt = now + delay
          if (!o.deferStart) safeStart(src, startAt, ...startArgs)
          o.started.push({ node: src, delay, startAt, args: startArgs })
        }

        return {
          node: src,
          delay,
          params: { playbackRate: src.playbackRate, detune: src.detune },
          bases: { playbackRate: freq / 440, detune },
        }
      }

      case "gain": {
        const g = ctx.createGain()
        const gain = p.gain ?? 1
        g.gain.setValueAtTime(gain, now)
        return { node: g, params: { gain: g.gain }, bases: { gain } }
      }

      case "delay": {
        const d = ctx.createDelay(5)
        const time = p.delayTime ?? 0.3
        d.delayTime.setValueAtTime(time, now)
        return { node: d, params: { delayTime: d.delayTime }, bases: { delayTime: time } }
      }

      case "convolver": {
        const cv = ctx.createConvolver()
        cv.normalize = p.normalize ?? true
        if (p.buffer) {
          const buf = getAudioBuffer(p.buffer)
          if (buf) cv.buffer = buf
        }
        return { node: cv, params: {}, bases: {} }
      }

      case "waveshaper": {
        // drive = pré-gain devant la courbe tanh : c'est un AudioParam
        // modulable (enveloppe/CV). node = le WaveShaper (sortie) ;
        // inputNode = le gain de drive (le son entre par là).
        const driveGain = ctx.createGain()
        const drive = p.drive ?? 1
        driveGain.gain.setValueAtTime(drive, now)

        const ws = ctx.createWaveShaper()
        ws.curve = buildTanhCurve()
        ws.oversample = p.oversample || "none"

        driveGain.connect(ws)

        return {
          node: ws,
          inputNode: driveGain,
          params: { drive: driveGain.gain },
          bases: { drive },
        }
      }

      case "compressor": {
        const c = ctx.createDynamicsCompressor()
        c.threshold.setValueAtTime(p.threshold ?? -24, now)
        c.knee.setValueAtTime(p.knee ?? 30, now)
        c.ratio.setValueAtTime(p.ratio ?? 12, now)
        c.attack.setValueAtTime(p.attack ?? 0.003, now)
        c.release.setValueAtTime(p.release ?? 0.25, now)
        return {
          node: c,
          params: {
            threshold: c.threshold,
            knee: c.knee,
            ratio: c.ratio,
            attack: c.attack,
            release: c.release,
          },
          bases: { ...p },
        }
      }

      case "channelSplitter": {
        const s = ctx.createChannelSplitter(4)
        return { node: s, params: {}, bases: {} }
      }

      case "channelMerger": {
        const m = ctx.createChannelMerger(4)
        return { node: m, params: {}, bases: {} }
      }

      case "panner": {
        const pn = ctx.createPanner()
        pn.panningModel = p.panningModel || "equalpower"
        pn.distanceModel = p.distanceModel || "inverse"
        pn.refDistance = p.refDistance ?? 1
        pn.maxDistance = p.maxDistance ?? 10000
        pn.rolloffFactor = p.rolloffFactor ?? 1
        pn.coneInnerAngle = p.coneInnerAngle ?? 360
        pn.coneOuterAngle = p.coneOuterAngle ?? 360
        pn.coneOuterGain = p.coneOuterGain ?? 0

        const pos = {
          X: p.positionX ?? 0,
          Y: p.positionY ?? 0,
          Z: p.positionZ ?? 1,
          oX: p.orientationX ?? 1,
          oY: p.orientationY ?? 0,
          oZ: p.orientationZ ?? 0,
        }
        pn.positionX.setValueAtTime(pos.X, now)
        pn.positionY.setValueAtTime(pos.Y, now)
        pn.positionZ.setValueAtTime(pos.Z, now)
        pn.orientationX.setValueAtTime(pos.oX, now)
        pn.orientationY.setValueAtTime(pos.oY, now)
        pn.orientationZ.setValueAtTime(pos.oZ, now)

        return {
          node: pn,
          params: {
            positionX: pn.positionX,
            positionY: pn.positionY,
            positionZ: pn.positionZ,
            orientationX: pn.orientationX,
            orientationY: pn.orientationY,
            orientationZ: pn.orientationZ,
          },
          bases: { ...pos },
        }
      }

      case "stereoPanner": {
        const sp = ctx.createStereoPanner()
        const pan = p.pan ?? 0
        sp.pan.setValueAtTime(pan, now)
        return { node: sp, params: { pan: sp.pan }, bases: { pan } }
      }

      /* Filtres biquad (filter_lowpass, filter_highpass, ...) */
      case "filter_lowpass":
      case "filter_highpass":
      case "filter_bandpass":
      case "filter_notch":
      case "filter_peaking":
      case "filter_lowshelf":
      case "filter_highshelf": {
        const f = ctx.createBiquadFilter()
        f.type = mod.type.replace("filter_", "")
        const freq = p.frequency ?? 1000
        const q = p.Q ?? 1
        f.frequency.setValueAtTime(freq, now)
        f.Q.setValueAtTime(q, now)
        const params = { frequency: f.frequency, Q: f.Q }
        const bases = { frequency: freq, Q: q }
        if (p.gain !== undefined) {
          f.gain.setValueAtTime(p.gain, now)
          params.gain = f.gain
          bases.gain = p.gain
        }
        return { node: f, params, bases }
      }

      case "constant": {
        const constantNode = ctx.createConstantSource()
        const value = p.value ?? 1
        constantNode.offset.setValueAtTime(value, now)

        // port "in" : le flux d'entrée module l'offset (a-rate) via un gain
        const modIn = ctx.createGain()
        modIn.gain.setValueAtTime(1, now)
        modIn.connect(constantNode.offset)

        if (!o.deferStart) safeStart(constantNode, now)
        o.started.push({ node: constantNode, delay: 0, startAt: now })

        return {
          node: constantNode,
          inputNode: modIn,
          inParam: constantNode.offset, // une enveloppe/CV branchée sur "in" programme l'offset
          params: { offset: constantNode.offset },
          bases: { offset: value, in: value },
        }
      }

      case "destination": {
        if (!o.destinationNode) return null
        return { node: o.destinationNode, params: {}, bases: {} }
      }

      case "envelope":
        return {
          modulator: true,
          modType: "envelope",
          modParams: p,
          node: null,
          params: {},
          bases: {},
        }
    }

    // type inconnu (ex: définition supprimée) -> ignoré silencieusement
    return null
  }

  /* =========================================================
   * INSTANCIATION D'UN SUPER-MODULE
   * ========================================================= */

  function instantiateSuper(ctx, def, instanceParams, o) {
    // 1. cloner le graphe interne et router les paramètres de l'instance
    //    (paramMap: clé aplatie -> { moduleId, key } interne)
    const modules = (def.graph.modules ?? []).map((m) =>
      JSON.parse(JSON.stringify(m))
    )

    for (const [flat, route] of Object.entries(def.paramMap ?? {})) {
      if (!(flat in instanceParams)) continue
      const target = modules.find((m) => m.id === route.moduleId)
      if (!target) continue
      target.params[route.key] = JSON.parse(
        JSON.stringify(instanceParams[flat])
      )
    }

    // 2. gains de bordure : un par port d'interface exposé
    const inputsByPort = new Map()
    const outputsByPort = new Map()

    for (const port of def.inputs) {
      const g = ctx.createGain()
      g.gain.setValueAtTime(1, ctx.currentTime)
      inputsByPort.set(port.portId, g)
    }
    for (const port of def.outputs) {
      const g = ctx.createGain()
      g.gain.setValueAtTime(1, ctx.currentTime)
      outputsByPort.set(port.portId, g)
    }

    // correspondance moduleId interne -> gain de bordure
    const boundaryIn = new Map(
      def.inputs.map((port) => [port.moduleId, inputsByPort.get(port.portId)])
    )
    const boundaryOut = new Map(
      def.outputs.map((port) => [port.moduleId, outputsByPort.get(port.portId)])
    )

    // 3. construire le graphe interne (récursion possible : super dans super)
    const inner = buildGraph(ctx, { modules, connections: def.graph.connections }, {
      note: o.note,
      velocity: o.velocity,
      destinationNode: o.destinationNode,
      deferStart: o.deferStart,
      started: o.started,
      activeEnvs: o.activeEnvs,
      boundaryIn,
      boundaryOut,
      stopOverride: o.stopOverride,
      voiceStopHooks: o.voiceStopHooks,
    })

    // 3bis. ports d'entrée reliés à des AudioParams internes (ex: detune) :
    // une enveloppe/CV branchée sur le port programme chacun d'eux
    const modTargetsByPort = new Map()
    for (const port of def.inputs) {
      const tList = []
      for (const c of def.graph.connections ?? []) {
        if (c.from?.id !== port.moduleId) continue
        const [, toPort = "in"] = (c.to.port ?? "in:in").split(":")
        const tgt = inner.nodes.get(c.to?.id)
        const param = tgt?.params?.[toPort]
        if (param && typeof param.setValueAtTime === "function") {
          tList.push({ param, base: tgt.bases?.[toPort] ?? 1 })
        }
      }
      if (tList.length) modTargetsByPort.set(port.portId, tList)
    }

    // 4. exposer les AudioParams internes modulables depuis l'extérieur
    //    (ex: supervoice.gain est directement le GainNode interne)
    const params = {}
    const bases = {}
    for (const [flat, route] of Object.entries(def.paramMap ?? {})) {
      const target = inner.nodes.get(route.moduleId)
      const param = target?.params?.[route.key]
      if (param && typeof param.setValueAtTime === "function") {
        params[flat] = param
        bases[flat] = target.bases?.[route.key] ?? 1
      }
    }

    // sortie "par défaut" si un seul port de sortie (compat ancien câblage)
    const firstOutput = outputsByPort.values().next().value ?? null

    return {
      node: firstOutput,
      params,
      bases,
      inputsByPort,
      outputsByPort,
      modTargetsByPort,
      isSuper: true,
    }
  }

  /* =========================================================
   * CONNEXIONS
   * ========================================================= */

  function wireConnection(ctx, c, nodes, o, audioDelay) {
    const from = nodes.get(c.from?.id)
    const to = nodes.get(c.to?.id)
    if (!from || !to) return

    const [, fromPort = "out"] = (c.from.port ?? "out:out").split(":")
    const [, toPort = "in"] = (c.to.port ?? "in:in").split(":")

    // --- cible : AudioNode ou AudioParam ---
    let target = null
    let modParam = null // AudioParam à moduler (entrée audio de super-module)
    let inParam = null // AudioParam modulé par un port "in" (ex: constant.offset)
    let modTargets = null // AudioParams internes ciblés par un port super.in

    if (to.isSuper) {
      const inNode = to.inputsByPort.get(toPort)
      // port d'entrée relié à des AudioParams internes (ex: detune) :
      // une enveloppe/CV doit programmer chacun de ces paramètres
      modTargets = to.modTargetsByPort?.get(toPort) ?? null
      if (inNode) {
        // le flux audio passe par le gain de bordure du port
        target = inNode
        modParam = inNode.gain
      } else {
        target = to.params?.[toPort] ?? null
      }
    } else if (toPort === "in") {
      // certains modules (ex: waveshaper) ont un nœud d'entrée distinct
      // de leur nœud de sortie (pré-gain → node)
      target = to.inputNode ?? to.node
      inParam = to.inParam ?? null
    } else {
      target = to.params?.[toPort] ?? null
    }

    // --- enveloppe : aucun flux audio, on programme uniquement le paramètre ---
    if (from.modulator) {
      const stages = from.modParams.stages
      if (!stages?.press?.length) return

      const shift = audioDelay?.get(c.to.id) ?? 0
      const looping = stages.loop === true

      const scheduleOn = (param, baseValue, affectsAmplitude = false) => {
        if (!param || typeof param.setValueAtTime !== "function") return
        if (looping) {
          scheduleLoopingEnvelope(param, stages.press, ctx, o.velocity, baseValue, shift)
        } else {
          scheduleStages(param, stages.press, ctx, o.velocity, baseValue, shift)
        }
        o.activeEnvs.push({
          param,
          base: baseValue,
          release: stages.release,
          affectsAmplitude,
          modulatorType: from.modType,
        })
      }

      // port super.in relié à des AudioParams internes (ex: detune) :
      // l'enveloppe programme chaque paramètre à sa valeur de base
      if (modTargets?.length) {
        const replace = from.modParams.modulation === "replace"
        for (const { param, base } of modTargets) {
          scheduleOn(param, replace ? 1 : base)
        }
        return
      }

      const param = modParam ?? inParam ?? target
      const paramName = modParam ? "gain" : inParam ? "in" : toPort
      let baseValue = 1
      if (from.modParams.modulation === "relative") {
        baseValue = to.bases?.[paramName] ?? 1
      }
      scheduleOn(param, baseValue, paramName === "gain" || paramName === "in")
      return
    }

    // --- câblage audio classique ---
    let src = from.node
    if (from.isSuper) {
      src = from.outputsByPort.get(fromPort) ?? from.node
    }
    if (!src || !target) return

    // Tout flux audio qui atteint la sortie (module "output" du patch) passe
    // par l'analyser : module -> analyser -> haut-parleurs.
    // Un seul analyser suffit pour tous les cas (input -> comp -> output, etc).
    if (target === ctx.destination && masterAnalyser) {
      target = masterAnalyser
    }

    try { src.connect(target) } catch {}
  }

  /**
   * Détermine le delay "audio" qui affecte chaque module :
   * pour un module recevant le son d'un oscillateur décalé, retourne ce delay.
   * En cas de plusieurs oscillateurs (delays différents) vers la même cible,
   * on garde le PLUS PETIT delay (cohérence : on ne retarde pas un son déjà là).
   */
  function computeAudioDelays(graph, nodes) {
    const delay = new Map()

    for (const [id, entry] of nodes) {
      if (entry.delay !== undefined) delay.set(id, entry.delay)
    }

    const edges = []
    for (const c of graph.connections ?? []) {
      const from = nodes.get(c.from?.id)
      const to = nodes.get(c.to?.id)
      if (!from || !to || from.modulator) continue
      const [, toPort = "in"] = (c.to.port ?? "in:in").split(":")
      // seul un flux audio entrant dans un module propage le delay
      if (toPort !== "in") continue
      edges.push([c.from.id, c.to.id])
    }

    let changed = true
    let guard = 0
    while (changed && guard++ < 500) {
      changed = false
      for (const [fromId, toId] of edges) {
        const d = delay.get(fromId)
        if (d === undefined) continue
        const cur = delay.get(toId)
        if (cur === undefined || d < cur) {
          delay.set(toId, d)
          changed = true
        }
      }
    }

    return delay
  }

  /**
   * Construit un graphe complet (modules + connexions).
   * @returns {{ nodes: Map, }}
   */
  function buildGraph(ctx, graph, opts) {
    const o = {
      note: opts.note,
      velocity: opts.velocity ?? 1,
      destinationNode: opts.destinationNode ?? null,
      deferStart: opts.deferStart ?? false,
      started: opts.started ?? [],
      activeEnvs: opts.activeEnvs ?? [],
      boundaryIn: opts.boundaryIn ?? null,
      boundaryOut: opts.boundaryOut ?? null,
      stopOverride: opts.stopOverride ?? new Map(),
      voiceStopHooks: opts.voiceStopHooks ?? [],
    }

    const nodes = new Map()

    // passe 1 : instanciation
    for (const mod of graph.modules ?? []) {
      const entry = instantiateModule(ctx, mod, o)
      if (entry) nodes.set(mod.id, entry)
    }

    // passe 1bis : propagation du delay le long du chemin audio (osc → gain)
    const audioDelay = computeAudioDelays(graph, nodes)

    // passe 2 : câblage (+ déclenchement des enveloppes, décalées si besoin)
    for (const c of graph.connections ?? []) {
      wireConnection(ctx, c, nodes, o, audioDelay)
    }

    return { nodes }
  }

  /* =========================================================
   * MAIN PATCH
   * ========================================================= */

  function buildMainPatch() {
    const ctx = audioCtx.value

    const started = []

    const { nodes } = buildGraph(ctx, normalizeGraph(getPatch()?.mainPatch), {
      destinationNode: ctx.destination,
      deferStart: true, // démarrés explicitement dans startMainPatch
      started,
    })

    mainNodes = nodes
    mainStarted = started

    // le module "input" devient le point d'entrée global des voix
    mainInputNode = null
    for (const entry of nodes.values()) {
      if (entry.isInput) mainInputNode = entry.node
    }
  }

  function startMainPatch() {
    if (mainRunning) return
    if (!audioCtx.value) return
    const now = audioCtx.value.currentTime
    for (const s of mainStarted) {
      // args : offset/duration optionnels des bufferSources (fx) ;
      // vides pour les oscillateurs/constant → start(t) seul.
      safeStart(s.node, now + (s.delay ?? 0), ...(s.args ?? []))
    }
    mainRunning = true
  }

  function stopMainPatch() {
    if (!mainRunning) return
    const now = audioCtx.value.currentTime
    for (const s of mainStarted) {
      safeStop(s.node, now + 0.001)
    }
    mainRunning = false
    mainStarted = []
  }

  function disconnectEntry(entry) {
    if (!entry) return
    // la sortie globale (ctx.destination) et l'analyser sont PERMANENTS :
    // on ne les déconnecte jamais (sinon plus rien ne sort des haut-parleurs).
    const dest = audioCtx.value?.destination
    if (entry.node !== dest && entry.node !== masterAnalyser) safeDisconnect(entry.node)
    entry.inputsByPort?.forEach((g) => safeDisconnect(g))
    entry.outputsByPort?.forEach((g) => safeDisconnect(g))
  }

  function teardownMainPatch() {
    stopAll()
    stopMainPatch()

    if (!mainNodes) return
    for (const entry of mainNodes.values()) {
      disconnectEntry(entry)
    }

    mainNodes = null
    mainInputNode = null
  }

  function rebuildMainPatch() {
    teardownMainPatch()
    buildMainPatch()
    startMainPatch()
    reconnectTrackGains()
    ensureMasterAnalyser()
  }

  /* =========================================================
   * GAIN PAR PISTE (volume indépendant)
   * Chaque piste du séquenceur possède son GainNode inséré
   * entre les voix de la piste et l'entrée du patch principal.
   * ========================================================= */

  function connectTrackGain(gain) {
    if (!mainInputNode) return
    try { gain.connect(mainInputNode) } catch {}
  }

  function reconnectTrackGains() {
    for (const g of trackGains) connectTrackGain(g)
  }

  function createTrackGainNode() {
    const ctx = audioCtx.value
    const gain = ctx.createGain()
    gain.gain.setValueAtTime(1, ctx.currentTime)

    trackGains.add(gain)
    connectTrackGain(gain)

    return {
      node: gain,
      setVolume(v) {
        gain.gain.setValueAtTime(v, audioCtx.value.currentTime)
      },
      dispose() {
        safeDisconnect(gain)
        trackGains.delete(gain)
      },
    }
  }

  /* =========================================================
   * VOICES
   * ========================================================= */

  function createVoice(note, velocity = 1, destinationNode = mainInputNode) {
    const ctx = audioCtx.value

    const started = []
    const activeEnvs = []
    const stopOverride = new Map()
    const voiceStopHooks = []

    const { nodes } = buildGraph(ctx, normalizeGraph(getPatch()?.voicePatch), {
      note,
      velocity,
      destinationNode,
      started,
      activeEnvs,
      stopOverride,
      voiceStopHooks,
    })

    return {
      nodes,

      stop() {
        const now = ctx.currentTime
        let maxRelease = 0
        let hasAmpEnv = false

        for (const hook of voiceStopHooks) {
          try {
            hook()
          } catch {}
        }

        for (const env of activeEnvs) {
          env.param.cancelScheduledValues(now)
          scheduleStages(env.param, env.release, ctx, 1, env.base)
          maxRelease = Math.max(maxRelease, getEnvelopeDuration(env.release))
          if (env.affectsAmplitude) hasAmpEnv = true
        }

        const tail = hasAmpEnv ? maxRelease + 0.05 : 0.05

        for (const s of started) {
          // un module peut imposer l'instant d'extinction (ex: wavetableS :
          // terminer le crossfade en cours avant de couper)
          const stopFn = stopOverride.get(s.node)
          const stopAt = stopFn
            ? Math.max(now, stopFn())
            : Math.max(now + tail, s.startAt ?? now)
          // ne jamais stopper un osc décalé AVANT son démarrage prévu
          safeStop(s.node, stopAt)
        }
      },
    }
  }

  /* =========================================================
   * Public API
   * ========================================================= */

  async function noteOn(note, velocity = 1, destinationNode = mainInputNode, voiceKey = null) {
    await init()
    startMainPatch()

    // Les voix sortent vers l'entrée du patch principal si elle existe,
    // sinon directement sur la sortie (via l'analyser).
    if (!destinationNode) destinationNode = audioCtx.value?.destination

    const key = voiceKey ?? note

    if (voices.has(key)) {
      voices.get(key).stop()
      voices.delete(key)
    }

    voices.set(key, createVoice(note, velocity, destinationNode))
  }

  function noteOff(note, voiceKey = null) {
    const key = voiceKey ?? note
    const voice = voices.get(key)
    if (!voice) return
    voice.stop()
    voices.delete(key)
  }

  function stopAll() {
    for (const v of voices.values()) v.stop()
    voices.clear()
  }

  /**
   * Met à jour dynamiquement la valeur d'un module 'constant'
   * du patch principal ou des voix actives.
   */
  function updateConstantValue(patchType, moduleId, newValue) {
    if (!audioCtx.value) return

    const now = audioCtx.value.currentTime
    const apply = (nodesMap) => {
      const entry = nodesMap?.get(moduleId)
      if (entry?.params?.offset) {
        entry.params.offset.setValueAtTime(newValue, now)
      }
    }

    if (patchType === "main") {
      apply(mainNodes)
    } else {
      for (const voice of voices.values()) apply(voice.nodes)
    }
  }

  return {
    init,
    rebuildMainPatch,
    noteOn,
    noteOff,
    stopAll,
    updateConstantValue,
    createTrackGainNode,
    setPatch,
    getContext: () => audioCtx.value,
    getAnalyser: () => masterAnalyser,
  }
}
