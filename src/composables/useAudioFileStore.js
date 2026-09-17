// composables/useAudioFileStore.js
// Persistance des octets des fichiers audio dans IndexedDB.
// Chaque fichier est stocké avec sa clé = nom du fichier (même clé que le
// cache en mémoire useAudioBufferCache). Permet de recharger le buffer
// après un rechargement de page / de patch, comme localStorage mais avec
// une capacité suffisante pour les échantillons audio.

const DB_NAME = "modular-synth-audio"
const STORE = "files"

let dbPromise = null

// Repli mémoire pour les environnements sans IndexedDB (tests Node).
const hasIDB = typeof indexedDB !== "undefined"
const memory = new Map()

function openDb() {
  if (!hasIDB) return null
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE)
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return dbPromise
}

export async function saveAudioFileBytes(key, bytes) {
  if (!key) return
  if (!hasIDB) {
    memory.set(key, bytes)
    return
  }
  const db = await openDb()
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite")
    tx.objectStore(STORE).put(bytes, key)
    tx.oncomplete = resolve
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })
}

export async function getAudioFileBytes(key) {
  if (!key) return null
  if (!hasIDB) return memory.get(key) ?? null
  const db = await openDb()
  return await new Promise((resolve) => {
    const tx = db.transaction(STORE, "readonly")
    const req = tx.objectStore(STORE).get(key)
    req.onsuccess = () => resolve(req.result ?? null)
    req.onerror = () => resolve(null)
  })
}

export async function removeAudioFile(key) {
  if (!key) return
  if (!hasIDB) {
    memory.delete(key)
    return
  }
  const db = await openDb()
  await new Promise((resolve) => {
    const tx = db.transaction(STORE, "readwrite")
    tx.objectStore(STORE).delete(key)
    tx.oncomplete = resolve
    tx.onerror = () => resolve()
  })
}

/** Liste des fichiers persistés (clés). */
export async function listAudioFiles() {
  if (!hasIDB) return [...memory.keys()]
  const db = await openDb()
  return await new Promise((resolve) => {
    const tx = db.transaction(STORE, "readonly")
    const req = tx.objectStore(STORE).getAllKeys()
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => resolve([])
  })
}
