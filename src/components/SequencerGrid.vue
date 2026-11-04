<script setup>
import { computed, nextTick, onMounted, ref, watch } from "vue"

/* Grille "piano roll" du séquenceur mono-piste :
 *   - X = numéro de pas
 *   - Y = note MIDI
 *
 * Seules les notes actives sont rendues (un bloc par pas) : la grille de fond
 * est dessinée en CSS, ce qui permet d'augmenter le nombre de pas sans faire
 * exploser le nombre de nœuds DOM. */

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
const NOTE_MIN = 0
const NOTE_MAX = 127
const CELL_W = 26
const ROW_H = 16
const KEY_W = 38

const props = defineProps({
  steps: { type: Array, default: () => [] },
  stepCount: { type: Number, default: 16 },
  currentStep: { type: Number, default: -1 },
})

const emit = defineEmits(["toggle-step", "velocity-change", "add-step"])

const scrollEl = ref(null)
const dragStep = ref(-1)

const totalSteps = computed(() => Math.max(1, Math.round(Number(props.stepCount) || 1)))
const gridWidth = computed(() => totalSteps.value * CELL_W)
const gridHeight = computed(() => (NOTE_MAX - NOTE_MIN + 1) * ROW_H)

/* Lignes verticales de la grille : mineures à chaque pas, majeures tous les
 * 4 pas. Couleurs issues du thème Bootstrap courant. */
const gridBackground = computed(() => {
  const minor = "rgba(var(--bs-body-color-rgb), 0.12)"
  const major = "rgba(var(--bs-body-color-rgb), 0.26)"
  return [
    `repeating-linear-gradient(90deg, ${minor} 0 1px, transparent 1px ${CELL_W}px)`,
    `repeating-linear-gradient(90deg, ${major} 0 1px, transparent 1px ${CELL_W * 4}px)`,
  ].join(", ")
})

/* Styles de ligne partagés par la colonne de notes et la grille. */
const rowStyle = (row) => ({
  height: `${ROW_H}px`,
  boxSizing: "border-box",
  borderBottom: "1px solid var(--bs-border-color-translucent)",
  backgroundColor: row.black ? "rgba(var(--bs-body-color-rgb), 0.04)" : undefined,
  borderTop: row.isC ? "1px solid rgba(var(--bs-body-color-rgb), 0.25)" : undefined,
})

const noteName = (note) => {
  const safe = Math.max(NOTE_MIN, Math.min(NOTE_MAX, Math.round(Number(note))))
  return `${NOTE_NAMES[safe % 12]}${Math.floor(safe / 12) - 1}`
}

/* De haut en bas : note la plus aiguë -> la plus grave. */
const noteRows = computed(() =>
  Array.from({ length: NOTE_MAX - NOTE_MIN + 1 }, (_, i) => {
    const note = NOTE_MAX - i
    return {
      note,
      name: noteName(note),
      black: [1, 3, 6, 8, 10].includes(note % 12),
      isC: note % 12 === 0,
    }
  })
)

const stepStates = computed(() =>
  Array.from({ length: totalSteps.value }, (_, i) => {
    const s = props.steps[i] ?? {}
    const note = Number.isFinite(Number(s.note))
      ? Math.max(NOTE_MIN, Math.min(NOTE_MAX, Math.round(Number(s.note))))
      : 60
    const velocity = Number.isFinite(Number(s.velocity))
      ? Math.max(0, Math.min(1, Number(s.velocity)))
      : 1
    return { note, active: !!s.active, velocity }
  })
)

const activeNotes = computed(() =>
  stepStates.value
    .map((s, index) => ({ ...s, index }))
    .filter((s) => s.active)
)

const noteTop = (note) => (NOTE_MAX - note) * ROW_H

const onGridClick = (event) => {
  const rect = event.currentTarget.getBoundingClientRect()
  const step = Math.floor((event.clientX - rect.left) / CELL_W)
  const row = Math.floor((event.clientY - rect.top) / ROW_H)
  const note = NOTE_MAX - row
  if (step < 0 || step >= totalSteps.value) return
  if (note < NOTE_MIN || note > NOTE_MAX) return
  emit("toggle-step", { index: step, note })
}

/* Barre de vélocité intégrée à l'en-tête de chaque pas : un glisser vertical
 * (ou un simple clic) règle la vélocité du pas. */
const applyVelocityFromEvent = (event, index) => {
  const rect = event.currentTarget.getBoundingClientRect()
  if (!rect.height) return
  const ratio = 1 - (event.clientY - rect.top) / rect.height
  const value = Math.round(Math.max(0, Math.min(1, ratio)) * 100) / 100
  emit("velocity-change", { index, value })
}

const onVelocityDown = (event, index) => {
  event.preventDefault()
  event.stopPropagation()
  dragStep.value = index
  event.currentTarget.setPointerCapture?.(event.pointerId)
  applyVelocityFromEvent(event, index)
}

const onVelocityMove = (event, index) => {
  if (dragStep.value !== index) return
  applyVelocityFromEvent(event, index)
}

const stopVelocityDrag = () => {
  dragStep.value = -1
}

/* Centre la vue sur les notes réellement utilisées au montage, plutôt que de
 * laisser l'utilisateur devant le haut de la plage MIDI (notes très aiguës). */
const scrollToActiveRange = () => {
  const el = scrollEl.value
  if (!el) return
  const used = props.steps
    .filter((s) => s?.active && Number.isFinite(Number(s.note)))
    .map((s) => Number(s.note))
  const center = used.length
    ? (Math.min(...used) + Math.max(...used)) / 2
    : 60
  el.scrollTop = Math.max(
    0,
    noteTop(center) - el.clientHeight / 2 + ROW_H / 2
  )
}

onMounted(scrollToActiveRange)

/* Quand on ajoute des pas, on amène la vue sur les nouvelles colonnes. */
watch(
  () => props.stepCount,
  (next, prev) => {
    if (next <= prev) return
    nextTick(() => {
      const el = scrollEl.value
      if (el) el.scrollLeft = el.scrollWidth
    })
  }
)
</script>

<template>
  <div
    ref="scrollEl"
    class="border rounded overflow-auto bg-body"
    style="height: 340px; min-height: 180px; max-height: 70vh; resize: vertical; box-sizing: border-box"
  >
    <div style="width: max-content; min-width: 100%">
      <div
        class="d-flex border-bottom bg-body-tertiary"
        style="position: sticky; top: 0; z-index: 4; width: max-content"
      >
        <div
          class="d-flex align-items-center justify-content-center border-end bg-body-tertiary text-body-secondary text-uppercase user-select-none"
          style="position: sticky; left: 0; z-index: 5; width: 38px; min-width: 38px; height: 44px; box-sizing: border-box; font-size: 9px; letter-spacing: 0.04em"
        >note</div>
        <div class="d-flex" :style="{ width: gridWidth + 'px' }">
          <div
            v-for="i in totalSteps"
            :key="i"
            class="d-flex flex-column align-items-center justify-content-between border-end user-select-none"
            :class="{
              'bg-warning-subtle': stepStates[i - 1]?.active,
              'bg-warning': i - 1 === currentStep,
            }"
            :style="{
              width: CELL_W + 'px',
              minWidth: CELL_W + 'px',
              height: '44px',
              padding: '2px 0 3px',
              boxSizing: 'border-box',
              fontSize: '9px',
              color: i - 1 === currentStep ? 'var(--bs-warning-text-emphasis)' : 'var(--bs-secondary-color)',
              borderRightColor: i % 4 === 0 ? 'var(--bs-secondary-border-subtle)' : 'var(--bs-border-color)',
            }"
            :title="`Pas ${i}`"
          >
            <span class="font-monospace">{{ i }}</span>
            <div
              class="position-relative overflow-hidden rounded"
              style="width: 10px; height: 24px; background: var(--bs-secondary-bg); cursor: ns-resize; touch-action: none"
              :title="`Vélocité du pas ${i} : ${Math.round((stepStates[i - 1]?.velocity ?? 1) * 100)} %`"
              @pointerdown="onVelocityDown($event, i - 1)"
              @pointermove="onVelocityMove($event, i - 1)"
              @pointerup="stopVelocityDrag"
              @pointercancel="stopVelocityDrag"
            >
              <div
                class="position-absolute bottom-0 start-0 end-0 bg-warning"
                :style="{ height: (stepStates[i - 1]?.velocity ?? 1) * 100 + '%' }"
              ></div>
            </div>
          </div>
          <button
            type="button"
            class="btn btn-warning rounded-0 fw-bold border-start"
            style="width: 28px; min-width: 28px; height: 44px; font-size: 18px"
            title="Ajouter un pas"
            @click="emit('add-step')"
          >
            +
          </button>
        </div>
      </div>

      <div class="d-flex" style="width: max-content">
        <div
          class="bg-body border-end"
          :style="{
            position: 'sticky',
            left: 0,
            zIndex: 3,
            width: '38px',
            minWidth: '38px',
            boxSizing: 'border-box',
            height: gridHeight + 'px',
          }"
        >
          <div
            v-for="row in noteRows"
            :key="row.note"
            class="d-flex align-items-center justify-content-end user-select-none"
            :class="{
              'bg-body-secondary text-body-tertiary': row.black,
              'fw-semibold text-body': row.isC,
            }"
            :style="{ ...rowStyle(row), paddingRight: '4px', fontSize: '9px' }"
          >
            {{ row.name }}
          </div>
        </div>

        <div
          class="position-relative"
          :style="{
            width: gridWidth + 'px',
            height: gridHeight + 'px',
            cursor: 'crosshair',
            backgroundImage: gridBackground,
            backgroundColor: 'var(--bs-body-bg)',
          }"
          @click="onGridClick"
        >
          <div
            v-for="row in noteRows"
            :key="row.note"
            :style="rowStyle(row)"
          ></div>

          <div
            v-if="currentStep >= 0 && currentStep < totalSteps"
            class="position-absolute top-0 bottom-0 pe-none"
            :style="{
              left: currentStep * CELL_W + 'px',
              width: CELL_W + 'px',
              zIndex: 1,
              backgroundColor: 'rgba(var(--bs-danger-rgb), 0.12)',
            }"
          ></div>

          <div
            v-for="note in activeNotes"
            :key="note.index"
            class="position-absolute rounded pe-none"
            :style="{
              left: note.index * CELL_W + 1 + 'px',
              top: noteTop(note.note) + 1 + 'px',
              width: CELL_W - 2 + 'px',
              height: ROW_H - 2 + 'px',
              opacity: 0.45 + note.velocity * 0.55,
              zIndex: 2,
              boxSizing: 'border-box',
              border: `1px solid ${note.index === currentStep ? 'var(--bs-danger)' : 'var(--bs-warning)'}`,
              background: note.index === currentStep
                ? 'linear-gradient(var(--bs-danger), var(--bs-danger))'
                : 'linear-gradient(var(--bs-warning), var(--bs-warning))',
            }"
            :title="`Pas ${note.index + 1} · ${noteName(note.note)} · vélocité ${Math.round(note.velocity * 100)} %`"
          ></div>
        </div>
      </div>
    </div>
  </div>
</template>
