// composables/useLmStudioSettings.js
//
// Configuration persistante du chat LM Studio : URL du serveur, modèle
// proposé par défaut et nombre maximal de corrections automatiques.
// Les valeurs sont conservées dans le localStorage et partagées par tous
// les composants qui utilisent ce composable.

import { reactive, watch } from "vue";
import { DEFAULT_BASE_URL, normalizeBaseUrl } from "./useLmStudioAPI.js";

const STORAGE_KEY = "modular-synth:lm-studio-settings";

export const DEFAULT_MODEL = "google/gemma-4-e4b";
export const DEFAULT_MAX_CORRECTION_ATTEMPTS = 15;

export const LM_STUDIO_DEFAULTS = Object.freeze({
  baseUrl: DEFAULT_BASE_URL,
  maxCorrectionAttempts: DEFAULT_MAX_CORRECTION_ATTEMPTS,
  defaultModel: DEFAULT_MODEL,
});

function sanitize(raw) {
  const source = raw && typeof raw === "object" ? raw : {};

  const attempts = Number.parseInt(source.maxCorrectionAttempts, 10);

  const baseUrl =
    typeof source.baseUrl === "string" && source.baseUrl.trim()
      ? normalizeBaseUrl(source.baseUrl)
      : LM_STUDIO_DEFAULTS.baseUrl;

  const defaultModel =
    typeof source.defaultModel === "string" && source.defaultModel.trim()
      ? source.defaultModel.trim()
      : LM_STUDIO_DEFAULTS.defaultModel;

  return {
    baseUrl,
    maxCorrectionAttempts: Number.isFinite(attempts)
      ? Math.max(0, attempts)
      : LM_STUDIO_DEFAULTS.maxCorrectionAttempts,
    defaultModel,
  };
}

function loadSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return sanitize(raw ? JSON.parse(raw) : null);
  } catch (err) {
    console.error("Impossible de lire la configuration LM Studio :", err);
    return { ...LM_STUDIO_DEFAULTS };
  }
}

const settings = reactive(loadSettings());

watch(
  settings,
  () => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...settings }));
    } catch (err) {
      console.error("Impossible d'enregistrer la configuration LM Studio :", err);
    }
  },
  { deep: true }
);

export function useLmStudioSettings() {
  /** Fusionne puis normalise de nouvelles valeurs (persistées aussitôt). */
  const updateSettings = (values = {}) => {
    Object.assign(settings, sanitize({ ...settings, ...values }));
  };

  /** Restaure les valeurs par défaut (persistées aussitôt). */
  const resetSettings = () => {
    Object.assign(settings, LM_STUDIO_DEFAULTS);
  };

  return {
    settings,
    defaults: LM_STUDIO_DEFAULTS,
    updateSettings,
    resetSettings,
  };
}
