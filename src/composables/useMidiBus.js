// composables/useMidiBus.js
//
// Gestionnaire MIDI central.
//
// Un seul accès Web MIDI est demandé pour toute l'application. Tous les
// appareils d'entrée sont écoutés et chaque message est étiqueté avec son
// `deviceId` : les modules `midi` du SynthPatch choisissent ensuite l'appareil
// qu'ils représentent via `params.device`.
//
// Le clavier à l'écran (module `keyboard`) n'est plus concerné : il ne reçoit
// que les événements du clavier physique du PC / de la souris.

import { reactive } from "vue"

export const midiState = reactive({
  supported:
    typeof navigator !== "undefined" && "requestMIDIAccess" in navigator,
  requested: false,
  error: "",
  devices: [],
})

let access = null
let pending = null
const handlers = new Set()

function refreshDevices() {
  const devices = []
  if (access) {
    for (const input of access.inputs.values()) {
      devices.push({
        id: input.id,
        name: input.name || "Appareil sans nom",
        manufacturer: input.manufacturer || "",
        state: input.state || "connected",
      })
      // Réattacher à chaque rafraîchissement est sans danger : on remplace
      // simplement l'ancien gestionnaire par un équivalent.
      input.onmidimessage = (e) => handleMidiMessage(input, e)
    }
  }
  midiState.devices.splice(0, midiState.devices.length, ...devices)
}

export async function requestMidiAccess() {
  if (!midiState.supported) {
    midiState.error = "Web MIDI n'est pas disponible dans ce navigateur."
    return null
  }
  if (access) return access
  if (pending) return pending

  pending = (async () => {
    try {
      const result = await navigator.requestMIDIAccess({ sysex: false })
      access = result
      midiState.requested = true
      midiState.error = ""
      // Branchement / débranchement à chaud.
      result.onstatechange = () => refreshDevices()
      refreshDevices()
      return result
    } catch (err) {
      midiState.error = "Accès MIDI refusé : " + (err?.message || err)
      return null
    } finally {
      pending = null
    }
  })()

  return pending
}

function handleMidiMessage(input, e) {
  const data = e.data
  if (!data || data.length < 3) return

  const cmd = data[0] & 0xf0
  const note = data[1]
  const velocity = data[2]

  if (cmd === 0x90 && velocity > 0) {
    emit({
      type: "noteOn",
      note,
      velocity: 1, //velocity / 127,
      deviceId: input.id,
      deviceName: input.name || "",
    })
  } else if (cmd === 0x80 || (cmd === 0x90 && velocity === 0)) {
    emit({
      type: "noteOff",
      note,
      deviceId: input.id,
      deviceName: input.name || "",
    })
  }
}

function emit(event) {
  for (const fn of handlers) fn(event)
}

/**
 * Enregistre un récepteur de messages MIDI.
 * Retourne une fonction de désinscription.
 */
export function registerMidiNoteHandler(fn) {
  handlers.add(fn)
  return () => {
    handlers.delete(fn)
  }
}

/**
 * Ancienne API : conservée pour les appelants qui ne connaissent pas les
 * appareils. Ces événements n'ont pas de `deviceId` et ne sont donc pas routés
 * vers les modules `midi` (qui exigent un appareil).
 */
export function emitMidiNoteOn(note, velocity) {
  emit({ type: "noteOn", note, velocity, deviceId: null })
}

export function emitMidiNoteOff(note) {
  emit({ type: "noteOff", note, deviceId: null })
}
