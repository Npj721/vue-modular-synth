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
/* Nombre de sources (doigts, souris, clavier physique, MIDI) qui tiennent
 * chaque note. La voix ne gère qu'une entrée par note (usePatchVoice.js:1781)
 * : sans compteur, le relâchement d'un doigt coupait une note encore tenue par
 * un autre. */
const noteRefs = new Map()
/* pointerId -> note tenue, ou null si le pointeur a glissé hors du clavier. */
const pointerNotes = new Map()

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

/* Un NOUVEAU patch (et non un simple réglage) : on relâche les notes tenues. */
watch(
  () => props.patch,
  () => releaseAll(),
)

function noteOn(midi, velocity = 1) {
  const n = noteRefs.get(midi) || 0
  noteRefs.set(midi, n + 1)
  if (n > 0) return // déjà tenue par une autre source
  activeNotes.value.add(midi)
  if (!ready.value) {
    initAudio().then(() => {
      // le doigt a pu être relâché pendant l'initialisation
      if (noteRefs.has(midi)) getSharedVoice().noteOn(midi, velocity)
    })
    return
  }
  getSharedVoice().noteOn(midi, velocity)
}

function noteOff(midi) {
  const n = noteRefs.get(midi) || 0
  if (n === 0) return
  if (n > 1) {
    noteRefs.set(midi, n - 1)
    return
  }
  noteRefs.delete(midi)
  activeNotes.value.delete(midi)
  if (ready.value) getSharedVoice().noteOff(midi)
}

/** Relâche tout : perte de focus, onglet masqué, changement de patch. */
function releaseAll() {
  for (const midi of [...noteRefs.keys()]) noteOff(midi)
  pointerNotes.clear()
}

function onVisibilityChange() {
  if (document.hidden) releaseAll()
}

/* =========================
 * Souris / tactile / stylet
 * =========================
 * Les Pointer Events unifient les trois : chaque doigt a son propre
 * pointerId, donc plus besoin de trier plusieurs contacts à l'intérieur d'un
 * seul handler (c'était le défaut de l'ancienne approche à base de
 * e.touches[0] : seul le premier doigt était suivi, et un doigt relâché
 * libérait la note du doigt restant). */

/** Note sous le pointeur, ou null si le pointeur n'est pas sur une touche. */
function midiAtPoint(x, y) {
  const el = document.elementFromPoint(x, y)
  const keyEl = el?.closest?.("[data-midi]")
  return keyEl ? parseInt(keyEl.dataset.midi, 10) : null
}

function onKeyPointerDown(midi, e) {
  if (e.pointerType === "mouse" && e.button !== 0) return
  e.preventDefault()
  pointerNotes.set(e.pointerId, midi)
  /* La capture attache le flux d'événements de CE doigt à la touche d'origine :
   * il continue donc d'être suivi même en glissant hors de la touche, et son
   * pointerup est garanti même si le doigt quitte le clavier. */
  e.currentTarget.setPointerCapture?.(e.pointerId)
  noteOn(midi)
}

function onKeyPointerMove(midi, e) {
  // un pointeur qui n'appuie sur rien (simple survol souris) est ignoré
  if (!pointerNotes.has(e.pointerId)) return
  const prev = pointerNotes.get(e.pointerId)
  const next = midiAtPoint(e.clientX, e.clientY)
  if (next === prev) return
  if (prev != null) noteOff(prev)
  pointerNotes.set(e.pointerId, next)
  if (next != null) noteOn(next)
}

function releasePointer(pointerId) {
  if (!pointerNotes.has(pointerId)) return
  const midi = pointerNotes.get(pointerId)
  if (midi != null) noteOff(midi)
  pointerNotes.delete(pointerId)
}

function onKeyPointerUp(e) {
  releasePointer(e.pointerId)
  e.currentTarget.releasePointerCapture?.(e.pointerId)
}

/* Filet de sécurité : si un pointerup atterrit ailleurs que sur la touche
 * (capture refusée, doigt sorti de la fenêtre…), la note est malgré tout
 * relâchée au niveau de la fenêtre. */
function onWindowPointerUp(e) {
  releasePointer(e.pointerId)
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
  window.addEventListener("pointerup", onWindowPointerUp)
  window.addEventListener("pointercancel", onWindowPointerUp)
  window.addEventListener("blur", releaseAll)
  document.addEventListener("visibilitychange", onVisibilityChange)
  unregisterMidi = registerMidiNoteHandler((msg) => {
    if (msg.type === "noteOn") noteOn(msg.note, msg.velocity ?? 1)
    else if (msg.type === "noteOff") noteOff(msg.note)
  })
})

onUnmounted(() => {
  window.removeEventListener("keydown", handleKeyDown)
  window.removeEventListener("keyup", handleKeyUp)
  window.removeEventListener("pointerup", onWindowPointerUp)
  window.removeEventListener("pointercancel", onWindowPointerUp)
  window.removeEventListener("blur", releaseAll)
  document.removeEventListener("visibilitychange", onVisibilityChange)
  if (unregisterMidi) unregisterMidi()
  releaseAll()
  getSharedVoice()?.stopAll()
})
</script>

<template>
  <div class="synth-keyboard">
    <div
      class="piano"
      :style="{ '--num-white-keys': numOctaves * 7 }"
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
        @pointerdown="onKeyPointerDown(key.midi, $event)"
        @pointermove="onKeyPointerMove(key.midi, $event)"
        @pointerup="onKeyPointerUp"
        @pointercancel="onKeyPointerUp"
        @lostpointercapture="onKeyPointerUp"
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
  /* indispensable pour que les glissements de doigts ne deviennent pas des
   * défilements de page (et pour que le zoom double-tap n'interfère pas) */
  touch-action: none;
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
