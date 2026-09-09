<script setup>
import { ref, computed, onMounted, onUnmounted, watch } from "vue"
import { getSharedVoice, initSharedVoice } from "../composables/useSharedVoice"
import { registerMidiNoteHandler } from "../composables/useMidiBus"

const props = defineProps({
  patch: {
    type: Object,
    required: true,
  },
  numOctaves: {
    type: Number,
    default: 5,
  },
})

/* =========================
 * State
 * ========================= */
const ready = ref(false)
const activeNotes = ref(new Set())
const heldByMouse = ref(null)
const heldByTouch = ref(new Map())

/* =========================
 * Piano layout (from example/synth.js)
 * ========================= */
const START_MIDI = 60 // C4
const WHITE_SEMITONES = [0, 2, 4, 5, 7, 9, 11]
const BLACK_SEMITONES = [1, 3, 6, 8, 10]
const NOTE_NAMES = ["C", "D", "E", "F", "G", "A", "B"]

const KEY_BINDINGS = {
  q: 60, a: 61, s: 62, z: 63, d: 64, f: 65, e: 66,
  g: 67, r: 68, h: 69, t: 70, j: 71, k: 72, y: 73,
  l: 74, u: 75, m: 76, i: 78, o: 80, p: 82,
}

function midiToName(midi) {
  const names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
  return names[midi % 12] + (Math.floor(midi / 12) - 1)
}

function midiFreq(m) {
  return 440 * Math.pow(2, (m - 69) / 12)
}

/* =========================
 * Key data
 * ========================= */
const pianoKeys = computed(() => {
  const keys = []

  for (let oct = 0; oct < props.numOctaves; oct++) {
    for (let i = 0; i < 7; i++) {
      const midi = START_MIDI + oct * 12 + WHITE_SEMITONES[i]
      keys.push({
        midi,
        note: NOTE_NAMES[i] + (START_MIDI / 12 - 1 + oct),
        type: "white",
        oct,
        idx: i,
      })
    }
  }

  const blackPositions = [0, 1, 3, 4, 5]
  for (let oct = 0; oct < props.numOctaves; oct++) {
    for (let i = 0; i < 5; i++) {
      const midi = START_MIDI + oct * 12 + BLACK_SEMITONES[i]
      keys.push({
        midi,
        note: midiToName(midi),
        type: "black",
        oct,
        idx: blackPositions[i],
      })
    }
  }

  return keys
})

const keyBindings = computed(() => {
  const map = {}
  for (const [k, midi] of Object.entries(KEY_BINDINGS)) {
    map[midi] = k.toUpperCase()
  }
  return map
})

/* =========================
 * Audio
 * ========================= */
async function initAudio() {
  await initSharedVoice()
  ready.value = true
}

watch(
  () => props.patch,
  () => {
    if (!ready.value) return
    activeNotes.value.clear()
  },
  { deep: true },
)

function noteOn(midi, velocity = 1) {
  if (activeNotes.value.has(midi)) return
  if (!ready.value) {
    initAudio().then(() => {
      getSharedVoice().noteOn(midi, velocity)
      activeNotes.value.add(midi)
    })
    return
  }
  getSharedVoice().noteOn(midi, velocity)
  activeNotes.value.add(midi)
}

function noteOff(midi) {
  if (!ready.value || !activeNotes.value.has(midi)) return
  getSharedVoice().noteOff(midi)
  activeNotes.value.delete(midi)
}

/* =========================
 * Mouse interaction
 * ========================= */
function onKeyMouseDown(midi, e) {
  e.preventDefault()
  heldByMouse.value = midi
  noteOn(midi)
}

function onMouseUp() {
  if (heldByMouse.value != null) {
    noteOff(heldByMouse.value)
    heldByMouse.value = null
  }
}

function onKeyboardPointerLeave() {
  if (heldByMouse.value != null) {
    noteOff(heldByMouse.value)
    heldByMouse.value = null
  }
}

/* =========================
 * Touch interaction
 * ========================= */
function getMidiFromEvent(e) {
  const touch = e.touches?.[0] || e.changedTouches?.[0]
  if (!touch) return null
  const el = document.elementFromPoint(touch.clientX, touch.clientY)
  if (!el) return null
  const keyEl = el.closest("[data-midi]")
  return keyEl ? parseInt(keyEl.dataset.midi) : null
}

function onTouchStart(e) {
  const midi = getMidiFromEvent(e)
  if (midi == null) return
  const id = e.touches[0].identifier
  heldByTouch.value.set(id, midi)
  noteOn(midi)
}

function onTouchMove(e) {
  e.preventDefault()
  const touch = e.touches[0]
  const id = touch.identifier
  const el = document.elementFromPoint(touch.clientX, touch.clientY)
  const keyEl = el?.closest("[data-midi]")
  const newMidi = keyEl ? parseInt(keyEl.dataset.midi) : null
  const prevMidi = heldByTouch.value.get(id)
  if (newMidi !== prevMidi) {
    if (prevMidi != null) noteOff(prevMidi)
    if (newMidi != null) noteOn(newMidi)
    if (newMidi != null) heldByTouch.value.set(id, newMidi)
    else heldByTouch.value.delete(id)
  }
}

function onTouchEnd(e) {
  const id = e.touches[0]?.identifier
  const midi = heldByTouch.value.get(id)
  if (midi != null) noteOff(midi)
  heldByTouch.value.delete(id)
}

/* =========================
 * Computer keyboard
 * ========================= */
function handleKeyDown(e) {
  if (e.repeat) return
  const midi = KEY_BINDINGS[e.key.toLowerCase()]
  if (midi !== undefined) noteOn(midi)
}

function handleKeyUp(e) {
  const midi = KEY_BINDINGS[e.key.toLowerCase()]
  if (midi !== undefined) noteOff(midi)
}

let unregisterMidi = null

onMounted(() => {
  window.addEventListener("keydown", handleKeyDown)
  window.addEventListener("keyup", handleKeyUp)
  window.addEventListener("mouseup", onMouseUp)
  unregisterMidi = registerMidiNoteHandler((msg) => {
    if (msg.type === "noteOn") noteOn(msg.note, msg.velocity ?? 1)
    else if (msg.type === "noteOff") noteOff(msg.note)
  })
})

onUnmounted(() => {
  window.removeEventListener("keydown", handleKeyDown)
  window.removeEventListener("keyup", handleKeyUp)
  window.removeEventListener("mouseup", onMouseUp)
  if (unregisterMidi) unregisterMidi()
  getSharedVoice()?.stopAll()
})
</script>

<template>
  <div class="synth-keyboard">
    <div
      class="piano"
      :style="{ '--num-white-keys': numOctaves * 7 }"
      @touchstart="onTouchStart"
      @touchmove="onTouchMove"
      @touchend="onTouchEnd"
      @touchcancel="onTouchEnd"
      @pointerleave="onKeyboardPointerLeave"
    >
      <div
        v-for="key in pianoKeys"
        :key="key.midi"
        :data-midi="key.midi"
        :class="[
          'piano-key',
          key.type,
          { pressed: activeNotes.has(key.midi) },
        ]"
        :style="
          key.type === 'black'
            ? {
                left: `calc(${(key.oct * 7 + key.idx + 1) * (100 / (numOctaves * 7))}% - ${8}px)`,
              }
            : {}
        "
        @mousedown="onKeyMouseDown(key.midi, $event)"
        @mouseenter="(e) => { if (heldByMouse != null) { noteOff(heldByMouse); heldByMouse = key.midi; noteOn(key.midi) } }"
      >
        <span class="key-note">{{ key.note }}</span>
        <span v-if="keyBindings[key.midi]" class="key-binding">{{
          keyBindings[key.midi]
        }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.synth-keyboard {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.piano {
  position: relative;
  height: 120px;
  background: #1a1a1a;
  border-radius: 0 0 6px 6px;
  padding: 0 4px;
  user-select: none;
  touch-action: none;
}

.piano-key {
  cursor: pointer;
  box-sizing: border-box;
}

.piano-key.white {
  position: relative;
  float: left;
  width: calc(100% / var(--num-white-keys));
  height: 100%;
  background: linear-gradient(to bottom, #f8f8f8, #fff);
  border: 1px solid #bbb;
  border-top: none;
  border-right: 1px solid #aaa;
  border-radius: 0 0 4px 4px;
  z-index: 1;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  align-items: center;
  padding-bottom: 6px;
  gap: 2px;
  box-shadow: inset 0 -3px 2px rgba(0, 0, 0, 0.05);
}

.piano-key.white:hover {
  background: linear-gradient(to bottom, #f0f0f0, #eee);
}

.piano-key.white.pressed {
  background: linear-gradient(to bottom, #80ccff, #5bb8f5);
  border-color: #4a9cd6;
  box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.15);
}

.piano-key.black {
  position: absolute;
  width: 16px;
  height: 70px;
  background: linear-gradient(to bottom, #333, #111);
  border: 1px solid #000;
  border-top: none;
  border-radius: 0 0 3px 3px;
  z-index: 2;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  align-items: center;
  padding-bottom: 5px;
  gap: 1px;
  box-shadow: 2px 2px 4px rgba(0, 0, 0, 0.5);
}

.piano-key.black:hover {
  background: linear-gradient(to bottom, #444, #222);
}

.piano-key.black.pressed {
  background: linear-gradient(to bottom, #5bb8f5, #3a9de0);
  box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.3);
}

.key-note {
  font-size: 9px;
  color: #666;
  pointer-events: none;
  line-height: 1;
}

.piano-key.white.pressed .key-note {
  color: #fff;
}

.piano-key.black .key-note {
  color: #888;
  font-size: 8px;
}

.piano-key.black.pressed .key-note {
  color: #ddeeff;
}

.key-binding {
  font-size: 8px;
  font-weight: bold;
  color: #999;
  pointer-events: none;
  line-height: 1;
}

.piano-key.black .key-binding {
  color: #666;
  font-size: 7px;
}
</style>
