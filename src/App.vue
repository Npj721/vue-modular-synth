<script setup>
  import { reactive, ref, watch, onMounted, onUnmounted } from "vue"
  import SynthPatchEditor from './components/SynthPatchEditor.vue'
  import SynthKeyboard from './components/SynthKeyboard.vue'
  import MultiTrackSequencer from './components/MultiTrackSequencer.vue'
  import AudioVisualizer from './components/AudioVisualizer.vue'
  import { useDockState } from './composables/useDockState'
  import { seedBaseSynths } from './composables/useBaseSynths'
  import { createDefaultSynthPatch } from './composables/useSynthPatch.js'
  import { setSharedPatch } from './composables/useSharedVoice.js'
  import {
    syncSequencers,
    stopAllSequencers,
  } from './composables/useSequencerEngine.js'
  import {
    initMidiEventSources,
    syncMidiEventSources,
    stopMidiEventSources,
  } from './composables/useMidiEventSources.js'
  const { showVisualizer, showKeyboard } = useDockState()

  // Un SynthPatch par défaut contient déjà un nœud Synth vide, relié à la
  // destination de la couche voice. L'utilisateur peut l'ouvrir et y charger
  // un synthé (ou en ajouter d'autres via le menu contextuel).
  const synthPatch = reactive(createDefaultSynthPatch())

  // Un seul écouteur MIDI pour toute l'application : les modules "midi" du
  // patch filtrent ensuite les notes par appareil.
  initMidiEventSources()

  /* Source de vérité du moteur partagé. Le watch doit vivre ici (et non dans
   * le séquenceur) : les câbles d'événements doivent être reconstruits même
   * quand le séquenceur est masqué ou retiré. */
  watch(
    synthPatch,
    () => {
      setSharedPatch(synthPatch)
      // Un module séquenceur supprimé ne doit pas continuer à tourner.
      syncSequencers(synthPatch)
      // Un module MIDI supprimé / changé d'appareil doit relâcher ses notes.
      syncMidiEventSources(synthPatch)
    },
    { deep: true, immediate: true }
  )

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

    /* Pré-installe les synthés de base (IndexedDB) au premier lancement. */
    seedBaseSynths().catch((e) => {
      console.error("seedBaseSynths :", e)
    })
  })

  onUnmounted(() => {
    if (dockObserver) dockObserver.disconnect()
    stopAllSequencers()
    stopMidiEventSources()
  })

</script>

<template>
  <div class="app min-vh-100" :style="{ '--dock-height': dockHeight + 'px' }">
    <div class="app-main min-vh-100" :style="{ paddingBottom: dockHeight + 'px' }">
      <SynthPatchEditor :patch="synthPatch" />
      <MultiTrackSequencer :patch="synthPatch" />
    </div>

    <div
      ref="dock"
      class="bottom-dock position-fixed bottom-0 start-0 end-0 z-3 d-flex flex-column bg-body-tertiary border-top shadow"
    >
      <AudioVisualizer v-show="showVisualizer" />
      <SynthKeyboard v-show="showKeyboard" :patch="synthPatch" />
    </div>
  </div>
</template>