<script setup>
import { ref, reactive, watch, nextTick } from "vue"
import Swal from "sweetalert2"
import PatchEditor from "./PatchEditor.vue";
import SuperModuleEditor from "./SuperModuleEditor.vue";
import SynthPatchManager from "./SynthPatchManager.vue";
import LmStudioChat from "./LmStudioChat.vue";

import { useDockState } from "../composables/useDockState";
import { useModuleCatalog } from "../composables/useModuleCatalog";
const { showVisualizer, showKeyboard } = useDockState()
const { getCatalog } = useModuleCatalog()

const currentPatch = ref("voice")
const patchManagerOpen = ref(false)
const aiOpen = ref(false)

const voiceEditor = ref(null)
const mainEditor = ref(null)
const chatRef = ref(null)

const voicePatch = reactive({
  modules: [],
  connections: []
})

const mainPatch = reactive({
  modules: [],
  connections: []
})

const toggleVoicePatch = () => {
    currentPatch.value = "voice"
}

const toggleMainPatch = () => {
    currentPatch.value = "main"
}

const toggleSuperModules = () => {
    currentPatch.value = "super"
}

const clearCurrentPatch = async () => {
  const editor = currentPatch.value === "voice" ? voiceEditor.value : mainEditor.value
  if (!editor) return
  const res = await Swal.fire({
    title: `Effacer entièrement le patch ${currentPatch.value} ?`,
    icon: "warning",
    showCancelButton: true,
    confirmButtonText: "Effacer",
    cancelButtonText: "Annuler",
    confirmButtonColor: "#d33",
  })
  if (!res.isConfirmed) return
  editor.clearPatch()
}

/* =========================
 * Synthé complet (voice + main) : chargement dans les deux éditeurs.
 * Chaque PatchEditor redessine son paper puis resynchronise sa source
 * de vérité ; le watch deep de SynthEditor propage le nouveau synthé
 * à l'App (MidiController, MultiTrackSequencer) et déclenche le
 * rebuild du moteur audio partagé.
 * ========================= */
const handleSynthPatchLoaded = (synthPatch) => {
  const voiceData = synthPatch.voicePatch || { modules: [], connections: [] };
  const mainData = synthPatch.mainPatch || { modules: [], connections: [] };
  //if (confirm("Charger ce synthé complet ? Les patches voice et main actuels seront remplacés.")) {
    voiceEditor.value?.loadPatch(voiceData);
    mainEditor.value?.loadPatch(mainData);
  //}
}

/* =========================
 * Extraction et diagnostic du JSON proposé par l'IA.
 * Le modèle encadre parfois le JSON de texte ou de Markdown : on repère
 * la première accolade ouvrante, puis on tente les accolades fermantes
 * de la dernière vers la première pour retrouver l'objet complet.
 * On tolère aussi deux écarts fréquents des LLM (commentaires et virgules
 * finales) en les retirant AVANT JSON.parse. Cela évite des allers-retours
 * de correction pour un simple commentaire.
 * Si aucune tentative n'aboutit, on conserve l'erreur de syntaxe et sa
 * position pour pouvoir la transmettre au modèle.
 * ========================= */

/** Retire les commentaires ligne (//) et bloc hors des chaînes JSON. */
const stripJsonComments = (text) => {
  let result = ""
  let inString = false
  let escaped = false

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]

    if (inString) {
      result += char
      if (escaped) {
        escaped = false
      } else if (char === "\\") {
        escaped = true
      } else if (char === '"') {
        inString = false
      }
      continue
    }

    if (char === '"') {
      inString = true
      result += char
      continue
    }

    if (char === "/" && text[index + 1] === "/") {
      result += " "
      index += 2
      while (
        index < text.length &&
        text[index] !== "\n" &&
        text[index] !== "\r"
      ) {
        index += 1
      }
      if (index < text.length) result += text[index]
      continue
    }

    if (char === "/" && text[index + 1] === "*") {
      result += " "
      index += 2
      while (
        index < text.length &&
        !(text[index] === "*" && text[index + 1] === "/")
      ) {
        index += 1
      }
      index += 1
      continue
    }

    result += char
  }

  return result
}

/** Retire les virgules qui précèdent directement } ou ] hors des chaînes. */
const stripTrailingJsonCommas = (text) => {
  let result = ""
  let inString = false
  let escaped = false

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]

    if (inString) {
      result += char
      if (escaped) {
        escaped = false
      } else if (char === "\\") {
        escaped = true
      } else if (char === '"') {
        inString = false
      }
      continue
    }

    if (char === '"') {
      inString = true
      result += char
      continue
    }

    if (char === ",") {
      let lookahead = index + 1
      while (lookahead < text.length && /\s/.test(text[lookahead])) {
        lookahead += 1
      }
      if (text[lookahead] === "}" || text[lookahead] === "]") continue
    }

    result += char
  }

  return result
}

const normalizeJsonCandidate = (text) =>
  stripTrailingJsonCommas(stripJsonComments(text))

const parseJsonResponse = (text) => {
  if (typeof text !== "string") {
    return { patch: null, syntaxError: null }
  }

  const start = text.indexOf("{")
  if (start === -1) {
    return { patch: null, syntaxError: null }
  }

  // Candidats du plus large au plus court : le dernier } ferme en principe
  // l'objet, les précédents permettent d'ignorer un éventuel texte résiduel.
  const candidates = []
  for (let end = text.lastIndexOf("}"); end > start; end = text.lastIndexOf("}", end - 1)) {
    candidates.push(text.slice(start, end + 1))
  }
  if (!candidates.length) candidates.push(text.slice(start))

  let firstError = null

  for (const candidate of candidates) {
    const normalized = normalizeJsonCandidate(candidate)

    try {
      return { patch: JSON.parse(normalized), syntaxError: null }
    } catch (error) {
      // On garde l'erreur du candidat le plus large : c'est celle qui décrit
      // le mieux le problème de syntaxe du patch complet.
      if (!firstError) firstError = { error, candidate: normalized }
    }
  }

  return { patch: null, syntaxError: firstError }
}

/** Vrai si le texte ressemble à une tentative de patch, pas à du texte libre. */
const looksLikePatchAttempt = (text) =>
  typeof text === "string" &&
  /"?(voicePatch|mainPatch|modules|connections|version)"?\s*:/i.test(text)

/** Position (0-based) de l'erreur selon le navigateur / moteur JS. */
const getJsonErrorPosition = (message, candidate) => {
  const positionMatch = message.match(/position\s+(\d+)/i)
  if (positionMatch) return Number(positionMatch[1])

  const lineColumnMatch =
    message.match(/\(line\s+(\d+)\s+column\s+(\d+)\)/i) ||
    message.match(/line\s+(\d+)\s+column\s+(\d+)/i)

  if (lineColumnMatch) {
    const line = Number(lineColumnMatch[1])
    const column = Number(lineColumnMatch[2])
    const prefix = candidate
      .split("\n")
      .slice(0, Math.max(0, line - 1))
      .join("\n")
    return prefix.length + (line > 1 ? 1 : 0) + Math.max(0, column - 1)
  }

  if (/end of (json )?input/i.test(message)) return candidate.length

  return null
}

const getLineColumn = (text, position) => {
  if (!Number.isFinite(position)) return { line: null, column: null }

  const before = text.slice(0, position)
  return {
    line: before.split("\n").length,
    column: position - before.lastIndexOf("\n"),
  }
}

/**
 * Extrait de quelques caractères autour de l'erreur. Le marqueur ⟦ICI⟧
 * évite tout problème d'alignement avec les retours à la ligne.
 */
const buildJsonErrorSnippet = (text, position, radius = 80) => {
  if (!Number.isFinite(position)) {
    return text.length > radius * 3 ? `${text.slice(0, radius * 3)}…` : text
  }

  const from = Math.max(0, position - radius)
  const to = Math.min(text.length, position + radius)
  const before = text.slice(from, position)
  const after = text.slice(position, to)
  const prefix = from > 0 ? "…" : ""
  const suffix = to < text.length ? "…" : ""

  return `${prefix}${before}⟦ICI⟧${after}${suffix}`
}

/** Message d'erreur de syntaxe lisible par le modèle, avec localisation. */
const formatJsonSyntaxError = ({ error, candidate }) => {
  const message = String(error?.message || "JSON invalide")
  const position = getJsonErrorPosition(message, candidate)
  const { line, column } = getLineColumn(candidate, position)
  const location =
    line !== null ? `ligne ${line}, colonne ${column}` : "position indéterminée"

  return [
    `Erreur de syntaxe JSON (${location}) : ${message}`,
    "Extrait autour de l'emplacement de l'erreur (⟦ICI⟧) :",
    buildJsonErrorSnippet(candidate, position),
  ].join("\n")
}

/* =========================
 * Validation du patch proposé par l'IA avant import.
 * Retourne une liste de messages d'erreur lisibles par le modèle :
 * ces messages lui sont renvoyés pour qu'il corrige sa proposition.
 * ========================= */
const validateSynthPatch = (synthPatch) => {
  const errors = []
  const catalog = getCatalog()

  if (!synthPatch || typeof synthPatch !== "object" || Array.isArray(synthPatch)) {
    return ["La réponse ne contient pas un objet patch JSON valide."]
  }

  const graphs = [
    ["voicePatch", synthPatch.voicePatch],
    ["mainPatch", synthPatch.mainPatch],
  ]

  for (const [graphName, graph] of graphs) {
    if (!graph || typeof graph !== "object" || Array.isArray(graph)) {
      errors.push(`${graphName} est absent ou n'est pas un objet.`)
      continue
    }

    const modules = Array.isArray(graph.modules) ? graph.modules : null
    const connections = Array.isArray(graph.connections) ? graph.connections : null

    if (!modules) errors.push(`${graphName}.modules doit être un tableau.`)
    if (!connections) errors.push(`${graphName}.connections doit être un tableau.`)
    if (!modules || !connections) continue

    const moduleIds = new Set()

    for (const [index, module] of modules.entries()) {
      const where = `${graphName}.modules[${index}]`

      if (!module || typeof module !== "object") {
        errors.push(`${where} n'est pas un objet.`)
        continue
      }

      if (typeof module.id !== "string" || !module.id) {
        errors.push(`${where}.id doit être une chaîne non vide.`)
      } else if (moduleIds.has(module.id)) {
        errors.push(`${where}.id "${module.id}" est dupliqué dans ${graphName}.`)
      } else {
        moduleIds.add(module.id)
      }

      if (typeof module.type !== "string" || !catalog[module.type]) {
        errors.push(`${where}.type "${module.type}" n'existe pas dans le catalogue.`)
      }

      if (
        !module.position ||
        !Number.isFinite(module.position.x) ||
        !Number.isFinite(module.position.y)
      ) {
        errors.push(`${where}.position doit contenir des coordonnées x et y numériques.`)
      }

      if (
        module.params !== undefined &&
        (!module.params || typeof module.params !== "object" || Array.isArray(module.params))
      ) {
        errors.push(`${where}.params doit être un objet.`)
      }
    }

    for (const [index, connection] of connections.entries()) {
      const where = `${graphName}.connections[${index}]`

      if (!connection || typeof connection !== "object") {
        errors.push(`${where} n'est pas un objet.`)
        continue
      }

      const endpoints = [
        ["from", connection.from, "outputs", "out"],
        ["to", connection.to, "inputs", "in"],
      ]

      for (const [side, endpoint, portCollection, portPrefix] of endpoints) {
        if (!endpoint || typeof endpoint !== "object") {
          errors.push(`${where}.${side} est absent.`)
          continue
        }

        if (typeof endpoint.id !== "string" || !endpoint.id) {
          errors.push(`${where}.${side}.id est absent.`)
          continue
        }

        const module = modules.find((m) => m?.id === endpoint.id)
        if (!module) {
          errors.push(
            `${where}.${side}.id "${endpoint.id}" ne correspond à aucun module de ${graphName}.`
          )
          continue
        }

        const definition = catalog[module.type]
        if (!definition) continue

        if (typeof endpoint.port !== "string" || !endpoint.port) {
          errors.push(`${where}.${side}.port est absent.`)
          continue
        }

        const ports = definition.ports?.[portCollection] ?? []
        if (!ports.some((port) => endpoint.port === `${portPrefix}:${port.id}`)) {
          const available = ports.map((port) => `${portPrefix}:${port.id}`).join(", ")
          errors.push(
            `${where}.${side}.port "${endpoint.port}" n'existe pas sur le module "${endpoint.id}" (${module.type}). Ports valides : ${available || "aucun"}.`
          )
        }
      }
    }

    /* -------------------------
     * Vérification de la topologie audio.
     * Un patch peut avoir des ports valides mais rester totalement silencieux
     * si rien n'atteint destination. On ne suit que les connexions audio :
     * une modulation vers in:gain ne constitue pas un chemin audio.
     * ------------------------- */

    const graphModules = modules.filter(
      (module) =>
        module &&
        typeof module === "object" &&
        typeof module.id === "string" &&
        module.id &&
        typeof module.type === "string" &&
        catalog[module.type]
    )
    const moduleMap = new Map(graphModules.map((module) => [module.id, module]))

    const findPort = (side, endpoint) => {
      const module = moduleMap.get(endpoint?.id)
      if (!module) return null

      const prefix = side === "from" ? "out:" : "in:"
      if (
        typeof endpoint.port !== "string" ||
        !endpoint.port.startsWith(prefix)
      ) {
        return null
      }

      const definition = catalog[module.type]
      const ports =
        side === "from"
          ? definition.ports?.outputs ?? []
          : definition.ports?.inputs ?? []
      const portId = endpoint.port.slice(prefix.length)

      return ports.find((port) => port.id === portId) ?? null
    }

    const audioEdges = new Map()
    for (const connection of connections) {
      const fromPort = findPort("from", connection?.from)
      const toPort = findPort("to", connection?.to)
      if (fromPort?.kind !== "audio" || toPort?.kind !== "audio") continue

      const fromId = connection.from.id
      if (!audioEdges.has(fromId)) audioEdges.set(fromId, new Set())
      audioEdges.get(fromId).add(connection.to.id)
    }

    const canReachWithAudio = (startIds, targetIds) => {
      const targets = new Set(targetIds)
      const visited = new Set()
      const queue = [...startIds]

      while (queue.length) {
        const current = queue.shift()
        if (targets.has(current)) return true
        if (visited.has(current)) continue
        visited.add(current)

        for (const next of audioEdges.get(current) ?? []) {
          if (!visited.has(next)) queue.push(next)
        }
      }

      return false
    }

    const destinationIds = graphModules
      .filter((module) => module.type === "destination")
      .map((module) => module.id)
    const inputIds = graphModules
      .filter((module) => module.type === "input")
      .map((module) => module.id)
    const audioOutputModules = graphModules.filter((module) =>
      (catalog[module.type]?.ports?.outputs ?? []).some(
        (port) => port.kind === "audio"
      )
    )

    if (graphName === "voicePatch" && !destinationIds.length) {
      errors.push(
        'voicePatch doit contenir un module "destination". Termine toujours la chaîne audio par destination in:in.'
      )
    }

    if (graphName === "mainPatch") {
      if (!inputIds.length) {
        errors.push(
          'mainPatch doit contenir un module "input" qui reçoit les voix du voicePatch.'
        )
      }
      if (!destinationIds.length) {
        errors.push(
          'mainPatch doit contenir un module "destination". Termine toujours la chaîne audio par destination in:in.'
        )
      }
    }

    if (destinationIds.length) {
      const destinationInputIds = new Set(destinationIds)
      const hasDestinationInput = connections.some((connection) =>
        destinationInputIds.has(connection?.to?.id)
      )

      if (!hasDestinationInput) {
        errors.push(
          `${graphName} : aucun câble n'arrive à "destination". Connecte une sortie audio à destination in:in.`
        )
      }

      const unreachableAudioModules = []
      for (const module of audioOutputModules) {
        if (canReachWithAudio([module.id], destinationIds)) continue
        if (graphName === "mainPatch" && module.type === "input") continue

        unreachableAudioModules.push(`"${module.id}" (${module.type})`)
      }

      if (unreachableAudioModules.length) {
        errors.push(
          `${graphName} : ces modules produisent de l'audio mais n'atteignent pas "destination" par des connexions audio : ${unreachableAudioModules.join(", ")}. Ajoute les câbles audio manquants ; une modulation vers in:gain ne compte pas comme chemin audio.`
        )
      }

      if (
        graphName === "mainPatch" &&
        inputIds.length &&
        !canReachWithAudio(inputIds, destinationIds)
      ) {
        errors.push(
          'mainPatch : aucun chemin audio continu ne relie "input" à "destination". Construis par exemple input out:out -> compressor in:in -> compressor out:out -> destination in:in.'
        )
      }
    }

    const connectedModuleIds = new Set()
    for (const connection of connections) {
      if (typeof connection?.from?.id === "string") {
        connectedModuleIds.add(connection.from.id)
      }
      if (typeof connection?.to?.id === "string") {
        connectedModuleIds.add(connection.to.id)
      }
    }

    const audioOutputModuleIds = new Set(
      audioOutputModules.map((module) => module.id)
    )
    for (const module of graphModules) {
      if (connectedModuleIds.has(module.id)) continue
      if (module.type === "destination" || module.type === "input") continue
      if (audioOutputModuleIds.has(module.id)) continue

      errors.push(
        `${graphName} : le module "${module.id}" (${module.type}) n'est connecté à aucune entrée ni sortie.`
      )
    }
  }

  return errors
}

/**
 * Tente de charger le patch proposé par l'IA. En cas d'échec, les erreurs
 * sont renvoyées au modèle via LmStudioChat pour qu'il corrige sa réponse.
 */
const handleAiPatchReceived = (answer) => {
  const { patch: synthPatch, syntaxError } = parseJsonResponse(answer)

  // Aucun JSON exploitable. Si le texte ressemble malgré tout à une tentative
  // de patch, on transmet l'erreur de syntaxe au modèle pour qu'il la corrige.
  if (!synthPatch) {
    if (syntaxError && looksLikePatchAttempt(answer)) {
      chatRef.value?.requestCorrection([
        formatJsonSyntaxError(syntaxError),
        "Renvoie un objet JSON syntaxiquement valide, sans texte ni balise Markdown autour.",
      ])
    }
    return
  }

  const errors = validateSynthPatch(synthPatch)

  if (!errors.length) {
    try {
      handleSynthPatchLoaded(synthPatch)
    } catch (err) {
      errors.push(`Erreur pendant l'importation du patch : ${err.message}`)
    }
  }

  if (errors.length) {
    chatRef.value?.requestCorrection(errors)
    return
  }

  chatRef.value?.resetCorrectionAttempts()
  currentPatch.value = "voice"
  Swal.fire({
    toast: true,
    position: "bottom-end",
    icon: "success",
    title: `Patch « ${synthPatch.name || "IA"} » chargé`,
    timer: 2500,
    showConfirmButton: false,
  })
}

const props = defineProps({
  // Ancien usage : éditeur autonome d'un synthé complet.
  patch: {
    type: Object,
    default: null,
  },
  // Nouvel usage : édition d'un nœud Synth d'un SynthPatch. L'objet est le
  // plus souvent `module.params` ({ name, voicePatch, mainPatch }).
  synth: {
    type: Object,
    default: null,
  },
  // Affiche un bouton de fermeture (utilisé dans la modale du SynthPatch).
  closeable: {
    type: Boolean,
    default: false,
  },
})
const patch = props.patch ?? reactive({})

const emit = defineEmits(["update:patch", "update:synth", "close"])

const deepClone = (v) => JSON.parse(JSON.stringify(v ?? {}))

/** Émet l'état courant vers le nœud Synth parent (graphes clonés). */
const emitSynthUpdate = () => {
  if (!props.synth) return
  emit("update:synth", {
    ...deepClone(props.synth),
    voicePatch: deepClone(voicePatch),
    mainPatch: deepClone(mainPatch),
  })
}

/**
 * Charge le synthé sélectionné dans les deux éditeurs. Les objets locaux
 * `voicePatch` / `mainPatch` restent stables (PatchEditor capture leur
 * référence au montage) : on remplace leur contenu, pas leur identité.
 */
const loadSynthIntoEditors = async (synth) => {
  if (!synth) return
  const voiceData = deepClone(synth.voicePatch ?? { modules: [], connections: [] })
  const mainData = deepClone(synth.mainPatch ?? { modules: [], connections: [] })
  await nextTick()
  voiceEditor.value?.loadPatch(voiceData)
  mainEditor.value?.loadPatch(mainData)
}

watch(() => props.synth, loadSynthIntoEditors, { immediate: true })

watch(
  voicePatch,
  (newPatch) => {
    if (props.synth) {
      emitSynthUpdate()
      return
    }
    patch.value = {
      voicePatch: newPatch,
      mainPatch,
    }
    emit("update:patch", patch.value)
  },
  { deep: true }
);

watch(
  mainPatch,
  (newPatch) => {
    if (props.synth) {
      emitSynthUpdate()
      return
    }
    patch.value = {
      voicePatch,
      mainPatch: newPatch,
    }
    emit("update:patch", patch.value)
  },
  { deep: true }
);

</script>
<template>
<div>
    <SynthPatchManager
      :patch="props.synth ?? patch"
      :voice-patch="voicePatch"
      :main-patch="mainPatch"
      @load="handleSynthPatchLoaded"
    />
    <div class="top-panel">
        <button :class="currentPatch === 'voice' ? 'button actif' : 'button'" @click="toggleVoicePatch">Voice</button>
        <button :class="currentPatch === 'main' ? 'button actif' : 'button'" class="button" @click="toggleMainPatch">Main</button>
        <button :class="currentPatch === 'super' ? 'button actif' : 'button'" class="button" @click="toggleSuperModules">Super Modules</button>
        <button
          class="button clear"
          :disabled="currentPatch === 'super'"
          @click="clearCurrentPatch"
        >Effacer</button>
        <button
          class="button toggle-manager"
          :disabled="currentPatch === 'super'"
          @click="patchManagerOpen = !patchManagerOpen"
        >{{ patchManagerOpen ? "◀ Patch Manager" : "▶ Patch Manager" }}</button>

        <button
          class="button toggle-manager"
          :disabled="currentPatch === 'super'"
          @click="showVisualizer = !showVisualizer"
        >{{ showVisualizer ? "◀ Spectrum" : "▶ Spectrum" }}</button>

        <button
          class="button toggle-manager"
          :disabled="currentPatch === 'super'"
          @click="showKeyboard = !showKeyboard"
        >{{ showKeyboard ? "◀ Keyboard" : "▶ Keyboard" }}</button>

        <button
          class="button toggle-manager"
          :class="{ actif: aiOpen }"
          @click="aiOpen = !aiOpen"
        >{{ aiOpen ? "◀ IA" : "▶ IA" }}</button>

        <button
          v-if="closeable"
          class="button close-synth"
          type="button"
          @click="emit('close')"
        >✕ Fermer</button>
    </div>
    <PatchEditor ref="voiceEditor" v-model:patch="voicePatch" :manager-open="patchManagerOpen" :exclude-categories="['synth']" v-show="currentPatch === 'voice'"></PatchEditor>
    <PatchEditor ref="mainEditor" v-model:patch="mainPatch" :manager-open="patchManagerOpen" :exclude-categories="['synth']" v-show="currentPatch === 'main'"></PatchEditor>
    <SuperModuleEditor v-show="currentPatch === 'super'"></SuperModuleEditor>

    <aside v-if="aiOpen" class="ai-panel">
      <div class="ai-panel-header">
        <span>Assistant IA</span>
        <button class="ai-close" type="button" aria-label="Fermer l'assistant" @click="aiOpen = false">✕</button>
      </div>
      <LmStudioChat
        ref="chatRef"
        class="ai-chat"
        :voice-patch="voicePatch"
        :main-patch="mainPatch"
        @patch-received="handleAiPatchReceived"
      />
    </aside>
</div>
</template>

<style scoped>

h1{
  color: rgb(0, 39, 33);;
}
.button {
  margin-right: 12px;
  padding: 6px 12px;
  border: none;
  background: rgb(1, 122, 102);
  color: white;
  font-weight: bold;
  font-size: large;
  border-radius: 4px;
  cursor: pointer;
  transition: transform 0.1s;
}

.button.actif {
  background: #00c9a7;
  color: white;
}

.button:hover {
  transform: scale(1.05);
}

.button.close-synth {
  background: #444;
  margin-left: auto;
}

.button.clear {
  background: #c0392b;
  margin-left: 24px;
}

.button.toggle-manager {
  background: #34495e;
  margin-left: 12px;
}

.button.toggle-manager.actif {
  background: #00c9a7;
}

.button.clear:disabled {
  background: #aaa;
  cursor: not-allowed;
  transform: none;
}

.top-panel{
  background: #12332b;
  border-top:1px solid rgba(255,255,255, .1);
  padding-top:2px;
  padding-bottom:2px;
}

/* =========================
 * Panneau Assistant IA (LmStudioChat)
 * Superposé à droite pour ne pas réduire la surface du patch.
 * ========================= */
.ai-panel {
  position: fixed;
  top: 0;
  right: 0;
  bottom: var(--dock-height, 0px);
  z-index: 200;
  display: flex;
  flex-direction: column;
  width: min(520px, 100vw);
  background: #fff;
  box-shadow: -4px 0 24px rgba(0, 0, 0, 0.35);
}

.ai-panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 11px 16px;
  background: #12332b;
  color: #fff;
  font-weight: bold;
}

.ai-close {
  border: none;
  background: transparent;
  color: #fff;
  font-size: 1.1rem;
  line-height: 1;
  cursor: pointer;
}

.ai-panel .ai-chat {
  flex: 1;
  height: auto;
  max-width: none;
  margin: 0;
  border: none;
  border-radius: 0;
  min-height: 0;
}
</style>