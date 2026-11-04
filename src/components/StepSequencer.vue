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
const stepCount = ref(16)

function buildSteps() {
  return Array.from({ length: stepCount.value }, (_, i) => ({
    note: 48 + i * 2,
    active: i % 4 === 0,
  }))
}

const steps = ref(buildSteps())

watch(stepCount, () => {
  const current = steps.value
  const next = buildSteps()
  next.forEach((s, i) => {
    if (current[i]) {
      s.note = current[i].note
      s.active = current[i].active
    }
  })
  steps.value = next
  if (currentStep.value >= stepCount.value) currentStep.value = -1
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
  if (playing.value) return
  playing.value = true
  currentStep.value = 0
  const interval = (60 / BPM.value / 4) * 1000
  triggerStep(0)
  intervalId.value = setInterval(() => {
    currentStep.value = (currentStep.value + 1) % stepCount.value
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

async function togglePlay() {
  if (playing.value) {
    stop()
    return
  }
  if (!ready.value) await initAudio()
  start()
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
    await synth.value.rebuildMainPatch()
  },
  { deep: true }
)
</script>

<template>
  <div class="d-flex flex-column gap-3">
    <div>
      <div class="d-flex gap-3 align-items-center flex-wrap">
        <button class="btn" :class="playing ? 'btn-danger' : 'btn-success'" @click="togglePlay">
          {{ playing ? 'Stop' : 'Play' }}
        </button>
        <label class="d-flex align-items-center gap-1 small text-body-secondary">
          BPM:
          <input class="form-control form-control-sm" style="width: 60px" v-model.number="BPM" type="number" min="40" max="300" />
        </label>
        <label class="d-flex align-items-center gap-1 small text-body-secondary">
          Steps:
          <input class="form-control form-control-sm" style="width: 60px" v-model.number="stepCount" type="number" min="1" max="64" />
        </label>
      </div>

      <div class="d-flex flex-wrap gap-1 mt-3">
        <div
          v-for="(step, i) in steps"
          :key="i"
          class="border rounded d-flex flex-column align-items-center gap-1 p-1 user-select-none"
          :class="{ 'bg-info text-dark': step.active, 'border-danger': i === currentStep }"
          :style="{ width: '44px', cursor: 'pointer', boxShadow: i === currentStep ? '0 0 0 2px var(--bs-danger)' : 'none' }"
          @click="step.active = !step.active"
        >
          <span class="small opacity-75">{{ i }}</span>
          <input
            v-model.number="step.note"
            class="form-control form-control-sm p-0 text-center"
            style="width: 34px; font-size: 12px"
            type="number"
            min="0"
            max="127"
            @click.stop
          />
        </div>
      </div>
    </div>
  </div>
</template>
