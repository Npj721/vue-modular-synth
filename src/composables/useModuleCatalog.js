// composables/useModuleCatalog.js
import { reactive, readonly } from 'vue'

export function useModuleCatalog() {
  // Catalogue interne
  const catalog = reactive({
    osc: {
      label: 'Oscillator',
      color: '#FF7BE5',
      params: {
        freq: { type: 'number', min: 20, max: 20000, step: 1, default: 440 },
        type: { type: 'enum', values: ['sine', 'triangle', 'square', 'sawtooth'], default: 'sine' }
      },
      inputs: [],
      outputs: ['out']
    },
    gain: {
      label: 'Gain',
      color: '#2C7BE5',
      params: {
        gain: { type: 'number', min: 0, max: 1, step: 0.01, default: 0.5 }
      },
      inputs: ['in'],
      outputs: ['out']
    },
    filter: {
      label: 'Filter',
      color: '#FFC75F',
      params: {
        type: { type: 'enum', values: ['lowpass', 'highpass', 'bandpass'], default: 'lowpass' },
        freq: { type: 'number', min: 20, max: 20000, step: 1, default: 1000 },
        Q: { type: 'number', min: 0.0001, max: 100, step: 0.01, default: 1 }
      },
      inputs: ['in'],
      outputs: ['out']
    }
  })

  // Accès au catalogue complet
  const getCatalog = () => readonly(catalog)

  // Récupérer un module par son type
  const getModuleByType = (type) => catalog[type]

  // Récupérer tous les types disponibles
  const getModuleTypes = () => Object.keys(catalog)

  return { getCatalog, getModuleByType, getModuleTypes }
}
