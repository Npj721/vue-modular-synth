<script setup>
import { ref, watch, onMounted, onUnmounted } from "vue"
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
 * Keyboard layout (UI)
 * ========================= */
const KEYS = [
  { note: 60, label: "C", key: "A" },
  { note: 62, label: "D", key: "Z" },
  { note: 64, label: "E", key: "E" },
  { note: 65, label: "F", key: "R" },
  { note: 67, label: "G", key: "T" },
  { note: 69, label: "A", key: "Y" },
  { note: 71, label: "B", key: "U" },
  { note: 72, label: "C", key: "I" },
  
  { note: 74, label: "C2", key: "Q" },
  { note: 76, label: "D2", key: "S" },
  { note: 77, label: "E2", key: "D" },
  { note: 79, label: "F2", key: "F" },
  { note: 81, label: "G2", key: "G" },
  { note: 83, label: "A2", key: "H" },
  { note: 84, label: "B2", key: "J" },

  { note: 86, label: "C3", key: "W" },
  { note: 88, label: "D3", key: "X" },
  { note: 89, label: "E3", key: "C" },
  { note: 91, label: "F3", key: "V" },
  { note: 93, label: "G3", key: "B" },
  { note: 95, label: "A3", key: "N" },
  { note: 96, label: "B3", key: "," },


]

const KEYBOARD_MAP = {
  a: 60,
  z: 62,
  e: 64,
  r: 65,
  t: 67,
  y: 69,
  u: 71,
  i: 72,
  

  q: 72,
  s: 74,
  d: 76,
  f: 77,
  g: 79,
  h: 81,
  j: 83,
  k: 84,
 

  w: 84,
  x: 86,
  c: 88,
  v: 89,
  b: 91,
  n: 93,
  ',': 95,
  ';':96
}

/* =========================
 * Init Audio (user gesture)
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
  async (newPatch) => {
    if (!ready.value) return

    // stop everything
    synth.value.stopAll()

    // recréer le moteur
    synth.value = usePatchVoice(newPatch)
    await synth.value.init()
  },
  { deep: true }
)

/* =========================
 * Note handling
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

  const note = KEYBOARD_MAP[e.key.toLowerCase()]
  if (note !== undefined) {
    noteOn(note)
  }
}

function handleKeyUp(e) {
  const note = KEYBOARD_MAP[e.key.toLowerCase()]
  if (note !== undefined) {
    noteOff(note)
  }
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
    <!-- INIT -->
    <button v-if="!ready" class="init-btn" @click="initAudio">
      Init Audio
    </button>

    <!-- KEYS -->
    <div v-else class="keys">
      <button
        v-for="k in KEYS"
        :key="k.note"
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
