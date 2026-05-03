<script setup>
import { ref, onUnmounted, watch, nextTick } from "vue"
import { usePatchVoice } from "../composables/usePatchVoice"

const props = defineProps({
  patch: {
    type: Object,
    required: true,
  },
})

const synth = ref(null)
const ready = ref(false)
const playing = ref(false)
const currentStep = ref(-1)
const intervalId = ref(null)

const BPM = ref(120)
const STEPS = 16

const SCALE = [0, 2, 4, 5, 7, 9, 11]

const baseNote = ref(48)

function buildSteps() {
  return Array.from({ length: STEPS }, (_, i) => ({
    note: baseNote.value + SCALE[i % SCALE.length] + Math.floor(i / SCALE.length) * 12,
    active: i % 4 === 0,
  }))
}

const steps = ref(buildSteps())

watch(baseNote, () => {
  steps.value = buildSteps()
})

/* =========================
 * Init Audio
 * ========================= */
async function initAudio() {
  synth.value = usePatchVoice(props.patch)
  await synth.value.init()
  ready.value = true
}

/* =========================
 * Playback
 * ========================= */
function start() {
  if (!ready.value) return
  playing.value = true
  currentStep.value = 0
  const interval = (60 / BPM.value / 4) * 1000
  triggerStep(0)
  intervalId.value = setInterval(() => {
    currentStep.value = (currentStep.value + 1) % STEPS
    triggerStep(currentStep.value)
  }, interval)
}

function stop() {
  playing.value = false
  if (intervalId.value) {
    clearInterval(intervalId.value)
    intervalId.value = null
  }
  synth.value?.stopAll()
  currentStep.value = -1
}

function togglePlay() {
  if (playing.value) stop()
  else start()
}

function triggerStep(stepIndex) {
  const step = steps.value[stepIndex]
  if (step.active) {
    synth.value.noteOn(step.note)
    setTimeout(() => synth.value.noteOff(step.note), (60 / BPM.value / 4) * 800)
  }
}

/* =========================
 * Cleanup
 * ========================= */
onUnmounted(() => {
  stop()
  synth.value?.stopAll()
})

/* =========================
 * Watch patch changes
 * ========================= */
watch(
  () => props.patch,
  async () => {
    if (!ready.value) return
    synth.value.stopAll()
    await nextTick()
    synth.value.rebuildMainPatch()
  },
  { deep: true }
)
</script>

<template>
  <div class="step-sequencer">
    <button v-if="!ready" class="init-btn" @click="initAudio">
      Init Audio
    </button>

    <div v-else>
      <div class="controls">
        <button @click="togglePlay">
          {{ playing ? 'Stop' : 'Play' }}
        </button>
        <label>
          BPM:
          <input v-model.number="BPM" type="number" min="40" max="300" />
        </label>
        <label>
          Base:
          <input v-model.number="baseNote" type="number" min="24" max="84" />
        </label>
      </div>

      <div class="steps">
        <div
          v-for="(step, i) in steps"
          :key="i"
          class="step"
          :class="{ active: step.active, current: i === currentStep }"
          @click="step.active = !step.active"
        >
          <div class="step-label">{{ step.note }}</div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.step-sequencer {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.init-btn {
  padding: 8px 12px;
  font-size: 14px;
  cursor: pointer;
}

.controls {
  display: flex;
  gap: 12px;
  align-items: center;
}

.controls button {
  padding: 6px 16px;
  cursor: pointer;
}

.controls input {
  width: 60px;
}

.steps {
  display: flex;
  gap: 4px;
}

.step {
  width: 40px;
  height: 60px;
  border: 1px solid #999;
  background: #f0f0f0;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  user-select: none;
}

.step.active {
  background: #00c9a7;
  color: white;
}

.step.current {
  border-color: #ff6b6b;
  box-shadow: 0 0 0 2px #ff6b6b;
}
</style>
