// composables/useSynthPatch.js
//
// Modèle de données d'un "SynthPatch" : un patch de niveau supérieur qui
// contient des nœuds "Synth" (chacun avec son voicePatch + mainPatch) et des
// modules non pilotés par les notes.
//
// Deux couches :
//   voice : Synth nodes + modules non note-driven, terminé par destination
//           -> cette destination alimente l'entrée du graphe main.
//   main  : modules non note-driven uniquement, terminé par destination
//           -> cette destination alimente l'analyser puis ctx.destination.
//
// Un Synth node embarque sa définition complète dans ses params :
//   { name, voicePatch: {modules, connections}, mainPatch: {...} }
// Cela rend chaque instance indépendante et simplifie la sauvegarde.
//
// L'ancien format { version, name, voicePatch, mainPatch } reste accepté :
// il est normalisé en SynthPatch contenant un unique Synth.

const DEFAULT_SYNTH_ID = "synth-default"
const DEFAULT_VOICE_DEST_ID = "synth-voice-destination"
const DEFAULT_MAIN_INPUT_ID = "synth-main-input"
const DEFAULT_MAIN_DEST_ID = "synth-main-destination"

export function emptyGraph() {
  return { modules: [], connections: [] }
}

export function emptySynth(name = "Synth") {
  return {
    name,
    voicePatch: emptyGraph(),
    mainPatch: emptyGraph(),
  }
}

/** SynthPatch vide (utilisé comme définition initiale d'un SuperSynth). */
export function emptySynthPatch(name = "SuperSynth") {
  return {
    version: 2,
    name,
    voice: emptyGraph(),
    main: emptyGraph(),
  }
}

// Clone "données pures" : les graphes peuvent être des proxys Vue, que
// structuredClone refuse. JSON suffit (mêmes contraintes que le paper).
function deepClone(value) {
  if (value == null) return value
  return JSON.parse(JSON.stringify(value))
}

function cloneGraph(graph) {
  if (!graph) return emptyGraph()
  return {
    ...graph,
    modules: Array.isArray(graph.modules)
      ? graph.modules.map((m) => ({
          ...m,
          params: m?.params ? deepClone(m.params) : {},
        }))
      : [],
    connections: Array.isArray(graph.connections)
      ? graph.connections.map((c) => deepClone(c))
      : [],
  }
}

/** Crée un module "Synth" complet (définition embarquée dans params). */
export function createSynthModule({
  id = null,
  name = "Synth",
  voicePatch = null,
  mainPatch = null,
  position = { x: 80, y: 80 },
  label = "",
} = {}) {
  return {
    id: id ?? crypto.randomUUID(),
    type: "synth",
    label,
    params: {
      name,
      voicePatch: voicePatch ? cloneGraph(voicePatch) : emptyGraph(),
      mainPatch: mainPatch ? cloneGraph(mainPatch) : emptyGraph(),
    },
    position,
  }
}

/** Garantit qu'un module synth possède bien ses deux graphes. */
export function ensureSynthModule(module) {
  if (!module || module.type !== "synth") return module
  if (!module.params) module.params = {}
  if (!module.params.name) module.params.name = module.label || "Synth"
  if (!module.params.voicePatch) module.params.voicePatch = emptyGraph()
  if (!module.params.mainPatch) module.params.mainPatch = emptyGraph()
  return module
}

/** Garantit qu'un module SuperSynth possède une définition de SynthPatch. */
export function ensureSuperSynthModule(module) {
  if (!module || module.type !== "superSynth") return module
  if (!module.params) module.params = {}
  if (!module.params.name) module.params.name = module.label || "SuperSynth"
  if (!module.params.synthPatch) {
    module.params.synthPatch = emptySynthPatch(module.params.name)
  }
  return module
}

/**
 * SynthPatch par défaut : un Synth, relié à la destination de la couche voice,
 * et une couche main input -> destination.
 */
export function createDefaultSynthPatch({ name = "SynthPatch", synth = null } = {}) {
  const s = synth ?? emptySynth("Synth")

  return {
    version: 2,
    name,
    voice: {
      modules: [
        createSynthModule({
          id: DEFAULT_SYNTH_ID,
          name: s.name ?? "Synth",
          voicePatch: s.voicePatch,
          mainPatch: s.mainPatch,
          position: { x: 80, y: 80 },
        }),
        {
          id: DEFAULT_VOICE_DEST_ID,
          type: "destination",
          label: "",
          params: {},
          position: { x: 360, y: 80 },
        },
      ],
      connections: [
        {
          from: { id: DEFAULT_SYNTH_ID, port: "out:out" },
          to: { id: DEFAULT_VOICE_DEST_ID, port: "in:in" },
        },
      ],
    },
    main: {
      modules: [
        {
          id: DEFAULT_MAIN_INPUT_ID,
          type: "input",
          label: "",
          params: {},
          position: { x: 80, y: 80 },
        },
        {
          id: DEFAULT_MAIN_DEST_ID,
          type: "destination",
          label: "",
          params: {},
          position: { x: 360, y: 80 },
        },
      ],
      connections: [
        {
          from: { id: DEFAULT_MAIN_INPUT_ID, port: "out:out" },
          to: { id: DEFAULT_MAIN_DEST_ID, port: "in:in" },
        },
      ],
    },
  }
}

/** Un patch est-il déjà au format SynthPatch (couches voice/main) ? */
export function isSynthPatch(patch) {
  return Boolean(
    patch &&
      (patch.voice || patch.main) &&
      (patch.voice?.modules || patch.main?.modules)
  )
}

function normalizeGraph(graph) {
  return {
    ...(graph ?? {}),
    modules: Array.isArray(graph?.modules) ? graph.modules : [],
    connections: Array.isArray(graph?.connections) ? graph.connections : [],
  }
}

function synthPatchFromOldSynth(patch) {
  const synth = {
    name: patch.name ?? "Synth",
    voicePatch: patch.voicePatch ?? emptyGraph(),
    mainPatch: patch.mainPatch ?? emptyGraph(),
  }
  const result = createDefaultSynthPatch({ name: patch.name ?? "Synth", synth })
  // conserve les métadonnées éventuelles (superModule, FX, ...)
  const { voicePatch, mainPatch, ...rest } = patch
  return { ...rest, ...result }
}

function synthPatchFromSynthList(patch) {
  const synthModules = patch.synths
    .filter(Boolean)
    .map((s, i) =>
      createSynthModule({
        id: s.id ?? `synth-${i + 1}`,
        name: s.name ?? `Synth ${i + 1}`,
        voicePatch: s.voicePatch,
        mainPatch: s.mainPatch,
        position: { x: 80 + i * 200, y: 80 },
      })
    )

  if (!synthModules.length) {
    return createDefaultSynthPatch({ name: patch.name ?? "SynthPatch" })
  }

  const destinationId = "synth-voice-destination"
  const mainInputId = "synth-main-input"
  const mainDestId = "synth-main-destination"

  return {
    ...patch,
    version: patch.version ?? 2,
    voice: {
      modules: [
        ...synthModules,
        {
          id: destinationId,
          type: "destination",
          label: "",
          params: {},
          position: { x: 80 + synthModules.length * 200, y: 80 },
        },
      ],
      connections: synthModules.map((m) => ({
        from: { id: m.id, port: "out:out" },
        to: { id: destinationId, port: "in:in" },
      })),
    },
    main: {
      modules: [
        {
          id: mainInputId,
          type: "input",
          label: "",
          params: {},
          position: { x: 80, y: 80 },
        },
        {
          id: mainDestId,
          type: "destination",
          label: "",
          params: {},
          position: { x: 360, y: 80 },
        },
      ],
      connections: [
        {
          from: { id: mainInputId, port: "out:out" },
          to: { id: mainDestId, port: "in:in" },
        },
      ],
    },
  }
}

/**
 * Normalise n'importe quel patch sauvegardé en SynthPatch.
 * - Ancien format { voicePatch, mainPatch } -> un Synth.
 * - Ancien format { synths: [...] } -> un Synth node par entrée.
 * - Format SynthPatch -> renvoyé tel quel (graphes normalisés).
 */
export function normalizeSynthPatch(patch) {
  if (!patch || (!patch.voice && !patch.main && !patch.voicePatch && !patch.mainPatch && !patch.synths)) {
    return createDefaultSynthPatch({ name: patch?.name ?? "SynthPatch" })
  }

  if (patch.voice || patch.main) {
    const result = {
      ...patch,
      version: patch.version ?? 2,
      voice: normalizeGraph(patch.voice),
      main: normalizeGraph(patch.main),
    }
    for (const mod of result.voice.modules) {
      if (mod?.type === "synth") ensureSynthModule(mod)
      else if (mod?.type === "superSynth") ensureSuperSynthModule(mod)
    }
    return result
  }

  if (Array.isArray(patch.synths)) {
    return synthPatchFromSynthList(patch)
  }

  return synthPatchFromOldSynth(patch)
}

/** Liste des nœuds Synth d'un SynthPatch normalisé. */
export function getSynthModules(patch) {
  const normalized = normalizeSynthPatch(patch)
  return (normalized.voice.modules ?? [])
    .filter((m) => m?.type === "synth")
    .map((module) => {
      ensureSynthModule(module)
      return {
        id: module.id,
        name: module.params.name ?? module.label ?? "Synth",
        voicePatch: module.params.voicePatch,
        mainPatch: module.params.mainPatch,
        module,
      }
    })
}

/** Liste des nœuds SuperSynth d'un SynthPatch normalisé. */
export function getSuperSynthModules(patch) {
  const normalized = normalizeSynthPatch(patch)
  return (normalized.voice.modules ?? [])
    .filter((m) => m?.type === "superSynth")
    .map((module) => {
      ensureSuperSynthModule(module)
      return {
        id: module.id,
        name: module.params.name ?? module.label ?? "SuperSynth",
        synthPatch: module.params.synthPatch,
        module,
      }
    })
}

export function findSynthModule(patch, id) {
  return getSynthModules(patch).find((s) => s.id === id) ?? null
}

/** Applique une définition de synthé à un nœud existant (sans changer son id). */
export function applySynthToModule(module, synth) {
  if (!module || module.type !== "synth" || !synth) return module
  ensureSynthModule(module)
  module.params.name = synth.name ?? module.params.name ?? "Synth"
  module.params.voicePatch = synth.voicePatch
    ? cloneGraph(synth.voicePatch)
    : emptyGraph()
  module.params.mainPatch = synth.mainPatch
    ? cloneGraph(synth.mainPatch)
    : emptyGraph()
  return module
}

/** Duplique un nœud Synth (nouvel id, graphes indépendants). */
export function duplicateSynthModule(module, { id = null, position = null } = {}) {
  const s = getSynthModules({ voice: { modules: [module] }, main: emptyGraph() })[0]
  return createSynthModule({
    id,
    name: `${s?.name ?? "Synth"} copy`,
    voicePatch: s?.voicePatch,
    mainPatch: s?.mainPatch,
    position: position ?? module?.position,
  })
}

/**
 * Transforme un SynthPatch en définition de SuperSynth réutilisable.
 *
 * Le graphe main est converti pour exposer l'interface audio :
 *   - module "input"       -> "super.in"
 *   - module "destination" -> "super.out"
 * Les ports (out:out / in:in) sont identiques, donc les connexions existantes
 * restent valides. Si l'interface manque, on l'ajoute.
 */
export function createSuperSynthDefinition(patch, name = "SuperSynth") {
  const p = normalizeSynthPatch(patch)
  const voice = deepClone(p.voice)
  const main = deepClone(p.main)

  let hasIn = false
  let hasOut = false

  main.modules = (main.modules ?? []).map((m) => {
    if (m.type === "input") {
      hasIn = true
      return {
        ...m,
        type: "super.in",
        params: { ...(m.params ?? {}), name: m.params?.name ?? "in" },
      }
    }
    if (m.type === "destination") {
      hasOut = true
      return {
        ...m,
        type: "super.out",
        params: { ...(m.params ?? {}), name: m.params?.name ?? "out" },
      }
    }
    return m
  })

  if (!hasIn) {
    main.modules.push({
      id: `super-in-${crypto.randomUUID()}`,
      type: "super.in",
      label: "",
      params: { name: "in" },
      position: { x: 40, y: 40 },
    })
  }
  if (!hasOut) {
    main.modules.push({
      id: `super-out-${crypto.randomUUID()}`,
      type: "super.out",
      label: "",
      params: { name: "out" },
      position: { x: 360, y: 40 },
    })
  }

  return {
    version: 2,
    name,
    voice,
    main,
  }
}
