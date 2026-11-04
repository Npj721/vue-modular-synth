<script setup>
import { ref, onUnmounted, watch } from "vue"
import { getSharedVoice, initSharedVoice } from "../composables/useSharedVoice"

const props = defineProps({
  name: { type: String, default: "Piste" },
  stepCount: { type: Number, default: 16 },
  currentStep: { type: Number, default: -1 },
})

const steps = ref(buildSteps(props.stepCount))

function buildSteps(count) {
  return Array.from({ length: count }, (_, i) => ({
    note: 48 + i * 2,
    active: i % 4 === 0,
  }))
}

watch(
  () => props.stepCount,
  (count) => {
    const current = steps.value
    const next = buildSteps(count)
    next.forEach((s, i) => {
      if (current[i]) {
        s.note = current[i].note
        s.active = current[i].active
      }
    })
    steps.value = next
  }
)

let ready = false

/* identifiant unique de cette piste (sert de clé de voix : évite
   les collisions entre pistes jouant la même note) */
const trackId = Math.random().toString(36).slice(2, 8)

/* gain de volume propre à cette piste (inséré avant l'entrée du patch) */
const volume = ref(1)
const trackGain = ref(null)

async function ensureReady() {
  if (!ready) {
    await initSharedVoice()
    trackGain.value = getSharedVoice().createTrackGainNode()
    applyVolume()
    ready = true
  }
}

function applyVolume() {
  trackGain.value?.setVolume(volume.value)
}

onUnmounted(() => {
  trackGain.value?.dispose()
  trackGain.value = null
})

/* appelé par l'horloge maîtresse pour déclencher un pas donné
   (bpm sert à calculer la durée de la note) */
async function trigger(stepIndex, bpm) {
  const step = steps.value[stepIndex]
  if (!step || !step.active) return
  await ensureReady()
  const voice = getSharedVoice()
  const interval = (60 / bpm / 4) * 1000
  const key = `t${trackId}:${stepIndex}:${step.note}`
  voice.noteOn(step.note, 1, trackGain.value?.node ?? null, key)
  setTimeout(() => voice.noteOff(step.note, key), interval * 0.8)
}

defineExpose({ trigger, steps })
</script>

<template>
  <div class="d-flex flex-column gap-2 p-2 border rounded bg-body-tertiary">
    <div class="d-flex align-items-center gap-2">
      <span class="fw-bold small">{{ name }}</span>
      <label class="d-flex align-items-center gap-2 small text-body-secondary ms-3" title="Volume de la piste">
        Vol
        <input
          v-model.number="volume"
          class="form-range"
          style="width: 90px"
          type="range"
          min="0"
          max="1"
          step="0.01"
          @input="applyVolume"
        />
        <span class="font-monospace text-end" style="min-width: 40px">{{ Math.round(volume * 100) }}%</span>
      </label>
      <span class="ms-auto"><slot name="remove" /></span>
    </div>
    <div class="d-flex flex-wrap gap-1">
      <div
        v-for="(step, i) in steps"
        :key="i"
        class="border rounded d-flex flex-column align-items-center gap-1 p-1 user-select-none"
        :class="{ 'bg-info text-dark': step.active, 'border-danger': i === currentStep }"
        :style="{ width: '40px', cursor: 'pointer', boxShadow: i === currentStep ? '0 0 0 2px var(--bs-danger)' : 'none' }"
        @click="step.active = !step.active"
      >
        <span class="small opacity-75">{{ i }}</span>
        <input
          v-model.number="step.note"
          class="form-control form-control-sm p-0 text-center"
          style="width: 32px; font-size: 12px"
          type="number"
          min="0"
          max="127"
          @click.stop
        />
      </div>
    </div>
  </div>
</template>
