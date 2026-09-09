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

const safeStart = (node, t) => {
  try { node.start(t) } catch {}
}

const safeStop = (node, t) => {
  try { node.stop(t) } catch {}
}

const safeDisconnect = (node) => {
  try { node.disconnect() } catch {}
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

    //param.setValueAtTime(from, t)
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
      case "osc": {
        const osc = ctx.createOscillator()
        osc.type = p.type || "sine"
        const freq =
          mod.type === "voice"
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
        if (p.loop && buffer) {
          src.loop = true
          src.loopStart = 0
          src.loopEnd = buffer.duration
        }
        if (buffer) {
          const startAt = now + delay
          if (!o.deferStart) safeStart(src, startAt)
          o.started.push({ node: src, delay, startAt })
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
        if (!o.deferStart) safeStart(constantNode, now)
        o.started.push({ node: constantNode, delay: 0, startAt: now })
        return {
          node: constantNode,
          params: { offset: constantNode.offset },
          bases: { value },
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
    })

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
    if (to.isSuper) {
      target = to.inputsByPort.get(toPort) ?? to.params?.[toPort] ?? null
    } else if (toPort === "in") {
      // certains modules (ex: waveshaper) ont un nœud d'entrée distinct
      // de leur nœud de sortie (pré-gain → node)
      target = to.inputNode ?? to.node
    } else {
      target = to.params?.[toPort] ?? null
    }

    // --- enveloppe : aucun flux audio, on programme uniquement le paramètre ---
    if (from.modulator) {
      if (!target || typeof target.setValueAtTime !== "function") return

      const paramName = toPort
      let baseValue = 1
      if (from.modParams.modulation === "relative") {
        baseValue = to.bases?.[paramName] ?? 1
      }

      const stages = from.modParams.stages
      if (!stages?.press?.length) return

      // si la cible est alimentée par un oscillateur décalé, l'attaque
      // de l'enveloppe démarre au même instant (release non décalé)
      const shift = audioDelay?.get(c.to.id) ?? 0
      if (stages.loop === true) {
        scheduleLoopingEnvelope(target, stages.press, ctx, o.velocity, baseValue, shift)
      } else {
        scheduleStages(target, stages.press, ctx, o.velocity, baseValue, shift)
      }

      o.activeEnvs.push({
        param: target,
        base: baseValue,
        release: stages.release,
        affectsAmplitude: paramName === "gain",
        modulatorType: from.modType,
      })
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
      safeStart(s.node, now + (s.delay ?? 0))
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

    const { nodes } = buildGraph(ctx, normalizeGraph(getPatch()?.voicePatch), {
      note,
      velocity,
      destinationNode,
      started,
      activeEnvs,
    })

    return {
      nodes,

      stop() {
        const now = ctx.currentTime
        let maxRelease = 0
        let hasAmpEnv = false

        for (const env of activeEnvs) {
          env.param.cancelScheduledValues(now)
          scheduleStages(env.param, env.release, ctx, 1, env.base)
          maxRelease = Math.max(maxRelease, getEnvelopeDuration(env.release))
          if (env.affectsAmplitude) hasAmpEnv = true
        }

        const tail = hasAmpEnv ? maxRelease + 0.05 : 0.05

        for (const s of started) {
          // ne jamais stopper un osc décalé AVANT son démarrage prévu
          const stopAt = Math.max(now + tail, s.startAt ?? now)
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
