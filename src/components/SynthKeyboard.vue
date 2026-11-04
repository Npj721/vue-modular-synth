<script setup>
import { ref, computed, onMounted, onUnmounted, watch } from "vue"
import { getSharedVoice, initSharedVoice } from "../composables/useSharedVoice"

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
/* Nombre de sources (doigts, souris, clavier physique) qui tiennent chaque
 * note. La voix ne gère qu'une entrée par note (usePatchVoice.js:1781) : sans
 * compteur, le relâchement d'un doigt coupait une note encore tenue par un
 * autre. */
const noteRefs = new Map()
/* midi -> { sourceId, voiceKey } mémorisé au noteOn. Le noteOff doit libérer
 * le même synthé même si la source a changé (module supprimé, patch rechargé).
 * La voiceKey inclut l'id de la source pour que deux sources jouant la même
 * note ne se coupent pas mutuellement dans le moteur. */
const noteTargets = new Map()
/* pointerId -> note tenue, ou null si le pointeur a glissé hors du clavier. */
const pointerNotes = new Map()
/* Touches actuellement tenues au clavier physique. On les suit séparément
 * pour que le keyup ne relâche pas une note tenue par la souris et pour
 * pouvoir ignorer complètement la saisie dans un champ éditable. */
const heldKeyboardKeys = new Set()

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

/* Géométrie du clavier : les largeurs dépendent du nombre d'octaves, elles
 * restent donc en style inline (pas de feuille de style personnalisée). */
function keyStyle(key) {
  const pressed = activeNotes.value.has(key.midi)
  const base = {
    cursor: "pointer",
    boxSizing: "border-box",
    touchAction: "none",
    userSelect: "none",
  }

  if (key.type === "white") {
    return {
      ...base,
      position: "relative",
      float: "left",
      width: `calc(100% / ${props.numOctaves * 7})`,
      height: "100%",
      background: pressed
        ? "linear-gradient(to bottom, #80ccff, #5bb8f5)"
        : "linear-gradient(to bottom, #f8f8f8, #fff)",
      border: pressed ? "1px solid #4a9cd6" : "1px solid #bbb",
      borderTop: "none",
      borderRight: "1px solid #aaa",
      borderRadius: "0 0 4px 4px",
      zIndex: 1,
      display: "flex",
      flexDirection: "column",
      justifyContent: "flex-end",
      alignItems: "center",
      paddingBottom: "6px",
      gap: "2px",
      boxShadow: pressed
        ? "inset 0 2px 4px rgba(0, 0, 0, 0.15)"
        : "inset 0 -3px 2px rgba(0, 0, 0, 0.05)",
    }
  }

  return {
    ...base,
    position: "absolute",
    left: `calc(${(key.oct * 7 + key.idx + 1) * (100 / (props.numOctaves * 7))}% - 8px)`,
    width: "16px",
    height: "70px",
    background: pressed
      ? "linear-gradient(to bottom, #5bb8f5, #3a9de0)"
      : "linear-gradient(to bottom, #333, #111)",
    border: "1px solid #000",
    borderTop: "none",
    borderRadius: "0 0 3px 3px",
    zIndex: 2,
    display: "flex",
    flexDirection: "column",
    justifyContent: "flex-end",
    alignItems: "center",
    paddingBottom: "5px",
    gap: "1px",
    boxShadow: pressed
      ? "inset 0 2px 4px rgba(0, 0, 0, 0.3)"
      : "2px 2px 4px rgba(0, 0, 0, 0.5)",
  }
}

function noteStyle(key) {
  const pressed = activeNotes.value.has(key.midi)
  if (key.type === "black") {
    return {
      fontSize: "8px",
      color: pressed ? "#ddeeff" : "#888",
      pointerEvents: "none",
      lineHeight: 1,
    }
  }
  return {
    fontSize: "9px",
    color: pressed ? "#fff" : "#666",
    pointerEvents: "none",
    lineHeight: 1,
  }
}

function bindingStyle(key) {
  return key.type === "black"
    ? { fontSize: "7px", fontWeight: "bold", color: "#666", pointerEvents: "none", lineHeight: 1 }
    : { fontSize: "8px", fontWeight: "bold", color: "#999", pointerEvents: "none", lineHeight: 1 }
}

/* =========================
 * Audio
 * ========================= */
async function initAudio() {
  await initSharedVoice()
  ready.value = true
}

/* Module "keyboard" du SynthPatch : le clavier à l'écran lui transmet ses
 * notes. S'il n'y en a pas (ancien patch), on garde le comportement
 * historique : diffusion à tous les synthés. */
const keyboardSource = computed(() => {
  const modules = props.patch?.voice?.modules ?? []
  return modules.find((m) => m.type === "keyboard") ?? null
})
const sourceId = computed(() => keyboardSource.value?.id ?? null)

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

  const src = sourceId.value
  const target = {
    sourceId: src,
    voiceKey: src ? `${src}:${midi}` : midi,
  }
  noteTargets.set(midi, target)

  if (!ready.value) {
    initAudio().then(() => {
      // le doigt a pu être relâché pendant l'initialisation
      if (!noteRefs.has(midi)) return
      const t = noteTargets.get(midi) ?? target
      getSharedVoice().noteOn(midi, velocity, null, t.voiceKey, t.sourceId)
    })
    return
  }
  getSharedVoice().noteOn(midi, velocity, null, target.voiceKey, src)
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

  const target = noteTargets.get(midi)
  noteTargets.delete(midi)
  if (ready.value) {
    getSharedVoice().noteOff(
      midi,
      target?.voiceKey ?? midi,
      target?.sourceId ?? null
    )
  }
}

/** Relâche tout : perte de focus, onglet masqué, changement de patch. */
function releaseAll() {
  heldKeyboardKeys.clear()
  pointerNotes.clear()
  // noteRefs compte les sources : il faut relâcher chaque référence, pas
  // seulement une par note, sinon une note tenue par deux sources reste active.
  for (const midi of [...noteRefs.keys()]) {
    while (noteRefs.get(midi)) noteOff(midi)
  }
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
/* Un champ éditable (chat, code DSP, paramètres, JSON…) doit garder ses
 * touches pour lui : sinon taper "q" joue une note au lieu d'écrire. */
function isEditableElement(el) {
  if (!el || typeof el.closest !== "function") return false
  if (el.isContentEditable) return true
  return !!el.closest(
    "input, textarea, select, " +
      "[contenteditable]:not([contenteditable='false']), " +
      "[role='textbox'], [role='searchbox'], [role='combobox']"
  )
}

function isTypingEvent(e) {
  if (e.isComposing) return true
  // composedPath couvre aussi les éditeurs placés dans un shadow DOM.
  const path = e.composedPath?.() ?? []
  return (
    path.some((el) => isEditableElement(el)) || isEditableElement(e.target)
  )
}

function handleKeyDown(e) {
  if (e.repeat || isTypingEvent(e)) return
  // Ctrl/Meta/Alt sont des raccourcis : ne pas les transformer en notes.
  if (e.ctrlKey || e.metaKey || e.altKey) return

  const key = e.key.toLowerCase()
  const midi = KEY_BINDINGS[key]
  if (midi === undefined || heldKeyboardKeys.has(key)) return
  heldKeyboardKeys.add(key)
  noteOn(midi)
}

function handleKeyUp(e) {
  const key = e.key.toLowerCase()
  // Seules les notes réellement déclenchées par le clavier sont relâchées ici.
  if (!heldKeyboardKeys.delete(key)) return
  const midi = KEY_BINDINGS[key]
  if (midi !== undefined) noteOff(midi)
}

onMounted(() => {
  window.addEventListener("keydown", handleKeyDown)
  window.addEventListener("keyup", handleKeyUp)
  window.addEventListener("pointerup", onWindowPointerUp)
  window.addEventListener("pointercancel", onWindowPointerUp)
  window.addEventListener("blur", releaseAll)
  document.addEventListener("visibilitychange", onVisibilityChange)
})

onUnmounted(() => {
  window.removeEventListener("keydown", handleKeyDown)
  window.removeEventListener("keyup", handleKeyUp)
  window.removeEventListener("pointerup", onWindowPointerUp)
  window.removeEventListener("pointercancel", onWindowPointerUp)
  window.removeEventListener("blur", releaseAll)
  document.removeEventListener("visibilitychange", onVisibilityChange)
  releaseAll()
  getSharedVoice()?.stopAll()
})
</script>

<template>
  <div class="flex-column gap-3" style="display: flex">
    <div
      style="
        position: relative;
        height: 120px;
        background: #1a1a1a;
        border-radius: 0 0 6px 6px;
        padding: 0 4px;
        user-select: none;
        touch-action: none;
      "
    >
      <div
        v-for="key in pianoKeys"
        :key="key.midi"
        :data-midi="key.midi"
        :style="keyStyle(key)"
        @pointerdown="onKeyPointerDown(key.midi, $event)"
        @pointermove="onKeyPointerMove(key.midi, $event)"
        @pointerup="onKeyPointerUp"
        @pointercancel="onKeyPointerUp"
        @lostpointercapture="onKeyPointerUp"
      >
        <span :style="noteStyle(key)">{{ key.note }}</span>
        <span v-if="keyBindings[key.midi]" :style="bindingStyle(key)">{{
          keyBindings[key.midi]
        }}</span>
      </div>
    </div>
  </div>
</template>
