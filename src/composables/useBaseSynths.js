// composables/useBaseSynths.js
// Pré-installation des synthés de base (src/data/baseSynths.js) dans
// IndexedDB au premier lancement, pour offrir au visiteur des instruments
// prêts à l'emploi sans action manuelle.
//
// Règles :
// - idempotent : un nom de synthé déjà présent n'est jamais écrasé
//   (les sauvegardes de l'utilisateur sont prioritaires) ;
// - silencieux : les super-modules / fichiers audio en conflit sont ignorés
//   sans popup de confirmation ;
// - extensible : il suffit d'ajouter un synthé au tableau baseSynths pour
//   qu'il soit proposé au prochain lancement.

import { baseSynths } from "../data/baseSynths.js"
import { usePatchStorage } from "./usePatchStorage.js"
import { installSynthDependencies, isCompleteSynth } from "./synthTransfer.js"

const SYNTH_STORAGE_KEY = "modular-synth-patches"

let seedPromise = null

export async function seedBaseSynths() {
  if (!seedPromise) seedPromise = doSeed()
  return seedPromise
}

async function doSeed() {
  const storage = usePatchStorage(SYNTH_STORAGE_KEY)
  await storage.ready()

  for (const synth of baseSynths) {
    if (!isCompleteSynth(synth) || !synth.name) continue
    if (storage.load(synth.name)) continue // ne jamais écraser une sauvegarde

    // installe d'abord les ressources portées par le preset (super-modules,
    // fichiers audio) puis enregistre le synthé.
    const ok = await installSynthDependencies(synth, { silent: true })
    if (!ok) continue
    storage.save(synth.name, synth)
  }
}