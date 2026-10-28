
<script setup>
import { ref, reactive, computed, onMounted, onBeforeUnmount, nextTick } from "vue";
import { useLmStudioAPI } from "../composables/useLmStudioAPI";
import { useLmStudioSettings } from "../composables/useLmStudioSettings";
import { useModuleCatalog } from "../composables/useModuleCatalog";

const { settings, defaults: defaultSettings, updateSettings } =
  useLmStudioSettings();

const {
  availableModels,
  loadedModels,
  loading,
  chatting,
  error,
  refreshModels,
  loadModel,
  chat,
  cancelChat,
  setBaseUrl,
  resetConversation,
} = useLmStudioAPI({ baseUrl: settings.baseUrl });

const { getCatalog } = useModuleCatalog();

const selectedModel = ref("");
const input = ref("");
const messages = ref([]);
const chatContainer = ref(null);

const settingsOpen = ref(false);
const settingsDraft = reactive({ ...settings });
const settingsSaved = ref(false);

const emit = defineEmits(["patch-received"]);

// Compteur par demande utilisateur (max fixé par la configuration).
let correctionAttempts = 0;

const props = defineProps({
  // Patch actuellement ouvert dans l'éditeur : envoyé au modèle comme
  // contexte afin qu'il propose des modifications plutôt qu'un nouveau patch.
  voicePatch: { type: Object, default: () => ({ modules: [], connections: [] }) },
  mainPatch: { type: Object, default: () => ({ modules: [], connections: [] }) },
});

const currentModel = computed(() =>
  availableModels.value.find((model) => model.key === selectedModel.value)
);

const isModelLoaded = computed(() =>
  loadedModels.value.some((model) => model.key === selectedModel.value)
);

/**
 * Transforme le catalogue réel en description compacte pour le LLM :
 * types disponibles, sens des ports et contraintes des paramètres. On omet
 * les métadonnées inutiles (libellés de ports, rate, kind) et les valeurs
 * par défaut volumineuses (code, JSON, fichiers audio).
 */
function buildCompactModuleCatalog(extraTypes = []) {
  const catalog = getCatalog();
  const extra = new Set(extraTypes);
  // Types internes aux super-modules ou nécessitant une ressource externe :
  // inutiles dans un patch généré, sauf s'ils sont déjà utilisés.
  const resourceTypes = new Set(["fx", "convolver", "audioworklet"]);

  const entries = Object.entries(catalog).filter(([type, definition]) => {
    if (type === "super.in" || type === "super.out") return false;
    if (definition.category === "interface") return false;
    if (resourceTypes.has(type) && !extra.has(type)) return false;
    return true;
  });

  const compactPort = (port) => ({
    id: port.id,
    ...(port.role ? { role: port.role } : {}),
  });

  const compactParam = (desc) => {
    const param = { type: desc.type };

    if (desc.min !== undefined) param.min = desc.min;
    if (desc.max !== undefined) param.max = desc.max;
    if (desc.values) param.values = desc.values;

    // Les défauts complexes (envelope, JSON, code, fichier) sont documentés
    // séparément ou laissés à l'application : ils alourdissent inutilement.
    const simpleDefault = ["number", "boolean", "string", "enum"].includes(
      desc.type
    );
    if (simpleDefault && desc.default !== undefined) {
      param.default = desc.default;
    }

    return param;
  };

  return entries.map(([type, definition]) => ({
    type,
    label: definition.label,
    category: definition.category,
    inputs: (definition.ports?.inputs ?? []).map(compactPort),
    outputs: (definition.ports?.outputs ?? []).map(compactPort),
    params: Object.fromEntries(
      Object.entries(definition.params ?? {}).map(([name, desc]) => [
        name,
        compactParam(desc),
      ])
    ),
  }));
}

/**
 * Réduit un graphe du patch courant à ses propriétés utiles au modèle
 * (id, type, params, position, label + connexions), sans les métadonnées
 * internes de l'éditeur.
 */
function compactGraph(graph) {
  const cloneParams = (params) => {
    try {
      return JSON.parse(JSON.stringify(params ?? {}));
    } catch {
      return {};
    }
  };

  return {
    modules: (graph?.modules ?? []).map((module) => ({
      id: module.id,
      type: module.type,
      ...(module.label ? { label: module.label } : {}),
      ...(module.position
        ? { position: { x: module.position.x, y: module.position.y } }
        : {}),
      params: cloneParams(module.params),
    })),
    connections: (graph?.connections ?? []).map((connection) => ({
      from: {
        id: connection.from?.id,
        magnet: connection.from?.magnet ?? "circle",
        port: connection.from?.port,
      },
      to: {
        id: connection.to?.id,
        magnet: connection.to?.magnet ?? "circle",
        port: connection.to?.port,
      },
    })),
  };
}

/**
 * Décrit le patch en cours d'édition. Ce bloc est ajouté à chaque message
 * utilisateur (et non au seul prompt système) afin que le modèle dispose
 * toujours de l'état réel du patch, y compris après plusieurs échanges.
 * Retourne une chaîne vide si les deux graphes sont vides.
 */
function buildCurrentPatchContext() {
  const voicePatch = compactGraph(props.voicePatch);
  const mainPatch = compactGraph(props.mainPatch);

  if (!voicePatch.modules.length && !mainPatch.modules.length) return "";

  const currentPatch = {
    version: 1,
    name: "patch en cours d'édition",
    voicePatch,
    mainPatch,
  };

  return [
    "==================================================",
    "PATCH ACTUEL (référence)",
    "==================================================",
    "",
    JSON.stringify(currentPatch),
    "",
    "Ce patch est l'état actuel de l'éditeur.",
    "- Si la demande est une modification, conserve les modules, paramètres, labels et connexions qui ne sont pas concernés, puis renvoie le patch COMPLET (voicePatch ET mainPatch), jamais un diff.",
    "- Si la demande décrit un nouveau son, tu peux remplacer tout ou partie de ce patch ; ne conserve pas des modules inutiles par habitude.",
    "- Réutilise les identifiants existants pour les modules conservés et donne des identifiants uniques aux nouveaux.",
    "- Place les nouveaux modules sur des positions libres, sans chevaucher les modules existants.",
    "",
    "Si un graphe est vide, construis-le. L'application gère elle-même le lien entre voicePatch et mainPatch.",
  ].join("\n");
}

/**
 * Types déjà présents dans le patch courant. Ils sont transmis au catalogue
 * même lorsqu'ils en sont exclus par défaut (modules à ressource externe).
 */
function collectCurrentPatchTypes() {
  return [
    ...(props.voicePatch?.modules ?? []),
    ...(props.mainPatch?.modules ?? []),
  ]
    .map((module) => module?.type)
    .filter(Boolean);
}

function buildSynthSystemPrompt() {
  const moduleCatalog = buildCompactModuleCatalog(collectCurrentPatchTypes());

  const instructions = [
    "Tu es un sound designer expert en synthèse modulaire. Tu produis des patches JSON complets pour un synthétiseur Web Audio.",
    "",
    "OBJECTIF",
    "- Réponds à la demande par une architecture adaptée au timbre recherché, pas par un template générique.",
    "- Utilise la variété du catalogue : couches de sources, filtres, effets, saturation, delay, panoramique et modulation.",
    "- Chaque module doit avoir un rôle audible. Évite d'empiler des modules décoratifs.",
    "- Si le message contient un patch actuel, modifie-le en conservant ce qui n'est pas concerné. S'il est vide, construis un patch complet. Si l'utilisateur demande un nouveau son, tu peux remplacer tout ou partie du patch.",
    "",
    "CATÉGORIES DU CATALOGUE",
    "source (génère le son), filter, effect, dynamics, routing, spatial, control (modulation), utility, super (module composite).",
    "",
    "MODÈLE WEB AUDIO À RESPECTER",
    "- voicePatch = graphe déclenché par note. Utilise 'voice' pour un son piloté par le clavier/MIDI. 'osc', 'wavetable', 'wavetableS' sont des sources libres (LFO, drone, couche).",
    "- mainPatch = traitement global. Les voix sont automatiquement routées depuis voicePatch vers le module 'input' de mainPatch. mainPatch doit contenir un chemin continu vers 'destination'.",
    "- Audio vs modulation : une connexion audio va d'une SORTIE audio vers une ENTRÉE audio. Une connexion de modulation va d'une SORTIE de rôle 'modulator' (envelope, constant, gain selon contexte) vers une ENTRÉE de paramètre (rôle 'modulatable') pour piloter un AudioParam.",
    "- 'voice' n'est PAS 'osc'. Si la demande est un son « note/piano/lead/plucks » à jouer au clavier, privilégie 'voice'. N'utilise 'osc' que si explicitement demandé comme source libre ou LFO.",
    "- Un module 'envelope' ou 'constant' produit une sortie 'modulator', jamais un signal audio à destination directe sauf s'il est explicitement connecté comme modulation.",
    "",
    "SCHÉMA JSON EXACT (À RESPECTER À LA LETTRE)",
    "{",
    '  "version": 1,',
    '  "name": "nom_du_son",',
    '  "voicePatch": { "modules": [], "connections": [] },',
    '  "mainPatch": { "modules": [], "connections": [] }',
    "}",
    "",
    "MODULE",
    '{ "id": "string_non_vide_unique_dans_le_graphe", "type": "string_clef_exacte_du_catalogue", "position": { "x": 0, "y": 0 }, "params": { } }',
    "- position DOIT contenir x et y numériques.",
    "- Si params est présent, il DOIT être un objet (jamais un tableau).",
    "- Ne recopie JAMAIS inputs, outputs, ports, min, max, values, default, label, color depuis le catalogue.",
    "- Conserve 'label' uniquement s'il existait déjà sur un module que tu modifies.",
    "",
    "CONNEXION",
    '{ "from": { "id": "module_source", "port": "out:NOM_PORT_SORTIE" }, "to": { "id": "module_cible", "port": "in:NOM_PORT_ENTREE" }, "magnet": "circle" }',
    "- from.id et to.id doivent exister DANS LE MÊME graphe.",
    "- port OBLIGATOIREMENT préfixé : 'out:...' pour une sortie, 'in:...' pour une entrée.",
    "- Le port doit exister EXACTEMENT dans le catalogue pour ce type de module (pas d'invention).",
    "- magnet est optionnel.",
    "",
    "RÈGLES DE VALIDATION (COPIE CONFORME DU VALIDATEUR)",
    "- L'objet racine DOIT être un objet (pas un tableau). voicePatch et mainPatch DOIVENT être des objets.",
    "- Chaque graphe doit avoir modules (tableau) et connections (tableau).",
    "- module.id doit être une chaîne non vide et UNIQUE dans son graphe.",
    "- module.type doit exister dans le catalogue fourni. 'super.in' et 'super.out' ne sont PAS autorisés dans un patch généré.",
    "- module.position doit avoir x et y finis (numbers).",
    "- Si module.params est défini, c'est obligatoirement un objet.",
    "- Pour chaque connexion : from et to doivent être des objets avec id et port non vides.",
    "- from.id doit pointer vers un module existant du même graphe. from.port doit correspondre à un port présent dans definition.ports.outputs avec le préfixe 'out:'.",
    "- to.id doit pointer vers un module existant du même graphe. to.port doit correspondre à un port présent dans definition.ports.inputs avec le préfixe 'in:'.",
    "- Un port invalide (mauvais côté, port inexistant) fera échouer la validation et te sera renvoyé pour correction.",
    "",
    "FORMAT DE SORTIE",
    "Retourne uniquement un objet JSON valide : aucun texte, aucun Markdown, aucune balise de code.",
    "{",
    '  "version": 1,',
    '  "name": "nom du son",',
    '  "voicePatch": { "modules": [], "connections": [] },',
    '  "mainPatch": { "modules": [], "connections": [] }',
    "}",
    "",
    'Module : { "id": "id_unique", "type": "type_du_catalogue", "position": { "x": 0, "y": 0 }, "params": {} }',
    'Connexion : { "from": { "id": "id_source", "port": "out:PORT" }, "to": { "id": "id_cible", "port": "in:PORT" }, "magnet": "circle" }',
    "",
    "- Les nouveaux modules et les connexions doivent respecter cette forme. position est obligatoire.",
    "- Un module contient id, type, position et params. Conserve label uniquement s'il existait déjà. Ne recopie jamais les inputs, outputs, min, max, default ou values du catalogue.",
    "- params contient uniquement les valeurs choisies. Un paramètre omis reprend sa valeur par défaut.",
    "- Les ports se lisent dans le catalogue : une sortie id out devient out:out ; une entrée id gain devient in:gain. Ne mets jamais le port dans l'id du module.",
    "- Les ids sont uniques dans chaque graphe. Aucune connexion ne traverse voicePatch et mainPatch.",
    "",
    "STRUCTURE AUDIO",
    "- voicePatch contient la synthèse : sources, filtres, gains, effets et modulations. Il doit avoir un module destination et un chemin audio qui y aboutit.",
    "- mainPatch reçoit les voix via input. Il doit contenir input, compressor et destination, avec un chemin audio continu de input à destination. Des effets supplémentaires peuvent être insérés dans ce chemin.",
    '- "voice" est la source pilotée par les notes. "osc" et "wavetable" sont des sources libres (LFO, drone, couche). Le paramètre type choisit la forme d\'onde : "sawtooth" est une valeur, jamais un type de module.',
    '- Une modulation relie une sortie de rôle "modulator" à une entrée de paramètre, par exemple envelope out:out -> gain in:gain. Elle ne remplace pas le chemin audio.',
    '- Envelope : params.stages = { "loop": false, "press": [{ "from": 0, "to": 1, "duration": 0.01, "curve": "exponential" }], "release": [{ "from": "current", "to": 0, "duration": 0.2, "curve": "linear" }] }. Les segments press/release peuvent contenir from, to, duration et curve. modulation vaut "relative" ou "replace".',
    "- Respecte les bornes numériques et les valeurs enum du catalogue. Ne laisse pas une sortie audio principale orpheline.",
    "",
    "VÉRIFICATION AVANT ENVOI",
    "- JSON syntaxiquement valide, ids uniques, positions numériques.",
    "- Tous les types, ports et paramètres existent dans le catalogue.",
    "- Chaque connexion référence un module du même graphe, avec le port du bon côté.",
    "- voicePatch atteint destination ; mainPatch suit input -> compressor -> destination.",
    "",
    "CATALOGUE — SEULE RÉFÉRENCE POUR LES TYPES, PORTS ET PARAMÈTRES",
    JSON.stringify(moduleCatalog),
  ];

  return instructions.join("\n");
}

onMounted(async () => {
  try {
    await refreshModels();
    applyDefaultModel();
  } catch (err) {
    console.error("Impossible de récupérer les modèles :", err);
  }
});

/** Sélectionne le modèle défini dans la configuration, s'il est disponible. */
function applyDefaultModel() {
  const preferred = settings.defaultModel;

  if (
    preferred &&
    availableModels.value.some((model) => model.key === preferred)
  ) {
    selectedModel.value = preferred;
  }
}

function toggleSettings() {
  if (!settingsOpen.value) {
    Object.assign(settingsDraft, settings);
    settingsSaved.value = false;
  }
  settingsOpen.value = !settingsOpen.value;
}

function restoreDefaultSettings() {
  Object.assign(settingsDraft, defaultSettings);
  settingsSaved.value = false;
}

/**
 * Applique puis persiste la configuration (localStorage via le composable).
 * Un changement d'URL de base réinitialise la conversation et recharge les
 * modèles depuis le nouveau serveur.
 */
async function saveSettings() {
  if (chatting.value || loading.value) return;

  const previousBaseUrl = settings.baseUrl;

  updateSettings({
    baseUrl: settingsDraft.baseUrl,
    defaultModel: settingsDraft.defaultModel,
    maxCorrectionAttempts: settingsDraft.maxCorrectionAttempts,
    contextLength: settingsDraft.contextLength,
    temperature: settingsDraft.temperature,
    maxTokens: settingsDraft.maxTokens,
  });

  // Reprend les valeurs normalisées (URL sans slash final, valeurs par défaut).
  Object.assign(settingsDraft, settings);
  settingsSaved.value = true;

  const baseUrlChanged = settings.baseUrl !== previousBaseUrl;

  if (baseUrlChanged) {
    setBaseUrl(settings.baseUrl);
    selectedModel.value = "";
    startNewConversation();
  }

  try {
    await refreshModels();
    // Le modèle par défaut est appliqué au premier chargement ou après un
    // changement de serveur ; sinon on conserve le modèle déjà choisi.
    if (baseUrlChanged || !selectedModel.value) applyDefaultModel();
  } catch (err) {
    console.error("Impossible de recharger les modèles après configuration :", err);
  }
}

async function handleLoadModel() {
  if (!selectedModel.value || loading.value) return;

  try {
    startNewConversation();
    await loadModel(selectedModel.value);
  } catch (err) {
    console.error("Impossible de charger le modèle :", err);
  }
}

function startNewConversation() {
  if (chatting.value) return;

  resetConversation();
  messages.value = [];
}

/** Interrompt la génération en cours ; la réponse partielle est conservée. */
function cancelResponse() {
  cancelChat();
}

// Fermer le panneau IA pendant une génération ne doit pas laisser le flux
// ouvert : on annule la requête lorsque le composant est démonté.
onBeforeUnmount(() => {
  cancelChat();
});

async function sendMessage() {
  const question = input.value.trim();

  if (!question || !isModelLoaded.value || chatting.value) return;

  // Nouvelle demande manuelle : on réarme le compteur de corrections.
  correctionAttempts = 0;
  input.value = "";

  await askModel(question);
}

/**
 * Envoie une demande au modèle, l'affiche dans le fil puis émet la réponse
 * complète pour que le parent tente de charger le patch proposé.
 */
async function askModel(question) {
  messages.value.push({
    role: "user",
    content: question,
  });

  const answerIndex =
    messages.value.push({
      role: "assistant",
      content: "",
    }) - 1;

  await scrollToBottom();

  // Le patch courant accompagne chaque demande : le modèle voit ainsi
  // toujours l'état réel de l'éditeur, même après plusieurs échanges.
  const currentPatchContext = buildCurrentPatchContext();
  const modelInput = currentPatchContext
    ? `${question}\n\n${currentPatchContext}`
    : question;

  try {
    await chat(
      selectedModel.value,
      modelInput,
      (chunk) => {
        messages.value[answerIndex].content += chunk;
        scrollToBottom();
      },
      buildSynthSystemPrompt(),
      {
        contextLength: settings.contextLength,
        temperature: settings.temperature,
        maxTokens: settings.maxTokens,
      }
    );

    // Réponse complète reçue : on la transmet au parent, qui se charge
    // d'extraire l'objet JSON et de charger le synthé proposé.
    emit("patch-received", messages.value[answerIndex].content);
  } catch (err) {
    if (err.name === "AbortError") {
      const partial = messages.value[answerIndex].content;

      messages.value[answerIndex].content = partial
        ? `${partial}\n\nGénération annulée.`
        : "Génération annulée.";

      return;
    }

    messages.value[answerIndex].content += `\n\nErreur : ${err.message}`;
  } finally {
    await scrollToBottom();
  }
}

/**
 * Appelée par le parent lorsque l'importation du patch a échoué : les
 * erreurs sont renvoyées au modèle dans un nouveau message afin qu'il
 * corrige sa proposition. Limite : settings.maxCorrectionAttempts.
 */
async function requestCorrection(errors = []) {
  const details = errors.filter(Boolean);

  if (!details.length || !isModelLoaded.value || chatting.value) return;

  const maxAttempts = settings.maxCorrectionAttempts;

  if (correctionAttempts >= maxAttempts) {
    error.value = `Le patch n'a pas pu être importé après ${maxAttempts} tentative(s) de correction. Corrige-le manuellement ou reformule la demande.`;
    await scrollToBottom();
    return;
  }

  correctionAttempts += 1;

  const message = [
    "⚠️ Le patch que tu viens de proposer n'a pas pu être importé dans l'éditeur.",
    "",
    "Erreurs détectées :",
    ...details.map((detail) => `- ${String(detail).replace(/\n/g, "\n  ")}`),
    "",
    "Corrige le patch pour résoudre ces erreurs, puis renvoie le patch complet et valide au format JSON attendu.",
  ].join("\n");

  await askModel(message);
}

/** Réinitialise le compteur après un import réussi. */
function resetCorrectionAttempts() {
  correctionAttempts = 0;
}

defineExpose({ requestCorrection, resetCorrectionAttempts });

async function scrollToBottom() {
  await nextTick();

  if (chatContainer.value) {
    chatContainer.value.scrollTop = chatContainer.value.scrollHeight;
  }
}
</script>

<template>
  <section class="lm-chat">
    <header class="chat-header">
      <div class="chat-title-row">
        <h2>Chat LM Studio</h2>

        <button
          type="button"
          class="settings-toggle"
          :class="{ actif: settingsOpen }"
          aria-label="Configuration du chat"
          title="Configuration"
          @click="toggleSettings"
        >
          ⚙
        </button>
      </div>

      <div class="model-controls">
        <select
          v-model="selectedModel"
          :disabled="loading || chatting"
          aria-label="Choisir un modèle"
          @change="startNewConversation"
        >
          <option value="" disabled>Choisir un modèle</option>

          <option
            v-for="model in availableModels"
            :key="model.key"
            :value="model.key"
          >
            {{ model.display_name || model.key }}
          </option>
        </select>

        <button
          v-if="!isModelLoaded"
          type="button"
          :disabled="!selectedModel || loading"
          @click="handleLoadModel"
        >
          {{ loading ? "Chargement…" : "Charger" }}
        </button>

        <span v-else class="model-status"> Modèle chargé </span>
      </div>

      <p v-if="currentModel" class="model-info">
        {{ currentModel.key }}
      </p>

      <button
        type="button"
        class="new-chat-button"
        :disabled="chatting || loading"
        @click="startNewConversation"
      >
        Nouvelle conversation
      </button>
    </header>

    <section v-if="settingsOpen" class="settings-panel">
      <h3>Configuration</h3>

      <label class="settings-field">
        <span>URL de base (DEFAULT_BASE_URL)</span>
        <input
          v-model="settingsDraft.baseUrl"
          type="url"
          placeholder="http://127.0.0.1:1234"
          @input="settingsSaved = false"
        />
      </label>

      <label class="settings-field">
        <span>Modèle par défaut (DEFAULT_MODEL)</span>
        <input
          v-model="settingsDraft.defaultModel"
          type="text"
          list="lm-studio-models"
          placeholder="google/gemma-4-e4b"
          @input="settingsSaved = false"
        />
        <datalist id="lm-studio-models">
          <option
            v-for="model in availableModels"
            :key="model.key"
            :value="model.key"
          >
            {{ model.display_name || model.key }}
          </option>
        </datalist>
      </label>

      <label class="settings-field">
        <span>Tentatives de correction max (MAX_CORRECTION_ATTEMPTS)</span>
        <input
          v-model.number="settingsDraft.maxCorrectionAttempts"
          type="number"
          min="0"
          max="50"
          step="1"
          @input="settingsSaved = false"
        />
      </label>

      <label class="settings-field">
        <span>Taille du contexte (context_length)</span>
        <input
          v-model.number="settingsDraft.contextLength"
          type="number"
          min="1"
          step="1"
          @input="settingsSaved = false"
        />
      </label>

      <label class="settings-field">
        <span>Température (temperature)</span>
        <input
          v-model.number="settingsDraft.temperature"
          type="number"
          min="0"
          max="1"
          step="0.05"
          @input="settingsSaved = false"
        />
      </label>

      <label class="settings-field">
        <span>Max tokens (max_output_tokens)</span>
        <input
          v-model.number="settingsDraft.maxTokens"
          type="number"
          min="-1"
          step="1"
          @input="settingsSaved = false"
        />
        <small class="settings-field-hint">−1 = sans limite</small>
      </label>

      <div class="settings-actions">
        <button
          type="button"
          :disabled="chatting || loading"
          @click="saveSettings"
        >
          Enregistrer
        </button>

        <button
          type="button"
          class="secondary"
          @click="restoreDefaultSettings"
        >
          Valeurs par défaut
        </button>

        <button
          type="button"
          class="secondary"
          @click="settingsOpen = false"
        >
          Fermer
        </button>
      </div>

      <p v-if="settingsSaved" class="settings-saved">
        Configuration enregistrée dans le localStorage.
      </p>
      <p class="settings-hint">
        Modifie l'URL du serveur, le modèle proposé à l'ouverture, les
        corrections automatiques et les paramètres d'inférence. Une valeur
        « Max tokens » de −1 retire la limite de génération.
      </p>
    </section>

    <p v-if="error" class="error-message">
      {{ error }}
    </p>

    <div
      ref="chatContainer"
      class="chat-messages"
      aria-live="polite"
      aria-label="Conversation"
    >
      <div v-if="!messages.length" class="empty-chat">
        <template v-if="!isModelLoaded">
          Choisis un modèle et charge-le pour commencer.
        </template>
        <template v-else>
          Modèle prêt. Tu peux envoyer ton premier message !
        </template>
      </div>

      <div
        v-for="(message, index) in messages"
        :key="index"
        class="message-row"
        :class="message.role"
      >
        <div class="message">
          <div class="message-author">
            {{ message.role === "user" ? "Toi" : "Assistant" }}
          </div>

          <div class="message-content">
            {{
              message.content ||
              (chatting && index === messages.length - 1
                ? "Réflexion en cours…"
                : "")
            }}
          </div>
        </div>
      </div>
    </div>

    <form class="chat-input" @submit.prevent="sendMessage">
      <textarea
        v-model="input"
        placeholder="Écris ton message…"
        rows="2"
        :disabled="!isModelLoaded || chatting"
        @keydown.enter.exact.prevent="sendMessage"
      />

      <button
        v-if="chatting"
        type="button"
        class="cancel-button"
        aria-label="Annuler la génération"
        @click="cancelResponse"
      >
        Annuler
      </button>

      <button
        v-else
        type="submit"
        :disabled="!isModelLoaded || !input.trim()"
      >
        Envoyer
      </button>
    </form>
  </section>
</template>

<style scoped>
.lm-chat {
  display: flex;
  flex-direction: column;
  height: 650px;
  max-width: 850px;
  margin: 0 auto;
  overflow: hidden;
  border: 1px solid #d1d5db;
  border-radius: 12px;
  background: #fff;
  color: #1f2937;
  font-family: system-ui, sans-serif;
}

.chat-header {
  padding: 16px;
  border-bottom: 1px solid #e5e7eb;
}

.chat-header h2 {
  margin: 0 0 12px;
  font-size: 1.2rem;
}

.chat-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}

.chat-title-row h2 {
  margin: 0;
}

.settings-toggle {
  padding: 5px 10px;
  font-size: 1.15rem;
  line-height: 1;
  background: #4b5563;
}

.settings-toggle.actif {
  background: #00a884;
}

.settings-panel {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px 16px;
  max-height: 55%;
  overflow-y: auto;
  border-bottom: 1px solid #e5e7eb;
  background: #f3f4f6;
}

.settings-panel h3 {
  margin: 0;
  font-size: 1rem;
}

.settings-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 0.85rem;
  color: #374151;
}

.settings-field input {
  font: inherit;
  padding: 8px 10px;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  background: #fff;
  color: #1f2937;
}

.settings-field-hint {
  font-size: 0.75rem;
  color: #6b7280;
}

.settings-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.settings-actions .secondary {
  background: #6b7280;
}

.settings-saved {
  margin: 0;
  font-size: 0.8rem;
  color: #15803d;
}

.settings-hint {
  margin: 0;
  font-size: 0.75rem;
  color: #6b7280;
}

.model-controls {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

select,
button,
textarea,
input {
  font: inherit;
}

select {
  flex: 1;
  min-width: 180px;
  padding: 9px;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  background: white;
  color: inherit;
}

button {
  padding: 9px 14px;
  border: 0;
  border-radius: 6px;
  background: #2563eb;
  color: white;
  cursor: pointer;
}

button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.model-status {
  color: #15803d;
  font-size: 0.9rem;
}

.model-info {
  margin: 8px 0 0;
  color: #6b7280;
  font-size: 0.8rem;
}

.error-message {
  margin: 0;
  padding: 10px 16px;
  background: #fef2f2;
  color: #b91c1c;
  overflow-wrap: anywhere;
}

.chat-messages {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 16px;
  overflow-y: auto;
  padding: 20px;
  background: #f9fafb;
}

.empty-chat {
  margin: auto;
  color: #6b7280;
  text-align: center;
}

.message-row {
  display: flex;
  width: 100%;
}

.message-row.user {
  justify-content: flex-end;
}

.message-row.assistant {
  justify-content: flex-start;
}

.message {
  max-width: 85%;
  padding: 12px 14px;
  border-radius: 12px;
  overflow-wrap: anywhere;
}

.user .message {
  background: #dbeafe;
  border-bottom-right-radius: 3px;
}

.assistant .message {
  background: white;
  border: 1px solid #e5e7eb;
  border-bottom-left-radius: 3px;
}

.message-author {
  margin-bottom: 6px;
  font-size: 0.8rem;
  font-weight: 700;
}

.message-content {
  white-space: pre-wrap;
  line-height: 1.5;
}

.chat-input {
  display: flex;
  align-items: flex-end;
  gap: 10px;
  padding: 14px;
  border-top: 1px solid #e5e7eb;
}

.chat-input textarea {
  flex: 1;
  min-width: 0;
  resize: vertical;
  padding: 10px;
  border: 1px solid #d1d5db;
  border-radius: 8px;
  color: inherit;
  background: white;
}

.cancel-button {
  background: #dc2626;
}

.cancel-button:hover {
  background: #b91c1c;
}

@media (max-width: 500px) {
  .lm-chat {
    height: 80vh;
  }

  .chat-input {
    align-items: stretch;
    flex-direction: column;
  }

  .chat-input button {
    align-self: flex-end;
  }

  .new-chat-button {
    margin-top: 12px;
    background: #4b5563;
  }
}
</style>
