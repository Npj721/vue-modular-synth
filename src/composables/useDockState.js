import { ref } from "vue"

/* État partagé du dock du bas (AudioVisualizer / SynthKeyboard) : les boutons
 * de réduction/restauration vivent dans le PatchEditor, le dock dans App.vue. */
const showVisualizer = ref(true)
const showKeyboard = ref(true)

export function useDockState() {
  return { showVisualizer, showKeyboard }
}