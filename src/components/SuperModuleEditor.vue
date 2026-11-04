<script setup>
import { ref, reactive, watch } from "vue";
import Swal from "sweetalert2";
import PatchEditor from "./PatchEditor.vue";
import { useSuperModules } from "../composables/useSuperModules";

/* --------------------
 * Registry
 * -------------------- */
const { list, get, saveFromGraph, remove, version } = useSuperModules();

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

// le registre peut changer hors de cet éditeur (ex: "Créer un super-module"
// via le menu contextuel d'un patch voice/main) → se rafraîchit.
watch(version, refreshDefs);

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
    Swal.fire({
      title: `Super-module "${def.label}" enregistré`,
      html:
        `Interface : ${def.inputs.length} entrée(s), ${def.outputs.length} sortie(s).<br>` +
        `${nbParams} paramètre(s) exposé(s).`,
      icon: "success",
      confirmButtonText: "OK",
    });

    refreshDefs();
  } catch (e) {
    Swal.fire({ title: "Erreur", text: e.message, icon: "error", confirmButtonText: "OK" });
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
    Swal.fire({
      title: `Super-module "${def.label}" enregistré sous`,
      html:
        `Interface : ${def.inputs.length} entrée(s), ${def.outputs.length} sortie(s).<br>` +
        `${nbParams} paramètre(s) exposé(s).`,
      icon: "success",
      confirmButtonText: "OK",
    });

    refreshDefs();
  } catch (e) {
    Swal.fire({ title: "Erreur", text: e.message, icon: "error", confirmButtonText: "OK" });
  }
}

/** Supprimer un super-module */
async function deleteDef(def) {
  const res = await Swal.fire({
    title: `Supprimer le super-module "${def.label}" ?`,
    icon: "warning",
    showCancelButton: true,
    confirmButtonText: "Supprimer",
    cancelButtonText: "Annuler",
    confirmButtonColor: "#d33",
  });
  if (!res.isConfirmed) return;

  remove(def.type);
  if (editingType.value === def.type) newSuper();
  refreshDefs();
}
</script>

<template>
  <div
    class="d-flex flex-column border rounded overflow-hidden"
    style="height: calc(100vh - var(--dock-height, 0px))"
  >
    <!-- Barre d'action -->
    <header class="d-flex align-items-center flex-wrap gap-2 p-2 bg-body-tertiary border-bottom">
      <input
        v-model="name"
        placeholder="Nom du super-module (ex: supervoice)"
        class="form-control form-control-sm"
        style="width: 240px"
      />
      <input
        v-model="color"
        type="color"
        class="form-control form-control-color form-control-sm"
        style="width: 48px"
      />
      <button class="btn btn-sm btn-primary" @click="save">Enregistrer</button>
      <button class="btn btn-sm btn-outline-dark" @click="saveAs">Enregistrer sous</button>
      <button class="btn btn-sm btn-outline-dark" @click="newSuper">Nouveau</button>

      <span class="small text-body-secondary ms-auto">
        Placez des nœuds « Super In » / « Super Out » pour définir l'interface
        du module.
      </span>
    </header>

    <div class="d-flex flex-grow-1 min-h-0 overflow-hidden">
      <!-- Liste des super-modules -->
      <aside
        class="flex-shrink-0 border-end bg-body-tertiary p-3 overflow-y-auto"
        style="width: 220px"
      >
        <h3 class="h6 mb-2">Super-modules</h3>

        <ul v-if="defs.length" class="list-group list-group-flush mb-2">
          <li
            v-for="d in defs"
            :key="d.type"
            class="list-group-item d-flex align-items-center gap-2 px-2 py-1"
            :class="{ active: d.type === editingType }"
            style="cursor: pointer"
            @click="editDef(d)"
          >
            <span
              class="d-inline-block rounded-circle flex-shrink-0"
              :style="{ width: '12px', height: '12px', background: d.color }"
            ></span>
            <span class="flex-grow-1 text-truncate">{{ d.label }}</span>
            <button
              class="btn btn-sm btn-link text-danger-emphasis p-0 border-0"
              title="Supprimer"
              @click.stop="deleteDef(d)"
            >
              X
            </button>
          </li>
        </ul>
        <p v-else class="small text-body-secondary mb-2">Aucun super-module enregistré.</p>

        <p v-if="editingType" class="small text-body-secondary mb-0">
          édition de : <code>{{ editingType }}</code>
        </p>
      </aside>

      <!-- Canvas interne -->
      <section class="d-flex flex-grow-1 min-w-0 min-h-0 overflow-hidden">
        <PatchEditor
          ref="editorRef"
          :key="editorKey"
          v-model:patch="draft"
          :show-patch-manager="false"
          :allow-interface-modules="true"
          :paper-fill-height="true"
          :initial-patch="initialPatch"
          :super-export-enabled="false"
          :exclude-categories="['event']"
          class="flex-grow-1 min-w-0"
          fill
        />
      </section>
    </div>
  </div>
</template>
