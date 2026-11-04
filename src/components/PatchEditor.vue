<script setup>
import { ref, reactive, watch, onMounted, nextTick, toRaw } from "vue";
import ModulePaper from "./ModulePaper.vue";
import PatchManager from "./PatchManager.vue";
import ModulePropertyPanel from "./ModulePropertyPanel.vue";
import { useSuperModules } from "../composables/useSuperModules";
import Swal from "sweetalert2";
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
  // afficher l'option "Créer un super-module" dans le menu contextuel
  superExportEnabled: { type: Boolean, default: true },
  // types de modules à masquer (ex: note-driven au niveau SynthPatch)
  excludeTypes: { type: Array, default: () => [] },
  // catégories supplémentaires à masquer (ex: ["synth"] dans un Synth)
  excludeCategories: { type: Array, default: () => [] },
  // éditeur sous une modale : désactiver les raccourcis clavier du paper
  inactive: { type: Boolean, default: false },
  // remplir la hauteur du conteneur parent au lieu de 100vh - dock
  fill: { type: Boolean, default: false },
})
const patch = props.patch

const defPatch = ref(null)

const emit = defineEmits([
  "update:patch",
  "edit-synth",
  "load-synth",
  "load-super-synth",
  "save-super-synth",
])
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

/* Ajoute un module programmatiquement (ex: depuis la banque de synthés du
   SynthPatch). Le paper sélectionne le nouveau nœud, puis on applique les
   paramètres fournis par-dessus les valeurs par défaut du catalogue. */
const addModuleExternal = (type, params = {}, position = null) => {
  const id = paperRef.value?.addModule(
    type,
    position?.x ?? 120,
    position?.y ?? 120
  );
  if (!id) return null;

  const module = patch.modules.find((m) => m.id === id);
  if (module) {
    const merged = {
      ...JSON.parse(JSON.stringify(module.params ?? {})),
      ...JSON.parse(JSON.stringify(params ?? {})),
    };
    module.params = merged;
    paperRef.value?.setModuleParams(id, merged);
  }
  return id;
};

const setModuleLabelExternal = (id, label) => {
  const module = patch.modules.find((m) => m.id === id);
  if (module) module.label = label;
  paperRef.value?.setModuleLabel(id, label);
};

/* Force le panneau de propriétés à relire les params du module sélectionné
   (après un remplacement de définition, par ex. chargement d'un synthé). */
const refreshSelectedModule = async () => {
  const id = selectedModuleId.value;
  if (!id) return;
  selectedModuleId.value = null;
  await nextTick();
  selectedModuleId.value = id;
};

defineExpose({
  clearPatch,
  loadPatch: loadPatchExternal,
  addModule: addModuleExternal,
  setModuleLabel: setModuleLabelExternal,
  refreshSelectedModule,
});

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
 * CREER UN SUPER-MODULE A PARTIR DU PATCH COURANT
 *
 * Transforme le patch voice/main courant en super-module en
 * remplaçant les modules "input" par "super.in" et
 * "destination" par "super.out".
 * ========================================================= */
const { saveFromGraph } = useSuperModules()

function transformToSuperModule(patchData) {
  const modules = JSON.parse(JSON.stringify(patchData.modules))
  const connections = JSON.parse(JSON.stringify(patchData.connections))

  const inputModule = modules.find(m => m.type === "input")
  const destModule = modules.find(m => m.type === "destination")

  if (!inputModule && !destModule) {
    throw new Error(
      "Le patch ne contient pas de module Input ou Output. " +
      "Ajoutez un module de sortie (destination) avant de créer un super-module."
    )
  }

  // Remplacer destination → super.out
  if (destModule) {
    const superOutId = crypto.randomUUID()
    modules.push({
      id: superOutId,
      type: "super.out",
      label: "",
      params: { name: "out" },
      position: { ...destModule.position },
    })
    for (const c of connections) {
      if (c.to.id === destModule.id) c.to.id = superOutId
    }
    modules.splice(modules.findIndex(m => m.id === destModule.id), 1)
  }

  // Remplacer input → super.in
  if (inputModule) {
    const superInId = crypto.randomUUID()
    modules.push({
      id: superInId,
      type: "super.in",
      label: "",
      params: { name: "in" },
      position: { ...inputModule.position },
    })
    for (const c of connections) {
      if (c.from.id === inputModule.id) c.from.id = superInId
    }
    modules.splice(modules.findIndex(m => m.id === inputModule.id), 1)
  }

  // Nettoyer les connexions orphelines
  const validIds = new Set(modules.map(m => m.id))
  const cleaned = connections.filter(
    c => validIds.has(c.from.id) && validIds.has(c.to.id)
  )

  return { modules, connections: cleaned }
}

const handleRequestSuperModule = async (patchData) => {
  if (!patchData?.modules?.length) {
    Swal.fire({
      title: "Patch vide",
      text: "Ajoutez des modules avant de créer un super-module.",
      icon: "warning",
      confirmButtonText: "OK",
    })
    return
  }

  const { value: formValues, isConfirmed } = await Swal.fire({
    title: "Créer un super-module",
    html:
      '<input id="swal-super-name" class="swal2-input" placeholder="Nom du super-module" style="margin-bottom:8px" />' +
      '<div style="display:flex;align-items:center;justify-content:center;gap:8px">' +
        '<label style="font-size:14px">Couleur :</label>' +
        '<input id="swal-super-color" type="color" value="#8E44AD" style="width:50px;height:36px;border:none;cursor:pointer" />' +
      '</div>',
    focusConfirm: false,
    showCancelButton: true,
    confirmButtonText: "Créer",
    cancelButtonText: "Annuler",
    preConfirm: () => {
      const name = document.getElementById("swal-super-name").value.trim()
      const color = document.getElementById("swal-super-color").value
      if (!name) {
        Swal.showValidationMessage("Nom requis")
        return
      }
      return { name, color }
    },
  })

  if (!isConfirmed || !formValues) return

  try {
    const graph = transformToSuperModule(patchData)
    const def = saveFromGraph({
      name: formValues.name,
      color: formValues.color,
      graph,
    })
    Swal.fire({
      title: `"${def.label}" créé`,
      html:
        `Super-module enregistré avec ${def.inputs.length} entrée(s) et ${def.outputs.length} sortie(s).<br>` +
        `Vous pouvez maintenant l'ajouter via le menu contextuel.`,
      icon: "success",
      confirmButtonText: "OK",
    })
  } catch (e) {
    Swal.fire({
      title: "Erreur",
      text: e.message,
      icon: "error",
      confirmButtonText: "OK",
    })
  }
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
  <div
    class="d-flex flex-row overflow-hidden"
    :style="{ height: fill ? '100%' : 'calc(100vh - var(--dock-height, 0px))' }"
  >
    <!-- Main area -->
    <div class="d-flex flex-grow-1 min-w-0 overflow-hidden">
      <!-- Patch manager (left) -->
      <aside
        v-if="showPatchManager"
        class="flex-shrink-0 border-end bg-body-tertiary overflow-y-auto"
        :class="{ 'opacity-0 border-0 overflow-hidden': !managerOpen }"
        :style="{
          width: managerOpen ? '260px' : '0px',
          transition: 'width 0.25s ease, opacity 0.25s ease',
        }"
      >
        <PatchManager
          :paperRef="paperRef"
          :patch="patch"
          @patch-loaded="handlePatchLoaded"
        />
      </aside>

      <!-- Center column : le paper occupe l'espace restant -->
      <section class="d-flex flex-column flex-grow-1 min-w-0 min-h-0 overflow-hidden">
        <!-- Paper -->
        <ModulePaper
          ref="paperRef"
          class="flex-grow-1 overflow-hidden"
          :fill-height="paperFillHeight"
          :exclude-categories="[
            ...(allowInterfaceModules ? [] : ['interface']),
            ...excludeCategories,
          ]"
          :exclude-types="excludeTypes"
          :super-export-enabled="superExportEnabled"
          :inactive="inactive"
          @module-selected="handleModuleSelected"
          @module-removed="handleModuleRemoved"
          @connection-added="handleConnectionAdded"
          @connection-removed="handleConnectionRemoved"
          @module-added="handleModuleAdded"
          @module-moved="handleModuleMoved"
          @module-param-copied="handleParamCopied"
          @request-super-module="handleRequestSuperModule"
        />
      </section>
    </div>

    <!-- Properties (colonne dédiée : collée à droite, à côté du paper) -->
    <ModulePropertyPanel
      v-if="selectedModule()"
      class="flex-shrink-0 border-start bg-body-tertiary overflow-y-auto"
      style="width: 600px; max-width: 60%"
      :module="selectedModule()"
      @param-changed="handleParamChanged"
      @label-changed="handleLabelChanged"
      @edit-synth="(mod) => emit('edit-synth', mod)"
      @load-synth="(mod) => emit('load-synth', mod)"
      @load-super-synth="(mod) => emit('load-super-synth', mod)"
      @save-super-synth="(mod) => emit('save-super-synth', mod)"
    />
  </div>
</template>
