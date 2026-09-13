# Vue Modular Synth

Synthétiseur modulaire basé sur le Web Audio API, construit avec Vue 3 et JointJS.  
Créez votre instrument en reliant visuellement des modules sonores, contrôlez-le au clavier ou en MIDI, et programmez des séquences multi-pistes.

---

## Sommaire

- [Architecture](#architecture)
- [Interface](#interface)
- [Catalogue de modules](#catalogue-de-modules)
- [Système de modulation](#système-de-modulation)
- [Format de patch](#format-de-patch)
- [Séquenceur multi-pistes](#séquenceur-multi-pistes)
- [Clavier et entrée MIDI](#clavier-et-entrée-midi)
- [Super-modules](#super-modules)
- [Visualiseur audio](#visualiseur-audio)
- [Éditeur d'enveloppes](#éditeur-denveloppes)
- [Gestion des fichiers audio](#gestion-des-fichiers-audio)
- [Persistance et stockage](#persistance-et-stockage)

---

## Architecture

Le moteur audio est entièrement basé sur le **Web Audio API** natif, sans aucune librairie DSP tierche.

Un patch complet est constitué de deux graphes :

```
┌─────────────────────────────────────────────────┐
│  mainPatch (monophonique, démarré une fois)     │
│                                                 │
│  input ──→ [effets, filtres, gain, pan…] ──→    │
│            → analyser → haut-parleurs           │
└─────────────────────────────────────────────────┘
        ↑
        │  (chaque note jouée envoie son signal ici)
        │
┌─────────────────────────────────────────────────┐
│  voicePatch (polyphonique, cloné par note)      │
│                                                 │
│  voice/fx ──→ gain ──→ enveloppe ──→            │
│       [osc, filtres, waveshaper…] ──→           │
└─────────────────────────────────────────────────┘
```

- **voicePatch** : graph cloné pour chaque note active. Les oscillateurs (`voice`) reçoivent la fréquence MIDI correspondante. Les enveloppes sont déclenchées à l'appui (`noteOn`) et relâchées à la fin (`noteOff`).
- **mainPatch** : graph unique, construit une seule fois. Les oscillateurs (`osc`) et sources `constant` démarreraont au premier `noteOn`. Tout audio qui atteint la sortie passe par un `AnalyserNode` permanent connecté aux haut-parleurs.
- **Un seul `AudioContext` partagé** : clavier, séquenceur et visualiseur utilisent le même moteur.
- Les boucles de rétroaction (feedback) sont possibles : tout sortie audio peut se reconnecter à toute entrée audio, y compris vers un nœud en amont.

---

## Interface

L'interface est organisée en **3 onglets** + une barre du bas :

| Onglet | Rôle |
|---|---|
| **Voice** | Édition du graph polyphonique (cloné par note) |
| **Main** | Édition du graph principal (effets globaux, stéréo, panning) |
| **Super Modules** | Création et édition de super-modules (macros) |

**Barre supérieure** : boutons pour chaque onglet, effacer le patch courant, ouvrir/fermer le gestionnaire de patches, le visualiseur spectrum et le clavier.

**Barre du bas** (dock fixe) :
- **Visualiseur audio** (oscilloscope, spectre, spectrogramme, détection de note)
- **Clavier synthétique** (5 octaves, jouable à la souris, multi-touch ou clavier AZERTY)

### Éditeur de graphe (canevas JointJS)

- **Ajout de modules** : palette de modules triés par catégorie (menu du haut ou clic droit).
- **Câblage** : tirer un fil depuis une sortie vers une entrée. La validité est vérifiée selon les types de ports (audio → audio, modulateur → modulable, etc.).
- **Sélection** : clic, Ctrl+clic multi-sélection, sélection par rectangle lasso.
- **Déplacement** : glisser un ou plusieurs modules (drag groupé).
- **Duplication** : Ctrl+D clone les modules sélectionnés + leurs connexions internes.
- **Copie de paramètres** : glisser un module sur un autre du même type copie les paramètres.
- **Suppression** : touche Delete (modules) ou clic droit sur une connexion.
- **Zoom** : 30% à 200% (Ctrl+molette ou boutons ±). **Pan** : Ctrl+glisser.

---

## Catalogue de modules

### Sources

| Module | Description | Ports d'entrée | Ports de sortie | Paramètres |
|---|---|---|---|---|
| **Voice** | Oscillateur piloté par note MIDI | `frequency` (param), `detune` (param) | `out` (audio) | `detune` −1200…+1200 ct (défaut 0), `delay` 0…5 s (défaut 0), `type` sine/triangle/square/sawtooth |
| **Wavetable** | Oscillateur piloté par note MIDI avec onde définie par une `PeriodicWave` | `frequency` (param), `detune` (param) | `out` (audio) | `detune` −1200…+1200 ct, `delay` 0…5 s, `wave` (JSON `{ real, imag, disableNormalization }`, défaut `disableNormalization: true`) |
| **FX / Sample** | Lecteur de fichier audio, transposé par la note (playbackRate = freq/440) | `frequency` (param), `detune` (param) | `out` (audio) | `buffer` (fichier audio), `detune` −1200…+1200 ct, `delay` 0…5 s, `loop` booléen |
| **Oscillator** | Oscillateur libre (LFO, audio rate…) — pas déclenché par note | `frequency` (param), `detune` (param) | `out` (audio) | `frequency` 0.01…20 000 Hz (défaut 4 Hz), `detune`, `delay`, `type` |

### Utilitaire

| Module | Description | Entrée | Sortie | Paramètres |
|---|---|---|---|---|
| **Gain** | Amplificateur / attenuateur | `in` (audio), `gain` (param modulable) | `out` (audio) | `gain` 0…1 (défaut 0.5) |

### Filtres (Biquad)

Tous les filtres exposent `frequency` (20…20 000 Hz, défaut 1 000) et `Q` (0.0001…100, défaut 1).

| Module | Type Biquad |
|---|---|
| **Lowpass** | `lowpass` |
| **Highpass** | `highpass` |
| **Bandpass** | `bandpass` |
| **Notch** | `notch` |
| **Peaking** | `peaking` (+ param `gain` −40…+40 dB, défaut 0) |
| **LowShelf** | `lowshelf` (+ param `gain`) |
| **HighShelf** | `highshelf` (+ param `gain`) |

### Dynamique

| Module | Description | Paramètres |
|---|---|---|
| **Compressor** | Compresseur dynamique | `threshold` −100…0 dB (défaut −24), `knee` 0…40 (défaut 30), `ratio` 1…20 (défaut 12), `attack` 0…1 s (défaut 0.003), `release` 0…1 s (défaut 0.25) |

### Effets

| Module | Description | Paramètres |
|---|---|---|
| **WaveShaper** | Distorsion (courbe tanh avec pré-gain modulable) | `drive` 0…10 (défaut 1, AudioParam modulable), `oversample` none/2x/4x |
| **Convolver** | Réverbérateur par convolution (impulse response) | `buffer` (fichier audio), `normalize` booléen |

### Spatial

| Module | Description | Paramètres |
|---|---|---|
| **Stereo Panner** | Pan stéréo simple | `pan` −1…+1 (défaut 0, modulable) |
| **Panner** | Panner 3D (HRTF, distance, cône) | `panningModel` equalpower/HRTF, `positionX/Y/Z` ±100, `orientationX/Y/Z`, `distanceModel`, `refDistance`, `maxDistance`, `rolloffFactor`, `coneInnerAngle`, `coneOuterAngle`, `coneOuterGain` |

### Temps

| Module | Description | Paramètres |
|---|---|---|
| **Delay** | Ligne de retard | `delayTime` 0…5 s (défaut 0.3, modulable) |

### Routage

| Module | Description |
|---|---|
| **Splitter** | Sépare un signal en 4 canaux (Ch 0–3) |
| **Merger** | Fusionne 4 canaux en un signal stéréo/mono |

### Contrôle

| Module | Description | Paramètres |
|---|---|---|
| **Envelope** | Générateur d'enveloppe (modulateur pur, aucun nœud audio) | `modulation` relative/replace, `stages` (press + release, courbes linéaire/exponentielle) |
| **Constant** | Source DC (offset constant modulable) | `value` −1000…+1000 (défaut 1, AudioParam modulable) |

### I/O

| Module | Rôle |
|---|---|
| **Input** | Point d'entrée global des voix dans le mainPatch (singleton) |
| **Destination** | Sortie vers l'analyser et les haut-parleurs (singleton) |

---

## Système de modulation

### Enveloppes

Chaque stage est `{ from, to, duration, curve }` :
- `from` peut être `"current"` (valeur en cours du paramètre) ou une valeur numérique.
- `curve` : `"linear"` ou `"exponential"` (les valeurs sont bornées à ≥ 0.0001).

**Modes de modulation :**
- **Relative** (défaut) : les valeurs du stage multiplient la valeur de base du paramètre cible.  
  Ex. : enveloppe 0→1 relative sur un gain de base 0.5 → le gain va de 0 à 0.5.
- **Replace** : les valeurs remplacent directement le paramètre (style CV).  
  Ex. : enveloppe 0→1 replace sur une fréquence de filtre → va de 0 Hz à 1 Hz.

**Loop** : l'enveloppe boucle les stages `press` indéfiniment (pré-schédule sur 180 secondes, précision Web Audio).

**Vélocité** : les valeurs `to` des stages press sont multipliées par la vélocité de la note.

### Modulation audio-rate (LFO, FM, AM)

Tout port modulable (`modulatable`) accepte une connexion audio directe :
- Un `osc` (LFO) connecté à `gain.gain` → **tremolo**
- Un `osc` connecté à `voice.frequency` → **FM**
- Un `osc` connecté à `filter_lowpass.frequency` → **wah**
- Un `constant` connecté à n'importe quel param → **offset CV**

### Modulation par enveloppe

Un `envelope` (modulateur pur) connecté à un paramètre modulable déclenche l'enveloppe à chaque `noteOn` et la relâche à chaque `noteOff`.

### Boucles de rétroaction

Les connexions arrière sont autorisées : une sortie audio peut se reconnecter à une entrée en amont. L'ordre de câblage est sans importance (construction en deux passes). Permet de créer :
- **Delay avec feedback** : `delay.out → gain → delay.in`
- **Self-oscillation de filtre** : `filter.out → gain → filter.frequency`
- **Comb filter** : `delay.out → gain → input`

### Délai des sources

Les modules `voice`, `osc` et `fx` possèdent un paramètre `delay` (0…5 s). L'oscillateur est démarré à `now + delay`. Le moteur propage le plus petit le long du chemin audio, de sorte que l'enveloppe reste synchronisée avec le son.

---

## Format de patch

### Patch complet (synth)

```json
{
  "version": 1,
  "name": "Mon synthé",
  "voicePatch": {
    "modules": [
      {
        "id": "uuid",
        "type": "voice",
        "params": { "detune": 0, "delay": 0, "type": "sawtooth" },
        "position": { "x": 30, "y": 40 }
      }
    ],
    "connections": [
      {
        "from": { "id": "uuid", "magnet": "circle", "port": "out:out" },
        "to":   { "id": "uuid", "magnet": "circle", "port": "in:in" }
      }
    ]
  },
  "mainPatch": {
    "modules": [ ... ],
    "connections": [ ... ]
  }
}
```

- Les IDs sont au format UUID 8-4-4-4-12 (hex).
- Les ports sont toujours au format `"group:portId"` (ex. `"out:out"`, `"in:gain"`, `"delayTime"`).
- Un `view` optionnel contient le zoom et la position du canvas.

### Format d'export

- **Patch simple** : `.json` (un seul graph, voice ou main).
- **Synth complet** : `.synth.json` (voicePatch + mainPatch).

---

## Séquenceur multi-pistes

Accessible sous l'éditeur de patch, le séquenceur est composé de :

- **Pistes** : ajout/suppression, chaque piston a son propre volume (GainNode dédié).
- **Pas** : 16 à 64 pas par boucle, note MIDI configurable par pas (0–127).
- **BPM** : 40 à 300, synchronisation de toutes les pistes sur une horloge commune.
- **Déclenchement** : chaque pas déclenche la voix correspondante via le partage du patch (shared voice). Durée de note = 80% de la durée d'un pas.

```
Piste 1 : [48] [ ] [ ] [60] [ ] [ ] [72] [ ] ...
Piste 2 : [36] [ ] [36] [ ] [36] [ ] [36] [ ] ...
           ↑ BPM commun, même pas
```

Chaque voix déclenchée possède une clé unique (`trackId:step:note`) pour permettre la superposition simultanée de plusieurs pistes.

---

## Clavier et entrée MIDI

### Clavier virtuel

- **5 octaves** (C4–B8), jouable à la souris (cliquer-glisser), multi-touch ou clavier AZERTY.
- Raccourcis clavier : `q a s z d f e g r h t j k y l u m i o p` (do dièse 4 → si dièse 6).
- Les notes actives sont mises en surbrillance ; les noms de notes et raccourcis sont affichés.

### MIDI (Web MIDI API)

- Détection automatique des périphériques MIDI.
- Connexion/déconnexion à la volée (hot-plug supporté).
- **Note On** (`0x90`) → déclenche la note (vélicité normalisée à 1.0).
- **Note Off** (`0x80`) ou Note On vélocité 0 → relâche.
- Les notes MIDI et le clavier virtuel partagent le même moteur audio.

> La gestion des CC (Control Change) n'est pas encore implémentée.

---

## Super-modules

Un super-module est un **macro-patch enregistré** qui se comporte comme un module natif du catalogue.

### Création

1. Construisez un sous-patch dans l'onglet Voice ou Main.
2. Clic droit → « Créer un super-module » → nom + couleur.
3. Le `input` du graph devient `super.in`, le `destination` devient `super.out`.
4. Les ports d'entrée/sortie exposés sont dérivés des noms des modules `super.in`/`super.out`.

### Paramètres exposés

Tous les paramètres des modules internes sont agrégés :
- Clé unique → port de paramètre unique (ex. `gain`, `detune`).
- Conflit → clé namespaced (ex. `filter.gain`, `filter.frequency`).
- Les valeurs par défaut sont capturées au moment de l'enregistrement.

### Comportement audio

- Le super-module est cloné à chaque instanciation (comme un module natif).
- Les paramètres exposés contrôlent directement les `AudioParam` internes.
- Les ports d'entrée exposés acceptent la modulation audio (gain de bordure modulable).
- Les super-modules peuvent être imbriqués (super dans super).

### Persistance

Les définitions de super-modules sont enregistrées dans `localStorage` sous la clé `modular-super-modules`.

---

## Visualiseur audio

Alimenté par l'`AnalyserNode` permanent (fftSize 2048, smoothing 0.8) :

| Vue | Description |
|---|---|
| **Oscilloscope** | Forme d'onde en temps réel (domaine temporel) |
| **Spectrogramme** | Barres de fréquences (1 024 bins, 0–20 kHz) |
| **Spectrogramme scrollant** | Carte chaleur fréquence-temps (noir → bleu → vert → jaune → rouge) |

### Détection de note jouée

- Autocorrélation normalisée (plage 40 Hz – 4 kHz).
- Seuil de voix : RMS > 0.004.
- Lissage médian sur 8 trames.
- Verrouillage de continuité ±1 octave pendant une note tenue.
- Interpolation parabolique sous-écran.
- Affiche le nom de la note et le décalage en cents (±).

---

## Éditeur d'enveloppes

L'éditeur graphique (`GraphEnvelopeEditor`) permet de dessiner visuellement les courbes d'enveloppe :

- **Ajout** de points : clic sur le canevas.
- **Déplacement** : glisser un point (tooltips avec t/v).
- **Suppression** : clic droit.
- **Courbes** : outils `line`, `scurve`, `arc`, `exp`, `log` — tracés interpolés par glisser.
- **Étirement** : boutons +/− pour ajuster la durée des stages (±100 ms en vue graphique, ±1 ms en vue tableau).
- **Plage min/max** éditable (persistée dans les données du stage).
- **Presets** : sauvegardés par type de module dans `localStorage` (clé `env:<type>`).
- **Loop** : case à cocher séparée pour activer la boucle continue.
- **Vue tableau** : édition numérique précise des stages (from, to, duration, courbe).

---

## Gestion des fichiers audio

Le module `AudioFilePicker` permet de charger des fichiers audio (`.mp3`, `.wav`, `.ogg`, etc.) :

- Décodage via l'`AudioContext` partagé.
- **Mise en cache mémoire** (`useAudioBufferCache`) pour un accès immédiat.
- **Persistance IndexedDB** (`modular-synth-audio`, store `files`) — les octets bruts sont stockés par nom de fichier.
- **Rechargement** depuis le stockage, **suppression** nettoyant le cache et IndexedDB.
- Les buffers sont restaurés automatiquement au chargement d'un patch (`hydratePatchBuffers`).

Utilisé par les modules **FX / Sample** et **Convolver**.

---

## Persistance et stockage

| Stockage | Clé | Contenu |
|---|---|---|
| `localStorage` | `modular-synth-patches` | Synths complets (voicePatch + mainPatch) |
| `localStorage` | `modular-patches` | Patches individuels (un seul graph) |
| `localStorage` | `modular-super-modules` | Définitions de super-modules |
| `localStorage` | `env:<type>` | Presets d'enveloppe par type de module |
| `IndexedDB` | `modular-synth-audio` | Fichiers audio bruts (clés par nom) |

### Export / Import

- **Patch simple** : Export `.json` / Import `.json` (validation de structure).
- **Synth complet** : Export `.synth.json` / Import `.synth.json` (les deux voicePatch et mainPatch doivent être présents).
- **Super-modules** : Enregistrés automatiquement dans le localStorage, exportables via le menu d'édition.

---

## Technologies

| Composant | Technologie |
|---|---|
| Framework | Vue 3.5 (`<script setup>` SFCs) |
| Build | Vite 7 |
| Canevas / diagrammes | JointJS 4.2 (`@joint/core`) |
| Audio | Web Audio API (natif) |
| MIDI | Web MIDI API |
| Dialogues | SweetAlert2 |
| Points | Point.js (courbes d'enveloppe) |
