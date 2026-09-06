// composables/useMidiBus.js
// Pont entre le contrôleur MIDI et le clavier à l'écran.
// Le clavier MIDI émet des événements ici ; le clavier à l'écran (SynthKeyboard)
// les reçoit et joue la note comme s'il l'avait déclenchée lui-même.
// Résultat : mêmes notes, même chemin audio, et la touche s'allume visuellement.

import { reactive } from "vue"

const state = reactive({
  handlers: new Set(),
})

/**
 * Enregistre un récepteur de notes MIDI (appelé par SynthKeyboard).
 * Retourne une fonction de désinscription.
 */
export function registerMidiNoteHandler(fn) {
  state.handlers.add(fn)
  return () => {
    state.handlers.delete(fn)
  }
}

export function emitMidiNoteOn(note, velocity) {
  for (const fn of state.handlers) fn({ type: "noteOn", note, velocity })
}

export function emitMidiNoteOff(note) {
  for (const fn of state.handlers) fn({ type: "noteOff", note })
}
