<script setup>
import { ref, reactive, onBeforeUnmount } from "vue"
import { emitMidiNoteOn, emitMidiNoteOff } from "../composables/useMidiBus"

/* =========================================================
 * Contrôleur MIDI
 *
 * - Demande l'accès MIDI (navigator.requestMIDIAccess)
 * - Liste les appareils (inputs) disponibles
 * - Permet d'en choisir un et de le connecter/déconnecter
 * - Gère Note On (0x90) / Note Off (0x80) avec velocity et les relaie
 *   vers le clavier à l'écran (SynthKeyboard) via useMidiBus.
 * ========================================================= */

const midiAccess = ref(null)
const midiSupported = typeof navigator !== "undefined" && "requestMIDIAccess" in navigator
const wasRequested = ref(false)
const error = ref("")
const devices = reactive([])

const selectedDeviceId = ref("")
const connectedDevices = reactive(new Map()) // id -> MIDIInput
const activeNotes = ref(new Set())

const statusText = ref("MIDI indisponible")

/* ------------------------------------------------------------------
 * Liste des appareils (inputs)
 * ------------------------------------------------------------------ */
function buildDeviceList() {
  devices.splice(0, devices.length)
  if (!midiAccess.value) return
  const inputs = midiAccess.value.inputs || new Map()
  for (const [, input] of inputs) {
    devices.push({
      id: input.id,
      name: input.name || "Appareil sans nom",
      manufacturer: input.manufacturer || "",
      state: input.state || "disconnected",
      connection: input.connection || "closed",
    })
  }
  // la sélection par défaut = premier appareil
  if (selectedDeviceId.value === "" && devices.length) {
    selectedDeviceId.value = devices[0].id
  }
  updateStatus()
}

/* ------------------------------------------------------------------
 * Écoute des événements MIDI
 * ------------------------------------------------------------------ */
function onMidiMessage(e) {
  const data = e.data
  if (!data || data.length < 3) return
  const cmd = data[0] & 0xf0
  const note = data[1]
  const velocity = data[2]

  switch (cmd) {
    case 0x90: // Note On
      if (velocity > 0) {
        if (!activeNotes.value.has(note)) {
          // Joué exactement comme le clavier à l'écran (velocity pleine = 1) :
          // même son, quelle que soit la force d'appui sur le clavier MIDI.
          emitMidiNoteOn(note, 1)
          activeNotes.value.add(note)
        }
      } else {
        // velocity 0 = Note Off
        handleNoteOff(note)
      }
      break

    case 0x80: // Note Off
      handleNoteOff(note)
      break
  }
}

function handleNoteOff(note) {
  if (!activeNotes.value.has(note)) return
  emitMidiNoteOff(note)
  activeNotes.value.delete(note)
}

/* ------------------------------------------------------------------
 * Branchement / débranchement d'un appareil
 * ------------------------------------------------------------------ */
function connectDevice(deviceId) {
  const input = midiAccess.value?.inputs?.get(deviceId)
  if (!input) return
  if (connectedDevices.has(deviceId)) return // déjà connecté

  input.onmidimessage = onMidiMessage
  connectedDevices.set(deviceId, input)
  updateStatus()
}

function disconnectDevice(deviceId) {
  const input = connectedDevices.get(deviceId)
  if (!input) return
  input.onmidimessage = null
  connectedDevices.delete(deviceId)
  updateStatus()
}

function isConnected(id) {
  return connectedDevices.has(id)
}

function onSelectChange(newId) {
  selectedDeviceId.value = newId
}

/* ------------------------------------------------------------------
 * Étiquettes / statut
 * ------------------------------------------------------------------ */
function deviceLabel(d) {
  const conn = isConnected(d.id)
  return (
    d.name +
    (d.manufacturer ? " (" + d.manufacturer + ")" : "") +
    (conn ? " — connecté" : "")
  )
}

function updateStatus() {
  const connected = connectedDevices.size
  if (midiAccess.value === null) {
    statusText.value = midiSupported ? "Cliquez sur Activer MIDI" : "MIDI non supporté par le navigateur"
  } else if (connected === 0) {
    statusText.value = "Aucun appareil connecté"
  } else {
    statusText.value = connected + " appareil(s) connecté(s)"
  }
}

/* ------------------------------------------------------------------
 * Request MIDI
 * ------------------------------------------------------------------ */
async function requestMidi() {
  error.value = ""
  try {
    if (!midiSupported) {
      error.value = "Votre navigateur ne supporte pas le Web MIDI API."
      return
    }
    const access = await navigator.requestMIDIAccess({ sysex: false })
    midiAccess.value = access
    wasRequested.value = true

    // mises à jour à chaud (branchement / débranchement d'un appareil)
    access.onstatechange = () => buildDeviceList()

    // si un appareil était sélectionné et connecté avant, le re-connecter
    buildDeviceList()
  } catch (err) {
    error.value = "Accès MIDI refusé : " + (err?.message || err)
    statusText.value = "Accès refusé"
  }
}

onBeforeUnmount(() => {
  // débrancher proprement pour ne plus recevoir de messages
  for (const [, input] of connectedDevices) {
    input.onmidimessage = null
  }
  connectedDevices.clear()
})
</script>

<template>
  <div class="midi-controller">
    <div class="midi-controls">
      <button
        class="midi-btn request"
        :disabled="wasRequested"
        @click="requestMidi"
      >{{ wasRequested ? "MIDI activé" : "Activer MIDI" }}</button>

      <select
        v-if="midiAccess"
        :value="selectedDeviceId"
        class="midi-select"
        @change="onSelectChange($event.target.value)"
      >
        <option value="">— Choisir un appareil —</option>
        <option v-for="d in devices" :key="d.id" :value="d.id">
          {{ deviceLabel(d) }}
        </option>
      </select>

      <button
        v-if="midiAccess && selectedDeviceId"
        class="midi-btn connect"
        :class="{ active: isConnected(selectedDeviceId) }"
        @click="isConnected(selectedDeviceId) ? disconnectDevice(selectedDeviceId) : connectDevice(selectedDeviceId)"
      >{{ isConnected(selectedDeviceId) ? "Déconnecter" : "Connecter" }}</button>

      <span class="midi-status" :class="{ ok: connectedDevices.size > 0 }">{{ statusText }}</span>
    </div>

    <div v-if="error" class="midi-error">{{ error }}</div>
    <p v-else-if="!midiSupported" class="midi-hint">
      Le Web MIDI API n'est pas disponible dans ce navigateur. Utilisez Chrome ou Edge.
    </p>
    <p v-else-if="!wasRequested" class="midi-hint">
      Activez MIDI pour pouvoir jouer avec votre piano / clavier MIDI.
    </p>
  </div>
</template>

<style scoped>
.midi-controller {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px;
  border: 1px solid #ddd;
  border-radius: 6px;
  background: #fafafa;
  font-size: 13px;
}
.midi-controls {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}
.midi-btn {
  padding: 6px 14px;
  border: 1px solid #999;
  border-radius: 4px;
  cursor: pointer;
  background: #eee;
  color: #333;
  font-weight: bold;
}
.midi-btn:disabled {
  opacity: 0.6;
  cursor: default;
}
.midi-btn.request {
  background: #4d96ff;
  color: white;
  border-color: #2c7be5;
}
.midi-btn.request:disabled {
  background: #8bb8ff;
}
.midi-btn.connect {
  background: #eee;
}
.midi-btn.connect.active {
  background: #f0a6b0;
  border-color: #e05260;
}
.midi-select {
  padding: 5px 8px;
  min-width: 220px;
  border: 1px solid #999;
  border-radius: 4px;
  background: white;
}
.midi-status {
  color: #888;
  font-size: 12px;
}
.midi-status.ok {
  color: #00a86b;
}
.midi-error {
  color: #c0392b;
  font-size: 12px;
}
.midi-hint {
  color: #888;
  font-size: 12px;
  margin: 0;
}
</style>
