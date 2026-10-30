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
| **WavetableS** | Table de wavetables parcourue par morphing (2 oscillateurs + crossfade equal-power), **en boucle** tant que la note est tenue ; release en fin de crossfade — le panneau affiche la table en **pseudo-3D** (point de fuite) avec la **frame en cours de lecture** surlignée | `frequency` (param), `detune` (param) | `out` (audio) | `detune`, `delay`, `morph` en ms (durée moyenne d'un crossfade entre 2 frames, défaut 200 ms), `endMode` (défaut `loop` = retour à la frame 0 en fin de liste, ou `pingpong` = va-et-vient), `progression` (répartition temporelle des frames dans un passage ; défaut `linear`, familles `sine`/`quad`/`cubic`/`quart`/`quint`/`expo`/`circ` en `-in`/`-out`/`-inout`, et `back`/`elastic`/`bounce` en `-in`/`-out`/`-inout` — les familles non monotones font dépasser/revenir l'index), `wave` (JSON `[ { real, imag }, … ]` jusqu'à 255 frames) |
| **FX / Sample** | Lecteur de fichier audio, transposé par la note (playbackRate = freq/440) | `frequency` (param), `detune` (param) | `out` (audio) | `buffer` (fichier audio), `detune` −1200…+1200 ct, `delay` 0…5 s, `loop` booléen, `start`/`end` en ms (plage de lecture réglable depuis la forme d'onde affichée dans le panneau) |
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
| **WaveShaper** | Distorsion / transfert arbitraire par courbe JS éditable dans le panneau (tanh par défaut) | `curve` (code JS, fonction `buildCurve(length)`), `drive` 0…10 (défaut 1, AudioParam modulable), `oversample` none/2x/4x |
| **Convolver** | Réverbérateur par convolution (impulse response) | `buffer` (fichier audio), `normalize` booléen |

#### Courbe du WaveShaper

Le paramètre `curve` est un code JavaScript éditable dans le panneau, compilé au chargement
du patch. Il doit définir une fonction `buildCurve(length = 8192)` qui retourne un
`Float32Array` (ou un tableau) d'au moins 2 valeurs, une par point de x = −1 à x = +1.
La courbe par défaut est la tanh normalisée ; n'importe quel transfert arbitraire est possible :

```js
function buildCurve(length = 8192) {
  const curve = new Float32Array(length)
  for (let i = 0; i < length; i++) {
    const x = (i / (length - 1)) * 2 - 1
    curve[i] = Math.sin(x * Math.PI / 2) // exemple : saturation douce
  }
  return curve
}
```

Le code est exécuté dans le contexte de la page : ne chargez que des patches de confiance.
En cas de code invalide, la courbe par défaut est utilisée. Les presets (`curve` + `drive` +
`oversample`) se sauvegardent, se chargent et se suppriment depuis le panneau (IndexedDB,
namespace `waveshaper-presets`).

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
| **Splitter** | Sépare un signal multicanal en 4 sorties mono (Ch 0–3) |
| **Merger** | Place 4 entrées mono sur 4 canaux distincts (ne mélange pas les sources) |

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

### Code

| Module | Description | Entrée | Sortie | Paramètres |
|---|---|---|---|---|
| **AudioWorklet** | Traitement DSP maison : le code du `AudioWorkletProcessor` s'écrit dans un `<textarea>` du panneau de propriétés, est compilé depuis cette chaîne de caractères et enveloppé dans un `AudioWorkletNode` | `in` (audio), `p1`…`p8` (params modulables) | `out` (audio) | `code` (source JS), `rate` a-rate/k-rate, `channels` 1/2, `options` (JSON), `p1`…`p8` −10…+10 |

#### Écrire le DSP

Le code s'écrit comme un `AudioWorklet` classique. Le nom passé à `registerProcessor` est
**ignoré** : le moteur masque cette fonction et enregistre à la place votre classe sous un nom unique
(Web Audio refuse d'enregistrer deux fois le même nom dans un contexte, et deux modules peuvent
utiliser le même nom lisible). N'importe quelle valeur fonctionne, y compris calculée :

```js
class Tremolo extends AudioWorkletProcessor {
  // `super(options)` n'est pas obligatoire pour p1..p8 (le moteur les déclare
  // via le getter statique parameterDescriptors), mais c'est la seule façon de
  // lire `options.processorOptions` — donc de la configuration du panneau.
  constructor(options) {
    super(options)
    this.rate = options.processorOptions?.params?.rate ?? 5
    this.phase = 0
  }
  process(inputs, outputs, parameters) {
    const inp = inputs[0] || []
    const out = outputs[0] || []
    const depth = awParam(parameters.p1, 0)
    this.phase += this.rate / sampleRate
    const g = 1 - depth * 0.5 * (1 - Math.cos(2 * Math.PI * this.phase))
    for (let ch = 0; ch < out.length; ch++) {
      const src = inp[ch] ?? inp[0]
      if (src) for (let i = 0; i < out[ch].length; i++) out[ch][i] = (src[i] || 0) * g
      else out[ch].fill(0)
    }
    return true
  }
}
registerProcessor("tremolo", Tremolo)
```

Le plus simple est de **ne pas déclarer de constructeur** : p1..p8 sont déclarés par le moteur
indépendamment de la forme du constructeur (et le constructeur implicite d'une classe dérivée
transmettant tout à `super()`, `options.processorOptions` reste lisible).

Disposez en plus du standard :

| Symbole | Rôle |
|---|---|
| `awParam(parameters.pN, i)` | lit un AudioParam quelle que soit la forme du tableau reçu : 128 valeurs s'il varie pendant le bloc, **une seule** s'il est constant (a-rate non modulé, ou k-rate). Évite le `NaN` qu'un `arr[i]` sur un tableau de longueur 1 provoquerait — helper injecté par le moteur |
| `p1`…`p8` | paramètres modulables : une enveloppe, un `gain`, une `constant` se câblent dessus comme sur n'importe quel autre module |
| `options.processorOptions` | contenu JSON du champ `options` du panneau (configuration statique : coefficients, mixages…) |

> **Le constructeur n'a plus d'importance pour `p1`…`p8`.** Les descripteurs sont déclarés par le
> préambule injecté, au plus profond de la chaîne d'héritage : `super(options)`, `super()` à vide,
> ou pas de constructeur du tout, tout fonctionne. `super(options)` reste la forme recommandée
> parce que c'est elle qui donne accès à `options.processorOptions` dans le constructeur.
>
> Si le worklet se plaint de paramètres absents alors que votre code est correct, c'est qu'il a été
> compilé par une version antérieure du moteur : un processor enregistré vit jusqu'à la fermeture
> de l'`AudioContext` et n'a aucun moyen d'être déchargé. Rechargez la page.

#### Plage de valeur de `p1`…`p8`

Un AudioParam est **borné par le navigateur** : tout ce qui sort de `[minValue, maxValue]` est
silencieusement ramené dans l'intervalle. La plage par défaut est `−10`…`+10`, ce qui suffit pour une
modulation additive (une enveloppe `0..1` se lit telle quelle) mais pas pour exprimer une
profondeur de bits, une fréquence en Hz ou une durée en ms.

Le champ `options` accepte une clé `ranges` pour redéfinir la plage de chaque paramètre :

```json
{ "params": {}, "ranges": { "p1": [1, 16], "p2": [100, 20000] } }
```

| Forme | Plage obtenue |
|---|---|
| `"p1": [1, 16]` | `1` … `16` |
| `"p1": 0.5` | `-0.5` … `+0.5` (raccourci symétrique) |
| absent | `−10` … `+10` |

Les plages sont figées dans le descripteur, donc dans le code compilé : **les modifier recompile le
worklet** (une fois, au prochain chargement du patch — pas à chaque frappe). Les champs `p1`…`p8`
du panneau suivent automatiquement la plage déclarée, et `ranges` n'est pas transmis au DSP
(uniquement votre clé `params` l'est, via `processorOptions`).

#### Quand le code est compilé

Le code est compilé au **chargement du patch**, jamais en cours de lecture : on écrit le code,
on enregistre, on rejoue. Un module du voice patch s'entend donc **à la note suivante** (le graphe
voix est reconstruit à chaque note) ; un module du main patch prend effet à la reconstruction du
main patch, c'est-à-dire au rechargement du patch ou à toute action qui le reconstruit — comme
n'importe quel autre paramètre.

#### Contraintes

- **Un seul fichier** : pas d'`import` ES dans le code (un `import` depuis une URL `blob:` n'est
  pas résolvable ici).
- **Pas de `console.log`** visible : aucun `console` dans le `AudioWorkletGlobalScope`.
- **CSP** : si l'hébergement impose une CSP, `script-src` doit autoriser `blob:` sinon
  `addModule()` est bloqué.
- **Le code s'exécute** : un patch `.json` importé d'une source tierce déclare et exécute un
  processor.
- **8 paramètres maximum** par module.
- **`rate` et `ranges` sont figés à la compilation** : ils sont écrits dans le blob, donc les changer
  recompile le code (a-rate et k-rate, ou deux jeux de plages, sont des processeurs distincts).
- Un code invalide (erreur de syntaxe, aucun `registerProcessor`) ou un navigateur sans AudioWorklet
  ne casse jamais le graphe : le module laisse passer le signal inchangé et l'avertissement va dans
  la console du navigateur.
- **`process()` qui renvoie `true` ne fuit pas** : le moteur signale explicitement l'arrêt à chaque
  worklet quand la voix est démontée (et à chaque reconstruction du main patch), ce qui fait
  renvoyer `false` au `process()` du module et permet au navigateur de récupérer le processor.
  Renvoyer `false` soi-même quand le module est au repos reste plus propre, mais n'est pas requis.

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

**Loop** : l'enveloppe répète les stages `press` indéfiniment. Une courte fenêtre d'automation (5 s) est planifiée au `noteOn`, puis **allongée au fur et à mesure** dans la timeline Web Audio — les évènements ne sont jamais réécrits, seulement ajoutés après le dernier, ce qui conserve la précision échantillon sans jamais laisser une automation de plusieurs minutes s'accumuler dans les AudioParam.

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
- Les raccourcis sont ignorés quand le focus est dans un champ de saisie (chat, code DSP, paramètres, JSON…) ou avec Ctrl/Alt/Meta.
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

Les définitions de super-modules sont enregistrées dans IndexedDB (base `modular-synth-store`, namespace `super-modules`).

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
- **Presets** : sauvegardés par type de module dans IndexedDB (namespace `envelope:<type>`).
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

| Stockage | Clé / Namespace | Contenu |
|---|---|---|
| `IndexedDB` | `modular-synth-store` → `patches:modular-synth-patches` | Synths complets (voicePatch + mainPatch) |
| `IndexedDB` | `modular-synth-store` → `patches:modular-patches` | Patches individuels (un seul graph) |
| `IndexedDB` | `modular-synth-store` → `super-modules` | Définitions de super-modules |
| `IndexedDB` | `modular-synth-store` → `envelope:<clé>` | Presets d'enveloppe par type de module |
| `IndexedDB` | `modular-synth-store` → `worklet-presets` | Presets AudioWorklet |
| `IndexedDB` | `modular-synth-store` → `waveshaper-presets` | Presets WaveShaper |
| `IndexedDB` | `modular-synth-audio` | Fichiers audio bruts (clés par nom) |
| Repli mémoire | — | Environnements sans IndexedDB (tests Node) |

> Les anciennes données `localStorage` (`modular-synth-patches`, `modular-patches`,
> `modular-super-modules`, `env:<type>`) sont migrées automatiquement vers
> IndexedDB au premier chargement puis supprimées de `localStorage`.

### Export / Import

- **Patch simple** : Export `.json` / Import `.json` (validation de structure).
- **Synth complet** : Export `.synth.json` / Import `.synth.json` (les deux voicePatch et mainPatch doivent être présents).
- **Super-modules** : Enregistrés automatiquement dans IndexedDB, exportables via le menu d'édition.

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
