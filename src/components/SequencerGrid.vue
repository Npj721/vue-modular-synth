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
  <div ref="scrollEl" class="seq-scroll">
    <div class="seq-content">
      <div class="seq-header">
        <div class="seq-header-spacer">note</div>
        <div class="seq-header-steps" :style="{ width: gridWidth + 'px' }">
          <div
            v-for="i in totalSteps"
            :key="i"
            class="seq-header-step"
            :class="{
              active: stepStates[i - 1]?.active,
              current: i - 1 === currentStep,
            }"
            :title="`Pas ${i}`"
          >
            <span class="seq-step-number">{{ i }}</span>
            <div
              class="seq-velocity"
              :title="`Vélocité du pas ${i} : ${Math.round((stepStates[i - 1]?.velocity ?? 1) * 100)} %`"
              @pointerdown="onVelocityDown($event, i - 1)"
              @pointermove="onVelocityMove($event, i - 1)"
              @pointerup="stopVelocityDrag"
              @pointercancel="stopVelocityDrag"
            >
              <div
                class="seq-velocity-fill"
                :style="{ height: (stepStates[i - 1]?.velocity ?? 1) * 100 + '%' }"
              ></div>
            </div>
          </div>
          <button
            type="button"
            class="seq-header-add"
            title="Ajouter un pas"
            @click="emit('add-step')"
          >
            +
          </button>
        </div>
      </div>

      <div class="seq-body">
        <div class="seq-keys" :style="{ height: gridHeight + 'px' }">
          <div
            v-for="row in noteRows"
            :key="row.note"
            class="seq-key"
            :class="{ black: row.black, c: row.isC }"
          >
            {{ row.name }}
          </div>
        </div>

        <div
          class="seq-grid"
          :style="{ width: gridWidth + 'px', height: gridHeight + 'px' }"
          @click="onGridClick"
        >
          <div
            v-for="row in noteRows"
            :key="row.note"
            class="seq-row"
            :class="{ black: row.black, c: row.isC }"
          ></div>

          <div
            v-if="currentStep >= 0 && currentStep < totalSteps"
            class="seq-current-col"
            :style="{
              left: currentStep * CELL_W + 'px',
              width: CELL_W + 'px',
            }"
          ></div>

          <div
            v-for="note in activeNotes"
            :key="note.index"
            class="seq-note"
            :class="{ current: note.index === currentStep }"
            :style="{
              left: note.index * CELL_W + 1 + 'px',
              top: noteTop(note.note) + 1 + 'px',
              width: CELL_W - 2 + 'px',
              height: ROW_H - 2 + 'px',
              opacity: 0.45 + note.velocity * 0.55,
            }"
            :title="`Pas ${note.index + 1} · ${noteName(note.note)} · vélocité ${Math.round(note.velocity * 100)} %`"
          ></div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.seq-scroll {
  --cell-w: 26px;
  --row-h: 16px;
  --key-w: 38px;

  height: 340px;
  min-height: 180px;
  max-height: 70vh;
  overflow: auto;
  resize: vertical;
  border: 1px solid #e0c9a6;
  border-radius: 4px;
  background: #fff;
  box-sizing: border-box;
}

.seq-content {
  width: max-content;
  min-width: 100%;
}

/* ---------- En-tête : numéros de pas + vélocités ---------- */

.seq-header {
  position: sticky;
  top: 0;
  z-index: 4;
  display: flex;
  width: max-content;
  background: #fdf6ea;
  border-bottom: 1px solid #e0c9a6;
}

.seq-header-spacer {
  position: sticky;
  left: 0;
  z-index: 5;
  display: flex;
  align-items: center;
  justify-content: center;
  width: var(--key-w);
  min-width: var(--key-w);
  height: 44px;
  box-sizing: border-box;
  background: #fdf6ea;
  border-right: 1px solid #e0c9a6;
  color: #b08a55;
  font-size: 9px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.seq-header-steps {
  display: flex;
}

.seq-header-step {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: space-between;
  width: var(--cell-w);
  min-width: var(--cell-w);
  height: 44px;
  padding: 2px 0 3px;
  box-sizing: border-box;
  border-right: 1px solid #ead7b8;
  color: #8a6a3a;
  font-size: 9px;
  user-select: none;
}

.seq-header-step:nth-child(4n) {
  border-right-color: #d8b98b;
}

.seq-header-step.active {
  background: #ffe9c4;
}

.seq-header-step.current {
  background: #f7c9a3;
  box-shadow: inset 0 0 0 1px #e67e22;
}

.seq-step-number {
  font-variant-numeric: tabular-nums;
}

.seq-velocity {
  position: relative;
  width: 10px;
  height: 24px;
  overflow: hidden;
  border-radius: 2px;
  background: #f0e0c8;
  cursor: ns-resize;
  touch-action: none;
}

.seq-velocity-fill {
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  background: #e29a2d;
}

.seq-header-add {
  width: 28px;
  min-width: 28px;
  height: 44px;
  border: 0;
  border-left: 1px solid #e0c9a6;
  background: #f7e2c0;
  color: #b9770e;
  font-size: 18px;
  font-weight: 700;
  cursor: pointer;
}

.seq-header-add:hover {
  background: #ffe9c4;
}

/* ---------- Colonne des notes ---------- */

.seq-body {
  display: flex;
  width: max-content;
}

.seq-keys {
  position: sticky;
  left: 0;
  z-index: 3;
  width: var(--key-w);
  min-width: var(--key-w);
  box-sizing: border-box;
  background: #fff;
  border-right: 1px solid #e0c9a6;
}

.seq-key {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  height: var(--row-h);
  padding-right: 4px;
  box-sizing: border-box;
  border-bottom: 1px solid rgba(0, 0, 0, 0.05);
  background: #fff;
  color: #555;
  font-size: 9px;
  user-select: none;
  font-variant-numeric: tabular-nums;
}

.seq-key.black {
  background: #f1f1f1;
  color: #888;
}

.seq-key.c {
  border-top: 1px solid #d8b98b;
  font-weight: 600;
  color: #333;
}

/* ---------- Grille ---------- */

.seq-grid {
  position: relative;
  background: #fcfaf6;
  cursor: crosshair;
}

.seq-row {
  height: var(--row-h);
  box-sizing: border-box;
  border-bottom: 1px solid rgba(0, 0, 0, 0.05);
}

.seq-row.black {
  background: rgba(0, 0, 0, 0.035);
}

.seq-row.c {
  border-top: 1px solid rgba(160, 120, 60, 0.35);
}

/* Lignes verticales de la grille, par-dessus les lignes horizontales. */
.seq-grid::after {
  content: "";
  position: absolute;
  inset: 0;
  z-index: 1;
  pointer-events: none;
  background-image:
    repeating-linear-gradient(
      90deg,
      rgba(80, 60, 30, 0.12) 0 1px,
      transparent 1px var(--cell-w)
    ),
    repeating-linear-gradient(
      90deg,
      rgba(80, 60, 30, 0.26) 0 1px,
      transparent 1px calc(var(--cell-w) * 4)
    );
}

.seq-current-col {
  position: absolute;
  top: 0;
  bottom: 0;
  z-index: 1;
  pointer-events: none;
  background: rgba(231, 76, 60, 0.12);
}

.seq-note {
  position: absolute;
  z-index: 2;
  box-sizing: border-box;
  border: 1px solid #c67d0d;
  border-radius: 3px;
  background: linear-gradient(#f6b94f, #e79a1f);
  pointer-events: none;
}

.seq-note.current {
  border-color: #c0392b;
  background: linear-gradient(#f07a6a, #e74c3c);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.7);
}
</style>
