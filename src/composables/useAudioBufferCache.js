// composables/useAudioBufferCache.js
// Cache global des buffers audio décodés.
// Le param "audioFile" des modules (ex: convolver) ne stocke qu'une clé
// (le nom du fichier) ; le vrai AudioBuffer déchiffré est conservé ici.

const buffers = new Map()

export function setAudioBuffer(key, buffer) {
  if (key) buffers.set(key, buffer)
}

export function getAudioBuffer(key) {
  if (!key) return null
  return buffers.get(key) || null
}

export function clearAudioBuffer(key) {
  if (key) buffers.delete(key)
}