// composables/useAudioBufferCache.js
// Cache global des buffers audio décodés.
// Le param "audioFile" des modules (ex: convolver, fx) ne stocke qu'une clé
// (le nom du fichier) ; le vrai AudioBuffer déchiffré est conservé ici.

import { getAudioFileBytes } from "./useAudioFileStore"

const buffers = new Map()

export function setAudioBuffer(key, buffer) {
  if (key) {
    buffers.set(key, buffer)
    missing.delete(key)
  }
}

export function getAudioBuffer(key) {
  if (!key) return null
  return buffers.get(key) || null
}

export function clearAudioBuffer(key) {
  if (key) buffers.delete(key)
}

// Clés vérifiées en IndexedDB mais absentes : évite de re-requêter le disque
// à chaque mutation du patch pour un fichier qui n'existe pas.
const missing = new Set()

// Reconstruit (async) un buffer à partir des octets persistés en IndexedDB,
// s'il n'est pas déjà en cache. Utilisé au chargement d'un patch.
let pending = new Map()
export async function ensureAudioBuffer(key, ctx) {
  if (!key || !ctx) return null
  if (buffers.has(key)) return buffers.get(key)
  if (missing.has(key)) return null
  if (pending.has(key)) return pending.get(key)

  const p = (async () => {
    const bytes = await getAudioFileBytes(key)
    if (!bytes) {
      missing.add(key)
      return null
    }
    try {
      const buffer = await ctx.decodeAudioData(bytes.slice(0))
      buffers.set(key, buffer)
      missing.delete(key)
      return buffer
    } catch (err) {
      missing.add(key)
      console.error("Échec du décodage du fichier persisté :", key, err)
      return null
    } finally {
      pending.delete(key)
    }
  })()

  pending.set(key, p)
  return p
}