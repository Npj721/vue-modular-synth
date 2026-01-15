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
