// composables/useIndexedDb.js
// Persistance clé/valeur dans IndexedDB avec repli mémoire hors navigateur.
// Toutes les sauvegardes de haut niveau (patches, synthés, super-modules,
// presets d'enveloppe) passent par ce module : IndexedDB n'a pas le quota
// restrictif de localStorage, ce qui permet de stocker des patches lourds
// (wavetableS, samples, convolver...).
//
// Layout : un seul object store "kv", clé = chaîne `ns::key`. Les parcours
// se font par plage de préfixe sur la clé.

const DB_NAME = "modular-synth-store"
const STORE = "kv"
const SEP = "::"

let dbPromise = null
let usingMemory = false

// repli mémoire (tests Node, navigation privée, IndexedDB indisponible…)
const memory = new Map()

function openDb() {
  if (dbPromise) return dbPromise
  if (typeof indexedDB === "undefined") {
    usingMemory = true
    dbPromise = Promise.reject(new Error("no-indexeddb"))
    return dbPromise
  }
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE)
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => {
      usingMemory = true
      reject(req.error)
    }
  })
  return dbPromise
}

async function db() {
  try {
    return await openDb()
  } catch {
    return null
  }
}

const fullKey = (ns, key) => ns + SEP + key
const nsRange = (ns) => {
  const lo = ns + SEP
  return IDBKeyRange.bound(lo, lo + "\uffff")
}

const forget = (err, label) => {
  console.error(`useIndexedDb/${label} :`, err)
  return null
}

export function isMemoryMode() {
  return usingMemory
}

export async function kvPut(ns, key, value) {
  if (typeof key !== "string" || !key) return
  const d = await db()
  if (!d) {
    memory.set(fullKey(ns, key), value)
    return
  }
  try {
    await new Promise((resolve, reject) => {
      const tx = d.transaction(STORE, "readwrite")
      tx.objectStore(STORE).put(value, fullKey(ns, key))
      tx.oncomplete = resolve
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error)
    })
  } catch (err) {
    forget(err, "put")
  }
}

export async function kvGet(ns, key) {
  const d = await db()
  if (!d) {
    return memory.has(fullKey(ns, key)) ? memory.get(fullKey(ns, key)) : null
  }
  try {
    return await new Promise((resolve) => {
      const tx = d.transaction(STORE, "readonly")
      const req = tx.objectStore(STORE).get(fullKey(ns, key))
      req.onsuccess = () => resolve(req.result ?? null)
      req.onerror = () => {
        forget(req.error, "get")
        resolve(null)
      }
    })
  } catch (err) {
    return forget(err, "get")
  }
}

export async function kvDelete(ns, key) {
  const d = await db()
  if (!d) {
    memory.delete(fullKey(ns, key))
    return
  }
  try {
    await new Promise((resolve, reject) => {
      const tx = d.transaction(STORE, "readwrite")
      tx.objectStore(STORE).delete(fullKey(ns, key))
      tx.oncomplete = resolve
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error)
    })
  } catch (err) {
    forget(err, "delete")
  }
}

export async function kvKeys(ns) {
  const d = await db()
  if (!d) {
    const out = []
    const pre = ns + SEP
    for (const k of memory.keys()) {
      if (k.startsWith(pre)) out.push(k.slice(pre.length))
    }
    return out
  }
  try {
    return await new Promise((resolve) => {
      const tx = d.transaction(STORE, "readonly")
      const req = tx.objectStore(STORE).getAllKeys(nsRange(ns))
      req.onsuccess = () => {
        const pre = ns + SEP
        resolve(req.result.map((k) => k.slice(pre.length)))
      }
      req.onerror = () => {
        forget(req.error, "keys")
        resolve([])
      }
    })
  } catch (err) {
    return forget(err, "keys") ?? []
  }
}

export async function kvEntries(ns) {
  const d = await db()
  if (!d) {
    const out = []
    const pre = ns + SEP
    for (const [k, v] of memory) {
      if (k.startsWith(pre)) out.push({ key: k.slice(pre.length), value: v })
    }
    return out
  }
  try {
    return await new Promise((resolve) => {
      const tx = d.transaction(STORE, "readonly")
      const curReq = tx.objectStore(STORE).openCursor(nsRange(ns))
      const pre = ns + SEP
      const out = []
      curReq.onsuccess = () => {
        const cur = curReq.result
        if (cur) {
          out.push({ key: cur.key.slice(pre.length), value: cur.value })
          cur.continue()
        } else {
          resolve(out)
        }
      }
      curReq.onerror = () => {
        forget(curReq.error, "entries")
        resolve([])
      }
    })
  } catch (err) {
    return forget(err, "entries") ?? []
  }
}