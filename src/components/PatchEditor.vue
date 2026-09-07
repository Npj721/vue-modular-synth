<script setup>
import { ref, reactive, watch, onMounted, nextTick, toRaw } from "vue";
import ModuleToolbar from "./ModuleToolbar.vue";
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
 * TOOLBAR
 * ========================================================= */
const handleAddModule = (type) => {
  const id = paperRef.value.addModule(type, 150, 100);
};

/* =========================================================
 * MODULE SELECTION
 * ========================================================= */
const handleModuleSelected = (module) => {
  selectedModuleId.value = module.id;
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

defineExpose({ clearPatch });

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
};

const handleModuleAdded = ({ id, type, params, position }) => {
  patch.modules.push({
    id,
    type,
    params: params,
    position
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
    <!-- Toolbar -->
    <header class="editor-toolbar">
      <ModuleToolbar
        :exclude-categories="allowInterfaceModules ? [] : ['interface']"
        @add-module="handleAddModule"
      />
    </header>

    <!-- Main area -->
    <div class="editor-main" :class="{ 'no-manager': !showPatchManager }">
      <!-- Patch manager (left) -->
      <aside v-if="showPatchManager" class="editor-patch">
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
          @module-selected="handleModuleSelected"
          @module-removed="handleModuleRemoved"
          @connection-added="handleConnectionAdded"
          @connection-removed="handleConnectionRemoved"
          @module-added="handleModuleAdded"
          @module-moved="handleModuleMoved"
        />
      </section>

      <!-- Properties (colonne dédiée : ne peut pas écraser le paper) -->
      <ModulePropertyPanel
        v-if="selectedModule()"
        class="editor-properties"
        :module="selectedModule()"
        @param-changed="handleParamChanged"
        :style="'width:98.75%'"
      />
        <!-- <SynthKeyboard
          :patch="patch"
        /> -->

        
    </div>
  </div>
</template>

<style scoped>
  .editor-root {
    display: flex;
    flex-direction: column;
    height: calc(100vh - var(--dock-height, 0px));
    overflow: hidden;
  }

  /* =========================
  * TOOLBAR
  * ========================= */
  .editor-toolbar {
    flex: 0 0 auto;
    border-bottom: 1px solid #ccc;
    background: #f5f5f5;
    padding: 4px;
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
    transition: width 0.2s ease;
  }

  .editor-patch.collapsed {
    width: 0;
    padding: 0;
    border: none;
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
    width: 300px;
    max-width: 60%;
    border-left: 1px solid #ddd;
    background: #fafafa;
    max-height: 400px;
    overflow: auto;
  }
</style>