
<script setup>
import { ref, computed, onMounted, nextTick } from "vue";
import { useLmStudioAPI } from "../composables/useLmStudioAPI";
import { useModuleCatalog } from "../composables/useModuleCatalog";

const {
  availableModels,
  loadedModels,
  loading,
  chatting,
  error,
  refreshModels,
  loadModel,
  chat,
  resetConversation,
} = useLmStudioAPI();

const { getCatalog } = useModuleCatalog();

const selectedModel = ref("");
const input = ref("");
const messages = ref([]);
const chatContainer = ref(null);

const emit = defineEmits(["patch-received"]);

// Nombre de tentatives de correction automatique pour une même demande
// utilisateur : évite une boucle infinie si le modèle n'arrive pas à corriger.
const MAX_CORRECTION_ATTEMPTS = 3;
let correctionAttempts = 0;

const props = defineProps({
  // Patch actuellement ouvert dans l'éditeur : envoyé au modèle comme
  // contexte afin qu'il propose des modifications plutôt qu'un nouveau patch.
  voicePatch: { type: Object, default: () => ({ modules: [], connections: [] }) },
  mainPatch: { type: Object, default: () => ({ modules: [], connections: [] }) },
});

const currentModel = computed(() =>
  availableModels.value.find((model) => model.key === selectedModel.value)
);

const isModelLoaded = computed(() =>
  loadedModels.value.some((model) => model.key === selectedModel.value)
);

/**
 * Transforme le catalogue réel en description compacte pour le LLM.
 * On transmet les noms de ports et les contraintes des paramètres,
 * sans envoyer le code des AudioWorklets ni les données volumineuses.
 */
function buildCompactModuleCatalog(types = null) {
  const catalog = getCatalog();

  const entries = Object.entries(catalog).filter(
    ([type]) => !types || types.includes(type)
  );

  return entries.map(([type, definition]) => {
    const inputs = (definition.ports?.inputs ?? []).map((port) => ({
      id: port.id,
      kind: port.kind,
      ...(port.role ? { role: port.role } : {}),
      ...(port.rate ? { rate: port.rate } : {}),
    }));

    const outputs = (definition.ports?.outputs ?? []).map((port) => ({
      id: port.id,
      kind: port.kind,
      ...(port.role ? { role: port.role } : {}),
      ...(port.rate ? { rate: port.rate } : {}),
    }));

    const params = Object.fromEntries(
      Object.entries(definition.params ?? {}).map(([name, desc]) => [
        name,
        {
          type: desc.type,
          ...(desc.min !== undefined ? { min: desc.min } : {}),
          ...(desc.max !== undefined ? { max: desc.max } : {}),
          ...(desc.values ? { values: desc.values } : {}),
          ...(desc.default !== undefined ? { default: desc.default } : {}),
        },
      ])
    );

    return {
      type,
      inputs,
      outputs,
      params,
    };
  });
}

/**
 * Réduit un graphe du patch courant à ses propriétés utiles au modèle
 * (id, type, params, position, label + connexions), sans les métadonnées
 * internes de l'éditeur.
 */
function compactGraph(graph) {
  const cloneParams = (params) => {
    try {
      return JSON.parse(JSON.stringify(params ?? {}));
    } catch {
      return {};
    }
  };

  return {
    modules: (graph?.modules ?? []).map((module) => ({
      id: module.id,
      type: module.type,
      ...(module.label ? { label: module.label } : {}),
      ...(module.position
        ? { position: { x: module.position.x, y: module.position.y } }
        : {}),
      params: cloneParams(module.params),
    })),
    connections: (graph?.connections ?? []).map((connection) => ({
      from: {
        id: connection.from?.id,
        magnet: connection.from?.magnet ?? "circle",
        port: connection.from?.port,
      },
      to: {
        id: connection.to?.id,
        magnet: connection.to?.magnet ?? "circle",
        port: connection.to?.port,
      },
    })),
  };
}

/**
 * Décrit le patch en cours d'édition. Ce bloc est ajouté à chaque message
 * utilisateur (et non au seul prompt système) afin que le modèle dispose
 * toujours de l'état réel du patch, y compris après plusieurs échanges.
 * Retourne une chaîne vide si les deux graphes sont vides.
 */
function buildCurrentPatchContext() {
  const voicePatch = compactGraph(props.voicePatch);
  const mainPatch = compactGraph(props.mainPatch);

  if (!voicePatch.modules.length && !mainPatch.modules.length) return "";

  const currentPatch = {
    version: 1,
    name: "patch en cours d'édition",
    voicePatch,
    mainPatch,
  };

  return [
    "==================================================",
    "PATCH EN COURS D'ÉDITION — MODIFICATION ATTENDUE",
    "==================================================",
    "",
    "Le patch ci-dessous est celui qui est actuellement ouvert dans l'éditeur :",
    JSON.stringify(currentPatch),
    "",
    "La demande exprimée ci-dessus porte sur CE patch existant : l'utilisateur ne demande pas un nouveau patch, mais une modification de celui-ci.",
    "- conserve les modules, paramètres, labels et connexions existants qui ne sont pas concernés par la demande ;",
    "- ajoute, retire ou modifie uniquement ce qui est nécessaire pour satisfaire la demande ;",
    "- réutilise les identifiants existants et donne des identifiants uniques aux nouveaux modules ;",
    "- renvoie toujours le patch COMPLET et mis à jour (voicePatch ET mainPatch), jamais un diff ni un fragment ;",
    "- place les nouveaux modules sur des positions (x, y) libres, sans chevaucher les modules existants.",
    "",
    "Exemples de demandes de modification :",
    '- « ajoute une enveloppe percussive sur le gain » : conserve le gain existant, ajoute un module envelope (attaque courte, décroissance rapide) et relie sa sortie à l\'entrée de modulation de paramètre "gain" du gain existant.',
    '- « ajoute un tremolo sur le voice » : ajoute un module osc (LFO, fréquence basse) et un module gain, relie osc -> gain, puis relie la sortie du gain à l\'entrée de modulation "detune" du voice existant ; règle le gain du LFO pour une modulation audible.',
    "",
    "Si un graphe du patch fourni est vide, tu peux y construire le chemin nécessaire en respectant les règles précédentes.",
    "Si l'utilisateur demande explicitement un patch entièrement nouveau, ignore ce patch de référence et repars d'une structure vierge.",
  ].join("\n");
}

/**
 * Types de modules déjà présents dans le patch courant : ils doivent
 * figurer dans le catalogue transmis au modèle, même s'ils ne font pas
 * partie de la liste initiale.
 */
function collectCurrentPatchTypes() {
  return [
    ...(props.voicePatch?.modules ?? []),
    ...(props.mainPatch?.modules ?? []),
  ]
    .map((module) => module?.type)
    .filter(Boolean);
}

function buildSynthSystemPrompt(types = null) {
  // Ces modules garantissent une structure de patch exploitable.
  // Les autres types sont ajoutés selon les besoins de la génération.
  const requiredTypes = [
    "voice",
    "gain",
    "envelope",
    "input",
    "compressor",
    "destination",
  ];

  const requestedTypes =
    types == null
      ? null
      : [...new Set([...requiredTypes, ...types])];

  const moduleCatalog = buildCompactModuleCatalog(requestedTypes);

  const instructions = [
    "Tu es un expert en synthèse audio modulaire et en génération de patches JSON pour une application Vue 3.",
    "Ta tâche est de produire un patch fonctionnel, musicalement cohérent et strictement compatible avec le format attendu par l'application.",
    "",
    "==================================================",
    "1. FORMAT JSON DE SORTIE — CONTRAT STRICT",
    "==================================================",
    "",
    "Retourne uniquement un objet JSON valide. Aucun Markdown, aucune balise ```json, aucun commentaire, aucune explication avant ou après.",
    "La racine doit contenir exactement les propriétés structurelles suivantes :",
    '- "version" : nombre 1',
    '- "name" : chaîne descriptive du patch',
    '- "voicePatch" : graphe de synthèse vocale',
    '- "mainPatch" : graphe de traitement principal',
    "",
    "Chaque graphe possède exactement les propriétés structurelles suivantes :",
    '- "modules" : tableau de modules',
    '- "connections" : tableau de connexions',
    "",
    "Chaque module généré doit avoir cette forme :",
    '{ "id": "identifiant_unique", "type": "type_du_catalogue", "params": {} }',
    "",
    "Dans les objets modules, utilise uniquement id, type et params.",
    "N'ajoute JAMAIS les propriétés inputs, outputs, ports, label, color, category ou singleton aux objets modules.",
    "Les ports sont définis par le catalogue et ne doivent pas être recopiés dans le patch.",
    "Un module sans paramètre explicite peut avoir params: {}.",
    "",
    "==================================================",
    "2. CATALOGUE : DOCUMENTATION, PAS FORMAT DE SORTIE",
    "==================================================",
    "",
    "Le catalogue fourni plus bas décrit les types de modules disponibles, leurs ports et leurs paramètres.",
    "Il ne constitue PAS le schéma JSON à recopier.",
    "Les objets du catalogue décrivent les paramètres autorisés ; le patch contient les valeurs effectives de ces paramètres.",
    "",
    "Exemple : si le catalogue décrit frequency avec type number, min 20, max 20000 et default 1200, écris dans le patch :",
    '"params": { "frequency": 1200 }',
    "",
    "N'écris jamais ceci dans le patch :",
    '"params": { "frequency": { "type": "number", "min": 20, "max": 20000, "default": 1200 } }',
    "",
    "Pour un paramètre enum, utilise une valeur parmi les chaînes autorisées.",
    "Pour un paramètre boolean, utilise true ou false.",
    "Pour un paramètre numérique, utilise directement un nombre dans la plage autorisée.",
    "Pour un paramètre complexe, tel que stages d'une enveloppe, utilise la structure de valeur réellement attendue, et non la description du paramètre du catalogue.",
    "N'invente aucun type de module, port ou paramètre absent du catalogue.",
    "Ne confonds jamais le type du module avec la valeur d'un de ses paramètres.",
    "",
    'Exemple : un oscillateur en dents de scie est un module de type "voice" avec "params": { "type": "sawtooth" }.',
    'Il n’existe pas de module "sawtooth" dans ce cas : "sawtooth" est une valeur du paramètre type.',
    "",
    "==================================================",
    "3. IDENTIFIANTS ET CONNEXIONS",
    "==================================================",
    "",
    "Chaque module doit avoir un identifiant id unique dans son graphe.",
    "Pour éviter toute ambiguïté, utilise des identifiants simples et distincts, par exemple voice_1, filter_1, gain_1, envelope_1 et destination_1.",
    "N'utilise jamais le type du module à la place de son identifiant lorsqu'il existe plusieurs instances du même type.",
    "",
    "Chaque connexion doit respecter cette forme :",
    '{ "from": { "id": "ID_MODULE_SOURCE", "magnet": "circle", "port": "PORT_SOURCE" }, "to": { "id": "ID_MODULE_DESTINATION", "magnet": "circle", "port": "PORT_DESTINATION" } }',
    "",
    "RÈGLE CRITIQUE SUR LES IDENTIFIANTS :",
    "Dans from.id et to.id, écris uniquement l'identifiant exact du module, tel qu'il apparaît dans modules[].id.",
    "N'ajoute jamais .in, .out ou un autre suffixe à ces identifiants.",
    "Le nom du port est renseigné séparément dans le champ port.",
    "",
    'Exemple correct : from.id = "voice_1", from.port = "out:out".',
    'Exemple incorrect : from.id = "voice_1.out".',
    'Exemple correct : to.id = "filter_1", to.port = "in:in".',
    'Exemple incorrect : to.id = "filter_1.in".',
    "",
    "Utilise les identifiants de ports exacts du catalogue et le format de port utilisé par l'application.",
    'Pour une sortie audio nommée out, utilise "out:out" si c\'est le port indiqué par le format de l\'application.',
    'Pour une entrée audio nommée in, utilise "in:in".',
    'Pour une entrée de paramètre nommée gain, utilise le port exact "gain:gain" lorsqu\'il correspond au format du catalogue et de l\'application.',
    "",
    "Les champs magnet doivent conserver la valeur attendue par le format de l'application, généralement circle.",
    "Ne place jamais un nom de module, un type ou une valeur de paramètre dans le champ port.",
    "Chaque connexion doit référencer deux modules présents dans le même graphe.",
    "Chaque port utilisé doit exister sur le module correspondant et être du bon côté : sortie dans from, entrée dans to.",
    "Ne crée pas de connexion vers un port inexistant.",
    "Ne crée pas de connexion entre deux graphes différents.",
    "",
    "==================================================",
    "4. LES DEUX GRAPHES SONT DISTINCTS",
    "==================================================",
    "",
    "Le patch comporte deux graphes indépendants : voicePatch et mainPatch.",
    "",
    "voicePatch contient la génération du son, les oscillateurs, les filtres, les gains, les enveloppes et les éventuels modulateurs.",
    'Il doit contenir un module de type "destination".',
    "Le signal audio destiné à la sortie de voicePatch doit réellement atteindre ce destination.",
    "",
    "mainPatch contient le traitement principal du signal fourni par l'application.",
    'Il doit contenir un module de type "input", un module de type "compressor" et un module de type "destination".',
    "Le chemin audio principal doit être : input -> compressor -> destination.",
    "",
    "Dans mainPatch, relie la sortie audio de input à l'entrée audio du compressor, puis la sortie audio du compressor à l'entrée audio du destination.",
    "Ne renverse jamais le sens de ces connexions.",
    "",
    "L'application réalise elle-même le raccordement entre la sortie de voicePatch et l'entrée de mainPatch.",
    "Ne crée donc aucune connexion traversant voicePatch et mainPatch.",
    "Ne place pas l'oscillateur ou les modules de synthèse vocale dans mainPatch pour essayer de raccorder les graphes manuellement.",
    "Ne supprime jamais les destinations obligatoires, même si le chemin audio semble déjà complet.",
    'Le type technique de la sortie est "destination", même si son libellé dans l’interface est "Output".',
    "",
    "==================================================",
    "5. CONSTRUIRE UN PATCH AUDIO COHÉRENT",
    "==================================================",
    "",
    "Le patch doit produire un chemin audio réel, et pas seulement une collection de modules.",
    "Chaque module audio ajouté à la chaîne principale du son doit être relié à la suite du chemin, sauf s'il s'agit d'une branche intentionnelle.",
    "Ne laisse pas la sortie d'un oscillateur sans destination audio ni branche de modulation intentionnelle.",
    "Ne considère pas une entrée de modulation comme un remplacement automatique du chemin audio principal.",
    "",
    "Pour une demande de synthétiseur classique, une architecture possible est :",
    "voice -> filtre éventuel -> gain -> destination.",
    "Une enveloppe peut contrôler le gain en reliant sa sortie au port de paramètre gain du module gain.",
    "Cette architecture est un exemple utile, pas une obligation si la demande nécessite une autre architecture.",
    "",
    "Si l'utilisateur demande un filtre, utilise le type exact de filtre présent dans le catalogue, avec ses noms de paramètres exacts.",
    'Par exemple, "filter_lowpass" utilise frequency et Q, et non cutoff ou resonance.',
    "Si l'utilisateur demande une forme d'onde, règle le paramètre du module source correspondant, plutôt que d'inventer un type de module.",
    "",
    "Utilise des paramètres numériques explicites lorsque cela améliore la précision du son demandé.",
    "Les paramètres omis doivent pouvoir utiliser les valeurs par défaut de l'application.",
    "N'inclus pas toutes les valeurs par défaut dans le patch uniquement pour recopier le catalogue.",
    "",
    "==================================================",
    "6. MODULATION ET ENVELOPPES",
    "==================================================",
    "",
    "Les connexions de modulation sont autorisées lorsque les ports du catalogue les permettent.",
    "Une sortie de type modulator peut être reliée à une entrée de paramètre modulatable compatible.",
    "Ne limite pas arbitrairement la modulation aux seules enveloppes : d'autres modules peuvent servir de sources de modulation si leurs ports l'autorisent.",
    "",
    "Le module gain peut avoir deux usages distincts :",
    "1. Traitement audio : son entrée in reçoit un signal audio et son paramètre gain règle le niveau.",
    "2. Modulation : sa sortie out peut servir de signal de modulation pour une entrée de paramètre compatible.",
    "Dans une chaîne de modulation, une valeur de gain supérieure à 1 peut être intentionnelle. Ne la réduis pas automatiquement à 1 si elle sert à produire une modulation.",
    "Pour un gain utilisé sur le chemin audio principal, choisis une valeur cohérente avec le niveau sonore recherché.",
    "",
    "Pour une enveloppe, utilise le module de type envelope et ses paramètres réels.",
    'Le paramètre modulation accepte uniquement les valeurs déclarées dans le catalogue, notamment "relative" ou "replace" lorsque celles-ci y figurent.',
    "Le paramètre stages est un objet structuré, pas une simple liste de segments.",
    "Conserve la structure de l'enveloppe : loop, press et release ; ajoute min et max si la structure attendue par l'application les utilise.",
    "press et release sont des tableaux de segments. Chaque segment peut contenir les propriétés réellement prises en charge, par exemple from, to, duration et curve.",
    'Un segment de relâchement peut utiliser "from": "current" lorsque cette valeur est prise en charge.',
    "Choisis des durées et des courbes adaptées au son demandé : une percussion ou une cloche peut avoir une attaque rapide et une décroissance longue ; un son tenu peut avoir une attaque plus lente et un relâchement adapté.",
    "Ne remplace pas l'objet stages par un tableau brut et n'invente pas de propriété mode si le catalogue ne la déclare pas.",
    "",
    "==================================================",
    "7. MODULATION EN CASCADE ET PATCHES CRÉATIFS",
    "==================================================",
    "",
    "Tu peux créer plusieurs oscillateurs, gains, enveloppes et filtres si cela sert le résultat musical demandé.",
    "Tu peux construire des chaînes de modulation en cascade, par exemple un modulateur contrôlant la fréquence d'un autre oscillateur, à condition que les ports et les connexions soient valides.",
    "Tu peux utiliser plusieurs sources audio et des branches parallèles lorsque l'architecture le justifie.",
    "Ne simplifie pas automatiquement une demande complexe en un seul oscillateur.",
    "Ne multiplie cependant pas les modules sans raison sonore : chaque module doit contribuer au son demandé.",
    "Privilégie une architecture qui correspond à la famille sonore demandée : cloche, basse, pad, percussion, drone, texture évolutive ou autre.",
    "Pour une cloche, plusieurs oscillateurs sinusoïdaux, des rapports de fréquence inharmoniques, des enveloppes courtes ou différenciées et une modulation en cascade peuvent être appropriés.",
    "Pour un pad, plusieurs voix, des formes d'onde complémentaires, un filtrage et des enveloppes plus lentes peuvent être appropriés.",
    "Ces recettes sont des orientations créatives, jamais des règles qui remplacent le catalogue ou les contraintes de l'utilisateur.",
    "",
    "==================================================",
    "8. PARAMÈTRES ET VALEURS",
    "==================================================",
    "",
    "Respecte les bornes numériques et les valeurs enum du catalogue.",
    "Ne copie jamais min, max, step, default, values ou type depuis la description d'un paramètre dans sa valeur effective.",
    "N'invente pas de paramètres tels que cutoff, resonance, waveform ou mode si le module ne les déclare pas sous ces noms.",
    "N'utilise que les clés de paramètres déclarées pour le type de module concerné.",
    "Pour les modules sans paramètres, utilise params: {}.",
    "Pour les paramètres non précisés par l'utilisateur, tu peux omettre les clés et laisser l'application appliquer ses valeurs par défaut.",
    "Évite les valeurs extrêmes sans justification sonore. Une valeur extrême peut être légitime pour une modulation, mais ne doit pas être choisie par erreur.",
    "",
    "==================================================",
    "9. VÉRIFICATION OBLIGATOIRE AVANT LA RÉPONSE",
    "==================================================",
    "",
    "Avant de retourner le JSON, effectue mentalement les contrôles suivants :",
    "",
    "A. FORMAT",
    "- Le JSON est syntaxiquement valide.",
    "- La racine contient version, name, voicePatch et mainPatch.",
    "- Chaque graphe contient modules et connections.",
    "- Chaque module contient uniquement id, type et params.",
    "",
    "B. MODULES",
    "- Tous les types de modules existent dans le catalogue fourni.",
    "- Chaque id de module est unique dans son graphe.",
    "- Aucun objet de description de port ou de paramètre n'a été copié dans le patch.",
    "- Les valeurs de params sont des valeurs effectives et non des métadonnées.",
    "",
    "C. CONNEXIONS",
    "- Chaque from.id et to.id correspond exactement à un id de module du même graphe.",
    "- Aucun identifiant de connexion ne se termine artificiellement par .in ou .out.",
    "- Chaque port existe sur le module référencé et se trouve du bon côté.",
    "- Les connexions audio ont un sens cohérent.",
    "- Les connexions de modulation utilisent des ports compatibles.",
    "",
    "D. STRUCTURE",
    "- voicePatch contient destination et un chemin audio qui y aboutit.",
    "- mainPatch contient input, compressor et destination.",
    "- mainPatch est câblé dans l'ordre input -> compressor -> destination.",
    "- Aucune connexion ne traverse les limites des deux graphes.",
    "",
    "E. INTENTION MUSICALE",
    "- Le patch correspond à la demande sonore.",
    "- Les modules et les modulations contribuent au résultat attendu.",
    "- Aucun module essentiel n'est oublié et aucune connexion n'est inventée.",
    "",
    "Si une erreur est détectée pendant cette vérification, corrige-la avant de répondre.",
    "Ne retourne jamais un patch que tu sais incomplet ou invalide.",
    "",
    "==================================================",
    "10. DEMANDE DE L'UTILISATEUR",
    "==================================================",
    "",
    "Génère le patch demandé par l'utilisateur en respectant toutes les règles ci-dessus.",
    "Le catalogue ci-dessous est la seule référence pour les modules, les ports et les paramètres autorisés.",
    "",
    "CATALOGUE DES MODULES DISPONIBLES",
    JSON.stringify(moduleCatalog),
    "",
    "",
"CLARIFICATION DES OSCILLATEURS",
"",
"Il existe deux types de modules distincts : voice et osc. Ne jamais confondre leurs types.",
"",
"1. MODULE voice",
"- voice est un oscillateur déclenché par le système de notes du synthétiseur.",
"- Sa fréquence fondamentale est déterminée par la note jouée.",
"- Utiliser voice pour produire le son principal audible du patch, ou toute voix qui doit suivre les notes jouées.",
"- La forme d'onde est définie par le paramètre params.type, avec une valeur autorisée par le catalogue, par exemple sine, triangle, square ou sawtooth.",
"- Le type du module reste toujours voice. Pour obtenir une onde sawtooth, utiliser type: voice et params.type: sawtooth. Ne jamais utiliser type: sawtooth comme type de module.",
"",
"2. MODULE osc",
"- osc est un oscillateur indépendant dont la fréquence est déterminée par ses propres paramètres plutôt que par la note jouée.",
"- Il peut servir de source de modulation pour faire varier un paramètre d'un autre module.",
"- Exemple conceptuel : osc -> gain -> entrée de modulation detune d'un module voice.",
"- N'utiliser osc que si son type, ses paramètres et ses ports sont présents dans le catalogue fourni.",
"- Ne jamais inventer de paramètres, de ports ou de types de modules, même si un exemple conceptuel les suggère.",
"",
"3. RÈGLES DE CONNEXION ET DE PARAMÈTRES",
"- Chaque connexion référence l'identifiant du module dans from.id ou to.id, et le port exact dans from.port ou to.port.",
"- Le champ port contient uniquement l'identifiant exact du port, par exemple out:out, in:in ou gain:gain.",
"- Ne jamais ajouter le nom du port à l'identifiant du module. Exemple correct : from.id = voice_1 et from.port = out:out. Exemple incorrect : from.id = voice_1.out.",
"- Les valeurs dans params sont les valeurs effectives des paramètres, pas leur définition.",
"- Exemple correct : params: { frequency: 1200 }. Exemple incorrect : params: { frequency: { type: number, min: 20, max: 20000, default: 1200 } }.",
"- Utiliser exclusivement les types, ports et paramètres définis dans le catalogue.",
"4. POSITION",
`- Attention, même si ça ne change rien au son, chaque module DOIT un object position avec x et y, par exemple "position": { "x": 230, "y": 20 }`,
"",
"RÈGLES POUR UN PATCH AVEC UNE VOIX AUDIBLE",
"",
"- Pour un son audible qui doit suivre les notes jouées, utiliser voice comme source audio principale.",
"- Pour un son en dents de scie, utiliser un module voice avec params.type = sawtooth. Ne pas créer un module de type sawtooth ni remplacer voice par osc.",
"- Pour un patch comportant un filtre passe-bas et un volume contrôlé par une enveloppe, construire le graphe audio du voicePatch ainsi : voice -> filter_lowpass -> gain -> destination.",
"- Connecter également la sortie de l'enveloppe à l'entrée de modulation du gain : envelope.out:out -> gain.in:gain.",
"- Le voicePatch doit obligatoirement contenir un module destination.",
"- Le mainPatch doit obligatoirement contenir les modules input, compressor et destination, reliés dans cet ordre : input -> compressor -> destination.",
"- Le voicePatch et le mainPatch sont deux graphes indépendants. Ne jamais créer de connexion directe entre les modules de ces deux graphes.",
"- L'application gère le pont entre la sortie du voicePatch et l'entrée du mainPatch. Ne pas créer soi-même de connexion entre les deux graphes.",
"- Ces règles décrivent le résultat attendu pour ce type de patch. Elles ne remplacent pas le catalogue et n'autorisent jamais l'invention de ports, paramètres ou types absents de celui-ci.",
    "EXEMPLE DE PATCH VALIDE",
    `{"version":1,"name":"basic","voicePatch":{"modules":[{"id":"c5522702-69b2-405c-84b4-e5f7174e4279","type":"voice","params":{"detune":0,"type":"sine","delay":0},"position":{"x":50,"y":20}},{"id":"531cfba3-6c76-4f66-abc7-6e23a6df1de5","type":"gain","params":{"gain":0.5},"position":{"x":230,"y":20}},{"id":"27e0e276-79ce-4be0-8964-67e471fce04d","type":"destination","params":{},"position":{"x":400,"y":20}},{"id":"827f666e-5ebd-4fa6-a7c0-b78dc15ce765","type":"envelope","params":{"modulation":"relative","stages":{"press":[{"from":0,"to":1,"duration":0.05,"curve":"exponential"},{"from":1,"to":0.75,"duration":0.3,"curve":"exponential"},{"from":0.75,"to":0.75,"duration":0.3,"curve":"exponential"},{"from":0.75,"to":0,"duration":0.7,"curve":"exponential"}],"release":[{"from":"current","to":0,"duration":0.15,"curve":"exponential"}]}},"position":{"x":230,"y":90}}],"connections":[{"from":{"id":"c5522702-69b2-405c-84b4-e5f7174e4279","magnet":"circle","port":"out:out"},"to":{"id":"531cfba3-6c76-4f66-abc7-6e23a6df1de5","magnet":"circle","port":"in:in"}},{"from":{"id":"531cfba3-6c76-4f66-abc7-6e23a6df1de5","magnet":"circle","port":"out:out"},"to":{"id":"27e0e276-79ce-4be0-8964-67e471fce04d","magnet":"circle","port":"in:in"}},{"from":{"id":"827f666e-5ebd-4fa6-a7c0-b78dc15ce765","magnet":"circle","port":"out:out"},"to":{"id":"531cfba3-6c76-4f66-abc7-6e23a6df1de5","magnet":"circle","port":"in:gain"}}]},"mainPatch":{"modules":[{"id":"0051a11e-53de-4dc8-a4ab-dfd737f3d537","type":"destination","params":{},"position":{"x":350,"y":70}},{"id":"bce68758-fdef-4033-abdc-f44714ffecf9","type":"input","params":{},"position":{"x":30,"y":70}},{"id":"514bf08a-4bdd-4c2f-9a84-4c139ccd33e7","type":"compressor","params":{"threshold":-24,"knee":30,"ratio":12,"attack":0.003,"release":0.25},"position":{"x":190,"y":160}}],"connections":[{"from":{"id":"bce68758-fdef-4033-abdc-f44714ffecf9","magnet":"circle","port":"out:out"},"to":{"id":"514bf08a-4bdd-4c2f-9a84-4c139ccd33e7","magnet":"circle","port":"in:in"}},{"from":{"id":"514bf08a-4bdd-4c2f-9a84-4c139ccd33e7","magnet":"circle","port":"out:out"},"to":{"id":"0051a11e-53de-4dc8-a4ab-dfd737f3d537","magnet":"circle","port":"in:in"}}]}}`
  ];

  return instructions.join("\n");
}

onMounted(async () => {
  try {
    await refreshModels();

    if (availableModels.value.length) {
      selectedModel.value = "google/gemma-4-e4b";
    }
  } catch (err) {
    console.error("Impossible de récupérer les modèles :", err);
  }
});

async function handleLoadModel() {
  if (!selectedModel.value || loading.value) return;

  try {
    startNewConversation();
    await loadModel(selectedModel.value);
  } catch (err) {
    console.error("Impossible de charger le modèle :", err);
  }
}

function startNewConversation() {
  if (chatting.value) return;

  resetConversation();
  messages.value = [];
}

async function sendMessage() {
  const question = input.value.trim();

  if (!question || !isModelLoaded.value || chatting.value) return;

  // Nouvelle demande manuelle : on réarme le compteur de corrections.
  correctionAttempts = 0;
  input.value = "";

  await askModel(question);
}

/**
 * Envoie une demande au modèle, l'affiche dans le fil puis émet la réponse
 * complète pour que le parent tente de charger le patch proposé.
 */
async function askModel(question) {
  messages.value.push({
    role: "user",
    content: question,
  });

  const answerIndex =
    messages.value.push({
      role: "assistant",
      content: "",
    }) - 1;

  await scrollToBottom();

  // Le patch courant accompagne chaque demande : le modèle voit ainsi
  // toujours l'état réel de l'éditeur, même après plusieurs échanges.
  const currentPatchContext = buildCurrentPatchContext();
  const modelInput = currentPatchContext
    ? `${question}\n\n${currentPatchContext}`
    : question;

  try {
    await chat(
      selectedModel.value,
      modelInput,
      (chunk) => {
        messages.value[answerIndex].content += chunk;
        scrollToBottom();
      },
      buildSynthSystemPrompt([
        "voice",
        "gain",
        "filter_lowpass",
        "filter_highpass",
        "compressor",
        "envelope",
        "destination",
        "input",
        ...collectCurrentPatchTypes(),
      ])
    );

    // Réponse complète reçue : on la transmet au parent, qui se charge
    // d'extraire l'objet JSON et de charger le synthé proposé.
    emit("patch-received", messages.value[answerIndex].content);
  } catch (err) {
    messages.value[answerIndex].content += `\n\nErreur : ${err.message}`;
  } finally {
    await scrollToBottom();
  }
}

/**
 * Appelée par le parent lorsque l'importation du patch a échoué : les
 * erreurs sont renvoyées au modèle dans un nouveau message afin qu'il
 * corrige sa proposition. Limitée à MAX_CORRECTION_ATTEMPTS par demande.
 */
async function requestCorrection(errors = []) {
  const details = errors.filter(Boolean);

  if (!details.length || !isModelLoaded.value || chatting.value) return;

  if (correctionAttempts >= MAX_CORRECTION_ATTEMPTS) {
    error.value = `Le patch n'a pas pu être importé après ${MAX_CORRECTION_ATTEMPTS} tentatives de correction. Corrige-le manuellement ou reformule la demande.`;
    await scrollToBottom();
    return;
  }

  correctionAttempts += 1;

  const message = [
    "⚠️ Le patch que tu viens de proposer n'a pas pu être importé dans l'éditeur.",
    "",
    "Erreurs détectées :",
    ...details.map((detail) => `- ${detail}`),
    "",
    "Corrige le patch pour résoudre ces erreurs, puis renvoie le patch complet et valide au format JSON attendu.",
  ].join("\n");

  await askModel(message);
}

/** Réinitialise le compteur après un import réussi. */
function resetCorrectionAttempts() {
  correctionAttempts = 0;
}

defineExpose({ requestCorrection, resetCorrectionAttempts });

async function scrollToBottom() {
  await nextTick();

  if (chatContainer.value) {
    chatContainer.value.scrollTop = chatContainer.value.scrollHeight;
  }
}
</script>

<template>
  <section class="lm-chat">
    <header class="chat-header">
      <h2>Chat LM Studio</h2>

      <div class="model-controls">
        <select
          v-model="selectedModel"
          :disabled="loading || chatting"
          aria-label="Choisir un modèle"
          @change="startNewConversation"
        >
          <option value="" disabled>Choisir un modèle</option>

          <option
            v-for="model in availableModels"
            :key="model.key"
            :value="model.key"
          >
            {{ model.display_name || model.key }}
          </option>
        </select>

        <button
          v-if="!isModelLoaded"
          type="button"
          :disabled="!selectedModel || loading"
          @click="handleLoadModel"
        >
          {{ loading ? "Chargement…" : "Charger" }}
        </button>

        <span v-else class="model-status"> Modèle chargé </span>
      </div>

      <p v-if="currentModel" class="model-info">
        {{ currentModel.key }}
      </p>

      <button
        type="button"
        class="new-chat-button"
        :disabled="chatting || loading"
        @click="startNewConversation"
      >
        Nouvelle conversation
      </button>
    </header>

    <p v-if="error" class="error-message">
      {{ error }}
    </p>

    <div
      ref="chatContainer"
      class="chat-messages"
      aria-live="polite"
      aria-label="Conversation"
    >
      <div v-if="!messages.length" class="empty-chat">
        <template v-if="!isModelLoaded">
          Choisis un modèle et charge-le pour commencer.
        </template>
        <template v-else>
          Modèle prêt. Tu peux envoyer ton premier message !
        </template>
      </div>

      <div
        v-for="(message, index) in messages"
        :key="index"
        class="message-row"
        :class="message.role"
      >
        <div class="message">
          <div class="message-author">
            {{ message.role === "user" ? "Toi" : "Assistant" }}
          </div>

          <div class="message-content">
            {{
              message.content ||
              (chatting && index === messages.length - 1
                ? "Réflexion en cours…"
                : "")
            }}
          </div>
        </div>
      </div>
    </div>

    <form class="chat-input" @submit.prevent="sendMessage">
      <textarea
        v-model="input"
        placeholder="Écris ton message…"
        rows="2"
        :disabled="!isModelLoaded || chatting"
        @keydown.enter.exact.prevent="sendMessage"
      />

      <button
        type="submit"
        :disabled="!isModelLoaded || !input.trim() || chatting"
      >
        {{ chatting ? "Réponse…" : "Envoyer" }}
      </button>
    </form>
  </section>
</template>

<style scoped>
.lm-chat {
  display: flex;
  flex-direction: column;
  height: 650px;
  max-width: 850px;
  margin: 0 auto;
  overflow: hidden;
  border: 1px solid #d1d5db;
  border-radius: 12px;
  background: #fff;
  color: #1f2937;
  font-family: system-ui, sans-serif;
}

.chat-header {
  padding: 16px;
  border-bottom: 1px solid #e5e7eb;
}

.chat-header h2 {
  margin: 0 0 12px;
  font-size: 1.2rem;
}

.model-controls {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

select,
button,
textarea {
  font: inherit;
}

select {
  flex: 1;
  min-width: 180px;
  padding: 9px;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  background: white;
  color: inherit;
}

button {
  padding: 9px 14px;
  border: 0;
  border-radius: 6px;
  background: #2563eb;
  color: white;
  cursor: pointer;
}

button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.model-status {
  color: #15803d;
  font-size: 0.9rem;
}

.model-info {
  margin: 8px 0 0;
  color: #6b7280;
  font-size: 0.8rem;
}

.error-message {
  margin: 0;
  padding: 10px 16px;
  background: #fef2f2;
  color: #b91c1c;
  overflow-wrap: anywhere;
}

.chat-messages {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 16px;
  overflow-y: auto;
  padding: 20px;
  background: #f9fafb;
}

.empty-chat {
  margin: auto;
  color: #6b7280;
  text-align: center;
}

.message-row {
  display: flex;
  width: 100%;
}

.message-row.user {
  justify-content: flex-end;
}

.message-row.assistant {
  justify-content: flex-start;
}

.message {
  max-width: 85%;
  padding: 12px 14px;
  border-radius: 12px;
  overflow-wrap: anywhere;
}

.user .message {
  background: #dbeafe;
  border-bottom-right-radius: 3px;
}

.assistant .message {
  background: white;
  border: 1px solid #e5e7eb;
  border-bottom-left-radius: 3px;
}

.message-author {
  margin-bottom: 6px;
  font-size: 0.8rem;
  font-weight: 700;
}

.message-content {
  white-space: pre-wrap;
  line-height: 1.5;
}

.chat-input {
  display: flex;
  align-items: flex-end;
  gap: 10px;
  padding: 14px;
  border-top: 1px solid #e5e7eb;
}

.chat-input textarea {
  flex: 1;
  min-width: 0;
  resize: vertical;
  padding: 10px;
  border: 1px solid #d1d5db;
  border-radius: 8px;
  color: inherit;
  background: white;
}

@media (max-width: 500px) {
  .lm-chat {
    height: 80vh;
  }

  .chat-input {
    align-items: stretch;
    flex-direction: column;
  }

  .chat-input button {
    align-self: flex-end;
  }

  .new-chat-button {
    margin-top: 12px;
    background: #4b5563;
  }
}
</style>
