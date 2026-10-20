// composables/useWorkletPresets.js
// Presets du module AudioWorklet : sauvegarde de la config complète
// (code DSP, rate, channels, options JSON, valeurs p1..p8) sous un nom,
// pour pouvoir la réutiliser plus tard dans un autre module / patch.
//
// Même mécanique que usePatchStorage : un cache réactif unique partagé
// entre tous les composants, persistance asynchrone en IndexedDB (via
// useIndexedDb) — pas de localStorage (quota ~5 Mo, le code + les params
// peuvent grossir).

import { reactive } from "vue"
import { kvPut, kvDelete, kvEntries } from "./useIndexedDb.js"

const NS = "worklet-presets"

const state = reactive({
  entries: {},   // nom -> { params: {...}, savedAt }
  loaded: null,
})

const clone = (v) => JSON.parse(JSON.stringify(v ?? {}))

async function init() {
  try {
    const entries = await kvEntries(NS)
    for (const { key: name, value } of entries) {
      state.entries[name] = value
    }
  } catch (err) {
    console.error("useWorkletPresets/load :", err)
  }
}

// Chargement eager : la liste est prête dès que le panneau s'ouvre
state.loaded = init()

export function useWorkletPresets() {
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
    kvPut(NS, name, clone(value)).catch(() => {})
  }

  const remove = (name) => {
    if (!(name in state.entries)) return
    delete state.entries[name]
    kvDelete(NS, name).catch(() => {})
  }

  const ready = () => state.loaded

  return { names, get, save, remove, ready, state }
}
