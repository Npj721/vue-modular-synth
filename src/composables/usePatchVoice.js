// composables/usePatchVoice.js
import { ref } from "vue"
import { useSuperModules } from "./useSuperModules"

/* =========================================================
 * Utils
 * ========================================================= */

const EPS = 0.0001

const noteToFreq = (note) =>
  440 * Math.pow(2, (note - 69) / 12)

function getEnvelopeDuration(stages = []) {
  return stages.reduce((t, s) => t + s.duration, 0)
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
 * Envelope scheduler
 * ========================================================= */

function scheduleStages(param, stages, ctx, velocity = 1, base = 1) {
  const now = ctx.currentTime

  if (param.cancelAndHoldAtTime) {
    param.cancelAndHoldAtTime(now)
  } else {
    const v = param.value
    param.cancelScheduledValues(now)
    param.setValueAtTime(v, now)
  }

  let t = now

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

  return t - now
}

/* =========================================================
 * Main composable
 * ========================================================= */

export function usePatchVoice(patch) {
  const audioCtx = ref(null)
  const voices = new Map()

  const { get: getSuperDef } = useSuperModules()

  // MAIN PATCH (singleton)
  let mainNodes = null
  let mainInputNode = null
  let mainStarted = [] // nœuds à cycle de vie global (oscs, constants...)
  let mainRunning = false

  /* =========================
   * Init (lazy safe)
   * ========================= */

  async function ensureContext() {
    if (!audioCtx.value) {
      audioCtx.value = new AudioContext()
    }
    if (audioCtx.value.state !== "running") {
      await audioCtx.value.resume()
    }
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
        osc.frequency.setValueAtTime(freq, now)
        osc.detune.setValueAtTime(detune, now)
        if (!o.deferStart) safeStart(osc, now)
        o.started.push(osc)
        return {
          node: osc,
          params: { frequency: osc.frequency, detune: osc.detune },
          bases: { frequency: freq, detune },
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
        o.started.push(constantNode)
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

  function wireConnection(ctx, c, nodes, o) {
    const from = nodes.get(c.from?.id)
    const to = nodes.get(c.to?.id)
    if (!from || !to) return

    const [, fromPort = "out"] = (c.from.port ?? "out:out").split(":")
    const [, toPort = "in"] = (c.to.port ?? "in:in").split(":")

    // --- source ---
    let src = from.node
    if (from.isSuper) {
      src = from.outputsByPort.get(fromPort) ?? from.node
    }
    if (!src) return

    // --- cible : AudioNode ou AudioParam ---
    let target = null
    if (to.isSuper) {
      target = to.inputsByPort.get(toPort) ?? to.params?.[toPort] ?? null
    } else if (toPort === "in") {
      target = to.node
    } else {
      target = to.params?.[toPort] ?? null
    }
    if (!target) return

    try { src.connect(target) } catch { return }

    // --- enveloppe branchée sur ce paramètre ? ---
    // (la cible doit être un AudioParam)
    if (from.modulator && typeof target.setValueAtTime === "function") {
      const paramName = toPort
      let baseValue = 1
      if (from.modParams.modulation === "relative") {
        baseValue = to.bases?.[paramName] ?? 1
      }

      const stages = from.modParams.stages
      if (!stages?.press?.length) return

      scheduleStages(target, stages.press, ctx, o.velocity, baseValue)

      o.activeEnvs.push({
        param: target,
        base: baseValue,
        release: stages.release,
        affectsAmplitude: paramName === "gain",
        modulatorType: from.modType,
      })
    }
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

    // passe 2 : câblage (+ déclenchement des enveloppes)
    for (const c of graph.connections ?? []) {
      wireConnection(ctx, c, nodes, o)
    }

    return { nodes }
  }

  /* =========================================================
   * MAIN PATCH
   * ========================================================= */

  function buildMainPatch() {
    const ctx = audioCtx.value

    const started = []

    const { nodes } = buildGraph(ctx, patch.mainPatch, {
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
    for (const node of mainStarted) {
      safeStart(node, now)
    }
    mainRunning = true
  }

  function stopMainPatch() {
    if (!mainRunning) return
    const now = audioCtx.value.currentTime
    for (const node of mainStarted) {
      safeStop(node, now + 0.001)
    }
    mainRunning = false
    mainStarted = []
  }

  function disconnectEntry(entry) {
    if (!entry) return
    safeDisconnect(entry.node)
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
  }

  /* =========================================================
   * VOICES
   * ========================================================= */

  function createVoice(note, velocity = 1) {
    const ctx = audioCtx.value

    const started = []
    const activeEnvs = []

    const { nodes } = buildGraph(ctx, patch.voicePatch, {
      note,
      velocity,
      destinationNode: mainInputNode,
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

        for (const node of started) {
          safeStop(node, now + tail)
        }
      },
    }
  }

  /* =========================================================
   * Public API
   * ========================================================= */

  async function noteOn(note, velocity = 1) {
    await init()
    startMainPatch()

    if (voices.has(note)) {
      voices.get(note).stop()
      voices.delete(note)
    }

    voices.set(note, createVoice(note, velocity))
  }

  function noteOff(note) {
    const voice = voices.get(note)
    if (!voice) return
    voice.stop()
    voices.delete(note)
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
  }
}
