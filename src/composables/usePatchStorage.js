const STORAGE_KEY = "modular-patches"

export function usePatchStorage() {
  const list = () => {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : {}
  }

  const save = (name, patch) => {
    const patches = list()
    patches[name] = {
      ...patch,
      savedAt: Date.now()
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(patches))
  }

  const load = (name) => {
    return list()[name] ?? null
  }

  const remove = (name) => {
    const patches = list()
    delete patches[name]
    localStorage.setItem(STORAGE_KEY, JSON.stringify(patches))
  }

  const names = () => Object.keys(list())

  return { list, save, load, remove, names }
}
