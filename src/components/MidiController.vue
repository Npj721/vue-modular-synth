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
  <div class="d-flex flex-column gap-2 p-2 border rounded bg-body-tertiary small">
    <div class="d-flex flex-wrap gap-2 align-items-center">
      <button
        class="btn btn-sm fw-bold"
        :class="midiState.requested ? 'btn-outline-dark' : 'btn-primary'"
        :disabled="midiState.requested || !midiState.supported"
        @click="requestMidiAccess"
      >{{ midiState.requested ? "MIDI activé" : "Activer MIDI" }}</button>

      <span class="small" :class="midiState.devices.length > 0 ? 'text-success-emphasis' : 'text-body-secondary'">
        {{ statusText }}
      </span>
    </div>

    <div v-if="midiState.error" class="alert alert-danger py-1 px-2 small mb-0">{{ midiState.error }}</div>
    <p v-else-if="!midiState.supported" class="form-text mb-0">
      Le Web MIDI API n'est pas disponible dans ce navigateur. Utilisez Chrome
      ou Edge.
    </p>
    <p v-else-if="!midiState.requested" class="form-text mb-0">
      Activez MIDI pour pouvoir jouer avec votre piano / clavier MIDI.
    </p>
    <ul v-else-if="midiState.devices.length" class="mb-0 ps-3 small text-body-secondary">
      <li v-for="d in midiState.devices" :key="d.id">
        {{ d.name }}<span v-if="d.manufacturer"> ({{ d.manufacturer }})</span>
      </li>
    </ul>
    <p v-else class="form-text mb-0">
      Aucun appareil détecté. Branchez un clavier MIDI puis rouvrez ce panneau.
    </p>
  </div>
</template>
