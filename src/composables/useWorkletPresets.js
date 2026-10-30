// composables/useWorkletPresets.js
// Presets de modules à code : sauvegarde de la config complète (code DSP /
// courbe, options et paramètres) sous un nom, pour pouvoir la réutiliser plus
// tard dans un autre module / patch.
//
// Un store réactif est créé PAR NAMESPACE IndexedDB : les presets AudioWorklet
// et WaveShaper restent séparés, mais partagent exactement la même mécanique.
// Persistance asynchrone en IndexedDB (via useIndexedDb) — pas de localStorage
// (quota ~5 Mo, le code + les params peuvent grossir).

import { reactive } from "vue"
import { kvPut, kvDelete, kvEntries } from "./useIndexedDb.js"

const WORKLET_NS = "worklet-presets"
const WAVESHAPER_NS = "waveshaper-presets"

const clone = (v) => JSON.parse(JSON.stringify(v ?? {}))
const stores = new Map()

function createStore(namespace) {
  const state = reactive({
    entries: {},   // nom -> { params: {...}, savedAt }
    loaded: null,
  })

  async function init() {
    try {
      const entries = await kvEntries(namespace)
      for (const { key: name, value } of entries) {
        // ne pas écraser une entrée créée pendant le chargement asynchrone
        if (!(name in state.entries)) state.entries[name] = value
      }
    } catch (err) {
      console.error(`useWorkletPresets/load (${namespace}) :`, err)
    }
  }

  // Chargement à la première utilisation : la liste est prête dès que le
  // panneau demande le store.
  state.loaded = init()
  return state
}

function getStore(namespace) {
  let state = stores.get(namespace)
  if (!state) {
    state = createStore(namespace)
    stores.set(namespace, state)
  }
  return state
}

function usePresets(namespace) {
  const state = getStore(namespace)

  // noms triés du plus récent au plus ancien
  const names = () =>
    Object.keys(state.entries).sort(
      (a, b) => (state.entries[b]?.savedAt ?? 0) - (state.entries[a]?.savedAt ?? 0)
    )

  const get = (name) => state.entries[name] ?? null

  // snapshot = objet params complet du module (code, options, p1..p8…)
  const save = (name, params) => {
    if (!name) return
    const value = { params: clone(params), savedAt: Date.now() }
    state.entries[name] = value
    kvPut(namespace, name, clone(value)).catch(() => {})
  }

  const remove = (name) => {
    if (!(name in state.entries)) return
    delete state.entries[name]
    kvDelete(namespace, name).catch(() => {})
  }

  const ready = () => state.loaded

  return { names, get, save, remove, ready, state }
}

export function useWorkletPresets() {
  return usePresets(WORKLET_NS)
}

export function useWaveshaperPresets() {
  return usePresets(WAVESHAPER_NS)
}
