// composables/useSuperSynthBank.js
//
// Bibliothèque de définitions de SuperSynth (SynthPatch réutilisables).
// Les définitions sont copiées dans les params du module superSynth au moment
// de l'insertion : chaque instance est donc indépendante.

import { usePatchStorage } from "./usePatchStorage"

const STORAGE_KEY = "modular-supersynths"

export function useSuperSynthBank() {
  const storage = usePatchStorage(STORAGE_KEY)

  const names = () =>
    storage.names().sort((a, b) => a.localeCompare(b))

  return {
    names,
    get: (name) => storage.load(name),
    save: (name, definition) => storage.save(name, definition),
    remove: (name) => storage.remove(name),
    ready: () => storage.ready(),
  }
}
