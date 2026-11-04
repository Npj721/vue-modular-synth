<script setup>
import { ref, onUnmounted } from "vue"
import { getSharedVoice, initSharedVoice } from "../composables/useSharedVoice"
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
  <div class="d-flex flex-column gap-3">
    <div class="d-flex gap-3 align-items-center flex-wrap">
      <button class="btn" :class="playing ? 'btn-danger' : 'btn-success'" @click="togglePlay">
        {{ playing ? 'Stop' : 'Play all' }}
      </button>
      <label class="d-flex align-items-center gap-1 small text-body-secondary">
        BPM:
        <input class="form-control form-control-sm" style="width: 60px" v-model.number="BPM" type="number" min="40" max="300" />
      </label>
      <label class="d-flex align-items-center gap-1 small text-body-secondary">
        Steps:
        <input class="form-control form-control-sm" style="width: 60px" v-model.number="stepCount" type="number" min="1" max="64" />
      </label>
      <button class="btn btn-outline-primary ms-auto" @click="addTrack">+ Piste</button>
    </div>

    <div class="d-flex flex-column gap-2">
      <SequencerTrack
        v-for="t in tracks"
        :key="t.id"
        :ref="(el) => setTrackRef(t.id, el)"
        :name="`Piste ${tracks.indexOf(t) + 1}`"
        :step-count="stepCount"
        :current-step="playing ? currentStep : -1"
      >
        <template #remove>
          <button class="btn btn-sm btn-danger px-2 py-0" @click="removeTrack(t.id)">×</button>
        </template>
      </SequencerTrack>
    </div>
  </div>
</template>
