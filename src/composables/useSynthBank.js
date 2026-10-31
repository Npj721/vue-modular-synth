// composables/useSynthBank.js
//
// Accès à la bibliothèque de synthés complets (format historique
// { version, name, voicePatch, mainPatch }). C'est la même banque que celle
// utilisée par SynthPatchManager / SynthEditor.

import { usePatchStorage } from "./usePatchStorage"

const STORAGE_KEY = "modular-synth-patches"

export function useSynthBank() {
  const storage = usePatchStorage(STORAGE_KEY)

  const names = () =>
    storage.names().sort((a, b) => a.localeCompare(b))

  return {
    names,
    get: (name) => storage.load(name),
    save: (name, synth) => storage.save(name, synth),
    remove: (name) => storage.remove(name),
    ready: () => storage.ready(),
  }
}
