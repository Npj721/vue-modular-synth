// composables/useMidiEventSources.js
//
// Routage des notes MIDI vers les modules `midi` du SynthPatch.
//
// Chaque module `midi` représente un appareil (params.device) et expose une
// sortie Events. Une note n'est envoyée qu'aux synthés câblés à ce module :
// plusieurs modules peuvent viser des appareils différents, et un même
// appareil peut alimenter plusieurs modules si on le souhaite.
//
// Comme le séquenceur, le moteur vit au niveau du SynthPatch (App.vue) : il
// continue à recevoir les notes même quand le panneau de propriétés est fermé.

import { registerMidiNoteHandler } from "./useMidiBus.js"
import { getSharedVoice } from "./useSharedVoice.js"

/** Modules `midi` du patch courant. */
let modules = []
let unregister = null

/** `${moduleId}:${note}` -> { moduleId, note, voiceKey, deviceId } */
const active = new Map()

/**
 * Met à jour la liste des modules MIDI du patch et relâche les notes dont le
 * module a disparu ou changé d'appareil.
 */
export function syncMidiEventSources(patch) {
  const next = (patch?.voice?.modules ?? []).filter((m) => m.type === "midi")
  const byId = new Map(next.map((m) => [m.id, m]))

  for (const [key, note] of active) {
    const module = byId.get(note.moduleId)
    if (!module || module.params?.device !== note.deviceId) {
      release(note)
      active.delete(key)
    }
  }

  modules = next
}

function release(note) {
  getSharedVoice()?.noteOff(note.note, note.voiceKey, note.moduleId)
}

function handleMidiEvent(msg) {
  if (!msg?.deviceId) return

  const targets = modules.filter((m) => m.params?.device === msg.deviceId)
  if (!targets.length) return

  for (const module of targets) {
    const key = `${module.id}:${msg.note}`

    if (msg.type === "noteOn") {
      if (active.has(key)) continue
      const voiceKey = `${module.id}:midi:${msg.note}`
      active.set(key, {
        moduleId: module.id,
        note: msg.note,
        voiceKey,
        deviceId: msg.deviceId,
      })
      getSharedVoice()?.noteOn(
        msg.note,
        msg.velocity ?? 1,
        null,
        voiceKey,
        module.id
      )
    } else if (msg.type === "noteOff") {
      const note = active.get(key)
      if (!note) continue
      active.delete(key)
      release(note)
    }
  }
}

/** À appeler une seule fois au démarrage de l'application. */
export function initMidiEventSources() {
  if (unregister) return
  unregister = registerMidiNoteHandler(handleMidiEvent)
}

/** Relâche toutes les notes tenues et coupe l'écoute MIDI. */
export function stopMidiEventSources() {
  for (const [key, note] of active) {
    release(note)
    active.delete(key)
  }
  if (unregister) {
    unregister()
    unregister = null
  }
}
