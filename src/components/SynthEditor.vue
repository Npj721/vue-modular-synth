<script setup>
import { ref, reactive, watch } from "vue";
import ModuleToolbar from "./ModuleToolbar.vue";
import ModulePaper from "./ModulePaper.vue";
import PatchManager from "./PatchManager.vue";
import ModulePropertyPanel from "./ModulePropertyPanel.vue";

/* --------------------
 * Refs
 * -------------------- */
const paperRef = ref(null);

/* --------------------
 * Patch JSON (source de vérité)
 * -------------------- */
const patch = reactive({
  modules: [],
  connections: [],
});

const defPatch = ref(null)

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
    if (c.from.moduleId === module.id || c.to.moduleId === module.id) {
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
 * CONNECTIONS
 * ========================================================= */
const handleConnectionAdded = (conn) => {
  patch.connections.push(conn);
};

const handleConnectionRemoved = (conn) => {
  const idx = patch.connections.findIndex(
    (c) =>
      c.from.moduleId === conn.from.moduleId &&
      c.from.port === conn.from.port &&
      c.to.moduleId === conn.to.moduleId &&
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
  console.log('handleModuleAdded', {  id, type, params, position })

  patch.modules.push({
    id,
    type,
    params: params,
    position
  })
}

const handleModuleMoved = ({ id, position }) => {
  console.log('handleModuleMoved', { id, position })
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
  },
  { deep: true }
);
</script>

<template>
  <div class="editor-root">
    <!-- Toolbar -->
    <header class="editor-toolbar">
      <ModuleToolbar @add-module="handleAddModule" />
    </header>

    <!-- Main area -->
    <div class="editor-main">
      <!-- Patch manager (left) -->
      <aside class="editor-patch">
        <PatchManager
          :paperRef="paperRef"
          :patch="patch"
          @patch-loaded="handlePatchLoaded"
        />
      </aside>

      <!-- Center column -->
      <section class="editor-center">
        <!-- Paper -->
        <ModulePaper
          ref="paperRef"
          class="editor-paper"
          @module-selected="handleModuleSelected"
          @module-removed="handleModuleRemoved"
          @connection-added="handleConnectionAdded"
          @connection-removed="handleConnectionRemoved"
          @module-added="handleModuleAdded"
          @module-moved="handleModuleMoved"
        />

        <!-- Properties -->
        <ModulePropertyPanel
          v-if="selectedModule()"
          class="editor-properties"
          :module="selectedModule()"
          @param-changed="handleParamChanged"
          :style="'width:98.75%'"
        />
      </section>
    </div>
  </div>
</template>

<style scoped>
  .editor-root {
    display: flex;
    flex-direction: column;
    height: 100vh;
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
      1fr /* paper */
      auto; /* properties */
    overflow: hidden;
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
    border-left: 1px solid #ddd;
    background: #fafafa;
    max-height: 400px;
    overflow: auto;
  }
</style>