<script setup>
import { ref, watch, computed, onMounted, onUnmounted } from "vue"
import { getSharedVoice, initSharedVoice } from "../composables/useSharedVoice"
import { registerMidiNoteHandler } from "../composables/useMidiBus"

const props = defineProps({
  patch: {
    type: Object,
    required: true,
  },
})

/* =========================
 * State
 * ========================= */
const ready = ref(false)
const activeNotes = ref(new Set())

/* =========================
 * Keyboard logic
 * ========================= */
const SCALE = [0, 2, 4, 5, 7, 9, 11] // do ré mi fa sol la si

const KEY_ROWS = [
  ["a","z","e","r","t","y","u","i","o","p"],
  ["q","s","d","f","g","h","j","k","l","m","ù","µ"],
  ["w","x","c","v","b","n",",",";","="]
]

const baseNote = ref(38) // D2

function buildKeyboardMap() {
  const map = {}

  KEY_ROWS.forEach((row, rowIndex) => {
    const octaveBase = baseNote.value + rowIndex * 12

    row.forEach((key, indexInRow) => {
      const scaleDegree = indexInRow % SCALE.length
      const octaveShift = Math.floor(indexInRow / SCALE.length)

      map[key] =
        octaveBase +
        octaveShift * 12 +
        SCALE[scaleDegree]
    })
  })

  return map
}


const KEYBOARD_MAP = ref(buildKeyboardMap())

/* =========================
 * UI KEYS (pour le template)
 * ========================= */
const KEYS = computed(() => {
  const keys = []

  KEY_ROWS.forEach((row) => {
    row.forEach((key) => {
      const note = KEYBOARD_MAP.value[key]
      if (note !== undefined) {
        keys.push({
          key,
          note,
          label: note, // plus tard → C3, D#4, etc
        })
      }
    })
  })

  return keys
})

function octaveUp() {
  baseNote.value += 12
  KEYBOARD_MAP.value = buildKeyboardMap()
}

function octaveDown() {
  baseNote.value -= 12
  KEYBOARD_MAP.value = buildKeyboardMap()
}

/* =========================
 * Init Audio (contexte partagé)
 * ========================= */
async function initAudio() {
  await initSharedVoice()
  ready.value = true
}

/* =========================
 * Patch updates (reconstruction sur la voix partagée)
 * ========================= */
watch(
  () => props.patch,
  () => {
    if (!ready.value) return
    // le patch partagé est resynchronisé (setSharedPatch géré par le séquenceur)
    // ici nous ne faisons que couper les notes actives du clavier à l'écran
    activeNotes.value.clear()
  },
  { deep: true }
)

/* =========================
 * Notes
 * ========================= */
async function noteOn(note, velocity = 1) {
  if (activeNotes.value.has(note)) return
  if (!ready.value) await initAudio()
  getSharedVoice().noteOn(note, velocity)
  activeNotes.value.add(note)
}

function noteOff(note) {
  if (!ready.value || !activeNotes.value.has(note)) return
  getSharedVoice().noteOff(note)
  activeNotes.value.delete(note)
}

/* =========================
 * Keyboard events
 * ========================= */
function handleKeyDown(e) {
  if (e.repeat) return

  if (e.key === "+") return octaveUp()
  if (e.key === "-") return octaveDown()

  const note = KEYBOARD_MAP.value[e.key.toLowerCase()]
  if (note !== undefined) noteOn(note)
}

function handleKeyUp(e) {
  const note = KEYBOARD_MAP.value[e.key.toLowerCase()]
  if (note !== undefined) noteOff(note)
}

onMounted(() => {
  window.addEventListener("keydown", handleKeyDown)
  window.addEventListener("keyup", handleKeyUp)

  // Reçoit les notes du clavier MIDI et les joue comme si elles venaient
  // du clavier à l'écran : même chemin audio + la touche s'allume.
  unregisterMidi = registerMidiNoteHandler((msg) => {
    if (msg.type === "noteOn") noteOn(msg.note, msg.velocity ?? 1)
    else if (msg.type === "noteOff") noteOff(msg.note)
  })
})

let unregisterMidi = null

onUnmounted(() => {
  window.removeEventListener("keydown", handleKeyDown)
  window.removeEventListener("keyup", handleKeyUp)
  if (unregisterMidi) unregisterMidi()
  getSharedVoice()?.stopAll()
})
</script>

<template>
  <div class="synth-keyboard">
    <div class="keys">
      <button
        v-for="k in KEYS"
        :key="k.key"
        class="key"
        :class="{ active: activeNotes.has(k.note) }"
        @mousedown="noteOn(k.note)"
        @mouseup="noteOff(k.note)"
        @mouseleave="noteOff(k.note)"
      >
        <div class="note">{{ k.label }}</div>
        <div class="kbd">{{ k.key }}</div>
      </button>
    </div>
  </div>
</template>

<style scoped>
.synth-keyboard {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.keys {
  display: flex;
  gap: 6px;
}

.key {
  width: 28px;
  height: 70px;
  border: 1px solid #999;
  background: #fdfdfd;
  cursor: pointer;
  user-select: none;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  padding: 6px;
}

.key.active {
  background: #00c9a7;
  color: white;
}

.note {
  font-size: 16px;
  font-weight: bold;
}

.kbd {
  font-size: 11px;
  opacity: 0.6;
  text-align: right;
}
</style>
