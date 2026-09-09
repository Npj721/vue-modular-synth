const DEFAULT_KEY = "modular-patches"

export function usePatchStorage(key = DEFAULT_KEY) {
  const list = () => {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : {}
  }

  const save = (name, patch) => {
    const patches = list()
    patches[name] = {
      ...patch,
      savedAt: Date.now()
    }
    localStorage.setItem(key, JSON.stringify(patches))
  }

  const load = (name) => {
    return list()[name] ?? null
  }

  const remove = (name) => {
    const patches = list()
    delete patches[name]
    localStorage.setItem(key, JSON.stringify(patches))
  }

  const names = () => Object.keys(list())

  return { list, save, load, remove, names }
}
