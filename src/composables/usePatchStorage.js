// composables/usePatchStorage.js
// Sauvegarde des patches dans IndexedDB (via useIndexedDb) au lieu de
// localStorage : les patches contenant des wavetableS/samples lourds
// dépassent le quota localStorage (~5 Mo), IndexedDB n'a pas cette limite.
//
// L'API reste synchrone pour les lectures (cache réactif) ; les écritures
// sont persistées en IndexedDB de façon asynchrone. Les anciennes données
// localStorage sont migrées automatiquement puis supprimées.

import { reactive } from "vue"
import { kvPut, kvGet, kvDelete, kvKeys, kvEntries } from "./useIndexedDb.js"

const DEFAULT_KEY = "modular-patches"

const namespace = (key) => "patches:" + key

/* État par clé de stockage, partagé entre tous les composants. */
const states = new Map() // key -> { entries: reactive{}, loaded: Promise }

function stateOf(key) {
  if (!states.has(key)) {
    states.set(key, {
      entries: reactive({}),
      loaded: init(key),
    })
  }
  return states.get(key)
}

async function init(key) {
  const ns = namespace(key)
  try {
    // --- migration des anciennes données localStorage (un objet JSON par clé) ---
    const rawLegacy = localStorage.getItem(key)
    if (rawLegacy) {
      const legacy = JSON.parse(rawLegacy)
      for (const [name, value] of Object.entries(legacy)) {
        await kvPut(ns, name, value)
      }
      localStorage.removeItem(key)
    }
  } catch (err) {
    console.error("usePatchStorage/migration :", err)
  }

  try {
    const entries = await kvEntries(ns)
    const state = states.get(key)
    for (const { key: name, value } of entries) {
      state.entries[name] = value
    }
  } catch (err) {
    console.error("usePatchStorage/load :", err)
  }
}

const clone = (patch) => JSON.parse(JSON.stringify(patch ?? {}))

export function usePatchStorage(key = DEFAULT_KEY) {
  const state = stateOf(key)
  const ns = namespace(key)

  const list = () => state.entries
  const names = () => Object.keys(state.entries)
  const load = (name) => state.entries[name] ?? null
  const ready = () => state.loaded

  const save = (name, patch) => {
    if (!name) return
    const value = { ...clone(patch), savedAt: Date.now() }
    state.entries[name] = value
    kvPut(ns, name, value).catch(() => {})
  }

  const remove = (name) => {
    if (!(name in state.entries)) return
    delete state.entries[name]
    kvDelete(ns, name).catch(() => {})
  }

  return { list, save, load, remove, names, ready }
}