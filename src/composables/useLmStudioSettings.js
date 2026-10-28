// composables/useLmStudioSettings.js
//
// Configuration persistante du chat LM Studio : URL du serveur, modèle
// proposé par défaut, corrections automatiques et paramètres d'inférence
// (contexte, température, tokens de sortie). Les valeurs sont conservées
// dans le localStorage et partagées par tous les composants qui utilisent
// ce composable.

import { reactive, watch } from "vue";
import { DEFAULT_BASE_URL, normalizeBaseUrl } from "./useLmStudioAPI.js";

const STORAGE_KEY = "modular-synth:lm-studio-settings";

export const DEFAULT_MODEL = "google/gemma-4-e4b";
export const DEFAULT_MAX_CORRECTION_ATTEMPTS = 15;
export const DEFAULT_CONTEXT_LENGTH = 32000;
export const DEFAULT_TEMPERATURE = 0.4;
// -1 signifie "aucune limite" : le champ n'est pas envoyé à l'API.
export const DEFAULT_MAX_TOKENS = -1;

export const LM_STUDIO_DEFAULTS = Object.freeze({
  baseUrl: DEFAULT_BASE_URL,
  maxCorrectionAttempts: DEFAULT_MAX_CORRECTION_ATTEMPTS,
  defaultModel: DEFAULT_MODEL,
  contextLength: DEFAULT_CONTEXT_LENGTH,
  temperature: DEFAULT_TEMPERATURE,
  maxTokens: DEFAULT_MAX_TOKENS,
});

function toInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toNumber(value, fallback) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function sanitize(raw) {
  const source = raw && typeof raw === "object" ? raw : {};

  const attempts = toInteger(
    source.maxCorrectionAttempts,
    LM_STUDIO_DEFAULTS.maxCorrectionAttempts,
  );
  const contextLength = toInteger(
    source.contextLength,
    LM_STUDIO_DEFAULTS.contextLength,
  );
  const temperature = toNumber(
    source.temperature,
    LM_STUDIO_DEFAULTS.temperature,
  );
  const maxTokens = toInteger(source.maxTokens, LM_STUDIO_DEFAULTS.maxTokens);

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
    maxCorrectionAttempts: Math.max(0, attempts),
    defaultModel,
    contextLength:
      contextLength > 0
        ? contextLength
        : LM_STUDIO_DEFAULTS.contextLength,
    // LM Studio attend une température dans l'intervalle [0, 1].
    temperature: Math.min(1, Math.max(0, temperature)),
    maxTokens:
      maxTokens === -1 || maxTokens > 0
        ? maxTokens
        : LM_STUDIO_DEFAULTS.maxTokens,
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
