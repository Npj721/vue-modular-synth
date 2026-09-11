<script setup>
import { ref, reactive, watch, onMounted, nextTick, toRaw } from "vue";
import ModulePaper from "./ModulePaper.vue";
import PatchManager from "./PatchManager.vue";
import ModulePropertyPanel from "./ModulePropertyPanel.vue";
import SynthKeyboard from "./SynthKeyboard.vue";

/* --------------------
 * Refs
 * -------------------- */
const paperRef = ref(null);

/* --------------------
 * Patch JSON (source de vérité)
 * -------------------- */

const props = defineProps({
  patch: {
    type: Object,
    required: true
  },
  // masquer le patch manager (utilisé par l'éditeur de super-module)
  showPatchManager: { type: Boolean, default: true },
  // collapser le patch manager (animation) : voice/main uniquement
  managerOpen: { type: Boolean, default: false },
  // autoriser les nœuds d'interface Super In / Super Out
  allowInterfaceModules: { type: Boolean, default: false },
  // étirer le canvas sur la hauteur disponible
  paperFillHeight: { type: Boolean, default: false },
  // contenu initial à dessiner au montage (édition d'un super-module)
  initialPatch: { type: Object, default: null },
})
const patch = props.patch

const defPatch = ref(null)

const emit = defineEmits(["update:patch"])
/* --------------------
 * Sélection
 * -------------------- */
const selectedModuleId = ref(null);

/* =========================================================
 * MODULE SELECTION
 * ========================================================= */
const handleModuleSelected = (module) => {
  selectedModuleId.value = module ? module.id : null;
};

/* =========================================================
 * MODULE REMOVAL
 * ========================================================= */
const handleModuleRemoved = (module) => {
  // modules
  const mIdx = patch.modules.findIndex((m) => m.id === module.id);
  if (mIdx !== -1) patch.modules.splice(mIdx, 1);

  // connections (mutation, pas réassignation)
  for (let i = patch.connections.length - 1; i >= 0; i--) {
    const c = patch.connections[i];
    if (c.from.id === module.id || c.to.id === module.id) {
      patch.connections.splice(i, 1);
    }
  }

  if (selectedModuleId.value === module.id) {
    selectedModuleId.value = null;
  }
};

const handlePatchLoaded = (loadedPatch) => {
  // Reset modules et connexions existantes
  patch.modules.splice(0, patch.modules.length, ...loadedPatch.modules);
  patch.connections.splice(
    0,
    patch.connections.length,
    ...loadedPatch.connections
  );
  selectedModuleId.value = loadedPatch.modules[0]?.id || null;
};

/* =========================================================
 * CLEAR
 * ========================================================= */
const clearPatch = () => {
  paperRef.value?.clearGraph();
  patch.modules.splice(0, patch.modules.length);
  patch.connections.splice(0, patch.connections.length);
  selectedModuleId.value = null;
};

/* Charge un patch externe (redessin du paper + source de vérité).
   Utilisé par le Patch Manager du "synthé complet". */
const loadPatchExternal = (data) => {
  const clone = JSON.parse(JSON.stringify(toRaw(data) ?? {}));
  paperRef.value?.loadPatch(clone);
  patch.modules.splice(0, patch.modules.length, ...(clone.modules ?? []));
  patch.connections.splice(0, patch.connections.length, ...(clone.connections ?? []));
  selectedModuleId.value = null;
};

defineExpose({ clearPatch, loadPatch: loadPatchExternal });

/* =========================================================
 * CONNECTIONS
 * ========================================================= */
const handleConnectionAdded = (conn) => {
  patch.connections.push(conn);
};

const handleConnectionRemoved = (conn) => {
  const idx = patch.connections.findIndex(
    (c) =>
      c.from.id === conn.from.id &&
      c.from.port === conn.from.port &&
      c.to.id === conn.to.id &&
      c.to.port === conn.to.port
  );
  if (idx !== -1) patch.connections.splice(idx, 1);
};

/* =========================================================
 * MODULE PROPERTIES
 * ========================================================= */
const handleParamChanged = ({ key, value }) => {
  if (!selectedModuleId.value) return;

  const module = patch.modules.find((m) => m.id === selectedModuleId.value);
  if (!module) return;

  module.params[key] = value;
  // synchronise le wrapper du paper (source de vérité : la donnée patch,
  // pas l'objet interne du module dessiné à l'écran)
  paperRef.value?.setModuleParam(selectedModuleId.value, key, value);
};

const handleLabelChanged = (label) => {
  if (!selectedModuleId.value) return;

  const module = patch.modules.find((m) => m.id === selectedModuleId.value);
  if (!module) return;

  module.label = label;
  paperRef.value?.setModuleLabel(module.id, label);
};

/* Copie des paramètres d'un module vers un autre (drag du module sélectionné).
   La source de vérité est la donnée live du patch (patch.modules), et non
   l'objet interne du paper (qui peut être obsolète si les params ont été
   modifiés via le panneau). */
const handleParamCopied = ({ sourceId, targetId }) => {
  const source = patch.modules.find((m) => m.id === sourceId);
  const target = patch.modules.find((m) => m.id === targetId);
  if (!source || !target) return;

  const copied = JSON.parse(JSON.stringify(source.params));
  target.params = copied;
  paperRef.value?.setModuleParams(targetId, copied);
};

const handleModuleAdded = ({ id, type, params, position, label = "" }) => {
  patch.modules.push({
    id,
    type,
    params: params,
    position,
    label
  })
}

const handleModuleMoved = ({ id, position }) => {
  const m = patch.modules.find(m => m.id === id)
  if (!m) return
  m.position = { ...position }
}

/* =========================================================
 * Derived selected module (pour le panel)
 * ========================================================= */
const selectedModule = () =>
  patch.modules.find((m) => m.id === selectedModuleId.value) || null;

/* =========================================================
 * Debug
 * ========================================================= */
watch(
  patch,
  (newPatch) => {
    defPatch.value =  JSON.stringify(newPatch, null, 2)
    emit("update:patch", newPatch )
  },
  { deep: true }
);

/* =========================================================
 * Contenu initial (ex: édition d'un super-module existant)
 * ========================================================= */
onMounted(async () => {
  const initial = props.initialPatch;
  if (!initial?.modules?.length) return;

  await nextTick();

  // dessiner sur le paper (émet aussi module-added / connection-added)
  const clone = JSON.parse(JSON.stringify(toRaw(initial)));
  paperRef.value?.loadPatch(clone);

  // resynchroniser la source de vérité (remplace les push des events)
  patch.modules.splice(0, patch.modules.length, ...clone.modules);
  patch.connections.splice(0, patch.connections.length, ...clone.connections);
});
</script>

<template>
  <div class="editor-root">
    <!-- Main area -->
    <div class="editor-main" :class="{ 'no-manager': !showPatchManager }">
      <!-- Patch manager (left) -->
      <aside v-if="showPatchManager" class="editor-patch" :class="{ collapsed: !managerOpen }">
        <PatchManager
          :paperRef="paperRef"
          :patch="patch"
          @patch-loaded="handlePatchLoaded"
        />
      </aside>

      <!-- Center column : le paper occupe ici une hauteur fixe élevée,
           le panneau de propriétés est une colonne à part (droite) -->
      <section class="editor-center">
        <!-- Paper -->
        <ModulePaper
          ref="paperRef"
          class="editor-paper"
          :fill-height="paperFillHeight"
          :exclude-categories="allowInterfaceModules ? [] : ['interface']"
          @module-selected="handleModuleSelected"
          @module-removed="handleModuleRemoved"
          @connection-added="handleConnectionAdded"
          @connection-removed="handleConnectionRemoved"
          @module-added="handleModuleAdded"
          @module-moved="handleModuleMoved"
          @module-param-copied="handleParamCopied"
        />
      </section>
    </div>

    <!-- Properties (colonne dédiée : collée à droite, à côté du paper) -->
<ModulePropertyPanel
        v-if="selectedModule()"
        class="editor-properties"
        :module="selectedModule()"
        @param-changed="handleParamChanged"
        @label-changed="handleLabelChanged"
      />
  </div>
</template>

<style scoped>
  .editor-root {
    display: flex;
    flex-direction: row;
    height: calc(100vh - var(--dock-height, 0px));
    overflow: hidden;
  }

  /* =========================
  * MAIN GRID
  * ========================= */
  .editor-main {
    flex: 1;
    display: grid;
    grid-template-columns:
      auto /* patch manager */
      minmax(720px, 1fr) /* paper : jamais plus petit que 720px */
      auto; /* properties */
    overflow: hidden;
  }

  /* sans patch manager, le canvas prend toute la largeur
     (sinon il tombe dans la colonne "auto" et rétrécit) */
  .editor-main.no-manager {
    grid-template-columns: minmax(720px, 1fr) auto;
  }

  /* =========================
  * PATCH MANAGER
  * ========================= */
  .editor-patch {
    width: 260px;
    border-right: 1px solid #ddd;
    background: #fafafa;
    overflow-y: auto;
    transition: width 0.25s ease, opacity 0.25s ease;
  }

  .editor-patch.collapsed {
    width: 0;
    padding: 0;
    border: none;
    overflow: hidden;
    opacity: 0;
  }

  /* =========================
  * PAPER
  * ========================= */
  .editor-paper-wrapper {
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .editor-paper {
    flex: 1;
    background: #fff;
    overflow: hidden;
  }

  /* =========================
  * DEBUG
  * ========================= */
  .editor-debug {
    flex: 0 0 auto;
    padding: 6px 8px;
    font-size: 12px;
    border-top: 1px solid #ddd;
    background: #fafafa;
  }

  /* =========================
  * PROPERTIES
  * ========================= */
  .editor-properties {
    width: 600px;
    max-width: 60%;
    flex-shrink: 0;
    border-left: 1px solid #ddd;
    background: #fafafa;
    align-self: stretch;
    overflow-y: auto;
  }
</style>