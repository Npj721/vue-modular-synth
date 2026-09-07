<script setup>
  import { reactive, ref, onMounted, onUnmounted } from "vue"
  import SynthEditor from './components/SynthEditor.vue'
  import SynthKeyboard from './components/SynthKeyboard.vue'
  import MultiTrackSequencer from './components/MultiTrackSequencer.vue'
  import MidiController from './components/MidiController.vue'
  import AudioVisualizer from './components/AudioVisualizer.vue'
  const patch = reactive({})

  /* Barre du bas : analyzer + piano toujours visibles, empilés l'un sous
   * l'autre. Le dock est en position: fixed → on lui réserve la même hauteur
   * en bas du contenu pour ne pas masquer ce qui défile. */
  const dock = ref(null)
  const dockHeight = ref(0)
  let dockObserver = null

  onMounted(() => {
    dockObserver = new ResizeObserver(() => {
      dockHeight.value = dock.value ? dock.value.offsetHeight : 0
    })
    if (dock.value) dockObserver.observe(dock.value)
  })

  onUnmounted(() => {
    if (dockObserver) dockObserver.disconnect()
  })

</script>

<template>
  <div class="app" :style="{ '--dock-height': dockHeight + 'px' }">
    <div class="app-main" :style="{ paddingBottom: dockHeight + 'px' }">
      <SynthEditor v-model:patch="patch"/>
      <MidiController :patch="patch.value ? patch.value : patch" />
      <MultiTrackSequencer :patch="patch.value ? patch.value : patch" />
      <h1>patch</h1>
      <div>
        {{ patch }}
      </div>
    </div>

    <div class="bottom-dock" ref="dock">
      <AudioVisualizer />
      <SynthKeyboard :patch="patch.value ? patch.value : patch" />
    </div>
  </div>
</template>

<style scoped>
.app {
  min-height: 100vh;
}

.app-main {
  min-height: 100vh;
}

.bottom-dock {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 100;
  display: flex;
  flex-direction: column;
  background: #0b0f0d;
  border-top: 1px solid #1e3a30;
  box-shadow: 0 -4px 16px rgba(0, 0, 0, 0.45);
}
</style>