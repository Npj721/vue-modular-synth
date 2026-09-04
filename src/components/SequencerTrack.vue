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
  <div class="track">
    <div class="track-head">
      <span class="track-name">{{ name }}</span>
      <label class="volume" title="Volume de la piste">
        Vol
        <input
          v-model.number="volume"
          type="range"
          min="0"
          max="1"
          step="0.01"
          @input="applyVolume"
        />
        <span class="volume-value">{{ Math.round(volume * 100) }}%</span>
      </label>
      <span class="track-remove"><slot name="remove" /></span>
    </div>
    <div class="steps">
      <div
        v-for="(step, i) in steps"
        :key="i"
        class="step"
        :class="{ active: step.active, current: i === currentStep }"
        @click="step.active = !step.active"
      >
        <span class="step-label">{{ i }}</span>
        <input
          v-model.number="step.note"
          class="step-note"
          type="number"
          min="0"
          max="127"
          @click.stop
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.track {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px;
  border: 1px solid #ddd;
  background: #fafafa;
}

.track-head {
  display: flex;
  align-items: center;
  gap: 8px;
}

.track-name {
  font-weight: bold;
  font-size: 13px;
}

.volume {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  opacity: 0.85;
  margin-left: 12px;
}

.volume input[type="range"] {
  width: 90px;
}

.volume-value {
  min-width: 40px;
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.track-remove {
  margin-left: auto;
}

.track-remove .remove {
  border: none;
  background: #c0392b;
  color: white;
  border-radius: 4px;
  width: 22px;
  height: 22px;
  cursor: pointer;
  line-height: 1;
}

.steps {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
}

.step {
  width: 40px;
  padding: 4px;
  border: 1px solid #999;
  background: #f0f0f0;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
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

.step-label {
  font-size: 10px;
  opacity: 0.6;
}

.step-note {
  width: 32px;
  text-align: center;
  font-size: 12px;
}
</style>
