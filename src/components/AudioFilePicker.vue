<script setup>
import { ref } from "vue"
import { initSharedVoice, getSharedVoice } from "../composables/useSharedVoice"
import { setAudioBuffer } from "../composables/useAudioBufferCache"

const props = defineProps({
  value: {
    type: String,
    default: null,
  },
})

const emit = defineEmits(["update"])

const loading = ref(false)

const onFileSelected = async (e) => {
  const file = e.target.files[0]
  if (!file) return
  try {
    loading.value = true
    const args = await file.arrayBuffer()
    // garantit l'existence du contexte audio partagé (décodage + conv engine)
    await initSharedVoice()
    const ctx = getSharedVoice().getContext()
    const buffer = await ctx.decodeAudioData(args)
    // Clé stable = nom du fichier : les rebuilds du patch retrouveront le buffer.
    setAudioBuffer(file.name, buffer)
    emit("update", file.name)
  } catch (err) {
    console.error("Impossible de décoder le fichier audio :", err)
  } finally {
    loading.value = false
  }
}

const clear = () => {
  emit("update", null)
}
</script>

<template>
  <div class="audio-file-picker">
    <div v-if="value" class="file-row">
      <span class="file-name">{{ value }}</span>
      <button @click="clear">✕</button>
    </div>

    <input
      type="file"
      accept="audio/*"
      :disabled="loading"
      @change="onFileSelected"
    />
  </div>
</template>

<style scoped>
.audio-file-picker {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.file-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
}

.file-name {
  opacity: 0.8;
}
</style>
