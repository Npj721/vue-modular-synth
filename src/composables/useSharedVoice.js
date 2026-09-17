// composables/useSharedVoice.js
// Voix/Contexte audio PARTAGÉ entre toutes les pistes du séquenceur multi-pistes.
// Un seul AudioContext + une seule instance usePatchVoice => toutes les pistes
// jouent sur la même horloge et sortent par le même patch principal.

import { usePatchVoice } from "./usePatchVoice.js"
import { useSuperModules } from "./useSuperModules.js"
import { getAudioBuffer, ensureAudioBuffer } from "./useAudioBufferCache.js"

let sharedPatch = null
let voice = null

const getPatch = () => sharedPatch

/**
 * Renvoie l'instance unique de voix (patch) partagée.
 * Chaque composant peut appeler getSharedVoice() sans créer un nouveau contexte.
 */
export function getSharedVoice() {
  if (!voice) voice = usePatchVoice(getPatch)
  return voice
}

/** Vrai si un graph (patch principal ou voix) référence ce fichier. */
function graphUsesBuffer(graph, key) {
  return Boolean(
    graph &&
      Array.isArray(graph.modules) &&
      graph.modules.some((m) => m?.params?.buffer === key)
  )
}

/** Vrai si le patch partagé (main ou voice) référence ce fichier. */
function patchUsesBuffer(patch, key) {
  return graphUsesBuffer(patch?.mainPatch, key) || graphUsesBuffer(patch?.voicePatch, key)
}

/** Collecte les clés de fichiers audio référencées par les modules du patch. */
function collectBufferKeys(patch) {
  const keys = new Set()
  const scan = (graph) => {
    if (!graph || !Array.isArray(graph.modules)) return
    for (const mod of graph.modules) {
      const b = mod?.params?.buffer
      if (typeof b === "string" && b) keys.add(b)
    }
  }
  scan(patch?.mainPatch)
  scan(patch?.voicePatch)
  return [...keys]
}

/**
 * Garantit que le buffer référencé par `key` est disponible en cache,
 * rechargé depuis IndexedDB si besoin. Si le patch partagé l'utilise dans
 * un de ses graphes, reconstruit le patch principal pour que les modules
 * "fx" / "convolver" soient re-instanciés avec le bon buffer.
 *
 * Ne bloque jamais sur resume() (autoplay) : le AudioContext est créé de
 * façon synchrone et decodeAudioData fonctionne même contexte suspendu.
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

  // le fichier est utilisé par le patch : re-instantier pour l'appliquer
  if (patchUsesBuffer(sharedPatch, key)) {
    v.stopAll()
    v.rebuildMainPatch()
  }
}

/**
 * Recharge depuis IndexedDB les buffers audio référencés par le patch
 * (modules "fx" / "convolver") et encore absents du cache.
 */
export async function hydratePatchBuffers(patch) {
  const keys = collectBufferKeys(patch)
  for (const key of keys) {
    await ensureSharedPatchBuffer(key)
  }
}

/**
 * Met à jour le patch source du contexte partagé (et reconstruit le graphe).
 */
export function setSharedPatch(patch) {
  sharedPatch = patch
  if (voice) {
    // les super-modules (persistés en IndexedDB) doivent être chargés avant
    // de reconstruire le graphe, sinon leurs modules seraient ignorés.
    const { ready } = useSuperModules()
    Promise.resolve(ready).then(() => {
      voice.stopAll()
      voice.rebuildMainPatch()
      voice.setPatch(getPatch)
    })
  }
  // ré-hydratation asynchrone des buffers persistés (sauvegarde/rechargement)
  hydratePatchBuffers(patch).catch((e) => {
    console.error("Échec de la ré-hydratation des buffers audio :", e)
  })
}

export async function initSharedVoice() {
  return getSharedVoice().init()
}

/** Renvoie l'AnalyserNode branché juste avant la sortie (pour la visualisation). */
export function getSharedAnalyser() {
  return getSharedVoice().getAnalyser()
}
