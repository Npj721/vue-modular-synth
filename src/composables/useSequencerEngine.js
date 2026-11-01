// composables/useSequencerEngine.js
//
// Horloge des modules `sequencer` du SynthPatch.
//
// Un module séquenceur est une source d'événements comme le clavier : il ne
// produit aucun son, il émet des noteOn/noteOff sur son port "Events". Le
// moteur tourne au niveau du SynthPatch (App.vue) pour continuer à jouer même
// quand le panneau de propriétés est fermé ou que le module n'est plus
// sélectionné.
//
// L'état (playing / step courant) est un singleton réactif partagé entre le
// moteur et le panneau de propriétés.

import { reactive } from "vue"
import { getSharedVoice, initSharedVoice } from "./useSharedVoice.js"

/** moduleId -> { playing, step, timer, pending, generation } */
const states = reactive({})

function ensureState(id) {
  if (!states[id]) {
    states[id] = {
      playing: false,
      step: -1,
      timer: null,
      pending: new Set(),
      generation: 0,
    }
  }
  return states[id]
}

export function clampSequencerNumber(value, min, max, fallback) {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

/**
 * Normalise une séquence pour l'UI et le moteur : toujours `count` pas, avec
 * des valeurs bornées. Les pas manquants prennent les valeurs par défaut.
 */
export function normalizeSequencerSteps(steps, count) {
  const total = Math.round(clampSequencerNumber(count, 1, 64, 16))
  const source = Array.isArray(steps) ? steps : []

  return Array.from({ length: total }, (_, i) => {
    const s = source[i] ?? {}
    return {
      note: Math.round(clampSequencerNumber(s.note, 0, 127, 60)),
      active: !!s.active,
      velocity: clampSequencerNumber(s.velocity, 0, 1, 1),
    }
  })
}

function stepDurationMs(module) {
  const bpm = clampSequencerNumber(module?.params?.bpm, 40, 300, 120)
  // Croche : 4 pas par temps.
  return (60 / bpm / 4) * 1000
}

function releasePending(id) {
  const st = states[id]
  if (!st) return

  for (const p of st.pending) {
    clearTimeout(p.timer)
    getSharedVoice()?.noteOff(p.note, p.voiceKey, id)
  }
  st.pending.clear()
}

function triggerStep(module, stepIndex) {
  const st = ensureState(module.id)
  const steps = normalizeSequencerSteps(
    module.params?.steps,
    module.params?.stepCount
  )
  const step = steps[stepIndex]
  if (!step?.active) return

  const voiceKey = `${module.id}:seq:${++st.generation}`
  const gateMs = Math.max(10, stepDurationMs(module) * 0.8)

  getSharedVoice()?.noteOn(step.note, step.velocity, null, voiceKey, module.id)

  const entry = { note: step.note, voiceKey, timer: null }
  entry.timer = setTimeout(() => {
    st.pending.delete(entry)
    getSharedVoice()?.noteOff(entry.note, entry.voiceKey, module.id)
  }, gateMs)
  st.pending.add(entry)
}

function scheduleNext(module) {
  const st = ensureState(module.id)
  if (!st.playing) return

  st.timer = setTimeout(() => {
    if (!st.playing) return
    const count = Math.round(
      clampSequencerNumber(module.params?.stepCount, 1, 64, 16)
    )
    st.step = (st.step + 1) % count
    triggerStep(module, st.step)
    scheduleNext(module)
  }, stepDurationMs(module))
}

export async function startSequencer(module) {
  if (!module?.id) return

  const st = ensureState(module.id)
  if (st.playing) return

  st.playing = true
  st.step = 0

  try {
    await initSharedVoice()
  } catch {
    st.playing = false
    st.step = -1
    return
  }

  // L'utilisateur a pu cliquer sur Stop pendant l'initialisation.
  if (!st.playing) return

  triggerStep(module, 0)
  scheduleNext(module)
}

export function stopSequencer(module) {
  const id = module?.id
  if (!id) return

  const st = states[id]
  if (!st) return

  st.playing = false
  st.step = -1

  if (st.timer) {
    clearTimeout(st.timer)
    st.timer = null
  }

  releasePending(id)
}

export function toggleSequencer(module) {
  if (isSequencerPlaying(module?.id)) stopSequencer(module)
  else void startSequencer(module)
}

export function isSequencerPlaying(id) {
  return !!states[id]?.playing
}

export function getSequencerStep(id) {
  return states[id]?.step ?? -1
}

/** Arrête les séquenceurs dont le module a disparu du patch. */
export function syncSequencers(patch) {
  const modules = (patch?.voice?.modules ?? []).filter(
    (m) => m.type === "sequencer"
  )
  const ids = new Set(modules.map((m) => m.id))

  for (const id of Object.keys(states)) {
    if (!ids.has(id)) stopSequencer({ id })
  }
}

export function stopAllSequencers() {
  for (const id of Object.keys(states)) stopSequencer({ id })
}
