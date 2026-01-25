<script setup>
import { ref, watch, computed, onMounted, onUnmounted, nextTick } from "vue"
import { usePatchVoice } from "../composables/usePatchVoice"

const props = defineProps({
  patch: {
    type: Object,
    required: true,
  },
})

/* =========================
 * State
 * ========================= */
const synth = ref(null)
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
 * Init Audio
 * ========================= */
async function initAudio() {
  synth.value = usePatchVoice(props.patch)
  await synth.value.init()
  ready.value = true
}

/* =========================
 * Patch updates
 * ========================= */
watch(
  () => props.patch,
  async () => {
    if (!ready.value) return

    // 1. stop toutes les voix
    synth.value.stopAll()
    activeNotes.value.clear()

    // 2. attendre que Vue ait fini
    await nextTick()


    synth.value.rebuildMainPatch()
  },
  { deep: true }
)

/* =========================
 * Notes
 * ========================= */
function noteOn(note) {
  if (!ready.value || activeNotes.value.has(note)) return
  synth.value.noteOn(note)
  activeNotes.value.add(note)
}

function noteOff(note) {
  if (!ready.value || !activeNotes.value.has(note)) return
  synth.value.noteOff(note)
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
})

onUnmounted(() => {
  window.removeEventListener("keydown", handleKeyDown)
  window.removeEventListener("keyup", handleKeyUp)
  synth.value?.stopAll()
})
</script>

<template>
  <div class="synth-keyboard">
    <button v-if="!ready" class="init-btn" @click="initAudio">
      Init Audio
    </button>

    <div v-else class="keys">
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

.init-btn {
  padding: 8px 12px;
  font-size: 14px;
  cursor: pointer;
}

.keys {
  display: flex;
  gap: 6px;
}

.key {
  width: 56px;
  height: 140px;
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
