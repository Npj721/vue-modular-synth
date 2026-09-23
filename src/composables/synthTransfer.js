// composables/synthTransfer.js
// Pipeline générique d'import d'un synthé complet (voicePatch + mainPatch).
// Indépendant de la source (fichier .json, blob, preset interne…) : on
// travaille sur le texte JSON d'un côté et sur l'objet parsé de l'autre.
// Utilisé par SynthPatchManager (import fichier) et useBaseSynths (seed).

import { installSuperModulesFromFile } from "./superModuleTransfer.js"
import { installAudioFilesFromFile } from "./audioTransfer.js"

/** Valide qu'un objet ressemble à un synthé complet. */
export function isCompleteSynth(data) {
  return Boolean(data && data.voicePatch && data.mainPatch)
}

/**
 * Parse et valide le texte JSON d'un synthé complet.
 * @throws {Error} si le JSON est invalide ou si voicePatch/mainPatch manquent
 */
export function parseSynthText(text) {
  const data = JSON.parse(text)
  if (!isCompleteSynth(data)) {
    throw new Error("Un synthéthiseur complet doit contenir voicePatch et mainPatch.")
  }
  return data
}

/**
 * Installe les dépendances portées par un synthé (super-modules puis fichiers
 * audio) AVANT que celui-ci soit utilisé.
 *
 * - `silent: false` (défaut, import utilisateur) : en cas de conflit de nom,
 *   une fenêtre demande si on écrase ou si on annule l'importation.
 * - `silent: true` (presets internes) : les éléments en conflit sont ignorés
 *   sans demander confirmation.
 *
 * @returns {Promise<boolean>} false si l'importation est annulée
 */
export async function installSynthDependencies(data, { silent = false } = {}) {
  if (!(await installSuperModulesFromFile(data?.superModule, { silent }))) return false
  if (!(await installAudioFilesFromFile(data?.FX, { silent }))) return false
  return true
}