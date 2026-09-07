<script setup>
import { ref, reactive } from "vue";
import PatchEditor from "./PatchEditor.vue";
import { useSuperModules } from "../composables/useSuperModules";

/* --------------------
 * Registry
 * -------------------- */
const { list, get, saveFromGraph, remove } = useSuperModules();

/* --------------------
 * État éditeur
 * -------------------- */
const editorRef = ref(null);
const editorKey = ref(0); // incrémente => remonte le PatchEditor

// graphe interne en cours d'édition (source de vérité du canvas)
const draft = reactive({ modules: [], connections: [] });

// contenu initial à dessiner au montage du PatchEditor
const initialPatch = ref(null);

// formulaire
const name = ref("");
const color = ref("#8E44AD");
const editingType = ref(null); // type existant lors d'une édition

// liste affichée
const defs = ref([]);
const refreshDefs = () => {
  defs.value = list().map((d) => ({ ...d }));
};
refreshDefs();

/* =========================================================
 * Actions
 * ========================================================= */

function resetForm() {
  name.value = "";
  color.value = "#8E44AD";
  editingType.value = null;
}

/** Nouveau super-module vierge */
function newSuper() {
  resetForm();
  initialPatch.value = null;
  draft.modules.splice(0, draft.modules.length);
  draft.connections.splice(0, draft.connections.length);
  editorKey.value++;
}

/** Charger un super-module existant pour l'éditer */
function editDef(def) {
  const full = get(def.type);
  if (!full) return;

  editingType.value = full.type;
  name.value = full.label;
  color.value = full.color;
  initialPatch.value = JSON.parse(JSON.stringify(full.graph));
  editorKey.value++;
}

/** Enregistrer (création ou mise à jour) */
function save() {
  try {
    const def = saveFromGraph({
      name: name.value,
      color: color.value,
      graph: JSON.parse(JSON.stringify(draft)),
      typeToUpdate: editingType.value,
    });

    editingType.value = def.type;

    const nbPorts = def.inputs.length + def.outputs.length;
    const nbParams = Object.keys(def.params).length;
    window.alert(
      `Super-module "${def.label}" enregistré.\n` +
        `Interface : ${def.inputs.length} entrée(s), ${def.outputs.length} sortie(s).\n` +
        `${nbParams} paramètre(s) exposé(s).`
    );

    refreshDefs();
  } catch (e) {
    window.alert(e.message);
  }
}

/** Enregistrer sous : crée une copie sous un nouveau type sans toucher l'original */
function saveAs() {
  try {
    const def = saveFromGraph({
      name: name.value,
      color: color.value,
      graph: JSON.parse(JSON.stringify(draft)),
      typeToUpdate: null,
    });

    // switch d'édition sur la nouvelle copie
    editingType.value = def.type;
    name.value = def.label;

    const nbPorts = def.inputs.length + def.outputs.length;
    const nbParams = Object.keys(def.params).length;
    window.alert(
      `Super-module "${def.label}" enregistré sous.\n` +
        `Interface : ${def.inputs.length} entrée(s), ${def.outputs.length} sortie(s).\n` +
        `${nbParams} paramètre(s) exposé(s).`
    );

    refreshDefs();
  } catch (e) {
    window.alert(e.message);
  }
}

/** Supprimer un super-module */
function deleteDef(def) {
  if (!window.confirm(`Supprimer le super-module "${def.label}" ?`)) return;

  remove(def.type);
  if (editingType.value === def.type) newSuper();
  refreshDefs();
}
</script>

<template>
  <div class="super-editor">
    <!-- Barre d'action -->
    <header class="super-header">
      <input
        v-model="name"
        placeholder="Nom du super-module (ex: supervoice)"
        class="super-name"
      />
      <input v-model="color" type="color" class="super-color" />
      <button class="btn primary" @click="save">Enregistrer</button>
      <button class="btn" @click="saveAs">Enregistrer sous</button>
      <button class="btn" @click="newSuper">Nouveau</button>

      <span class="hint">
        Placez des nœuds « Super In » / « Super Out » pour définir l'interface
        du module.
      </span>
    </header>

    <div class="super-main">
      <!-- Liste des super-modules -->
      <aside class="super-list">
        <h3>Super-modules</h3>

        <ul v-if="defs.length">
          <li
            v-for="d in defs"
            :key="d.type"
            :class="{ selected: d.type === editingType }"
            @click="editDef(d)"
          >
            <span class="dot" :style="{ background: d.color }"></span>
            <span class="label">{{ d.label }}</span>
            <button class="del" title="Supprimer" @click.stop="deleteDef(d)">
              X
            </button>
          </li>
        </ul>
        <p v-else class="empty">Aucun super-module enregistré.</p>

        <p v-if="editingType" class="meta">
          édition de : <code>{{ editingType }}</code>
        </p>
      </aside>

      <!-- Canvas interne -->
      <section class="super-canvas">
        <PatchEditor
          ref="editorRef"
          :key="editorKey"
          v-model:patch="draft"
          :show-patch-manager="false"
          :allow-interface-modules="true"
          :paper-fill-height="true"
          :initial-patch="initialPatch"
        />
      </section>
    </div>
  </div>
</template>

<style scoped>
.super-editor {
  display: flex;
  flex-direction: column;
  border: 1px solid #ddd;
  border-radius: 4px;
  overflow: hidden;
  /* même gabarit que les éditeurs Voice / Main (PatchEditor = 100vh moins le dock) */
  height: calc(100vh - var(--dock-height, 0px));
}

/* =========================
 * HEADER
 * ========================= */
.super-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px;
  background: #f0f4ff;
  border-bottom: 1px solid #ddd;
}

.super-name {
  width: 240px;
  padding: 6px 8px;
}

.super-color {
  width: 42px;
  height: 32px;
  padding: 2px;
  cursor: pointer;
}

.btn {
  padding: 6px 14px;
  border: 1px solid #bbb;
  background: white;
  border-radius: 4px;
  font-weight: bold;
  cursor: pointer;
}

.btn.primary {
  background: #7c4dff;
  border-color: #7c4dff;
  color: white;
}

.hint {
  font-size: 12px;
  color: #666;
  margin-left: auto;
}

/* =========================
 * MAIN
 * ========================= */
.super-main {
  flex: 1;
  display: grid;
  grid-template-columns: 220px 1fr;
  min-height: 0; /* permet au canvas de remplir sans déborder */
  overflow: hidden;
}

/* =========================
 * LISTE
 * ========================= */
.super-list {
  border-right: 1px solid #ddd;
  background: #fafafa;
  padding: 10px;
  overflow-y: auto;
  min-height: 0;
}

.super-list h3 {
  margin: 0 0 8px;
  font-size: 14px;
}

.super-list ul {
  list-style: none;
  padding: 0;
  margin: 0;
}

.super-list li {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px;
  border-radius: 4px;
  cursor: pointer;
}

.super-list li:hover {
  background: #eee;
}

.super-list li.selected {
  background: #e5dbff;
}

.dot {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  flex: 0 0 auto;
}

.label {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.del {
  border: none;
  background: transparent;
  color: #c0392b;
  font-weight: bold;
  cursor: pointer;
}

.empty,
.meta {
  font-size: 12px;
  color: #777;
}

.meta code {
  font-size: 11px;
}

/* =========================
 * CANVAS
 * ========================= */
.super-canvas {
  min-width: 0;
  min-height: 0;
  display: flex;
}

/* le PatchEditor imbriqué remplit la cellule (sous la barre d'action) */
.super-canvas :deep(.editor-root) {
  flex: 1;
  height: 100%;
  min-width: 0;
}

/* colonne centrale : paper extensible + panel de propriétés en dessous */
.super-canvas :deep(.editor-center) {
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.super-canvas :deep(.editor-main) {
  min-height: 0;
}
</style>
