// composables/audioTransfer.js
// Sérialisation des fichiers audio (samples / IR de convolveur) dans les
// fichiers d'export .json / .synth.json et leur réimportation dans
// IndexedDB (base "modular-synth-audio") AVANT de charger le synthé/patch.

import Swal from "sweetalert2"
import { useModuleCatalog } from "./useModuleCatalog.js"
import {
  getAudioFileBytes,
  saveAudioFileBytes,
} from "./useAudioFileStore.js"

const { getModuleByType } = useModuleCatalog()

/* -----------------------------------------------------------------
 * Encodage / décodage base64 (les octets audio ne sont pas
 * sérialisables directement en JSON).
 * ----------------------------------------------------------------- */

const CHUNK = 0x8000

export function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer)
  let bin = ""
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(bin)
}

export function base64ToArrayBuffer(b64) {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes.buffer
}

/* -----------------------------------------------------------------
 * Collecte des noms de fichiers référencés par un graphe.
 * ----------------------------------------------------------------- */

function audioFileKeysOfModule(m) {
  const def = getModuleByType(m?.type)
  if (!def?.params) return []
  const keys = []
  for (const [pname, pdef] of Object.entries(def.params)) {
    if (pdef && pdef.type === "audioFile") {
      const v = m?.params?.[pname]
      if (typeof v === "string" && v) keys.push(v)
    }
  }
  return keys
}

/** Noms de fichiers audio référencés par un graphe, récursivement
 *  (y compris les fichiers utilisés à l'intérieur des super-modules). */
export function collectAudioKeys(graph) {
  const keys = new Set()
  const visit = (g) => {
    for (const m of g?.modules ?? []) {
      for (const k of audioFileKeysOfModule(m)) keys.add(k)
      const def = getModuleByType(m.type)
      if (def?.isSuper && def?.superDef?.graph) visit(def.superDef.graph)
    }
  }
  visit(graph)
  return [...keys]
}

/** Construit le payload "FX" d'un export : { nomFichier -> base64 }.
 *  @param {object[]} graphs  graphes { modules, connections } à analyser */
export async function buildAudioPayload(graphs) {
  const keys = new Set()
  for (const g of graphs) {
    for (const k of collectAudioKeys(g)) keys.add(k)
  }
  const payload = {}
  for (const key of keys) {
    try {
      const bytes = await getAudioFileBytes(key)
      if (bytes?.byteLength) payload[key] = arrayBufferToBase64(bytes)
    } catch {
      // fichier présent dans le patch mais absent du stockage : on l'ignore
    }
  }
  return payload
}

/**
 * Réintègre les fichiers audio portés par la clé "FX" d'un fichier
 * d'importation dans modular-synth-audio.
 *
 * - si un fichier du même nom existe déjà, une fenêtre demande si on
 *   écrase (tous) ou si on annule l'importation ;
 * - retourne true pour continuer l'importation, false si elle est annulée.
 */
export async function installAudioFilesFromFile(fxPayload) {
  if (!fxPayload || typeof fxPayload !== "object") return true
  const names = Object.keys(fxPayload).filter((k) => fxPayload[k])
  if (!names.length) return true

  const existing = new Set()
  for (const name of names) {
    if (await getAudioFileBytes(name)) existing.add(name)
  }

  if (existing.size) {
    const labels = [...existing].map((n) => `« ${n} »`).join(", ")
    const res = await Swal.fire({
      title: "Fichier(s) audio déjà présent(s)",
      html:
        `Le fichier contient le(s) fichier(s) audio ${labels}, ` +
        `déjà présent(s) sur ce poste.<br><br>` +
        `Écraser avec la version du fichier ?`,
      icon: "warning",
      showCancelButton: true,
      confirmButtonText: "Écraser",
      cancelButtonText: "Annuler l'importation",
    })
    if (!res.isConfirmed) return false
  }

  for (const name of names) {
    try {
      const bytes = base64ToArrayBuffer(String(fxPayload[name]))
      await saveAudioFileBytes(name, bytes)
    } catch (err) {
      Swal.fire({
        title: "Fichier audio invalide",
        text: err.message,
        icon: "error",
        confirmButtonText: "OK",
      })
      return false
    }
  }
  return true
}