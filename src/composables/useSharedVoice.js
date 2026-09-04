// composables/useSharedVoice.js
// Voix/Contexte audio PARTAGÉ entre toutes les pistes du séquenceur multi-pistes.
// Un seul AudioContext + une seule instance usePatchVoice => toutes les pistes
// jouent sur la même horloge et sortent par le même patch principal.

import { usePatchVoice } from "./usePatchVoice"

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

/**
 * Met à jour le patch source du contexte partagé (et reconstruit le graphe).
 */
export function setSharedPatch(patch) {
  sharedPatch = patch
  if (voice) {
    voice.stopAll()
    voice.rebuildMainPatch()
    voice.setPatch(getPatch)
  }
}

export async function initSharedVoice() {
  return getSharedVoice().init()
}
