<script setup>
import { ref, watch, onMounted, onUnmounted } from "vue"
import { getSharedVoice, setSharedPatch, initSharedVoice } from "../composables/useSharedVoice"
import SequencerTrack from "./SequencerTrack.vue"

const props = defineProps({
  patch: {
    type: Object,
    required: true,
  },
})

const tracks = ref([])
let uid = 0

function newTrack() {
  uid++
  return { id: `track-${uid}` }
}

function addTrack() {
  tracks.value.push(newTrack())
}

function removeTrack(id) {
  const idx = tracks.value.findIndex((t) => t.id === id)
  if (idx !== -1) tracks.value.splice(idx, 1)
}

for (let i = 0; i < 2; i++) addTrack()

const BPM = ref(120)
const stepCount = ref(16)
const playing = ref(false)
const currentStep = ref(-1)
const intervalId = ref(null)

const trackRefs = ref({})

function setTrackRef(id, el) {
  if (el) trackRefs.value[id] = el
  else delete trackRefs.value[id]
}

/* =========================
 * Patch partagé
 * ========================= */
watch(
  () => props.patch,
  () => setSharedPatch(props.patch),
  { deep: true, immediate: true }
)

onMounted(() => setSharedPatch(props.patch))

/* =========================
 * Horloge maîtresse (une seule pour toutes les pistes)
 * ========================= */
async function start() {
  if (playing.value) return
  await initSharedVoice()
  playing.value = true
  currentStep.value = 0
  tickAll(0)
  const interval = (60 / BPM.value / 4) * 1000
  intervalId.value = setInterval(() => {
    currentStep.value = (currentStep.value + 1) % stepCount.value
    tickAll(currentStep.value)
  }, interval)
}

function stop() {
  playing.value = false
  if (intervalId.value) {
    clearInterval(intervalId.value)
    intervalId.value = null
  }
  getSharedVoice()?.stopAll()
  currentStep.value = -1
}

function togglePlay() {
  if (playing.value) {
    stop()
  } else {
    start()
  }
}

function tickAll(step) {
  for (const t of tracks.value) {
    trackRefs.value[t.id]?.trigger(step, BPM.value)
  }
}

onUnmounted(() => {
  stop()
  getSharedVoice()?.stopAll()
})
</script>

<template>
  <div class="multi-sequencer">
    <div class="controls">
      <button @click="togglePlay">
        {{ playing ? 'Stop' : 'Play all' }}
      </button>
      <label>
        BPM:
        <input v-model.number="BPM" type="number" min="40" max="300" />
      </label>
      <label>
        Steps:
        <input v-model.number="stepCount" type="number" min="1" max="64" />
      </label>
      <button class="add" @click="addTrack">+ Piste</button>
    </div>

    <div class="tracks">
      <SequencerTrack
        v-for="t in tracks"
        :key="t.id"
        :ref="(el) => setTrackRef(t.id, el)"
        :name="`Piste ${tracks.indexOf(t) + 1}`"
        :step-count="stepCount"
        :current-step="playing ? currentStep : -1"
      >
        <template #remove>
          <button class="remove" @click="removeTrack(t.id)">×</button>
        </template>
      </SequencerTrack>
    </div>
  </div>
</template>

<style scoped>
.multi-sequencer {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.controls {
  display: flex;
  gap: 12px;
  align-items: center;
  flex-wrap: wrap;
}

.controls button {
  padding: 6px 16px;
  cursor: pointer;
}

.controls input {
  width: 60px;
}

.tracks {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.controls .add {
  margin-left: auto;
}

.remove {
  border: none;
  background: #c0392b;
  color: white;
  border-radius: 4px;
  width: 22px;
  height: 22px;
  cursor: pointer;
  line-height: 1;
}
</style>
