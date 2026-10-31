// composables/useSharedVoice.js
// Gestionnaire audio partagé entre toutes les pistes du séquenceur, le clavier
// et les visualiseurs.
//
// Un seul AudioContext + un seul analyser maître. Un SynthPatch est instancié
// récursivement :
//
//   SynthPatchInstance
//     ├─ synth engines (un par nœud Synth) ──► graphe voice ──► voiceBus
//     ├─ SuperSynth instances (récursives) ──┘                    │
//     │                                                           ▼
//     └─ graphe main ─────────────────────────────────────► sortie / analyser
//
// Chaque nœud Synth/SuperSynth reçoit les notes indépendamment. Un SuperSynth
// propage les notes à ses synthés internes ; deux instances du même SuperSynth
// possèdent des moteurs et des graphes distincts.

import { usePatchVoice } from "./usePatchVoice.js"
import { useSuperModules } from "./useSuperModules.js"
import { getAudioBuffer, ensureAudioBuffer } from "./useAudioBufferCache.js"
import { normalizeSynthPatch } from "./useSynthPatch.js"

let sharedPatch = null
let manager = null

/* =========================================================
 * Parcours récursif des graphes (buffers audio)
 * ========================================================= */

function eachGraph(patch, fn) {
  if (!patch) return

  if (Array.isArray(patch.synths)) {
    for (const synth of patch.synths) eachGraph(synth, fn)
  }

  // Ancien format et synthé individuel.
  if (patch.voicePatch) fn(patch.voicePatch)
  if (patch.mainPatch) fn(patch.mainPatch)

  // SynthPatch : couches voice/main + graphes embarqués.
  for (const layer of [patch.voice, patch.main]) {
    if (!layer) continue
    fn(layer)
    for (const mod of layer.modules ?? []) {
      if (mod?.type === "synth") {
        if (mod.params?.voicePatch) fn(mod.params.voicePatch)
        if (mod.params?.mainPatch) fn(mod.params.mainPatch)
      } else if (mod?.type === "superSynth") {
        eachGraph(mod.params?.synthPatch, fn)
      }
    }
  }
}

/** Vrai si un graph référence ce fichier audio. */
function graphUsesBuffer(graph, key) {
  return Boolean(
    graph &&
      Array.isArray(graph.modules) &&
      graph.modules.some((m) => m?.params?.buffer === key)
  )
}

/** Vrai si le patch partagé (tous graphes confondus) référence ce fichier. */
function patchUsesBuffer(patch, key) {
  let used = false
  eachGraph(patch, (graph) => {
    if (graphUsesBuffer(graph, key)) used = true
  })
  return used
}

/** Collecte les clés de fichiers audio référencées par tous les graphes. */
function collectBufferKeys(patch) {
  const keys = new Set()
  eachGraph(patch, (graph) => {
    if (!graph || !Array.isArray(graph.modules)) return
    for (const mod of graph.modules) {
      const b = mod?.params?.buffer
      if (typeof b === "string" && b) keys.add(b)
    }
  })
  return [...keys]
}

/* =========================================================
 * Instance récursive d'un SynthPatch
 * ========================================================= */

function createSynthPatchInstance({ getPatch, context, outputNode }) {
  const ctx = context
  let normalized = normalizeSynthPatch(getPatch?.())

  /** moduleId -> { id, synth, engine, output, trackGains: Map<track, gain> } */
  const synthRecords = new Map()

  /** moduleId -> { id, module, child, output } */
  const superRecords = new Map()

  /** moduleId -> { output, input } (utilisé par les modules synth/superSynth) */
  const synthNodes = new Map()

  /** Pistes vues par cette instance (pour reconnecter les gains après rebuild). */
  const tracks = new Set()

  let mainHost = null
  let voiceHost = null
  let voiceBus = null
  let initPromise = null

  // Bornes super.in / super.out du graphe main (SuperSynth).
  let mainInGain = null
  let mainOutGain = null
  let mainBoundaryIn = new Map()
  let mainBoundaryOut = new Map()

  /* ---------- Patch courant ---------- */

  function refreshPatch() {
    normalized = normalizeSynthPatch(getPatch?.())
  }

  function ensureBoundaryGains() {
    if (!mainInGain) {
      mainInGain = ctx.createGain()
      mainInGain.gain.value = 1
    }
    if (!mainOutGain) {
      mainOutGain = ctx.createGain()
      mainOutGain.gain.value = 1
    }
  }

  function syncBoundaries() {
    ensureBoundaryGains()
    const inMap = new Map()
    const outMap = new Map()
    for (const mod of normalized.main.modules ?? []) {
      if (mod.type === "super.in") inMap.set(mod.id, mainInGain)
      else if (mod.type === "super.out") outMap.set(mod.id, mainOutGain)
    }
    mainBoundaryIn = inMap
    mainBoundaryOut = outMap
  }

  /* ---------- Enfants : synthés et SuperSynth ---------- */

  function createSynthRecord(module) {
    const output = ctx.createGain()
    output.gain.value = 1

    const record = {
      id: module.id,
      synth: null,
      engine: null,
      output,
      trackGains: new Map(),
    }

    record.synth = {
      id: module.id,
      name: module.params?.name ?? "Synth",
      voicePatch: module.params?.voicePatch,
      mainPatch: module.params?.mainPatch,
    }

    record.engine = usePatchVoice(() => record.synth, {
      context: ctx,
      outputNode: output,
      manageContext: false,
    })

    return record
  }

  function updateSynthRecord(record, module) {
    record.synth = {
      id: module.id,
      name: module.params?.name ?? "Synth",
      voicePatch: module.params?.voicePatch,
      mainPatch: module.params?.mainPatch,
    }
    record.engine.setPatch(() => record.synth)
  }

  function createSuperRecord(module) {
    const output = ctx.createGain()
    output.gain.value = 1

    const child = createSynthPatchInstance({
      getPatch: () => module.params?.synthPatch,
      context: ctx,
      outputNode: output,
    })

    return { id: module.id, module, child, output }
  }

  function disposeSynthRecord(record) {
    record.engine.stopAll()
    for (const [track, gain] of record.trackGains) {
      try {
        gain.disconnect()
      } catch {}
      track.gains?.delete(gain)
    }
    record.trackGains.clear()
    try {
      record.output.disconnect()
    } catch {}
  }

  function syncChildren() {
    refreshPatch()

    const voiceModules = normalized.voice.modules ?? []
    const nextSynthIds = new Set()
    const nextSuperIds = new Set()

    for (const module of voiceModules) {
      if (module.type === "synth") {
        nextSynthIds.add(module.id)
        let record = synthRecords.get(module.id)
        if (!record) {
          record = createSynthRecord(module)
          synthRecords.set(module.id, record)
        } else {
          updateSynthRecord(record, module)
        }
        synthNodes.set(module.id, {
          output: record.output,
          input: record.engine.getInputNode(),
        })
      } else if (module.type === "superSynth") {
        nextSuperIds.add(module.id)
        let record = superRecords.get(module.id)
        if (!record) {
          record = createSuperRecord(module)
          superRecords.set(module.id, record)
        } else {
          // Le rebuild du parent appellera child.rebuildAll(), qui relit
          // module.params.synthPatch via le getter.
          record.module = module
        }
        synthNodes.set(module.id, {
          output: record.output,
          input: record.child.getInputNode(),
        })
      }
    }

    for (const [id, record] of synthRecords) {
      if (nextSynthIds.has(id)) continue
      disposeSynthRecord(record)
      synthRecords.delete(id)
      synthNodes.delete(id)
    }

    for (const [id, record] of superRecords) {
      if (nextSuperIds.has(id)) continue
      record.child.dispose()
      try {
        record.output.disconnect()
      } catch {}
      superRecords.delete(id)
      synthNodes.delete(id)
    }
  }

  /* ---------- Gains par piste ---------- */

  function connectTrackGain(track, record) {
    if (!track) return null

    tracks.add(track)

    let gain = record.trackGains.get(track)
    if (!gain) {
      gain = ctx.createGain()
      gain.gain.setValueAtTime(track.volume ?? 1, ctx.currentTime)
      record.trackGains.set(track, gain)
      track.gains?.add(gain)
    } else {
      try {
        gain.disconnect()
      } catch {}
    }

    const input = record.engine.getInputNode() ?? record.engine.getOutputNode()
    if (input) {
      try {
        gain.connect(input)
      } catch {}
    }
    return gain
  }

  function reconnectTrackGains() {
    for (const track of tracks) {
      if (track.disposed) continue
      for (const record of synthRecords.values()) {
        connectTrackGain(track, record)
      }
    }
  }

  /* ---------- Hôtes voice / main ---------- */

  async function ensureHosts() {
    if (!mainHost) {
      mainHost = usePatchVoice(() => ({ mainPatch: normalized.main }), {
        context: ctx,
        outputNode,
        manageContext: false,
        mainBoundaryIn: () => mainBoundaryIn,
        mainBoundaryOut: () => mainBoundaryOut,
      })
    }
    await mainHost.init()
    mainHost.startMain()

    if (!voiceBus) {
      voiceBus = ctx.createGain()
      voiceBus.gain.value = 1
    }
    try {
      voiceBus.disconnect()
    } catch {}
    try {
      voiceBus.connect(mainHost.getInputNode() ?? outputNode)
    } catch {}

    if (!voiceHost) {
      voiceHost = usePatchVoice(() => ({ mainPatch: normalized.voice }), {
        context: ctx,
        outputNode: voiceBus,
        manageContext: false,
        getSynthNodes: () => synthNodes,
      })
    }
    await voiceHost.init()
    voiceHost.startMain()
  }

  /* ---------- Cycle de vie ---------- */

  async function init() {
    if (initPromise) return initPromise

    initPromise = (async () => {
      await useSuperModules().ready

      syncChildren()
      syncBoundaries()

      // 1. moteurs internes : les synthés construisent leur main + entrée
      for (const record of synthRecords.values()) {
        await record.engine.init()
        record.engine.startMain()
        synthNodes.set(record.id, {
          output: record.output,
          input: record.engine.getInputNode(),
        })
      }

      // 2. SuperSynth : instances récursives
      for (const record of superRecords.values()) {
        await record.child.init()
        synthNodes.set(record.id, {
          output: record.output,
          input: record.child.getInputNode(),
        })
      }

      // 3. couches voice/main du SynthPatch
      await ensureHosts()
    })()

    return initPromise
  }

  async function rebuildAll() {
    syncChildren()
    syncBoundaries()

    for (const record of synthRecords.values()) {
      record.engine.stopAll()
      await record.engine.rebuildMainPatch()
      record.engine.startMain()
      synthNodes.set(record.id, {
        output: record.output,
        input: record.engine.getInputNode(),
      })
    }

    for (const record of superRecords.values()) {
      await record.child.rebuildAll()
      synthNodes.set(record.id, {
        output: record.output,
        input: record.child.getInputNode(),
      })
    }

    if (mainHost) {
      await mainHost.rebuildMainPatch()
      mainHost.startMain()
    }

    if (voiceBus) {
      try {
        voiceBus.disconnect()
      } catch {}
      try {
        voiceBus.connect(mainHost?.getInputNode() ?? outputNode)
      } catch {}
    }

    if (voiceHost) {
      await voiceHost.rebuildMainPatch()
      voiceHost.startMain()
    }

    reconnectTrackGains()
  }

  function setPatch() {
    if (!initPromise) return Promise.resolve()
    return rebuildAll()
  }

  /* ---------- Notes ---------- */

  async function noteOn(note, velocity, track, voiceKey) {
    await init()

    const jobs = []
    for (const record of synthRecords.values()) {
      const dest = track ? connectTrackGain(track, record) : null
      jobs.push(record.engine.noteOn(note, velocity, dest, voiceKey))
    }
    for (const record of superRecords.values()) {
      jobs.push(record.child.noteOn(note, velocity, track, voiceKey))
    }

    await Promise.all(jobs)
  }

  function noteOff(note, voiceKey) {
    for (const record of synthRecords.values()) {
      record.engine.noteOff(note, voiceKey)
    }
    for (const record of superRecords.values()) {
      record.child.noteOff(note, voiceKey)
    }
  }

  function stopAll() {
    for (const record of synthRecords.values()) record.engine.stopAll()
    for (const record of superRecords.values()) record.child.stopAll()
  }

  function updateConstantValue(patchType, moduleId, value) {
    for (const record of synthRecords.values()) {
      record.engine.updateConstantValue(patchType, moduleId, value)
    }
    for (const record of superRecords.values()) {
      record.child.updateConstantValue(patchType, moduleId, value)
    }
    mainHost?.updateConstantValue("main", moduleId, value)
    voiceHost?.updateConstantValue("main", moduleId, value)
  }

  /* ---------- Introspection / libération ---------- */

  function getInputNode() {
    return mainHost?.getInputNode() ?? mainInGain
  }

  function getOutputNode() {
    return outputNode
  }

  function getSynthIds() {
    const ids = [...synthRecords.keys()]
    for (const record of superRecords.values()) {
      ids.push(...record.child.getSynthIds())
    }
    return ids
  }

  function getEngineById(id) {
    const record = synthRecords.get(id)
    if (record) return record.engine
    for (const record of superRecords.values()) {
      const found = record.child.getEngineById(id)
      if (found) return found
    }
    return null
  }

  async function rebuildSynth(id) {
    await init()

    const record = synthRecords.get(id)
    if (record) {
      record.engine.stopAll()
      await record.engine.rebuildMainPatch()
      record.engine.startMain()
      synthNodes.set(id, {
        output: record.output,
        input: record.engine.getInputNode(),
      })
      if (voiceHost) {
        await voiceHost.rebuildMainPatch()
        voiceHost.startMain()
      }
      reconnectTrackGains()
      return true
    }

    for (const child of superRecords.values()) {
      if (await child.child.rebuildSynth(id)) return true
    }
    return false
  }

  function dispose() {
    stopAll()

    for (const record of synthRecords.values()) disposeSynthRecord(record)
    synthRecords.clear()

    for (const record of superRecords.values()) {
      record.child.dispose()
      try {
        record.output.disconnect()
      } catch {}
    }
    superRecords.clear()

    synthNodes.clear()
    tracks.clear()

    try {
      voiceBus?.disconnect()
    } catch {}
    try {
      mainInGain?.disconnect()
    } catch {}
    try {
      mainOutGain?.disconnect()
    } catch {}
  }

  return {
    init,
    setPatch,
    rebuildAll,
    rebuildSynth,
    noteOn,
    noteOff,
    stopAll,
    reconnectTrackGains,
    updateConstantValue,
    getInputNode,
    getOutputNode,
    getSynthIds,
    getEngineById,
    dispose,
  }
}

/* =========================================================
 * Gestionnaire racine (contexte + analyser + pistes)
 * ========================================================= */

function createManager() {
  let audioCtx = null
  let masterAnalyser = null
  let keepAlive = null
  let initPromise = null
  let syncChain = Promise.resolve()

  let root = null

  /** AudioNode (jeton de piste) -> track { volume, gains, disposed } */
  const trackGainByNode = new Map()

  function ensureContext() {
    if (audioCtx) return audioCtx
    audioCtx = new AudioContext()

    masterAnalyser = audioCtx.createAnalyser()
    masterAnalyser.fftSize = 2048
    masterAnalyser.smoothingTimeConstant = 0.8
    masterAnalyser.connect(audioCtx.destination)

    return audioCtx
  }

  function startKeepAlive() {
    if (keepAlive || !audioCtx) return
    try {
      const osc = audioCtx.createOscillator()
      const gain = audioCtx.createGain()
      gain.gain.value = 0
      osc.connect(gain)
      gain.connect(audioCtx.destination)
      osc.start()
      keepAlive = { osc, gain }
    } catch {
      /* optimisation silencieuse */
    }
  }

  function init() {
    if (initPromise) return initPromise

    initPromise = (async () => {
      ensureContext()

      root = createSynthPatchInstance({
        getPatch: () => sharedPatch,
        context: audioCtx,
        outputNode: masterAnalyser,
      })

      await root.init()

      if (audioCtx.state !== "running") {
        try {
          await audioCtx.resume()
        } catch {}
      }
      startKeepAlive()
    })()

    return initPromise
  }

  function setPatch(patch) {
    sharedPatch = patch

    // Pas encore de contexte : init() fera le premier sync avec sharedPatch.
    if (!initPromise) return Promise.resolve()

    syncChain = syncChain
      .then(async () => {
        await initPromise
        await root?.setPatch()
      })
      .catch((e) => {
        console.error("Échec de la mise à jour du patch partagé :", e)
      })

    return syncChain
  }

  async function rebuildSynthPatch() {
    await init()
    await root?.rebuildAll()
  }

  const rebuildMainPatch = rebuildSynthPatch

  async function rebuildSynth(id) {
    await init()
    return root?.rebuildSynth(id)
  }

  async function noteOn(note, velocity = 1, destinationNode = null, voiceKey = null) {
    await init()
    const track = destinationNode ? trackGainByNode.get(destinationNode) : null
    await root?.noteOn(note, velocity, track, voiceKey)
  }

  function noteOff(note, voiceKey = null) {
    root?.noteOff(note, voiceKey)
  }

  function stopAll() {
    root?.stopAll()
  }

  function createTrackGainNode() {
    ensureContext()

    // Jeton stable pour la piste. Le signal ne passe pas par ce nœud : chaque
    // moteur reçoit son propre gain (voir connectTrackGain) afin d'éviter
    // toute fuite entre synthés et entre instances de SuperSynth.
    const node = audioCtx.createGain()
    node.gain.setValueAtTime(1, audioCtx.currentTime)

    const track = {
      node,
      volume: 1,
      gains: new Set(),
      disposed: false,
    }
    trackGainByNode.set(node, track)

    return {
      node,
      setVolume(v) {
        track.volume = v
        const now = audioCtx?.currentTime ?? 0
        for (const gain of track.gains) {
          try {
            gain.gain.setValueAtTime(v, now)
          } catch {}
        }
      },
      dispose() {
        for (const gain of track.gains) {
          try {
            gain.disconnect()
          } catch {}
        }
        track.gains.clear()
        track.disposed = true
        try {
          node.disconnect()
        } catch {}
        trackGainByNode.delete(node)
      },
    }
  }

  function updateConstantValue(patchType, moduleId, value) {
    root?.updateConstantValue(patchType, moduleId, value)
  }

  return {
    init,
    setPatch,
    rebuildMainPatch,
    rebuildSynthPatch,
    rebuildSynth,
    noteOn,
    noteOff,
    stopAll,
    createTrackGainNode,
    updateConstantValue,
    getSynthIds: () => root?.getSynthIds() ?? [],
    getSynthEngine: (id) => root?.getEngineById(id) ?? null,
    getContext: () => audioCtx,
    getAnalyser: () => masterAnalyser,
  }
}

/* =========================================================
 * API partagée (compatibilité avec les composants existants)
 * ========================================================= */

/** Renvoie le gestionnaire unique. */
export function getSharedVoice() {
  if (!manager) manager = createManager()
  return manager
}

/**
 * Garantit que le buffer référencé par `key` est disponible en cache,
 * rechargé depuis IndexedDB si besoin.
 */
export async function ensureSharedPatchBuffer(key) {
  if (!key) return

  const v = getSharedVoice()
  if (!v.getContext()) v.init().catch(() => {})
  const ctx = v.getContext()
  if (!ctx) return

  if (getAudioBuffer(key)) return // déjà chargé

  const loaded = await ensureAudioBuffer(key, ctx)
  if (!loaded) return

  if (patchUsesBuffer(sharedPatch, key)) {
    v.stopAll()
    await v.rebuildMainPatch()
  }
}

/**
 * Recharge depuis IndexedDB les buffers audio référencés par le patch.
 */
export async function hydratePatchBuffers(patch) {
  const keys = collectBufferKeys(patch)
  for (const key of keys) {
    await ensureSharedPatchBuffer(key)
  }
}

/** Met à jour le patch source du contexte partagé (et reconstruit les graphes). */
export function setSharedPatch(patch) {
  sharedPatch = patch

  if (manager) {
    manager.setPatch(patch).catch(() => {})
  }

  hydratePatchBuffers(patch).catch((e) => {
    console.error("Échec de la ré-hydratation des buffers audio :", e)
  })
}

export async function initSharedVoice() {
  return getSharedVoice().init()
}

/** Renvoie l'AnalyserNode branché juste avant la sortie (visualisation). */
export function getSharedAnalyser() {
  return getSharedVoice().getAnalyser()
}
