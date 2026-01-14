<script setup>
const props = defineProps({
  value: {
    type: String,
    default: null,
  },
})

const emit = defineEmits(["update"])

const onFileSelected = (e) => {
  const file = e.target.files[0]
  if (!file) return

  // 👉 ici on stocke JUSTE une référence
  emit("update", file.name)
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
