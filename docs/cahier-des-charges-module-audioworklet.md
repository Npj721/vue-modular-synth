# Cahier des charges — Module « AudioWorklet »

> Portée : v1 · Langue cible : documentation FR, code aux conventions de l'existant

---

## 1. Résumé

Ajouter un nouveau type de module au synthé modulaire : **`audioworklet`**. Ce module encapsule
un `AudioWorkletNode` dont le code DSP est **écrit dans un `<textarea>` du panneau de propriétés**,
puis **compilé depuis une chaîne de caractères** au moment de la construction du graphe.

Le source est transformé en `Blob` (`application/javascript`), puis injecté via
`ctx.audioWorklet.addModule(blobURL)`. Un prélude injecté masque `registerProcessor()` pour
enregistrer la classe de l'utilisateur sous un nom unique dérivé d'un hash du code (le nom écrit
par l'utilisateur est ignoré), et y déclarer les descripteurs `p1..p8`.

**Hors périmètre : le changement de code pendant la lecture.** On n'édite pas un worklet en
jouant. Le code écrit dans le textarea est pris en compte **à la prochaine reconstruction du
graphe** (voir §6.3), exactement comme n'importe quel autre paramètre du main patch.

Ports : **`in` (audio) + `p1..p8` (AudioParam modulables) → `out` (audio)**.

---

## 2. Contexte et points d'accroche dans l'existant

L'architecture n'a **pas** de classe de base de module. Un type de module = 4 choses :

| Étape | Fichier | Emplacement |
|---|---|---|
| Descripteur (ports, params, couleur) | `src/composables/useModuleCatalog.js` | littéral `catalog` (l. 10–931) |
| Instanciation Web Audio | `src/composables/usePatchVoice.js` | `switch (mod.type)` dans `instantiateModule` (l. 914–1281) |
| Éditeur de paramètres | `src/components/ModulePropertyPanel.vue` | rendu générique par `def.type` (l. 645–742) |
| Doc | `README.md` | tableau des modules (l. 85–165) |

Faits structurants à respecter :

- `instantiateModule()` est **synchrone** (l. 914) et appelé par `buildGraph()` en passe 1
  (l. 1554–1558). `audioWorklet.addModule()` est **asynchrone** ⇒ il faut une étape de
  pré-compilation *avant* la construction.
- `wireConnection()` (l. 1389–1490) route : port `in` → `entry.inputNode ?? entry.node` ;
  tout autre port d'entrée → `entry.params[port]` (un `AudioParam`). C'est exactement ce qu'il faut
  pour `p1..p8`.
- **Le graphe est déjà reconstruit automatiquement quand un paramètre change** :
  `StepSequencer.vue:105-114` observe `props.patch` en `deep` et appelle
  `stopAll()` + `rebuildMainPatch()`. Le textarea se comporte donc comme les autres champs.
- Les voix sont construites à **chaque note** dans `createVoice()` (l. 1699), appelé par
  `noteOn()` **après** `await init()` (l. 1772). Une compilation faite dans `init()` est donc
  toujours disponible avant la construction de la voix.
- Une seule URL de travail = un seul `AudioContext` partagé (`useSharedVoice.js`) ⇒ le registre de
  processeurs peut être un singleton au niveau module.
- `rebuildMainPatch()` (l. 1652) est synchrone et appelé depuis 3 endroits, **tous déjà dans un
  contexte async** (`useSharedVoice.js:78` et `:104`, `StepSequencer.vue:111`) ⇒ le rendre async
  ne casse aucun appelant.
- Aucun script de lint / typecheck / test dans `package.json` (seuls `dev`/`build`/`preview`).
  Les tests sont des smoke tests Node lancés à la main : `scripts/smoke-*.mjs`.

---

## 3. Objectifs / Non-objectifs

### Objectifs

1. Un module `audioworklet` ajoutable au **voice patch** et au **main patch** (menu contextuel).
2. Un `<textarea>` dans le panneau de propriétés pour écrire le code du processor.
3. Le code est compilé depuis une chaîne (blob + `addModule`) et **persisté** dans le `.json` du
   patch, sans changement de format d'export/import.
4. 8 paramètres **modulables** par le graphe (AudioParams) + un bloc de configuration libre passé
   au constructeur du processor.
5. Le module **ne peut jamais casser le graphe ni couper le son** (repli pass-through).

### Non-objectifs

- **Rechargement à chaud / édition pendant la lecture.** Aucun hot-swap, aucune reconstruction
  ciblée, aucun debounce de compilation côté moteur. Le code change, on relit / on rejoue.
- Affichage des erreurs de compilation dans le panneau (§11, option).
- `MessagePort` / VU-mètre du worklet vers l'UI.
- `import` ES dans le code du worklet (§8).
- AudioWorklet dans un super-module (§8, limite 3).
- Sandboxing du code utilisateur (synthé local, l'utilisateur écrit son propre DSP).

---

## 4. Parcours utilisateur

1. Clic droit sur le paper → catégorie **« Code »** → **« AudioWorklet »**.
2. Le module apparaît, câblable `in → out`, avec un processor passthrough par défaut dans le textarea.
3. L'utilisateur écrit son DSP, par exemple :

   ```js
   class Tremolo extends AudioWorkletProcessor {
     constructor(options) {
        super()   // les p1..p8 sont poses par le preambule, cf. section 5.4

       this.rate = options.processorOptions?.params?.rate ?? 5
       this.phase = 0
     }
     process(inputs, outputs, parameters) {
       const inp = inputs[0] || []
       const out = outputs[0] || []
       const depth = awParam(parameters.p1, 0)   // helper injecté
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

4. Il enregistre le patch (ou le recharge) → le code est compilé, le module joue.
5. Dans le **voice patch**, une nouvelle version du code s'entend **à la note suivante** : c'est le
   cas d'usage principal, et il est gratuit.
6. Il branche un `gain` ou une enveloppe sur `p1` pour le moduler.

---

## 5. Spécification fonctionnelle

### 5.1 Descripteur catalogue

```js
audioworklet: {
  label: "AudioWorklet",
  color: "#E8A33D",
  category: "code",        // nouvelle catégorie
  singleton: false,

  ports: {
    inputs: [
      { id: "in", label: "In", kind: "audio", role: "audioIn", multiple: true },
      ...paramPorts(["p1","p2","p3","p4","p5","p6","p7","p8"]),  // kind:"param", role:"modulatable", rate:"a-rate"
    ],
    outputs: [
      { id: "out", label: "Out", kind: "audio", role: "modulator", multiple: true },
    ],
  },

  params: {
    code:     { type: "code", default: DEFAULT_WORKLET_CODE, rows: 18 },
    rate:     { type: "enum", values: ["a-rate", "k-rate"], default: "a-rate" },
    channels: { type: "enum", values: [1, 2], default: 1 },
    options:  { type: "json", default: "{\"params\":{}}" },
    p1: num(-10, 10, 0.001, 0),
    ... p8,
  },
}
```

À valider : **8 ports de modulation** (`p1..p8`) et la plage **−10..10** (§10, D1/D2).

### 5.2 Nouveau descripteur de paramètre : `code`

| `type` | Rendu dans `ModulePropertyPanel.vue` |
|---|---|
| `code` | `<textarea>` inline, monospace, `spellcheck=false`, `rows` depuis le descripteur. **Volontairement inline** (contrairement au `json` qui passe par une modale) : quelques dizaines de lignes de code ne gênent pas le rendu, là où une table de 500 000 lignes rend l'UI inutilisable. |
| `json` (existant) | Inchangé. |

**Debounce decommit.** Le textarea travaille sur un **draft local** et ne commite vers
`param-changed` qu'après **500 ms d'inactivité** (commit immédiat sur `blur` et `Ctrl+Entrée`).
Ce n'est pas du "live" : c'est le même mécanisme que la validation JSON différée déjà en place
(`scheduleJsonValidation`, l. 30-38), et ça évite qu'un `addModule` + un `rebuildMainPatch` parte
à chaque frappe.

### 5.3 Contrat du code injecté

Le source écrit par l'utilisateur **n'est jamais exécuté tel quel**. Le moteur construit :

```
PRELUDE  +  <code utilisateur>  +  EPILOGUE
```

**PRELUDE** (avant le code utilisateur) :

```js
const awParam = (v, i = 0) =>
  ArrayBuffer.isView(v) ? (v.length > 1 ? v[i] : v[0]) : v;
```

Dans `process()`, un AudioParam est **toujours** un `Float32Array`, jamais un `Number`. Sa longueur
vaut **1 ou 128** : 128 si le paramètre varie pendant le quantum de rendu, 1 s'il est constant sur
tout le bloc. Le cas « longueur 1 » n'est pas réservé au `k-rate` : un paramètre `a-rate` **non
modulé**, ou modulé plus lentement qu'un bloc (128 samples ≈ 2,7 ms — un LFO à 4 Hz tombe la plupart
du temps dans ce cas), est servi comme un tableau d'une seule valeur. Lire `arr[i]` sans tester la
longueur renvoie donc `undefined` pour i > 0, puis `NaN` dans le DSP (silence/gling), sans la moindre
erreur. `awParam(arr, i)` renvoie `arr[0]` quand le tableau est constant et `arr[i]` sinon :
l'utilisateur n'écrit aucune branche.

> On lit la map via le **3ᵉ argument de `process()`**, jamais via le global `parameters` (qui n'est
> pas exposé → `ReferenceError`) ni `this.parameters` (non fiable selon les navigateurs → `undefined`).

**Masquage de `registerProcessor` (et non réécriture).** `registerProcessor()` lève
`NotSupportedError` si le nom est déjà enregistré, et la création du nœud exige le nom exact. Le
prélude injecté **masque** le global par un wrapper, ce qui évite toute manipulation du code de
l'utilisateur :

```js
const __awNativeRegister = globalThis.registerProcessor;
const registerProcessor = (nom, Classe) => {
  __awRegistered = true;
  __awNativeRegister("aw_<hash>", class extends Classe { /* voir ci-dessous */ });
};
```

- ✔ n'importe quelle forme d'appel : littéral, apostrophes simples, plusieurs lignes, classe en
  expression, **nom calculé** (il est ignoré de toute façon).
- ✘ `const registerProcessor = …` dans le code de l'utilisateur → collision de déclaration,
  `SyntaxError` remonté tel quel par `addModule()` (et le module retombe sur son repli).

**Déclaration de `p1..p8` — le point piégeux de l'API.** Elle se fait en **deux endroits
indépendants**, tous deux obligatoires.

1. `parameterDescriptors` n'existe pas dans `AudioWorkletNodeOptions` : le passer à `new
   AudioWorkletNode()` est **silencieusement ignoré** et `node.parameters` reste vide
   (`get("p1")` → `undefined`).

2. Le passage par `super({ parameterDescriptors })` ne suffit pas non plus : le navigateur construit
   les AudioParams du nœud à partir du **getter statique** `static get parameterDescriptors()` du
   constructeur enregistré (cf. `AudioWorkletNode::initializeAudioParameters`, qui lit le registre
   de descripteurs rempli à l'enregistrement). C'est le seul canal qui traverse la frontière entre
   le thread principal et le worklet. Un DSP qui ne déclare ses descripteurs que par `super()` se
   voit donc servir une map **vide** : `node.parameters` vide côté moteur, `parameters.p1`
   `undefined` (et `this.parameters` `undefined`) côté DSP — sans lever la moindre erreur.

D'où le préambule, qui pose le getter statique sur la classe de base injectée (hérité par la classe
de l'utilisateur) **et** sur la classe effectivement enregistrée, plus une transmission par
`options` pour les implémentations qui lisent le constructeur :

```js
class __awProcessor extends __awNativeProcessor {
  static get parameterDescriptors() { return __awDescriptors; }
  constructor(options) {
    super(__awPending
      ? Object.assign({}, options ?? {}, {
          parameterDescriptors: __awPending,
          parameterData: __awPending.map((d) => d.defaultValue),
        })
      : options);
  }
}
try { globalThis.AudioWorkletProcessor = __awProcessor; } catch (e) {}
```

Et le wrapper enregistré :

```js
__awNativeRegister(name, class extends Classe {
  static get parameterDescriptors() { return __awDescriptors; }
  constructor(options) {
    const merged = Object.assign({}, options ?? {}, {
      parameterDescriptors: __awDescriptors,
      parameterData: __awDescriptors.map((d) => d.defaultValue),
    });
    __awPending = __awDescriptors;   // pour la base injectée ci-dessus
    try { super(merged); } finally { __awPending = null; }
  }
});
```

Le `try/finally` autour de `super()` sert à ce qu'un `super()` à vide de l'utilisateur n'efface
rien : la déclaration est reposée au moment où la chaîne d'héritage l'atteint, quel que soit le
nombre de niveaux.

**Effet** : `super(options)`, `super()` à vide et l'absence de constructeur donnent tous huit AudioParam.
L'utilisateur n'a plus de contrainte sur la forme de son constructeur ; `super(options)` reste la
forme recommandée parce que c'est elle qui expose `options.processorOptions` au code.

Si `globalThis.AudioWorkletProcessor` n'est pas inscriptible, le repli est le seul wrapper : la
déclaration passe alors par les options et redevient dépendante de `super(options)`.

`rate` étant figé dans le blob, il fait partie de la clé du registre : le même code en `a-rate` et
en `k-rate` donne deux processeurs distincts. Idem pour les plages de `p1..p8` (voir §5.5).

**Dispo dans le worklet** : `AudioWorkletProcessor`, `sampleRate`, `currentTime`, `currentFrame`,
`awParam`, et les globals habituels.
**Pas** de `window`, `document`, `fetch`, ni de `console.log` visible.

**Options de construction** transmises :

```js
new AudioWorkletNode(ctx, name, {
  numberOfInputs: 1,
  numberOfOutputs: 1,
  outputChannelCount: [p.channels],
  processorOptions: JSON.parse(p.options ?? "{}"),
})
// PAS de parameterDescriptors ici : sans effet (cf. ci-dessus)
```

`options.processorOptions` est lisible dans le constructeur : c'est le canal de configuration
statique (blocs de filtres, tables, mixages) sans passer par des AudioParams.

**Code par défaut** (installé dans le textarea d'un module neuf) :

```js
// Traitement maison : lisez le DSP dans ce textarea.
// p1..p8 sont des AudioParams modulables depuis le graphe (rate : a-rate par défaut).
// awParam(parameters.pN, i) lit un paramètre modulable quel que soit son mode :
// le tableau a 128 valeurs s'il bouge pendant le bloc, une seule s'il est
// constant (a-rate non modulé ou k-rate) — le helper gère les deux.
// `parameters` est le 3e argument de process() (jamais le global
// "parameters", qui n'existe pas ; ni this.parameters, peu fiable).
// options.processorOptions est le JSON du champ "options" du panneau.
//
// Code de départ : bypass avec un gain sur p1 (0 = silence, 1 = direct, >1 = gain).
class BypassGain extends AudioWorkletProcessor {
  constructor(options) {
    super(options) // obligatoire : c'est par là que p1..p8 sont déclarés
  }

  process(inputs, outputs, parameters) {
    const inp = inputs[0] || []
    const out = outputs[0] || []
    const params = parameters ?? this.parameters
    const p1 = params.p1
    for (let ch = 0; ch < out.length; ch++) {
      const src = inp[ch] ?? inp[0]
      const dst = out[ch]
      if (!src || src.length === 0) {
        dst.fill(0)
        continue
      }
      for (let i = 0; i < dst.length; i++) {
        dst[i] = p1 ? src[i] * awParam(p1, i) : src[i]
      }
    }
    return true
  }
}
registerProcessor("audioworklet", BypassGain)
```

`options` par défaut : `{"ranges":{"p1":[0,100]},"params":{}}` — la plage de `p1` est donc
bornée à `0..100` (l'AudioParam, pas le knob : le catalogue expose `p1` en `0..100` avec un
défaut de `1`, les `p2..p8` restant en `−10..+10`).

### 5.4 Modulation — réponse à la question posée

Trois mécanismes possibles. **Recommandation : (A) + (C) en v1, (B) plus tard.**

| | Mécanisme | Modulable depuis le graphe ? | Précision | Effort |
|---|---|---|---|---|
| **A** | **AudioParams déclarés** (`p1..p8`) | ✅ oui, nativement (ports `kind:"param"`, comme `gain`/`filter`) | sample par sample en `a-rate` | faible |
| **B** | **`MessagePort`** (envoi de valeurs depuis l'UI) | ❌ non | non (asynchrone, trimé en blocs de 128) | moyen |
| **C** | **`processorOptions`** (objet libre, lu dans le constructeur) | ❌ non | statique (reconstruction requise) | très faible |

- **A est la bonne réponse** à « des paramètres injectés dans le processus » : ce sont de **vrais
  AudioParams**, donc câblables depuis une enveloppe, un `gain`, une `constant` ou un autre
  AudioWorklet, avec le code de modulation audio-rate déjà en place dans `wireConnection`
  (l. 1475–1490). Coût : 8 lignes de catalogue.
- **B** ne sert qu'à ce que A ne couvre pas : paramètres non-audio (séquenceur, trigger de note,
  mesure RMS). Utile plus tard.
- **C** est le canal « config statique », **gratuit** (une ligne) et complète l'ensemble.

Limite assumée : les 8 ports sont fixes et nommés. Un `p4` câblé alors que le code n'utilise pas
`parameters.p4` ne coûte rien ; symétriquement un worklet qui a besoin de 12 paramètres ne peut pas
les avoir → le contournement est d'agrandir la liste en `p1..pN`.

### 5.5 Plages de valeur de `p1..p8`

**Le piège à ne pas rater.** Un AudioParam est borné par le navigateur : `minValue`/`maxValue` ne
sont pas décoratifs, toute valeur hors intervalle est **silencieusement ramenée** dedans. Avec une
plage figée à `−10..+10`, la modulation est techniquement fonctionnelle mais lexicalement
inexprimante :

- profondeur de bits (`1..16`), fréquence de coupure en Hz, durée en ms : impossibles ;
- un `constant` à `12000` branché sur `p2` se retrouve **épinglé à 10 en permanence** — la
  modulation « ne sert à rien », alors qu'elle est correctement câblée.

D'où des plages déclarables par paramètre dans le JSON `options` :

```json
{ "params": {}, "ranges": { "p1": [1, 16], "p2": [100, 20000] } }
```

- `[min, max]` → plage explicite ; un nombre → plage symétrique `[-n, n]` ;
- paramètre absent → `−10..+10` (défaut symétrique, adapté à la modulation additive) ;
- `ranges` est une **directive moteur**, retirée des `processorOptions` avant l'envoi au processor ;
- les plages étant figées dans le descripteur, elles entrent dans la **clé du registre** : les
  modifier recompile le code (une fois, au prochain chargement) ;
- le moteur borne aussi la valeur initiale et la **base de modulation** dans la plage, sans quoi la
  base mémorisée garderait une valeur que l'AudioParam ne peut pas rendre (une modulation
  « relative » partirait de zéro) ;
- le panneau fait suivre les sliders `p1..p8` sur la plage déclarée, et affiche un rappel sous le
  champ `options`.

### 5.6 Persistance

`code` est une chaîne dans `module.params` ⇒ il est **sauvegardé / chargé / exporté tel quel** par
`PatchManager`, `SynthPatchManager` et `audioTransfer.js`, sans format nouveau. Le hash est
recalculé au chargement et le processor re-déclaré au premier `init()`. Aucun travail supplémentaire.

Note : un patch contenant du code est du code exécuté. Un `.json` importé d'une source tierce
déclarera un processor. **À signaler dans le README.**

---

## 6. Spécification technique

### 6.1 Nouveau composable : `src/composables/useAudioWorklet.js`

Singleton au niveau module (un seul `AudioContext` partagé).

```js
// registre : WeakMap<BaseAudioContext, Map<hash, record>>
// record = { hash, name, status: "pending"|"ok"|"error", error, promise }

// hash : SHA-256 via crypto.subtle (async), repli synchrone (FNV-1a ×2 concaténés)
//        si crypto.subtle est absent (contexte non sécurisé).
// nom  : `aw_${hash}` — identifiant JS valide, unique par code.

// ensureWorklet(ctx, src) -> Promise<record>   (async, idempotent)
//   1. hash = hashCode(src)
//   2. record.status === "ok"      -> resolve immédiatement
//   3. record.status === "pending" -> await record.promise
//   4. sinon : name = `aw_${hash}`
//      wrapped = PRELUDE(name, rate) + src + EPILOGUE
//      url = URL.createObjectURL(new Blob([wrapped], { type: "application/javascript" }))
//      try   { await ctx.audioWorklet.addModule(url); status = "ok" }
//      catch (e) { status = "error"; error = String(e?.message ?? e) }
//      finally { URL.revokeObjectURL(url) }   // le script est déjà chargé
//
// peekWorklet(ctx, src)  -> record | null   (lecture synchrone pour instantiateModule)
// getWorkletDefaults()   -> { code, options }
// clearWorkletRegistry()                    (tests / reset)
```

Points d'attention :

- **Révoquer l'URL** : `addModule` a récupéré le script à la résolution ⇒ `revokeObjectURL` dans le
  `finally` est sûr et évite une fuite.
- **Le code reste chargé dans le contexte** : Web Audio n'a pas de `removeProcessor`. Chaque
  compilation différente ajoute une classe à l'`AudioWorkletGlobalScope`. Sans conséquence
  audible ; la mémoire monte très lentement (une classe + une chaîne par version écrite).
  Documenté, non traité.
- **CSP** : si le site impose une CSP sans `script-src blob:`, `addModule` est bloqué
  (`SecurityError`) → remonté dans la console + le repli pass-through prend le relais.
- **Identité du code** : deux modules avec le **même** code partagent le même processor (dédup
  naturelle). Changer `p1` seul ne change pas le hash ⇒ aucune recompilation inutile.

### 6.2 `usePatchVoice.js` — instanciation

```js
import { WORKLET_PARAM_NAMES, clampParamValue } from "./useAudioWorklet.js"

function createWorkletNode(ctx, name, p) {
  let parsed = {}
  try { parsed = JSON.parse(p.options ?? "{}") ?? {} }
  catch (e) { console.warn("[audioworklet] options JSON invalide :", e?.message) }
  // `ranges` est une directive moteur (figée dans le descripteur), pas une
  // configuration du DSP : on ne la transmet pas au processor.
  const { ranges: _ignored, ...processorOptions } = parsed

  return new AudioWorkletNode(ctx, name, {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [p.channels === 2 ? 2 : 1],
    // PAS de parameterDescriptors ici : clé inconnue d'AudioWorkletNodeOptions,
    // ignorée, et node.parameters resterait vide (cf. §5.3).
    processorOptions,
  })
}

// dans instantiateModule()
case "audioworklet": {
  const rec = peekWorklet(ctx, p.code, { rate: p.rate, options: p.options })
  if (!rec || rec.status !== "ok") return { node: makePassthrough(ctx, now), params: {}, bases: {} }
  const node = safeCreate() ?? { /* repli */ }
  const params = {}, bases = {}
  for (const n of WORKLET_PARAM_NAMES) {
    const ap = node.parameters.get(n)
    if (!ap) { missing++; continue }        // jamais de throw : le son passe
    // bornée dans la plage déclarée, comme le fera le navigateur
    const v = clampParamValue(rec.ranges, n, p[n] ?? 0)
    ap.setValueAtTime(v, now)
    params[n] = ap; bases[n] = v
  }
  return { node, params, bases, worklet: { name: rec.name } }
}
```

Le repli est un simple `GainNode` à gain 1 : le signal passe au travers, le module ne casse rien,
et l'avertissement en console indique pourquoi (`code non compilé` / `code invalide : <message>`).

### 6.3 Pré-compilation (le seul point qui demande de l'async)

`instantiateModule` est synchrone ⇒ on ne peut pas `await addModule` dedans. On ajoute une étape de
pré-compilation, sur le modèle exact de `useSuperModules().ready` (l. 898).

```js
async function preloadWorklets() {
  const ctx = audioCtx.value
  if (!ctx?.audioWorklet) return
  const patch = getPatch()
  for (const g of [patch?.mainPatch, patch?.voicePatch]) {
    for (const mod of g?.modules ?? []) {
      if (mod.type !== "audioworklet") continue
      await ensureWorklet(ctx, mod.params?.code ?? getWorkletDefaults().code)
    }
  }
}
```

Deux points d'appel suffisent, **aucun des deux ne casse d'appelant** :

| Site | Modification |
|---|---|
| `init()` (l. 895), **avant** `buildMainPatch()` | `await preloadWorklets()`. C'est aussi le chemin de `noteOn()` (l. 1772) qui `await init()` **avant** `createVoice()` ⇒ la voix d'une note est toujours construite avec un code déjà compilé. |
| `rebuildMainPatch()` (l. 1652) | devient `async` : `await preloadWorklets()` **puis** `teardownMainPatch()` puis reconstruction. Compiler *avant* de démonter évite le silence pendant la compilation. Les 3 appelants (`useSharedVoice.js:78`, `useSharedVoice.js:104`, `StepSequencer.vue:111`) sont déjà dans un contexte `async` ⇒ un simple `await` à ajouter. |

Invariant : *un graphe n'est construit qu'avec du code déjà enregistré.* Toute violation tombe sur
le repli pass-through.

### 6.4 Cycle de vie, sans hot-swap

| Graphe | Moment de compilation | Prise en compte d'une nouvelle version du code |
|---|---|---|
| **Voice** | à chaque `noteOn()` via `init()` | **la note suivante** (le graphe voix est reconstruit à chaque note) |
| **Main** | à chaque `rebuildMainPatch()`, déclenchée par le `watch(deep)` de `StepSequencer.vue:105` | **à la reconstruction**, c'est-à-dire au rechargement du patch ou à toute action qui reconstruit le main patch — exactement le sort de tous les autres paramètres du main patch |

Pas de `buildGraph` à modifier, pas de `rewireModuleEdges`, pas de bookkeeping d'arêtes, pas de
`patchType` à propager, pas de façade UI → moteur. **Tout le plumbing de mise à jour à chaud
disparaît.**

### 6.5 Fichiers touchés

| # | Fichier | Nature |
|---|---|---|
| 1 | `src/composables/useAudioWorklet.js` | **nouveau** — registre, hash, blob, masquage de `registerProcessor`, descripteurs `p1..p8`, code par défaut |
| 2 | `src/composables/useModuleCatalog.js` | + entrée `audioworklet` |
| 3 | `src/composables/usePatchVoice.js` | + import de `WORKLET_PARAM_NAMES`, `createWorkletNode`, `case "audioworklet"`, `preloadWorklets`, `init()` et `rebuildMainPatch()` rendues/adaptées |
| 4 | `src/composables/useSharedVoice.js` | 2 × `await` sur `rebuildMainPatch()` (l. 78 et l. 104) |
| 5 | `src/components/ModulePropertyPanel.vue` | + rendu du type `code` (draft local + commit débouncé) |
| 6 | `src/components/ModulePaper.vue` **et** `ModuleToolbar.vue` | + `code: 'Code'` dans les deux copies de `CATEGORY_LABELS` (l. 79 / l. 17) |
| 7 | `README.md` | ligne dans le tableau des modules + section « AudioWorklet » (contraintes, CSP, limites) |
| 8 | `scripts/smoke-audioworklet.mjs` | **nouveau** — smoke test |

`PatchEditor.vue` et `SuperModuleEditor.vue` ne sont **pas** touchés.

---

## 7. Gestion d'erreurs

| Cas | Détection | Comportement |
|---|---|---|
| Erreur de syntaxe JS | `addModule` rejette | `status:"error"` + message ; `console.warn` ; **repli pass-through** (le son continue de passer) |
| `registerProcessor` absent du code | l'épilogue injecté lève au chargement | `addModule` rejette → idem |
| `const registerProcessor` déclaré par l'utilisateur | `SyntaxError` (collision) | `addModule` rejette → idem |
| `p1..p8` absents (processor compilé par une version antérieure du moteur) | `node.parameters.get(n)` → `undefined` | ignorés + `console.warn` nommant le processor ; le son passe, les params sont inertes ; rechargement de page requis |
| `options` JSON invalide | `JSON.parse` en `try/catch` | `{}` + `console.warn`, le module fonctionne |
| `addModule` bloqué par la CSP | `SecurityError` | remonté tel quel + repli pass-through |
| Code non encore compilé au build | `peekWorklet` → `null` | repli pass-through + `console.warn` |
| `createAudioWorkletNode` échoue | `try/catch` | repli pass-through |

Invariant : **le module ne peut jamais casser le graphe ni couper le son.** Le seul coût d'une
erreur de code est un `console.warn` — l'utilisateur voit que le code n'a pas pris.

---

## 8. Limites connues (à documenter dans le README)

1. **Pas d'`import` ES dans le code.** Un `import` depuis un `blob:` exigerait de réécrire les
   spécificateurs en URLs blob supplémentaires. Tout doit tenir dans un seul fichier.
2. **Pas de `console.log` visible** dans le worklet (pas de console standard) — prévoir
   `this.port.postMessage` (non exposé côté UI) ou du feedback visuel par un paramètre.
3. **AudioWorklet dans un super-module** : non pré-compilé en v1 (le graphe d'un super-module est
   construit récursivement de façon synchrone) ⇒ repli pass-through tant que le même code n'a pas
   été compilé dans le contexte. Le cas courant est couvert : un super-module contenant un
   AudioWorklet passe par le voice/main patch qui le contient.
4. **8 paramètres maximum** par module.
5. **Plage `−10..+10` par défaut**,modifiable par paramètre via `options.ranges` (§5.5) : une
   modulation « brute » reste additive et lisible, mais tout ce qui sort de l'unité (Hz, ms, bits)
   exige une plage déclarée.
6. **Le code s'exécute** : un patch importé d'une source tierce déclare un processor. Mention
   dans le README.
7. **CSP `blob:`** requise (voir §7).
8. Le code compilé **n'est jamais déchargé** du contexte : la mémoire croît très lentement avec le
   nombre de versions écrites.
9. Une entrée, une sortie (le nombre de **canaux** de sortie est réglable 1 ou 2).

---

## 9. Tests

`scripts/smoke-audioworklet.mjs`, même harnais que les autres (stub `localStorage` + Web Audio).
Stubs à ajouter :

- `StubContext.audioWorklet = { addModule: async (url) => … }` — la capture du source passe par un
  `globalThis.Blob` et `URL.createObjectURL` **stubés**, pour relire le blob avant qu'il soit
  révoqué ;
- `addModule` **exécute réellement** le blob (`new Function` avec un `AudioWorkletProcessor` et un
  `globalThis.registerProcessor` simulés). Le code injecté étant du JS ordinaire, c'est possible, et
  nécessaire : c'est le seul moyen de vérifier que le nom unique est bien celui enregistré et que
  les descripteurs `p1..p8` arrivent au processor ;
- `StubAudioWorkletNode` construit ses AudioParams **depuis le processor enregistré**, jamais depuis
  les options du nœud — c'est le comportement du navigateur, et c'est ce qui rend le test capable
  d'attraper une régression vers des descripteurs côté nœud.

Scénarios :

1. `ensureWorklet` produit un nom `aw_<hash>` stable, et différent pour deux codes différents.
2. Le nom est imposé par le wrapper : le nom déclaré par l'utilisateur est ignoré, le nom enregistré
   est `aw_<hash>`, le code de l'utilisateur n'est pas réécrit, le PRELUDE est présent.
3. **Le processor déclare 8 descripteurs** nommés `p1..p8`, bornés `−10..10`, avec
   `automationRate` conforme au paramètre `rate` ; `k-rate` et `a-rate` donnent deux processeurs
   distincts.
4. Un 2ᵉ appel avec le même code et le même `rate` réutilise le processor (un seul `addModule`).
5. Code invalide → `status:"error"`, message non vide, **aucune** exception propagée. Idem sans
   aucun `registerProcessor` (l'épilogue injecté lève).
6. Plages (`options.ranges`) : formes `[min, max]` et symétrique, JSON invalide et plage
   incohérente ignorées, `clampParamValue` borne correctement. Un même code compilé avec et sans
   `ranges` donne deux processeurs distincts, et `peekWorklet` retrouve le bon selon `options`.
7. Moteur : valeur initiale et base bornées dans la plage déclarée, `ranges` retiré des
   `processorOptions`.
8. `instantiateModule` avec un code non compilé → repli `GainNode`, entrée non nulle.
9. `instantiateModule` avec un code compilé → vrai nœud, `params.p1..p8` pointent sur des
   AudioParams, `bases.p1..p8` initialisés, `outputChannelCount` correct, et **aucun**
   `parameterDescriptors` dans les options du nœud.
10. Les trois formes de constructeur — `constructor(options) { super(options) }`, `constructor() {
    super() }`, et pas de constructeur du tout — donnent **toutes** les huit AudioParam, sans
    exception.
11. `rebuildMainPatch()` : le code est enregistré **avant** la construction du graphe ; trois rebuilds
    en rafale ne s'entrelacent pas.
12. Rétrocompatibilité : `buildGraph` et les autres types de modules ne sont pas affectés
    (les 3 smoke tests existants doivent passer **sans modification**).

---

## 10. Décisions à valider

| # | Question | Recommandation |
|---|---|---|
| D1 | Nombre de ports de modulation | **8** (`p1..p8`) — suffisant pour un Leslie ou un effet utilitaire, insuffisant pour un DSP très paramétré |
| D2 | Plage des paramètres | **`−10..10` par défaut, redéfinissable par paramètre** via `options.ranges` (voir §5.5) — `−10..10` seul rendait la modulation inexprimante en Hz / ms / bits, le navigateur bornant silencieusement tout dépassement |
| D3 | Modulation par `MessagePort` (B) | **plus tard** — A + C couvrent l'essentiel |
| D4 | `a-rate` par défaut | **oui** (cohérent avec `rate:"a-rate"` des autres ports) ; `k-rate` sélectionnable car moins verbeux |
| D5 | Nouvelle catégorie de palette | **`code` → « Code »** plutôt que ranger ça dans « Effects » |
| D6 | Debounce de commit du textarea | **500 ms** — évite un `addModule` + `rebuildMainPatch` par frappe |
| D7 | Affichage des erreurs de compilation dans le panneau | **non en v1** (console seulement). Si on veut : un `getWorkletStatus(moduleId)` sur le moteur, lu une fois à la sélection du module — quelques lignes |

---

## 11. Phases

- **Phase 1 — le module** : `useAudioWorklet.js`, entrée catalogue, `case` + repli pass-through,
  `preloadWorklets`, `init`/`rebuildMainPatch` adaptées, textarea. → on peut écrire un worklet
  statique, il est sauvegardé, rechargé et modulé.
- **Phase 2 — confort** : erreurs de compilation affichées dans le panneau (D7), snippets
  d'exemple, `preloadWorklets` des worklets des super-modules, raccourcis clavier.
