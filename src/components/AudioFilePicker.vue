<script setup>
import { ref, watch } from "vue"
import {
  initSharedVoice,
  getSharedVoice,
  ensureSharedPatchBuffer,
} from "../composables/useSharedVoice"
import { setAudioBuffer, getAudioBuffer } from "../composables/useAudioBufferCache"
import { saveAudioFileBytes, removeAudioFile } from "../composables/useAudioFileStore"

const props = defineProps({
  value: {
    type: String,
    default: null,
  },
})

const emit = defineEmits(["update"])

const loading = ref(false)
// empty | loading | loaded | missing
const status = ref(props.value ? "loading" : "empty")

/** Charge le buffer depuis le stockage (IndexedDB) pour la clé donnée. */
async function loadFromStorage(name) {
  if (!name) {
    status.value = "empty"
    return
  }
  status.value = "loading"
  try {
    await ensureSharedPatchBuffer(name)
    status.value = getAudioBuffer(name) ? "loaded" : "missing"
  } catch (err) {
    console.error("Échec du rechargement du fichier audio :", name, err)
    status.value = "missing"
  }
}

watch(
  () => props.value,
  (v) => {
    if (v) loadFromStorage(v)
    else status.value = "empty"
  },
  { immediate: true }
)

const onFileSelected = async (e) => {
  const file = e.target.files[0]
  if (!file) return
  try {
    loading.value = true
    const args = await file.arrayBuffer()
    // garantit l'existence du contexte audio partagé (décodage + conv engine)
    await initSharedVoice()
    const ctx = getSharedVoice().getContext()
    const buffer = await ctx.decodeAudioData(args.slice(0))
    // Clé stable = nom du fichier : les rebuilds du patch retrouveront le buffer.
    setAudioBuffer(file.name, buffer)
    // persiste les octets pour le rechargement (sauvegarde du patch)
    await saveAudioFileBytes(file.name, args)
    status.value = "loaded"
    emit("update", file.name)
  } catch (err) {
    console.error("Impossible de décoder le fichier audio :", err)
    status.value = "missing"
  } finally {
    loading.value = false
  }
}

const reload = () => loadFromStorage(props.value)

const clear = async () => {
  removeAudioFile(props.value).catch(() => {})
  status.value = "empty"
  emit("update", null)
}
</script>

<template>
  <div class="audio-file-picker d-flex flex-column gap-2">
    <div v-if="value" class="file-row d-flex align-items-center gap-2 small">
      <span
        class="file-name text-truncate"
        style="max-width: 160px"
        :title="value"
      >{{ value }}</span>
      <span
        class="file-status badge"
        :class="{
          'text-bg-success': status === 'loaded',
          'text-bg-warning': status === 'loading',
          'text-bg-danger': status === 'missing',
        }"
      >
        <template v-if="status === 'loading'">◌ chargement…</template>
        <template v-else-if="status === 'loaded'">● chargé</template>
        <template v-else-if="status === 'missing'">○ non retrouvé</template>
      </span>
      <button
        title="Recharger depuis le stockage"
        class="btn btn-sm btn-outline-dark py-0 px-1"
        @click="reload"
      >↻</button>
      <button
        title="Effacer"
        class="btn btn-sm btn-outline-danger py-0 px-1"
        @click="clear"
      >✕</button>
    </div>

    <input
      class="form-control form-control-sm"
      type="file"
      accept="audio/*"
      :disabled="loading"
      @change="onFileSelected"
    />
  </div>
</template>