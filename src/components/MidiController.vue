<script setup>
import { computed } from "vue"
import { midiState, requestMidiAccess } from "../composables/useMidiBus"

/* =========================================================
 * Contrôleur MIDI global
 *
 * - Demande l'accès MIDI (une seule fois pour toute l'application)
 * - Affiche les appareils détectés
 *
 * Le routage des notes se fait désormais dans les modules "midi" du
 * SynthPatch : chaque module choisit son appareil et sa sortie Events est
 * câblée vers les synthés à piloter.
 * ========================================================= */

const statusText = computed(() => {
  if (!midiState.supported) return "MIDI non supporté par le navigateur"
  if (!midiState.requested) return "MIDI non activé"
  if (!midiState.devices.length) return "Aucun appareil MIDI détecté"
  return `${midiState.devices.length} appareil(s) MIDI détecté(s)`
})
</script>

<template>
  <div class="midi-controller">
    <div class="midi-controls">
      <button
        class="midi-btn request"
        :disabled="midiState.requested || !midiState.supported"
        @click="requestMidiAccess"
      >{{ midiState.requested ? "MIDI activé" : "Activer MIDI" }}</button>

      <span class="midi-status" :class="{ ok: midiState.devices.length > 0 }">
        {{ statusText }}
      </span>
    </div>

    <div v-if="midiState.error" class="midi-error">{{ midiState.error }}</div>
    <p v-else-if="!midiState.supported" class="midi-hint">
      Le Web MIDI API n'est pas disponible dans ce navigateur. Utilisez Chrome
      ou Edge.
    </p>
    <p v-else-if="!midiState.requested" class="midi-hint">
      Activez MIDI pour pouvoir jouer avec votre piano / clavier MIDI.
    </p>
    <ul v-else-if="midiState.devices.length" class="midi-devices">
      <li v-for="d in midiState.devices" :key="d.id">
        {{ d.name }}<span v-if="d.manufacturer"> ({{ d.manufacturer }})</span>
      </li>
    </ul>
    <p v-else class="midi-hint">
      Aucun appareil détecté. Branchez un clavier MIDI puis rouvrez ce panneau.
    </p>
  </div>
</template>

<style scoped>
.midi-controller {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px;
  border: 1px solid #ddd;
  border-radius: 6px;
  background: #fafafa;
  font-size: 13px;
}
.midi-controls {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}
.midi-btn {
  padding: 6px 14px;
  border: 1px solid #999;
  border-radius: 4px;
  cursor: pointer;
  background: #eee;
  color: #333;
  font-weight: bold;
}
.midi-btn:disabled {
  opacity: 0.6;
  cursor: default;
}
.midi-btn.request {
  background: #4d96ff;
  color: white;
  border-color: #2c7be5;
}
.midi-btn.request:disabled {
  background: #8bb8ff;
}
.midi-status {
  color: #888;
  font-size: 12px;
}
.midi-status.ok {
  color: #00a86b;
}
.midi-devices {
  margin: 0;
  padding-left: 18px;
  color: #555;
  font-size: 12px;
}
.midi-error {
  color: #c0392b;
  font-size: 12px;
}
.midi-hint {
  color: #888;
  font-size: 12px;
  margin: 0;
}
</style>
