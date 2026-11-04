<script setup>
import { reactive, ref, watch, nextTick, onBeforeUnmount, computed } from 'vue'
import { useModuleCatalog } from '../composables/useModuleCatalog'
import {
  getWavetableBundle,
  subscribeWavetableFrame,
  getWavetableFrameState,
} from '../composables/usePatchVoice'
import { parseRanges, WORKLET_PARAM_NAMES } from '../composables/useAudioWorklet'
import { useWorkletPresets, useWaveshaperPresets } from '../composables/useWorkletPresets'
import { validateWaveshaperCurve } from '../composables/useWaveshaperCurve'
import GraphEnvelopeEditor from './GraphEnvelopeEditor.vue'
import AudioFilePicker from './AudioFilePicker.vue'
import SampleWaveformEditor from './SampleWaveformEditor.vue'
import SequencerGrid from './SequencerGrid.vue'
import {
  clampSequencerNumber,
  normalizeSequencerSteps,
  toggleSequencer,
  isSequencerPlaying,
  getSequencerStep,
  SEQUENCER_MAX_STEPS,
} from '../composables/useSequencerEngine'
import { markEventOnlyPatchChange } from '../composables/useSharedVoice.js'
import { midiState, requestMidiAccess } from '../composables/useMidiBus.js'

const props = defineProps({
  module: { type: Object, default: null }
})

const emit = defineEmits([
  'param-changed',
  'label-changed',
  'edit-synth',
  'load-synth',
  'load-super-synth',
  'save-super-synth',
])

// Réactif pour l'affichage
const params = reactive({})
const paramDefs = reactive({})
const label = ref("")

// Presets AudioWorklet (cf. bloc "PRESETS" plus bas) — déclarés ici car le
// watch de changement de module (immediate) les réinitialise pendant le setup.
const presetName = ref("")
const presetStatus = ref("")

// Validation JSON différée : re-parser un gros JSON (wavetable / wavetableS)
// à chaque frappe bloquerait la saisie → résultat calculé ~350 ms après le
// dernier input, "validation…" affiché dans l'intervalle.
const jsonResults = reactive({})
const jsonValidating = reactive({})
const jsonTimers = {}
const scheduleJsonValidation = (key) => {
  clearTimeout(jsonTimers[key])
  jsonTimers[key] = undefined
  jsonValidating[key] = true
  jsonTimers[key] = setTimeout(() => {
    jsonResults[key] = jsonStatus(paramDefs[key], params[key])
    jsonValidating[key] = false
  }, 350)
}
const jsonStatusView = (key) => {
  if (jsonValidating[key]) {
    return { pending: true, ok: false, message: "validation…" }
  }
  return {
    pending: false,
    ok: !!jsonResults[key]?.ok,
    message: jsonResults[key]?.message ?? "",
  }
}

// Édition JSON en MODALE : le gros JSON (wavetableS : jusqu'à des centaines
// de milliers de lignes) ne doit jamais être rendu en dur dans le panneau —
// un textarea de ~500 000 lignes rend l'interface inutilisable même fermé.
// Le panneau n'affiche qu'un bouton + un résumé ; le textarea n'existe que
// lorsque la modale est ouverte. Tant qu'elle est fermée, le panneau reste
// fluide ; dans la modale, la validation du brouillon est débouncée.
const jsonModalKey = ref(null)
const jsonDraft = ref("")
const jsonDraftStatus = ref({ pending: false, ok: false, message: "" })
let jsonDraftTimer = 0

/* =========================================================
 * CHAMP CODE (module AudioWorklet / courbe WaveShaper)
 *
 * Le textarea est un DRAFT local : le commit vers le patch est différé
 * (~500 ms après la dernière frappe) pour ne pas recompiler l'AudioWorklet
 * ni reconstruire le main patch à chaque caractère. Aucune notion de
 * changement "en direct" pendant la lecture : le code s'applique au prochain
 * chargement du patch / à la note suivante.
 * ========================================================= */

const CODE_COMMIT_MS = 500

const codeDrafts = reactive({})   // key -> texte en cours de saisie
const codeTimers = {}              // key -> timer de commit

// Statut de la courbe WaveShaper (le moteur retombe sur la courbe par défaut
// si le code est invalide, mais on prévient l'utilisateur dans le panneau).
const curveStatus = ref(null)

const codeValue = (key) => codeDrafts[key] ?? params[key] ?? ""

const validateCurveCode = (source) => {
  curveStatus.value = props.module?.type === 'waveshaper'
    ? validateWaveshaperCurve(source)
    : null
}

const onCodeInput = (key, e) => {
  codeDrafts[key] = e.target.value
  clearTimeout(codeTimers[key])
  codeTimers[key] = setTimeout(() => commitCode(key), CODE_COMMIT_MS)
}

// Ctrl+Entrée (ou la perte de focus) valide immédiatement
const commitCode = (key) => {
  clearTimeout(codeTimers[key])
  codeTimers[key] = undefined
  if (codeDrafts[key] === undefined) return   // rien saisi : rien à commiter
  if (props.module?.type === 'waveshaper' && key === 'curve') {
    validateCurveCode(codeDrafts[key])
  }
  emitChange(key, codeDrafts[key])
}

const onCodeKeydown = (key, e) => {
  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
    e.preventDefault()
    commitCode(key)
  }
}

const resetCode = (key) => {
  clearTimeout(codeTimers[key])
  codeTimers[key] = undefined
  const def = paramDefs[key]
  const value = def?.default ?? ""
  codeDrafts[key] = value
  if (props.module?.type === 'waveshaper' && key === 'curve') {
    validateCurveCode(value)
  }
  emitChange(key, value)
}

// le patch a changé ailleurs (chargement, annuler) : le draft suit
const resetCodeDraft = () => {
  Object.keys(codeTimers).forEach((k) => clearTimeout(codeTimers[k]))
  Object.keys(codeDrafts).forEach((k) => delete codeDrafts[k])
}

const openJsonModal = (key) => {
  jsonModalKey.value = key
  jsonDraft.value = params[key] ?? ""
  refreshJsonDraft()
}
const refreshJsonDraft = () => {
  clearTimeout(jsonDraftTimer)
  if (jsonModalKey.value == null) return
  jsonDraftStatus.value = { pending: true, ok: false, message: "validation…" }
  jsonDraftTimer = setTimeout(() => {
    jsonDraftStatus.value = jsonStatus(
      paramDefs[jsonModalKey.value],
      jsonDraft.value
    )
  }, 40)
}
const onJsonDraftInput = (e) => {
  jsonDraft.value = e.target.value
  refreshJsonDraft()
}
const applyJsonModal = () => {
  const key = jsonModalKey.value
  if (key == null) return
  emitChange(key, jsonDraft.value)
  closeJsonModal()
}
const closeJsonModal = () => {
  clearTimeout(jsonDraftTimer)
  jsonModalKey.value = null
  jsonDraft.value = ""
  jsonDraftStatus.value = { pending: false, ok: false, message: "" }
}

const { getModuleByType } = useModuleCatalog()

// Clone profond par JSON : structuredClone refuse les proxys réactifs du
// catalogue, alors que JSON.stringify traverse le proxy sans problème.
const deepClone = (v) => (v == null ? v : JSON.parse(JSON.stringify(v)))

/* =========================================================
 * PLAGES DE p1..p8 (module AudioWorklet)
 *
 * Le descripteur du catalogue annonce -10..+10, mais un AudioParam est borné
 * par le navigateur : impossible d'y faire entrer une profondeur de bits
 * (1..16) ou une fréquence en Hz. Le module accepte donc des plages par
 * paramètre dans le JSON `options` (`ranges`), et le panneau fait suivre les
 * sliders p1..p8 pour que le champ reflète la plage réellement compilée.
 * ========================================================= */

const workletRanges = computed(() => parseRanges(params.options))

// Les graphes internes d'un nœud Synth ne doivent pas apparaître comme des
// champs JSON géants : ils s'éditent via le bouton "Ouvrir le synthé".
const visibleParamDefs = computed(() => {
  const type = props.module?.type

  // Le séquenceur a son propre éditeur de pas/BPM : on ne duplique pas ces
  // champs dans la liste générique.
  if (type === "sequencer") {
    return Object.fromEntries(
      Object.entries(paramDefs).filter(
        ([key]) => key !== "steps" && key !== "bpm" && key !== "stepCount"
      )
    )
  }

  // Le module Pitch a un éditeur dédié (boutons + curseur).
  if (type === "pitch") {
    return Object.fromEntries(
      Object.entries(paramDefs).filter(([key]) => key !== "pitch")
    )
  }

  // Le module MIDI a un sélecteur d'appareil dédié.
  if (type === "midi") {
    return Object.fromEntries(
      Object.entries(paramDefs).filter(([key]) => key !== "device")
    )
  }

  if (type !== "synth" && type !== "superSynth") return paramDefs
  return Object.fromEntries(
    Object.entries(paramDefs).filter(([key]) => {
      if (type === "synth") return key !== "voicePatch" && key !== "mainPatch"
      return key !== "synthPatch"
    })
  )
})

/* =========================================================
 * SÉQUENCEUR (module event mono-piste)
 * ========================================================= */

const sequencerPlaying = computed(() =>
  isSequencerPlaying(props.module?.id)
)
const sequencerCurrentStep = computed(() =>
  getSequencerStep(props.module?.id)
)
const sequencerSteps = computed(() =>
  normalizeSequencerSteps(params.steps, params.stepCount)
)

const toggleSequencerPlay = () => {
  if (!props.module) return
  toggleSequencer(props.module)
}

const setSequencerStep = (index, patch) => {
  const steps = normalizeSequencerSteps(params.steps, params.stepCount)
  if (!steps[index]) return
  steps[index] = { ...steps[index], ...patch }
  emitChange("steps", steps)
}

// Grille : un clic sur une cellule active/déplace la note du pas, un clic sur
// la note déjà active la désactive.
const toggleSequencerStepAt = ({ index, note }) => {
  const steps = normalizeSequencerSteps(params.steps, params.stepCount)
  const step = steps[index]
  if (!step) return

  if (step.active && step.note === note) {
    step.active = false
  } else {
    step.active = true
    step.note = Math.round(clampSequencerNumber(note, 0, 127, 60))
  }
  emitChange("steps", steps)
}

// La grille et le moteur se basent tous deux sur stepCount : on garde le
// tableau de pas synchronisé quand on ajoute/retire des colonnes.
const setSequencerStepCount = (value) => {
  const current = Math.round(
    clampSequencerNumber(params.stepCount, 1, SEQUENCER_MAX_STEPS, 16)
  )
  const next = Math.round(
    clampSequencerNumber(value, 1, SEQUENCER_MAX_STEPS, current)
  )

  if (next !== current) {
    const steps = normalizeSequencerSteps(params.steps, next)
    emitChange("stepCount", next)
    emitChange("steps", steps)
    return
  }

  // Valeur saisie invalide (vide, hors bornes) : on réaffiche la valeur
  // courante sans toucher aux pas.
  params.stepCount = next
}

const addSequencerStep = (delta = 1) => {
  const current = Math.round(
    clampSequencerNumber(params.stepCount, 1, SEQUENCER_MAX_STEPS, 16)
  )
  setSequencerStepCount(current + delta)
}

const onSequencerStepCountChange = (event) => {
  setSequencerStepCount(event.target.value)
  event.target.value = Math.round(
    clampSequencerNumber(params.stepCount, 1, SEQUENCER_MAX_STEPS, 16)
  )
}

const setSequencerVelocity = (index, value) => {
  setSequencerStep(index, {
    velocity: clampSequencerNumber(value, 0, 1, 1),
  })
}

const onSequencerVelocityChange = ({ index, value }) => {
  setSequencerVelocity(index, value)
}

/* =========================================================
 * PITCH (module de transformation d'events)
 * ========================================================= */

const pitchOffset = computed(() =>
  Math.round(clampSequencerNumber(params.pitch, -48, 48, 0))
)

const pitchOffsetLabel = computed(() => {
  const value = pitchOffset.value
  const sign = value > 0 ? "+" : ""
  const plural = Math.abs(value) > 1 ? "s" : ""
  return `${sign}${value} demi-ton${plural}`
})

const setPitchOffset = (value) => {
  const next = Math.round(clampSequencerNumber(value, -48, 48, 0))
  params.pitch = next
  emitChange("pitch", next)
}

const nudgePitch = (delta) => {
  setPitchOffset(pitchOffset.value + delta)
}

const baseParamDef = (key) => {
  const def = props.module ? getModuleByType(props.module.type) : null
  return def?.params?.[key] ?? null
}

const applyWorkletRanges = () => {
  for (const n of WORKLET_PARAM_NAMES) {
    const base = baseParamDef(n)
    if (!base) continue
    const r = workletRanges.value[n]
    // COPIE du descripteur : paramDefs ne doit jamais référencer l'objet du
    // catalogue (singleton partagé par tous les modules).
    paramDefs[n] = r ? { ...base, min: r.minValue, max: r.maxValue } : { ...base }
  }
}

watch(() => params.options, applyWorkletRanges)

// Quand module sélectionné change
watch(
  () => props.module,
  (mod) => {
    // reset complet
    Object.keys(params).forEach(k => delete params[k])
    Object.keys(paramDefs).forEach(k => delete paramDefs[k])
    Object.keys(jsonResults).forEach(k => delete jsonResults[k])
    Object.keys(jsonValidating).forEach(k => delete jsonValidating[k])
    Object.keys(jsonTimers).forEach(k => clearTimeout(jsonTimers[k]))
    resetCodeDraft()
    closeJsonModal()
    curveStatus.value = null
    presetName.value = ""
    presetStatus.value = ""

    if (!mod) return

    label.value = mod.label || ""

    const def = getModuleByType(mod.type)
    if (!def) return

    // copier defs
    Object.entries(def.params).forEach(([key, defParam]) => {
      paramDefs[key] = defParam

      // initialisation par INSTANCE
      if (mod.params[key] === undefined) {
        // COPIE PROFONDE obligatoire : getModuleByType renvoie le singleton du
        // catalogue, donc sans ce clone tous les modules démunis du paramètre
        // partageraient le MÊME objet (pour une enveloppe : les mêmes stages,
        // donc la même plage min/max).
        mod.params[key] = deepClone(defParam.default)
      }

      // copie locale pour l’UI
      params[key] = mod.params[key]

      if (defParam.type === "json") {
        scheduleJsonValidation(key)
      }
    })

    // les `options` viennent d'être copiées dans params : on peut donc
    // borner les sliders p1..p8 sur les plages qui viennent d'être déclarées
    applyWorkletRanges()
  },
  { immediate: true }
)

// Émettre les changements
const emitChange = (key, value) => {
  const previous = props.module?.params?.[key]
  params[key] = value
  if (paramDefs[key]?.type === "json") scheduleJsonValidation(key)

  // Les pas/BPM d'un séquenceur et l'appareil d'un module MIDI ne modifient
  // pas le graphe audio : inutile de couper les voix en cours pour les
  // appliquer. On ne lève le drapeau que si la valeur change réellement, sinon
  // il resterait armé pour une modification audio suivante.
  const eventOnly =
    (props.module?.type === "sequencer" &&
      (key === "steps" || key === "bpm" || key === "stepCount")) ||
    (props.module?.type === "pitch" && key === "pitch") ||
    (props.module?.type === "midi" && key === "device")
  if (eventOnly && previous !== value) {
    markEventOnlyPatchChange()
  }

  emit('param-changed', { key, value })
}

/* =========================================================
 * MIDI (module event, un par appareil)
 * ========================================================= */

const midiStatusText = computed(() => {
  if (!midiState.supported) return "Web MIDI non disponible"
  if (!midiState.requested) return "MIDI non activé"
  if (!midiState.devices.length) return "Aucun appareil détecté"
  return `${midiState.devices.length} appareil(s) détecté(s)`
})

const midiDeviceMissing = computed(() => {
  if (props.module?.type !== "midi") return false
  const id = props.module.params?.device
  if (!id) return false
  return !midiState.devices.some((d) => d.id === id)
})

// S'il n'y a qu'un seul appareil, le sélectionner automatiquement : le module
// devient immédiatement utilisable après "Activer MIDI".
watch(
  () => midiState.devices.length,
  (count) => {
    if (props.module?.type !== "midi") return
    if (props.module.params?.device) return
    if (count !== 1) return
    emitChange("device", midiState.devices[0].id)
  },
  { immediate: true }
)

/* =========================================================
 * PRESETS DE MODULE À CODE (AudioWorklet / WaveShaper)
 *
 * Sauvegarde de la config COMPLÈTE du module (code DSP / courbe + paramètres)
 * sous un nom dans IndexedDB, pour la réutiliser plus tard — y compris dans un
 * autre module d'un autre patch. Le chargement écrase la config courante du
 * module sélectionné. Les stores sont séparés par type de module.
 * ========================================================= */

const workletPresets = useWorkletPresets()
const waveshaperPresets = useWaveshaperPresets()

const activePresetStore = computed(() => {
  if (props.module?.type === 'audioworklet') return workletPresets
  if (props.module?.type === 'waveshaper') return waveshaperPresets
  return null
})

const presetList = computed(() => {
  const store = activePresetStore.value
  if (!store) return []
  return store.names().map((name) => ({
    name,
    savedAt: store.get(name)?.savedAt ?? 0,
  }))
})

const formatPresetDate = (ts) =>
  ts ? new Date(ts).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : ""

// Capturer la config courante, brouillons de code non commis compris
const snapshotModuleParams = () => {
  // le textarea est un draft : on committe tout ce qui est en attente
  // pour que le snapshot reflète bien ce qui est affiché à l'écran
  Object.keys(codeDrafts).forEach((k) => commitCode(k))
  return deepClone(props.module?.params || {})
}

const saveCurrentPreset = () => {
  const store = activePresetStore.value
  if (!store) return
  const name = presetName.value.trim()
  if (!name) {
    presetStatus.value = "donnez un nom au preset"
    return
  }
  store.save(name, snapshotModuleParams())
  presetName.value = ""
  presetStatus.value = `preset « ${name} » sauvegardé`
}

// Écraser la config courante par le preset choisi
const applyPreset = (name) => {
  const store = activePresetStore.value
  const preset = store?.get(name)
  if (!preset || !props.module) return
  if (!window.confirm(`Charger le preset « ${name} » ? La config courante de ce module sera écrasée.`)) return

  const saved = preset.params || {}
  const defs = paramDefs

  Object.keys(defs).forEach((key) => {
    if (!(key in saved)) return
    const value = deepClone(saved[key])
    // le textarea affiche le draft en priorité : on le remplace pour que
    // le code chargé soit visible immédiatement
    if (defs[key].type === "code") {
      clearTimeout(codeTimers[key])
      codeTimers[key] = undefined
      codeDrafts[key] = value
      if (props.module?.type === 'waveshaper' && key === 'curve') {
        validateCurveCode(value)
      }
    }
    emitChange(key, value)
  })
  presetStatus.value = `preset « ${name} » chargé`
}

const deletePreset = (name) => {
  const store = activePresetStore.value
  if (!store) return
  if (!window.confirm(`Supprimer le preset « ${name} » ?`)) return
  store.remove(name)
  presetStatus.value = `preset « ${name} » supprimé`
}

const emitLabel = () => {
  emit('label-changed', label.value)
}

const updateEnveloppe= (key, value) => {
  // le GraphEnvelopeEditor n'émet que { press, release } :
  // préserver le drapeau "loop" du modèle
  const loop = params.stages?.loop ?? false
  params.stages = { ...value, loop }
  emit('param-changed', { key, value: params.stages })
}

const toggleLoop = () => {
  const value = !(params.stages?.loop ?? false)
  params.stages = { ...(params.stages || {}), loop: value }
  emit('param-changed', { key: 'stages', value: params.stages })
}

// Plages de lecture du module FX : les positions choisies sur l'onde sont
// reportées sur les paramètres numériques "start"/"end" (ms).
const onSampleRegionUpdate = ({ start, end }) => {
  emitChange('start', start)
  emitChange('end', end)
}

// Validation d'un paramètre JSON (ex: wavetable) à l'édition :
// - le contenu doit être un JSON valide
// - les clés désignées par def.jsonKeys doivent exister et être des tableaux
// - ils doivent contenir au moins une valeur et avoir tous la même taille
const jsonStatus = (def, value) => {
  if (!def || def.type !== 'json') return null
  const raw = value == null ? '' : String(value)
  if (!raw.trim()) return { ok: false, message: 'JSON vide' }

  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    return { ok: false, message: 'JSON invalide' }
  }

  // wavetableS : tableau de frames [ { real, imag }, ... ] homogènes
  if (def.jsonFrames) {
    if (!Array.isArray(parsed)) {
      return { ok: false, message: 'doit être un tableau de frames' }
    }
    if (parsed.length === 0) {
      return {
        ok: false,
        message: 'tableau vide (repli sur une onde par défaut)',
      }
    }
    let coeffs = -1
    for (let i = 0; i < parsed.length; i++) {
      const f = parsed[i]
      if (!f || typeof f !== 'object') {
        return { ok: false, message: `frame ${i} : objet attendu` }
      }
      for (const k of ['real', 'imag']) {
        if (!Array.isArray(f[k])) {
          return {
            ok: false,
            message: `frame ${i} : "${k}" doit être un tableau`,
          }
        }
        if (f[k].length === 0) {
          return { ok: false, message: `frame ${i} : "${k}" vide` }
        }
      }
      if (f.real.length !== f.imag.length) {
        return {
          ok: false,
          message: `frame ${i} : real/imag de tailles différentes`,
        }
      }
      if (coeffs === -1) coeffs = f.real.length
      else if (f.real.length !== coeffs) {
        return {
          ok: false,
          message: `frame ${i} : ${f.real.length} coeffs au lieu de ${coeffs}`,
        }
      }
    }
    return {
      ok: true,
      message: `JSON valide : ${parsed.length} frame(s) × ${coeffs} coeffs`,
    }
  }

  const keys = def.jsonKeys || []
  for (const k of keys) {
    if (!(k in parsed)) return { ok: false, message: `clé "${k}" manquante` }
    if (!Array.isArray(parsed[k])) {
      return { ok: false, message: `"${k}" doit être un tableau` }
    }
  }
  if (keys.length) {
    const lens = keys.map((k) => parsed[k].length)
    if (lens.some((l) => l === 0)) {
      return { ok: false, message: 'tableaux vides (repli sur une onde par défaut)' }
    }
    if (new Set(lens).size > 1) {
      return {
        ok: false,
        message: `${keys.join(' et ')} doivent avoir la même taille`,
      }
    }
    return {
      ok: true,
      message: `JSON valide : ${keys.join(', ')} = ${lens[0]} valeurs`,
    }
  }
  return { ok: true, message: 'JSON valide' }
}

// Un paramètre JSON "onde" expose des clés amplifiables (real + imag).
const isWaveParam = (def) =>
  Array.isArray(def?.jsonKeys) &&
  def.jsonKeys.includes('real') &&
  def.jsonKeys.includes('imag')

// Amplificateur : multiplie chaque valeur de real/imag et clampe dans [-1, 1].
// Écrit le résultat directement dans le paramètre "wave" (réécrit le JSON),
// pour que l'amplification soit "cuite" dans la wavetable (pas de recalcul
// à chaque note).
const ampFactor = ref(1)
const applyAmp = (def, key) => {
  if (!isWaveParam(def)) return
  const raw = params[key]
  if (!raw) return
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    return
  }
  if (!Array.isArray(parsed.real) || !Array.isArray(parsed.imag)) return

  const f = Number(ampFactor.value)
  if (!isFinite(f) || f <= 0) return

  const clamp01 = (v) => Math.max(-1, Math.min(1, v * f))
  const next = {
    ...parsed,
    real: parsed.real.map(clamp01),
    imag: parsed.imag.map(clamp01),
  }

  ampFactor.value = 1
  emitChange(key, JSON.stringify(next))
}

/* =========================================================
 * Visualiseur pseudo-3D de la table du module wavetableS
 * ---------------------------------------------------------
 * Reconstruit chaque frame par somme d'harmoniques (real·cos + imag·sin,
 * bornée à DRAW_HARMONICS pour éviter le repliement visuel et limiter le
 * coût), normalise au pic, puis empile les ondes en perspective vers un
 * POINT DE FUITE : frame 0 au premier plan, les suivantes qui fuient vers
 * le haut (échelle, amplitude et luminosité décroissantes). La frame EN
 * COURS DE LECTURE (notifiée par startMorphScan → subscribeWavetableFrame)
 * est tracée en clair avec sa ligne de temps. Le dessin est rAF-coalescé :
 * jamais plus d'un redraw par image, zéro travail quand rien ne bouge.
 * ========================================================= */
const MAX_VISIBLE_ROWS = 512
const DRAW_SAMPLES = 256
const DRAW_HARMONICS = 128

const viewer = ref(null)
const currentFrame = ref(0)
const scanActive = ref(false)
const rowFrameCount = ref(0)
const wavetableRows = reactive([])
let viewerUnsub = null
let viewerRaf = 0
let viewerResizeObs = null

// Reconstruit M échantillons d'une frame depuis ses coefficients.
function frameSamples(real, imag) {
  const K = Math.max(
    0,
    Math.min(Math.min(real?.length ?? 0, imag?.length ?? 0) - 1, DRAW_HARMONICS)
  )
  const out = new Float32Array(DRAW_SAMPLES)
  let peak = 0
  for (let i = 0; i < DRAW_SAMPLES; i++) {
    const phi = (2 * Math.PI * i) / DRAW_SAMPLES
    let v = 0
    for (let k = 1; k <= K; k++) {
      v += (real[k] || 0) * Math.cos(k * phi) + (imag[k] || 0) * Math.sin(k * phi)
    }
    if (Math.abs(v) > peak) peak = Math.abs(v)
    out[i] = v
  }
  if (peak > 1e-9) for (let i = 0; i < DRAW_SAMPLES; i++) out[i] /= peak
  return out
}

const scheduleViewerDraw = () => {
  if (viewerRaf || !viewer.value) return
  viewerRaf = requestAnimationFrame(() => {
    viewerRaf = 0
    drawWavetableViewer()
  })
}

// Échantillons déjà synthétisés par index de frame : le cache évite de
// re-synthétiser une frame à chaque changement. TOUTES les frames de la
// table sont dessinées (jusqu'à MAX_VISIBLE_ROWS ; au-delà, un pas de
// sous-échantillonnage conserve la silhouette globale) et la frame EN COURS
// DE LECTURE est toujours garantie présente dans la liste.
// La table de repli correspond à l'onde par défaut du moteur (dents de scie 1/n).
const FALLBACK_WAVE = (() => {
  const real = new Array(10).fill(0)
  const imag = [0, 1, 0.5, 0.333, 0.25, 0.2, 0.167, 0.143, 0.125, 0.111]
  return { index: 0, samples: frameSamples(real, imag) }
})()

let rowFramesCache = []
let rowSamplesCache = new Map()
let lastWaveSource = null

function frameSamplesAt(index) {
  const f = rowFramesCache[index]
  if (!f) return null
  let samples = rowSamplesCache.get(index)
  if (!samples) {
    samples = frameSamples(f.real, f.imag)
    rowSamplesCache.set(index, samples)
  }
  return samples
}

function rebuildWavetableRows() {
  wavetableRows.splice(0, wavetableRows.length)
  const mod = props.module
  if (!mod || mod.type !== "wavetableS") return

  const frames = getWavetableBundle(null, params.wave)?.frames ?? []
  if (params.wave !== lastWaveSource) {
    lastWaveSource = params.wave
    rowFramesCache = frames
    rowSamplesCache = new Map()
  }

  if (!frames.length) {
    rowFrameCount.value = 1
    wavetableRows.push(FALLBACK_WAVE)
    scheduleViewerDraw()
    return
  }

  const N = frames.length
  rowFrameCount.value = N
  const step = N > MAX_VISIBLE_ROWS ? Math.ceil(N / MAX_VISIBLE_ROWS) : 1
  const idxs = new Set()
  if (step > 1) {
    for (let i = 0; i < N; i += step) idxs.add(i)
    // la frame actuellement jouée est toujours dessinée
    idxs.add(Math.max(0, Math.min(N - 1, Math.round(currentFrame.value))))
  } else {
    for (let i = 0; i < N; i++) idxs.add(i)
  }

  for (const i of [...idxs].sort((a, b) => a - b)) {
    const samples = frameSamplesAt(i)
    if (samples) wavetableRows.push({ index: i, samples })
  }
  scheduleViewerDraw()
}

const onViewerFrame = ({ frame, active }) => {
  currentFrame.value = frame
  scanActive.value = active
  ensureActiveRow()
  scheduleViewerDraw()
}

// Tables très grandes (> MAX_VISIBLE_ROWS) : si la frame jouée manque dans
// l'échantillonnage, on l'ajoute à la volée (échantillons déjà en cache).
function ensureActiveRow() {
  const N = rowFramesCache.length
  const cur = Math.round(currentFrame.value)
  if (cur < 0 || cur >= N) return
  if (wavetableRows.some((r) => r.index === cur)) return
  const samples = frameSamplesAt(cur)
  if (!samples) return
  wavetableRows.push({ index: cur, samples })
  wavetableRows.sort((a, b) => a.index - b.index)
}

function bindWavetableViewer() {
  if (viewerUnsub) {
    viewerUnsub()
    viewerUnsub = null
  }
  const mod = props.module
  if (!mod || mod.type !== "wavetableS" || mod.id == null) {
    currentFrame.value = 0
    scanActive.value = false
    return
  }
  const st = getWavetableFrameState(mod.id)
  currentFrame.value = st ? st.frame : 0
  scanActive.value = st ? st.active : false
  viewerUnsub = subscribeWavetableFrame(mod.id, onViewerFrame)
  scheduleViewerDraw()
}

function drawWavetableViewer() {
  const canvas = viewer.value
  if (!canvas) return
  const ctx = canvas.getContext("2d")
  if (!ctx) return

  const dpr = window.devicePixelRatio || 1
  const w = canvas.clientWidth || 0
  const h = canvas.clientHeight || 0
  if (!w || !h) return
  const bw = Math.round(w * dpr)
  const bh = Math.round(h * dpr)
  if (canvas.width !== bw) canvas.width = bw
  if (canvas.height !== bh) canvas.height = bh
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

  ctx.fillStyle = "#0a1016"
  ctx.fillRect(0, 0, w, h)

  const rows = wavetableRows
  if (rows.length) {
    // point de fuite en haut-centre ; frame 0 au premier plan (bas, pleine
    // échelle), les suivantes fuient vers le lointain (échelle × amplitude ×
    // luminosité décroissants en 1/(1+k·z), z = profondeur = index/(N-1)).
    const VPX = w / 2
    const VPY = Math.max(20, h * 0.12)
    const yFront = h * 0.86
    const halfWFront = w * 0.46
    const AMP = 0.3
    const PERSP = 2.6

    const N = Math.max(1, rowFramesCache.length || rows.length)
    const cur = scanActive.value ? Math.round(currentFrame.value) : -1
    const activeRow = cur >= 0 ? rows.find((r) => r.index === cur) : null

    // géométrie d'une frame depuis son INDEX dans la table (le point de fuite
    // est au-dessus : y · s avec s = 1/(1+PERSP·depth))
    const scaled = (rowIndex) => {
      const depth = N > 1 ? rowIndex / (N - 1) : 0
      const s = 1 / (1 + PERSP * depth)
      return {
        depth,
        s,
        y: VPY + (yFront - VPY) * s,
        x0: VPX - halfWFront * s,
        x1: VPX + halfWFront * s,
      }
    }

    const drawRow = (row, isActive, geo) => {
      // les frames lointaines sont dessinées avec moins de points (détail
      // invisible) : on garde un temps de dessin raisonnable à haute vitesse
      const src = row.samples
      const n = Math.max(24, Math.round(src.length * (0.3 + 0.7 * geo.s)))
      const amp = (yFront - VPY) * AMP * geo.s
      ctx.beginPath()
      for (let i = 0; i < n; i++) {
        const k = Math.floor((i / (n - 1)) * (src.length - 1))
        const x = geo.x0 + (i / (n - 1)) * (geo.x1 - geo.x0)
        const yv = geo.y - src[k] * amp
        if (i === 0) ctx.moveTo(x, yv)
        else ctx.lineTo(x, yv)
      }
      ctx.strokeStyle = isActive
        ? "rgb(255, 199, 88)"
        : `rgba(96, 184, 162, ${0.16 + 0.34 * (1 - geo.depth)})`
      ctx.lineWidth = isActive ? 2 : 1
      if (isActive) {
        ctx.shadowColor = "rgba(255, 199, 88, 0.85)"
        ctx.shadowBlur = 8
      }
      ctx.stroke()
      if (isActive) {
        ctx.shadowBlur = 0
        // ligne de temps (playhead) sous la frame en cours
        ctx.beginPath()
        ctx.moveTo(geo.x0, geo.y)
        ctx.lineTo(geo.x1, geo.y)
        ctx.strokeStyle = "rgba(255, 199, 88, 0.4)"
        ctx.lineWidth = 1
        ctx.stroke()
      }
    }

    // 1) toutes les frames, dans l'ordre avant → arrière (front → lointain)
    for (const row of rows) {
      if (row === activeRow) continue
      drawRow(row, false, scaled(row.index))
    }

    // 2) la frame EN COURS DE LECTURE revient PAR-DESSUS, à sa propre
    //    profondeur (donc devant ou derrière selon son index) : elle reste
    //    bien visible même proche du point de fuite
    if (activeRow) drawRow(activeRow, true, scaled(activeRow.index))
  }

  ctx.fillStyle = "rgba(255, 255, 255, 0.75)"
  ctx.font = "11px system-ui, sans-serif"
  ctx.textAlign = "left"
  ctx.fillText(
    `frame ${currentFrame.value}${scanActive.value ? " — lecture" : " — arrêt"}`,
    8,
    16
  )
}

const startViewer = () => {
  stopViewer()
  const canvas = viewer.value
  if (!canvas) return
  viewerResizeObs = new ResizeObserver(() => scheduleViewerDraw())
  viewerResizeObs.observe(canvas)
  scheduleViewerDraw()
}

const stopViewer = () => {
  if (viewerUnsub) {
    viewerUnsub()
    viewerUnsub = null
  }
  if (viewerResizeObs) {
    viewerResizeObs.disconnect()
    viewerResizeObs = null
  }
  if (viewerRaf) {
    cancelAnimationFrame(viewerRaf)
    viewerRaf = 0
  }
}

// (Ré)initialisation du visualiseur quand le module sélectionné change
// (le nextTick attend que son <canvas> soit monté).
watch(
  () => props.module,
  () => {
    nextTick(() => {
      bindWavetableViewer()
      rebuildWavetableRows()
      startViewer()
    })
  },
  { immediate: true }
)

// Redessin quand la table elle-même change (édition JSON du module).
watch(
  () => (props.module?.type === "wavetableS" ? params.wave : null),
  () => {
    if (props.module?.type === "wavetableS") rebuildWavetableRows()
  }
)

onBeforeUnmount(() => {
  stopViewer()
  resetCodeDraft()
})
</script>

<template>
  <div v-if="module" class="h-100 p-3 bg-body-tertiary overflow-auto">
    <h3 class="h6 text-capitalize border-bottom pb-2 mb-3 mt-0">{{ module.type }} Parameters</h3>
    <div class="d-flex flex-column gap-1 mb-3">
      <input
        v-model="label"
        class="form-control form-control-sm"
        type="text"
        placeholder="Label du module (ex: lead)"
        @input="emitLabel"
      />
      <span v-if="label" class="form-text">utilisé comme préfixe des paramètres exposés</span>
    </div>

    <!-- Module clavier : source d'événements du SynthPatch -->
    <div v-if="module.type === 'keyboard'" class="d-flex flex-column gap-2 p-2 mb-3 border rounded bg-body-tertiary">
      <div class="d-flex flex-column gap-1">
        <strong>{{ params.name || module.label || "Keyboard" }}</strong>
        <span class="form-text">source d'événements</span>
      </div>
      <p class="form-text mb-0">
        Le clavier à l'écran et le clavier physique du PC envoient leurs notes
        aux synthés dont l'entrée Events est reliée à ce module. Une même
        sortie peut alimenter plusieurs synthés. Pour un clavier MIDI, ajoutez
        un module MIDI.
      </p>
    </div>

    <!-- Module Pitch : transpose les événements qui le traversent -->
    <div
      v-if="module.type === 'pitch'"
      class="d-flex flex-column gap-2 p-2 mb-3 border border-success-subtle rounded bg-success-subtle"
    >
      <div class="d-flex flex-column gap-1">
        <strong>{{ params.name || module.label || "Pitch" }}</strong>
        <span class="form-text">transpose les events</span>
      </div>
      <p class="form-text mb-0">
        Câblez une source Events (clavier, MIDI, séquenceur…) sur l'entrée
        Events, puis la sortie Events vers le Synth ou SuperSynth à piloter.
        Chaque note reçue est transposée du décalage ci-dessous. Plusieurs
        modules Pitch peuvent être chaînés : les décalages se cumulent.
      </p>

      <div class="d-flex align-items-center gap-2">
        <input
          class="form-range flex-grow-1"
          style="min-width: 120px"
          type="range"
          min="-48"
          max="48"
          step="1"
          :value="pitchOffset"
          @input="setPitchOffset($event.target.value)"
        />
        <span class="small fw-semibold text-success-emphasis text-end font-monospace" style="min-width: 94px">{{ pitchOffsetLabel }}</span>
      </div>

      <div class="d-flex flex-wrap gap-1">
        <button type="button" class="btn btn-sm btn-outline-success" title="Descendre d'une octave" @click="nudgePitch(-12)">−12</button>
        <button type="button" class="btn btn-sm btn-outline-success" title="Descendre d'un demi-ton" @click="nudgePitch(-1)">−1</button>
        <button type="button" class="btn btn-sm btn-outline-dark" title="Aucun décalage" @click="setPitchOffset(0)">0</button>
        <button type="button" class="btn btn-sm btn-outline-success" title="Monter d'un demi-ton" @click="nudgePitch(1)">+1</button>
        <button type="button" class="btn btn-sm btn-outline-success" title="Monter d'une octave" @click="nudgePitch(12)">+12</button>
      </div>

      <p class="form-text mb-0">
        Exemple : avec +2, une note 60 reçue est jouée en 62 par le synthé.
        Retirez le câble direct source → synthé si vous ne voulez entendre que
        la version transposée.
      </p>
    </div>

    <!-- Module MIDI : un appareil MIDI = une source d'événements -->
    <div
      v-if="module.type === 'midi'"
      class="d-flex flex-column gap-2 p-2 mb-3 border border-info-subtle rounded bg-info-subtle"
    >
      <div class="d-flex flex-column gap-1">
        <strong>{{ params.name || module.label || "MIDI Keyboard" }}</strong>
        <span class="form-text">source d'événements</span>
      </div>

      <div class="d-flex align-items-center gap-2 flex-wrap">
        <button
          type="button"
          class="btn btn-sm btn-primary"
          :disabled="!midiState.supported || midiState.requested"
          @click="requestMidiAccess"
        >
          {{ midiState.requested ? "MIDI activé" : "Activer MIDI" }}
        </button>
        <span
          class="small"
          :class="midiState.devices.length > 0 ? 'text-success-emphasis' : 'text-body-secondary'"
        >
          {{ midiStatusText }}
        </span>
      </div>

      <div v-if="midiState.error" class="alert alert-danger py-1 px-2 small mb-0">
        {{ midiState.error }}
      </div>

      <label v-if="midiState.devices.length" class="d-flex flex-column gap-1 small text-body-secondary">
        Appareil
        <select
          class="form-select form-select-sm"
          :value="params.device"
          @change="emitChange('device', $event.target.value)"
        >
          <option value="">— Choisir un appareil —</option>
          <option v-for="d in midiState.devices" :key="d.id" :value="d.id">
            {{ d.name }}<template v-if="d.manufacturer"> ({{ d.manufacturer }})</template>
          </option>
        </select>
      </label>
      <p v-else-if="midiState.requested" class="form-text mb-0">
        Aucun appareil MIDI détecté. Branchez un clavier puis rouvrez ce panneau.
      </p>
      <p v-else-if="midiState.supported" class="form-text mb-0">
        Activez MIDI pour lister les appareils disponibles.
      </p>
      <p v-else class="form-text mb-0">
        Le Web MIDI API n'est pas disponible dans ce navigateur. Utilisez Chrome
        ou Edge.
      </p>

      <p v-if="midiDeviceMissing" class="alert alert-warning py-1 px-2 small mb-0">
        L'appareil sélectionné n'est plus disponible.
      </p>

      <p class="form-text mb-0">
        Chaque module MIDI représente un appareil. Câblez sa sortie Events vers
        l'entrée Events des synthés à piloter.
      </p>
    </div>

    <!-- Module séquenceur : source d'événements du SynthPatch -->
    <div
      v-if="module.type === 'sequencer'"
      class="d-flex flex-column gap-2 p-2 mb-3 border border-warning-subtle rounded bg-warning-subtle"
    >
      <div class="d-flex flex-column gap-1">
        <strong>{{ params.name || module.label || "Sequencer" }}</strong>
        <span class="form-text">source d'événements</span>
      </div>

      <div class="d-flex align-items-center gap-2 flex-wrap">
        <button
          type="button"
          class="btn btn-sm"
          :class="sequencerPlaying ? 'btn-danger' : 'btn-warning'"
          @click="toggleSequencerPlay"
        >
          {{ sequencerPlaying ? "Stop" : "Play" }}
        </button>
        <label class="d-flex align-items-center gap-1 small text-body-secondary">
          BPM
          <input
            v-model.number="params.bpm"
            class="form-control form-control-sm"
            style="width: 58px"
            type="number"
            min="40"
            max="300"
            step="1"
            @input="emitChange('bpm', params.bpm)"
          />
        </label>
        <div class="d-flex align-items-center gap-1 small text-body-secondary">
          <span>Pas</span>
          <button
            type="button"
            class="btn btn-sm btn-outline-warning px-2 py-0"
            style="width: 24px; height: 26px; line-height: 1"
            title="Retirer un pas"
            @click="addSequencerStep(-1)"
          >
            −
          </button>
          <input
            class="form-control form-control-sm"
            style="width: 58px"
            :value="params.stepCount"
            type="number"
            min="1"
            :max="SEQUENCER_MAX_STEPS"
            step="1"
            @change="onSequencerStepCountChange"
          />
          <button
            type="button"
            class="btn btn-sm btn-outline-warning px-2 py-0"
            style="width: 24px; height: 26px; line-height: 1"
            title="Ajouter un pas"
            @click="addSequencerStep(1)"
          >
            +
          </button>
        </div>
      </div>

      <SequencerGrid
        :steps="sequencerSteps"
        :step-count="Math.round(Number(params.stepCount) || 16)"
        :current-step="sequencerCurrentStep"
        @toggle-step="toggleSequencerStepAt"
        @velocity-change="onSequencerVelocityChange"
        @add-step="addSequencerStep(1)"
      />

      <p class="form-text mb-0">
        Cliquez sur une cellule pour poser (ou déplacer) la note du pas.
        Cliquez sur la note active pour la retirer. Le curseur vertical au-dessus
        de chaque pas règle sa vélocité. Les notes partent sur la sortie Events :
        câblez-la vers l'entrée Events d'un ou plusieurs synthés.
      </p>
    </div>

    <!-- Nœud Synth : accès à l'éditeur voice/main interne -->
    <div v-if="module.type === 'synth'" class="d-flex flex-column gap-2 p-2 mb-3 border border-primary-subtle rounded bg-primary-subtle">
      <div class="d-flex flex-column gap-1">
        <strong>{{ params.name || module.label || "Synth" }}</strong>
        <span class="form-text">nœud Synth du SynthPatch</span>
      </div>
      <button type="button" class="btn btn-sm btn-primary" @click="emit('edit-synth', module)">
        Ouvrir le synthé (Voice / Main)
      </button>
      <button
        type="button"
        class="btn btn-sm btn-outline-dark"
        @click="emit('load-synth', module)"
      >
        Charger un synthé…
      </button>
      <p class="form-text mb-0">
        Ce nœud expose une entrée audio principale et une sortie. Les notes
        jouées lui sont envoyées indépendamment des autres Synth.
      </p>
    </div>

    <!-- Nœud SuperSynth : SynthPatch réutilisable, éditable récursivement -->
    <div
      v-if="module.type === 'superSynth'"
      class="d-flex flex-column gap-2 p-2 mb-3 border border-primary-subtle rounded bg-primary-subtle"
    >
      <div class="d-flex flex-column gap-1">
        <strong>{{ params.name || module.label || "SuperSynth" }}</strong>
        <span class="form-text">SuperSynth réutilisable</span>
      </div>
      <button
        type="button"
        class="btn btn-sm btn-primary"
        @click="emit('edit-synth', module)"
      >
        Ouvrir le SuperSynth (Voice / Main)
      </button>
      <button
        type="button"
        class="btn btn-sm btn-outline-dark"
        @click="emit('load-super-synth', module)"
      >
        Charger un SuperSynth…
      </button>
      <button
        type="button"
        class="btn btn-sm btn-outline-dark"
        @click="emit('save-super-synth', module)"
      >
        Enregistrer dans la bibliothèque
      </button>
      <p class="form-text mb-0">
        Ce nœud contient un SynthPatch complet (synthés internes + couche main).
        Les notes reçues sont propagées à tous ses synthés internes.
      </p>
    </div>

    <!-- Visualiseur pseudo-3D de la table (module wavetableS uniquement) :
         les frames fuient vers un point de fuite, la frame en cours de
         lecture est surlignée en clair avec sa ligne de temps. -->
    <div
      v-if="module.type === 'wavetableS'"
      class="mb-3 pb-3 border-bottom"
      style="border-bottom-style: dashed !important"
    >
      <h4 class="h6 mb-2">Table d'ondes</h4>
      <canvas ref="viewer" class="d-block w-100 rounded" style="height: 230px; background: #0a1016"></canvas>
      <div class="d-flex justify-content-between align-items-baseline small text-body-secondary mt-1">
        <span :class="{ 'opacity-50': !scanActive }">
          frame <strong class="text-success-emphasis font-monospace">{{ currentFrame }}</strong>
          <template v-if="rowFrameCount > 1"> / {{ rowFrameCount - 1 }}</template>
          <em class="fst-normal text-warning-emphasis">{{ scanActive ? "lecture" : "arrêt" }}</em>
        </span>
        <span class="font-monospace">
          {{ wavetableRows.length }} ligne(s)
        </span>
      </div>
    </div>

    <div
      v-for="(def, key) in visibleParamDefs"
      :key="key"
      class="d-flex align-items-center gap-2 mb-2"
      :class="{ 'flex-column align-items-stretch': def.type === 'envelope' || def.type === 'json' || def.type === 'code' }"
    >
      <label class="small text-body-secondary">{{ key }}</label>
      <!-- Number slider -->
      <input v-if="def.type === 'number'"
             class="form-control form-control-sm"
             style="width: 90px"
             type="number"
             :min="def.min"
             :max="def.max"
             :step="def.step"
             v-model.number="params[key]"
             @input="emitChange(key, params[key])" />
      <span v-if="def.type === 'number'" class="small font-monospace">{{ params[key] }}<template v-if="def.unit"> {{ def.unit }}</template></span>

      <!-- Enum dropdown -->
      <select v-else-if="def.type === 'enum'"
              class="form-select form-select-sm"
              v-model="params[key]"
              @change="emitChange(key, params[key])">
        <option v-for="v in def.values" :key="v" :value="v">{{ v }}</option>
      </select>

      <!-- String text input -->
      <input v-else-if="def.type === 'string'"
             class="form-control form-control-sm"
             type="text"
             v-model="params[key]"
             @change="emitChange(key, params[key])" />

      <!-- Code DSP (module AudioWorklet) / courbe (module WaveShaper) :
           textarea en ligne, le commit vers le patch est différé de 500 ms
           (cf. codeDrafts plus haut) -->
      <template v-else-if="def.type === 'code'">
        <textarea
          class="form-control font-monospace"
          style="min-height: 220px; font-size: 12px; line-height: 1.45; tab-size: 2; resize: vertical"
          spellcheck="false"
          autocomplete="off"
          autocapitalize="off"
          autocorrect="off"
          :rows="def.rows || 16"
          :value="codeValue(key)"
          @input="onCodeInput(key, $event)"
          @keydown="onCodeKeydown(key, $event)"
          @blur="commitCode(key)"
        ></textarea>
        <div class="d-flex align-items-center flex-wrap gap-2 mt-2">
          <button type="button" class="btn btn-sm btn-outline-dark" @click="commitCode(key)">Valider (Ctrl+Entrée)</button>
          <button type="button" class="btn btn-sm btn-outline-dark" @click="resetCode(key)">Code par défaut</button>
          <span class="form-text mb-0">
            compilé au chargement du patch — rejouez une note ou rechargez le patch
          </span>
        </div>
        <span
          v-if="module.type === 'waveshaper' && key === 'curve' && curveStatus"
          class="d-block mt-1 small font-monospace"
          :class="curveStatus?.ok ? 'text-success-emphasis' : 'text-danger-emphasis'">
          {{ curveStatus?.message }}
        </span>
      </template>

      <!-- JSON (ex: wavetable) : bouton + résumé ici, le textarea géant n'est
           rendu QUE dans la modale (jamais en dur dans le panneau) -->
      <template v-else-if="def.type === 'json'">
        <div class="d-flex flex-column gap-1 w-100">
          <button class="btn btn-sm btn-outline-dark w-100" @click="openJsonModal(key)">
            Charger / éditer le JSON…
          </button>
          <span class="form-text mb-0" v-if="key === 'options'">
            <code class="font-monospace">{ "ranges": { "p1": [1, 16] } }</code> — plage de valeur de p1
            (−10..+10 par défaut). Recompile le code au prochain chargement.
          </span>
          <span
            v-if="jsonStatusView(key).pending || jsonStatusView(key).message"
            class="small font-monospace"
            :class="jsonStatusView(key).pending ? 'text-body-secondary fst-italic' : jsonStatusView(key).ok ? 'text-success-emphasis' : 'text-danger-emphasis'">
            {{ jsonStatusView(key).message }}
          </span>
          <!-- Amplificateur : multiplie def.jsonKeys et réécrit le JSON -->
          <div
            v-if="isWaveParam(def)"
            class="d-flex align-items-center gap-2 small">
            <label class="text-nowrap">Amplifier ×</label>
            <input
              class="form-control form-control-sm"
              style="width: 64px"
              type="number"
              v-model.number="ampFactor"
              min="0.01"
              step="0.1"
              placeholder="1"
            />
            <button
              class="btn btn-sm btn-outline-success"
              :disabled="!(ampFactor > 0)"
              @click="applyAmp(def, key)">
              appliquer
            </button>
          </div>
        </div>
      </template>

      <!-- Boolean checkbox -->
      <input v-else-if="def.type === 'boolean'"
             class="form-check-input m-0"
             type="checkbox"
             v-model="params[key]"
             @change="emitChange(key, params[key])" />
      <!-- Enveloppe : éditeur graphique
           :key = module.id → l'éditeur est RECRÉÉ à chaque changement de
           module. Le panel de propriétés est lui-même réutilisé (PatchEditor
           ne met pas de :key), donc sans cette clé le composant d'édition
           survivait au changement d'enveloppe et conservait l'état interne
           de la précédente — notamment la plage min/max, relue uniquement au
           montage. -->
      <GraphEnvelopeEditor
        v-else-if="def.type === 'envelope'"
        :key="module.id + ':' + key"
        :stages="params.stages"
        :min="def.min != null ? def.min : 0"
        :max="def.max != null ? def.max : 1"
        :step="def.step != null ? def.step : 0.0001"
        :unit="def.unit || ''"
        :presets-key="'env:' + module.type"
        @update="val => updateEnveloppe(key, val)"
      />
      <label v-if="def.type === 'envelope'" class="form-check d-flex align-items-center gap-2 small mb-2 user-select-none">
        <input
          class="form-check-input m-0"
          type="checkbox"
          :checked="!!(params.stages && params.stages.loop)"
          @change="toggleLoop"
        />
        <span>Loop continue (sustain très long)</span>
      </label>
      <AudioFilePicker
        v-else-if="def.type === 'audioFile'"
        :value="params[key]"
        @update="val => emitChange(key, val)"
      />

    </div>

    <!-- Éditeur de plage de lecture pour les samples (module FX) -->
    <div v-if="module.type === 'fx'" class="mt-3 pt-3 border-top" style="border-top-style: dashed !important">
      <h4 class="h6 mb-2">Plage de lecture</h4>
      <SampleWaveformEditor
        :buffer-key="params.buffer || null"
        :start="Number(params.start) || 0"
        :end="Number(params.end) || 0"
        @update="onSampleRegionUpdate"
      />
    </div>

    <!-- Presets des modules à code : sauvegarde / rechargement de la config
         complète (code DSP / courbe + paramètres) sous un nom, persistée en
         IndexedDB (cf. useWorkletPresets) -->
    <div v-if="activePresetStore" class="mt-3 pt-3 border-top" style="border-top-style: dashed !important">
      <h4 class="h6 mb-2">Presets</h4>
      <div class="d-flex gap-2 mb-2">
        <input
          v-model="presetName"
          class="form-control form-control-sm"
          type="text"
          placeholder="Nom du preset"
          @keydown.enter="saveCurrentPreset"
        />
        <button type="button" class="btn btn-sm btn-outline-primary text-nowrap" @click="saveCurrentPreset">Sauver la config</button>
      </div>
      <ul v-if="presetList.length" class="list-unstyled d-flex flex-column gap-1 mb-0">
        <li v-for="p in presetList" :key="p.name" class="d-flex align-items-center gap-2 small">
          <span class="flex-grow-1 text-truncate" :title="p.name">{{ p.name }}</span>
          <span class="small text-body-secondary font-monospace text-nowrap">{{ formatPresetDate(p.savedAt) }}</span>
          <button type="button" class="btn btn-sm btn-outline-dark" @click="applyPreset(p.name)">Charger</button>
          <button
            type="button"
            class="btn btn-sm btn-outline-danger"
            title="Supprimer"
            @click="deletePreset(p.name)">✕</button>
        </li>
      </ul>
      <span v-else class="form-text">aucun preset sauvegardé pour l'instant</span>
      <span v-if="presetStatus" class="d-block mt-1 form-text text-success-emphasis">{{ presetStatus }}</span>
    </div>

    <!-- Modale d'édition du JSON des wavetables : seul endroit où le gros
         textarea est rendu (donc uniquement quand on en a besoin). Le
         Teleport envoie le contenu sur <body>, la position DOM n'a aucune
         incidence. ⚠️ rester à l'INTÉRIEUR de la div racine : un second root
         casserait l'héritage des attrs (class="editor-properties"). -->
    <Teleport to="body">
      <div
        v-if="jsonModalKey != null"
        class="modal d-block"
        tabindex="-1"
        style="background: rgba(0, 0, 0, 0.45)"
        @click.self="closeJsonModal">
        <div class="modal-dialog modal-xl modal-dialog-scrollable" style="height: min(88vh, 720px)">
          <div class="modal-content h-100">
            <div class="modal-header py-2">
              <strong class="modal-title font-monospace">{{ jsonModalKey }}</strong>
              <button
                type="button"
                class="btn-close"
                title="Fermer (Esc)"
                @click="closeJsonModal"></button>
            </div>
            <div class="modal-body d-flex flex-column gap-2 overflow-hidden">
              <div
                class="small font-monospace"
                :class="jsonDraftStatus.pending ? 'text-body-secondary fst-italic' : jsonDraftStatus.ok ? 'text-success-emphasis' : 'text-danger-emphasis'">
                {{ jsonDraftStatus.message }}
              </div>
              <textarea
                class="form-control font-monospace flex-grow-1"
                style="font-size: 12px; line-height: 1.4; resize: none"
                spellcheck="false"
                :value="jsonDraft"
                @input="onJsonDraftInput"
                @keydown.esc="closeJsonModal"></textarea>
            </div>
            <div class="modal-footer py-2">
              <span class="me-auto small text-body-secondary font-monospace">
                {{ jsonDraft.length.toLocaleString('fr-FR') }} caractères
              </span>
              <button type="button" class="btn btn-sm btn-outline-dark" @click="closeJsonModal">Annuler</button>
              <button
                type="button"
                class="btn btn-sm btn-success"
                :disabled="jsonDraftStatus.pending || !jsonDraftStatus.ok"
                @click="applyJsonModal">
                Charger
              </button>
            </div>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>
