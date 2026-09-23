// src/data/baseSynths.js
// Bibliothèque de synthés pré-installés. Ces presets sont ajoutés en
// IndexedDB au premier lancement (composables/useBaseSynths.js) afin que
// le visiteur dispose d'instruments prêts à l'emploi dès l'arrivée.
//
// Pour ajouter un synthé : pousser un objet « synth complet » dans le
// tableau ci-dessous, au format { version, name, voicePatch, mainPatch }
// (voire superModule / FX s'il dépend de ressources). Le seed est
// idempotent : un nom déjà présent n'est jamais écrasé.

export const baseSynths = [
  {
    "version": 1,
    "name": "basic",
    "voicePatch": {
      "modules": [
        {
          "id": "c5522702-69b2-405c-84b4-e5f7174e4279",
          "type": "voice",
          "params": {
            "detune": 0,
            "type": "sine",
            "delay": 0
          },
          "position": {
            "x": 50,
            "y": 20
          }
        },
        {
          "id": "531cfba3-6c76-4f66-abc7-6e23a6df1de5",
          "type": "gain",
          "params": {
            "gain": 0.5
          },
          "position": {
            "x": 230,
            "y": 20
          }
        },
        {
          "id": "27e0e276-79ce-4be0-8964-67e471fce04d",
          "type": "destination",
          "params": {},
          "position": {
            "x": 400,
            "y": 20
          }
        },
        {
          "id": "827f666e-5ebd-4fa6-a7c0-b78dc15ce765",
          "type": "envelope",
          "params": {
            "modulation": "relative",
            "stages": {
              "press": [
                { "from": 0, "to": 0.000973, "duration": 0.0001, "curve": "linear" },
                { "from": 0.000973, "to": 0.005099, "duration": 0.0001, "curve": "linear" },
                { "from": 0.005099, "to": 0.01014, "duration": 0.0001, "curve": "linear" },
                { "from": 0.01014, "to": 0.016296, "duration": 0.0001, "curve": "linear" },
                { "from": 0.016296, "to": 0.023816, "duration": 0.0001, "curve": "linear" },
                { "from": 0.023816, "to": 0.033, "duration": 0.0001, "curve": "linear" },
                { "from": 0.033, "to": 0.044218, "duration": 0.0001, "curve": "linear" },
                { "from": 0.044218, "to": 0.057919, "duration": 0.0001, "curve": "linear" },
                { "from": 0.057919, "to": 0.074654, "duration": 0.0001, "curve": "linear" },
                { "from": 0.074654, "to": 0.095094, "duration": 0.0001, "curve": "linear" },
                { "from": 0.095094, "to": 0.12006, "duration": 0.0001, "curve": "linear" },
                { "from": 0.12006, "to": 0.150552, "duration": 0.0001, "curve": "linear" },
                { "from": 0.150552, "to": 0.187797, "duration": 0.0001, "curve": "linear" },
                { "from": 0.187797, "to": 0.233287, "duration": 0.0001, "curve": "linear" },
                { "from": 0.233287, "to": 0.288849, "duration": 0.0001, "curve": "linear" },
                { "from": 0.288849, "to": 0.356712, "duration": 0.0001, "curve": "linear" },
                { "from": 0.356712, "to": 0.4396, "duration": 0.0001, "curve": "linear" },
                { "from": 0.4396, "to": 0.540841, "duration": 0.0001, "curve": "linear" },
                { "from": 0.540841, "to": 0.664496, "duration": 0.0001, "curve": "linear" },
                { "from": 0.664496, "to": 0.815528, "duration": 0.0001, "curve": "linear" },
                { "from": 0.815528, "to": 1, "duration": 0.0001, "curve": "linear" },
                { "from": 1, "to": 0.992949, "duration": 0.006013, "curve": "linear" },
                { "from": 0.992949, "to": 0.991302, "duration": 0.001479, "curve": "linear" },
                { "from": 0.991302, "to": 0.98929, "duration": 0.001479, "curve": "linear" },
                { "from": 0.98929, "to": 0.986833, "duration": 0.001479, "curve": "linear" },
                { "from": 0.986833, "to": 0.983832, "duration": 0.001479, "curve": "linear" },
                { "from": 0.983832, "to": 0.980166, "duration": 0.001479, "curve": "linear" },
                { "from": 0.980166, "to": 0.975689, "duration": 0.001479, "curve": "linear" },
                { "from": 0.975689, "to": 0.97022, "duration": 0.001479, "curve": "linear" },
                { "from": 0.97022, "to": 0.963541, "duration": 0.001479, "curve": "linear" },
                { "from": 0.963541, "to": 0.955383, "duration": 0.001479, "curve": "linear" },
                { "from": 0.955383, "to": 0.945419, "duration": 0.001479, "curve": "linear" },
                { "from": 0.945419, "to": 0.933248, "duration": 0.001479, "curve": "linear" },
                { "from": 0.933248, "to": 0.918383, "duration": 0.001479, "curve": "linear" },
                { "from": 0.918383, "to": 0.900227, "duration": 0.001479, "curve": "linear" },
                { "from": 0.900227, "to": 0.878051, "duration": 0.001479, "curve": "linear" },
                { "from": 0.878051, "to": 0.850965, "duration": 0.001479, "curve": "linear" },
                { "from": 0.850965, "to": 0.817882, "duration": 0.001479, "curve": "linear" },
                { "from": 0.817882, "to": 0.777475, "duration": 0.001479, "curve": "linear" },
                { "from": 0.777475, "to": 0.728121, "duration": 0.001479, "curve": "linear" },
                { "from": 0.728121, "to": 0.667841, "duration": 0.001479, "curve": "linear" },
                { "from": 0.667841, "to": 0.594213, "duration": 0.001479, "curve": "linear" },
                { "from": 0.594213, "to": 0.565038, "duration": 0.0001, "curve": "linear" },
                { "from": 0.565038, "to": 0.565841, "duration": 0.004032, "curve": "linear" },
                { "from": 0.565841, "to": 0.566822, "duration": 0.004032, "curve": "linear" },
                { "from": 0.566822, "to": 0.568021, "duration": 0.004032, "curve": "linear" },
                { "from": 0.568021, "to": 0.569485, "duration": 0.004032, "curve": "linear" },
                { "from": 0.569485, "to": 0.571273, "duration": 0.004032, "curve": "linear" },
                { "from": 0.571273, "to": 0.573457, "duration": 0.004032, "curve": "linear" },
                { "from": 0.573457, "to": 0.576125, "duration": 0.004032, "curve": "linear" },
                { "from": 0.576125, "to": 0.579383, "duration": 0.004032, "curve": "linear" },
                { "from": 0.579383, "to": 0.583363, "duration": 0.004032, "curve": "linear" },
                { "from": 0.583363, "to": 0.588223, "duration": 0.004032, "curve": "linear" },
                { "from": 0.588223, "to": 0.59416, "duration": 0.004032, "curve": "linear" },
                { "from": 0.59416, "to": 0.601411, "duration": 0.004032, "curve": "linear" },
                { "from": 0.601411, "to": 0.610268, "duration": 0.004032, "curve": "linear" },
                { "from": 0.610268, "to": 0.621086, "duration": 0.004032, "curve": "linear" },
                { "from": 0.621086, "to": 0.634298, "duration": 0.004032, "curve": "linear" },
                { "from": 0.634298, "to": 0.650436, "duration": 0.004032, "curve": "linear" },
                { "from": 0.650436, "to": 0.670147, "duration": 0.004032, "curve": "linear" },
                { "from": 0.670147, "to": 0.694222, "duration": 0.004032, "curve": "linear" },
                { "from": 0.694222, "to": 0.723627, "duration": 0.004032, "curve": "linear" },
                { "from": 0.723627, "to": 0.759543, "duration": 0.004032, "curve": "linear" },
                { "from": 0.759543, "to": 0.749818, "duration": 0.0001, "curve": "linear" },
                { "from": 0.749818, "to": 0.759543, "duration": 0.0001, "curve": "linear" },
                { "from": 0.759543, "to": 0.754867, "duration": 0.02332, "curve": "linear" },
                { "from": 0.754867, "to": 0.740956, "duration": 0.02332, "curve": "linear" },
                { "from": 0.740956, "to": 0.71815, "duration": 0.02332, "curve": "linear" },
                { "from": 0.71815, "to": 0.687013, "duration": 0.02332, "curve": "linear" },
                { "from": 0.687013, "to": 0.64831, "duration": 0.02332, "curve": "linear" },
                { "from": 0.64831, "to": 0.602996, "duration": 0.02332, "curve": "linear" },
                { "from": 0.602996, "to": 0.552184, "duration": 0.02332, "curve": "linear" },
                { "from": 0.552184, "to": 0.497127, "duration": 0.02332, "curve": "linear" },
                { "from": 0.497127, "to": 0.439181, "duration": 0.02332, "curve": "linear" },
                { "from": 0.439181, "to": 0.379771, "duration": 0.02332, "curve": "linear" },
                { "from": 0.379771, "to": 0.320362, "duration": 0.02332, "curve": "linear" },
                { "from": 0.320362, "to": 0.262416, "duration": 0.02332, "curve": "linear" },
                { "from": 0.262416, "to": 0.207359, "duration": 0.02332, "curve": "linear" },
                { "from": 0.207359, "to": 0.156547, "duration": 0.02332, "curve": "linear" },
                { "from": 0.156547, "to": 0.111232, "duration": 0.02332, "curve": "linear" },
                { "from": 0.111232, "to": 0.07253, "duration": 0.02332, "curve": "linear" },
                { "from": 0.07253, "to": 0.041393, "duration": 0.02332, "curve": "linear" },
                { "from": 0.041393, "to": 0.018587, "duration": 0.02332, "curve": "linear" },
                { "from": 0.018587, "to": 0.004676, "duration": 0.02332, "curve": "linear" },
                { "from": 0.004676, "to": 0, "duration": 0.02332, "curve": "linear" }
              ],
              "release": [
                { "from": "current", "to": 0, "duration": 0.15, "curve": "linear" }
              ],
              "min": 0,
              "max": 1,
              "loop": false
            }
          },
          "position": {
            "x": 230,
            "y": 90
          }
        }
      ],
      "connections": [
        {
          "from": { "id": "c5522702-69b2-405c-84b4-e5f7174e4279", "magnet": "circle", "port": "out:out" },
          "to": { "id": "531cfba3-6c76-4f66-abc7-6e23a6df1de5", "magnet": "circle", "port": "in:in" }
        },
        {
          "from": { "id": "531cfba3-6c76-4f66-abc7-6e23a6df1de5", "magnet": "circle", "port": "out:out" },
          "to": { "id": "27e0e276-79ce-4be0-8964-67e471fce04d", "magnet": "circle", "port": "in:in" }
        },
        {
          "from": { "id": "827f666e-5ebd-4fa6-a7c0-b78dc15ce765", "magnet": "circle", "port": "out:out" },
          "to": { "id": "531cfba3-6c76-4f66-abc7-6e23a6df1de5", "magnet": "circle", "port": "in:gain" }
        }
      ]
    },
    "mainPatch": {
      "modules": [
        {
          "id": "0051a11e-53de-4dc8-a4ab-dfd737f3d537",
          "type": "destination",
          "params": {},
          "position": {
            "x": 350,
            "y": 70
          }
        },
        {
          "id": "bce68758-fdef-4033-abdc-f44714ffecf9",
          "type": "input",
          "params": {},
          "position": {
            "x": 30,
            "y": 70
          }
        },
        {
          "id": "514bf08a-4bdd-4c2f-9a84-4c139ccd33e7",
          "type": "compressor",
          "params": {
            "threshold": -24,
            "knee": 30,
            "ratio": 12,
            "attack": 0.003,
            "release": 0.25
          },
          "position": {
            "x": 190,
            "y": 160
          }
        }
      ],
      "connections": [
        {
          "from": { "id": "bce68758-fdef-4033-abdc-f44714ffecf9", "magnet": "circle", "port": "out:out" },
          "to": { "id": "514bf08a-4bdd-4c2f-9a84-4c139ccd33e7", "magnet": "circle", "port": "in:in" }
        },
        {
          "from": { "id": "514bf08a-4bdd-4c2f-9a84-4c139ccd33e7", "magnet": "circle", "port": "out:out" },
          "to": { "id": "0051a11e-53de-4dc8-a4ab-dfd737f3d537", "magnet": "circle", "port": "in:in" }
        }
      ]
    }
  }
]