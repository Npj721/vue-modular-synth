<script setup>
import { ref, watch, onUnmounted } from 'vue'
import { usePatchVoice } from '../composables/usePatchVoice'

const props = defineProps({
  patch: {
    type: Object,
    required: true
  }
})

const audioCtx = ref(null)
const voice = ref(null)
const activeNote = ref(null)
const ready = ref(false)

const KEYS = [
  { note: 60, label: 'C' },
  { note: 62, label: 'D' },
  { note: 64, label: 'E' },
  { note: 65, label: 'F' },
  { note: 67, label: 'G' },
  { note: 69, label: 'A' },
  { note: 71, label: 'B' },
  { note: 72, label: 'C' }
]

/* =========================
 * Audio init (user gesture)
 * ========================= */
async function initAudio() {
  if (!audioCtx.value) {
    audioCtx.value = new AudioContext()
  }

  if (audioCtx.value.state === 'suspended') {
    await audioCtx.value.resume()
  }

  voice.value = usePatchVoice(audioCtx.value, props.patch)
  ready.value = true
}

/* =========================
 * Patch updates
 * ========================= */
watch(
  () => props.patch,
  (patch) => {
    if (!audioCtx.value || !ready.value) return

    voice.value?.dispose()
    voice.value = usePatchVoice(audioCtx.value, patch)
  },
  { deep: true }
)

/* =========================
 * Note handling
 * ========================= */
function noteOn(note) {
  if (!ready.value || !voice.value) return

  // piano behavior
  voice.value.stop()
  voice.value.start(note, 1)
  activeNote.value = note
}

function noteOff(note) {
  if (activeNote.value === note && voice.value) {
    voice.value.stop()
    activeNote.value = null
  }
}

onUnmounted(() => {
  voice.value?.dispose()
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
        v-for="key in KEYS"
        :key="key.note"
        class="key"
        :class="{ active: activeNote === key.note }"
        @mousedown="noteOn(key.note)"
        @mouseup="noteOff(key.note)"
        @mouseleave="noteOff(key.note)"
      >
        {{ key.label }}
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
  gap: 4px;
}

.key {
  width: 48px;
  height: 120px;
  border: 1px solid #999;
  background: #fdfdfd;
  cursor: pointer;
  user-select: none;
}

.key.active {
  background: #00c9a7;
}
</style>
