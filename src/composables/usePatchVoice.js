// composables/usePatchVoice.js
import { ref } from "vue"

/* =========================================================
 * Utils
 * ========================================================= */

const EPS = 0.0001

const noteToFreq = (note) =>
  440 * Math.pow(2, (note - 69) / 12)

function getEnvelopeDuration(stages = []) {
  return stages.reduce((t, s) => t + s.duration, 0)
}

/* =========================================================
 * Envelope scheduler
 * ========================================================= */

function scheduleStages(param, stages, ctx, velocity = 1, base = 1) {
  const now = ctx.currentTime

  if (param.cancelAndHoldAtTime) {
    param.cancelAndHoldAtTime(now)
  } else {
    const v = param.value
    param.cancelScheduledValues(now)
    param.setValueAtTime(v, now)
  }

  let t = now

  for (const stage of stages) {
    let from =
      stage.from === "current"
        ? param.value
        : stage.from * base

    let to = stage.to * velocity * base

    if (stage.curve === "exponential") {
      from = Math.max(EPS, from)
      to = Math.max(EPS, to)
    }

    param.setValueAtTime(from, t)
    t += stage.duration

    if (stage.curve === "exponential") {
      param.exponentialRampToValueAtTime(to, t)
    } else {
      param.linearRampToValueAtTime(to, t)
    }
  }

  return t - now
}

/* =========================================================
 * Main composable
 * ========================================================= */

export function usePatchVoice(patch) {
  const audioCtx = ref(null)
  const voices = new Map()

  // MAIN PATCH (singleton)
  let mainNodes = null
  let mainInputNode = null
  let mainSources = []
  let mainRunning = false

  /* =========================
   * Init (lazy safe)
   * ========================= */

  async function ensureContext() {
    if (!audioCtx.value) {
      audioCtx.value = new AudioContext()
    }
    if (audioCtx.value.state !== "running") {
      await audioCtx.value.resume()
    }
  }

  async function init() {
    await ensureContext()
    if (!mainNodes) {
      buildMainPatch()
    }
  }

  /* =========================
   * MAIN PATCH
   * ========================= */

  function buildMainPatch() {
    const ctx = audioCtx.value
    const now = ctx.currentTime

    mainNodes = new Map()
    mainSources = []

    for (const mod of patch.mainPatch.modules) {
      let node = null
      let params = {}
      let bases = {}

      switch (mod.type) {

        case "input": {
          const g = ctx.createGain()
          g.gain.setValueAtTime(1, now)
          node = g
          params = { gain: g.gain }
          bases = { gain: 1 }
          mainInputNode = g
          break
        }

        case "gain": {
          const g = ctx.createGain()
          const gain = mod.params.gain ?? 1
          g.gain.setValueAtTime(gain, now)
          node = g
          params = { gain: g.gain }
          bases = { gain }
          break
        }

        case "compressor": {
          const c = ctx.createDynamicsCompressor()
          const p = mod.params
          c.threshold.setValueAtTime(p.threshold ?? -24, now)
          c.knee.setValueAtTime(p.knee ?? 30, now)
          c.ratio.setValueAtTime(p.ratio ?? 12, now)
          c.attack.setValueAtTime(p.attack ?? 0.003, now)
          c.release.setValueAtTime(p.release ?? 0.25, now)
          node = c
          params = {
            threshold: c.threshold,
            knee: c.knee,
            ratio: c.ratio,
            attack: c.attack,
            release: c.release,
          }
          bases = { ...p }
          break
        }

        case "delay": {
          const d = ctx.createDelay(5)
          const time = mod.params.delayTime ?? 0.3
          d.delayTime.setValueAtTime(time, now)
          node = d
          params = { delayTime: d.delayTime }
          bases = { delayTime: time }
          break
        }

        case "osc": {
          const osc = ctx.createOscillator()
          osc.type = mod.params.type || "sine"
          osc.frequency.setValueAtTime(
            mod.params.frequency ?? 440,
            now
          )
          osc.detune.setValueAtTime(
            mod.params.detune ?? 0,
            now
          )
          node = osc
          mainSources.push(osc)
          break
        }

        case "constant": {
          const constantNode = ctx.createConstantSource();
          const value = mod.params.value !== undefined ? mod.params.value : 1;
          constantNode.offset.setValueAtTime(value, now);
          node = constantNode;
          params = { offset: constantNode.offset };
          bases = { value };
          break;
        }

        case "destination":
          node = ctx.destination
          break
      }

      mainNodes.set(mod.id, { node, params, bases })
    }

    // connections
    for (const c of patch.mainPatch.connections) {
      const from = mainNodes.get(c.from.id)
      const to = mainNodes.get(c.to.id)
      if (!from || !to) continue

      const [, toPort] = c.to.port.split(":")

      // Gestion spéciale pour les sources 'constant'
      if (from.params?.offset) {
        // Connecter l'AudioParam 'offset' à un autre AudioParam

        from.node.connect(to.params[toPort]);
      } else if (toPort === "in") {
        from.node.connect(to.node)
      } else if (to.params?.[toPort]) {
        from.node.connect(to.params[toPort])
      }
    }
  }

  function startMainPatch() {
    if (mainRunning) return
    const now = audioCtx.value.currentTime
    for (const src of mainSources) {
      try { src.start(now) } catch {}
    }
    // Démarrer les ConstantSourceNodes dans le mainPatch
    for (const { node } of mainNodes.values()) {
      if (node && typeof node.start === 'function') {
        try { node.start(now); } catch {}
      }
    }
    mainRunning = true
  }

  function stopMainPatch() {
    if (!mainRunning) return
    const now = audioCtx.value.currentTime
    // Arrêter les ConstantSourceNodes dans le mainPatch
    for (const { node } of mainNodes.values()) {
      if (node && typeof node.stop === 'function') {
        try { node.stop(now + 0.001); } catch {}
      }
    }
    for (const src of mainSources) {
      try { src.stop(now) } catch {}
    }
    mainRunning = false
    mainSources = []
  }

  function teardownMainPatch() {
    stopAll()
    stopMainPatch()

    if (!mainNodes) return
    for (const { node } of mainNodes.values()) {
      try { node.disconnect() } catch {}
    }

    mainNodes = null
    mainInputNode = null
  }

  function rebuildMainPatch() {
    teardownMainPatch()
    buildMainPatch()
    startMainPatch()
  }

  /* =========================
   * VOICES
   * ========================= */

  function createVoice(note, velocity = 1) {
    const ctx = audioCtx.value
    const now = ctx.currentTime

    const nodes = new Map()
    const sources = []
    const modulators = []

    for (const mod of patch.voicePatch.modules) {
      let node = null
      let params = {}
      let bases = {}

      switch (mod.type) {

        case "voice":
        case "osc": {
          const osc = ctx.createOscillator()
          osc.type = mod.params.type || "sine"
          const freq =
            mod.type === "voice"
              ? noteToFreq(note)
              : mod.params.frequency ?? 440
          const detune = mod.params.detune ?? 0
          osc.frequency.setValueAtTime(freq, now)
          osc.detune.setValueAtTime(detune, now)
          osc.start()
          node = osc
          params = {
            frequency: osc.frequency,
            detune: osc.detune,
          }
          bases = { frequency: freq, detune }
          sources.push(osc)
          break
        }

        case "gain": {
          const g = ctx.createGain()
          const gain = mod.params.gain ?? 1
          g.gain.setValueAtTime(gain, now)
          node = g
          params = { gain: g.gain }
          bases = { gain }
          break
        }

        case "delay": {
          const d = ctx.createDelay(5)
          const time = mod.params.delayTime ?? 0.3
          d.delayTime.setValueAtTime(time, now)
          node = d
          params = { delayTime: d.delayTime }
          bases = { delayTime: time }
          break
        }

        case "compressor": {
          const c = ctx.createDynamicsCompressor()
          const p = mod.params
          c.threshold.setValueAtTime(p.threshold ?? -24, now)
          c.knee.setValueAtTime(p.knee ?? 30, now)
          c.ratio.setValueAtTime(p.ratio ?? 12, now)
          c.attack.setValueAtTime(p.attack ?? 0.003, now)
          c.release.setValueAtTime(p.release ?? 0.25, now)
          node = c
          params = {
            threshold: c.threshold,
            knee: c.knee,
            ratio: c.ratio,
            attack: c.attack,
            release: c.release,
          }
          bases = { ...p }
          break
        }

        case "constant": {
        const constantNode = ctx.createConstantSource();
        constantNode.offset.setValueAtTime(0, now);
        node = constantNode;
        params = { offset: constantNode.offset };
        bases = { value: mod.params.value ?? 1 };
        try { node.start(); } catch {}
        break;
      }

        case "destination":
          node = mainInputNode
          break

        case "envelope":
          modulators.push(mod)
          continue
      }

      nodes.set(mod.id, { node, params, bases })
    }

    for (const c of patch.voicePatch.connections) {
      const from = nodes.get(c.from.id)
      const to = nodes.get(c.to.id)

      if (!from || !to) continue
      const [, toPort] = c.to.port.split(":")
      console.log( { from, to, toPort })

      // Gestion spéciale pour les sources 'constant'
      if (from.params?.offset) {
        from.node.connect(to.params[toPort]);
      }else if (toPort === "in") {
        from.node.connect(to.node)
      } else if (to.params?.[toPort]) {
        from.node.connect(to.params[toPort])
      }
    }

    const activeEnvs = []

for (const modulator of modulators) {

    // Trouver toutes les connexions sortantes de ce modulateur
    for (const c of patch.voicePatch.connections) {
      if (c.from.id !== modulator.id) continue;

      const target = nodes.get(c.to.id);
      if (!target) continue;
      console.log({ target })
      const [, paramName] = c.to.port.split(":");
      const param = target.params?.[paramName];
      if (!param) continue;

      // Déterminer la valeur de base pour le mode 'relative'
      let baseValue = 1;
      if (modulator.params.modulation === "relative") {
        // Pour un 'constant', la base est sa propre valeur 'value'
        // Pour un 'envelope', la base est la valeur du paramètre cible
        if (modulator.type === "constant") {
          baseValue = target.bases?.value ?? 1;
        } else {
          baseValue = target.bases?.[paramName] ?? 1;
        }
      }

      // Programmer la phase 'press' de l'enveloppe/stages
      scheduleStages(
        param,
        modulator.params.stages.press,
        ctx,
        velocity,
        baseValue
      );

      activeEnvs.push({
        param,
        base: baseValue,
        release: modulator.params.stages.release,
        affectsAmplitude: paramName === "gain",
        // On stocke le type pour une éventuelle logique future
        modulatorType: modulator.type
      });
    }
  }


    return {
      stop() {
        const now = ctx.currentTime
        let maxRelease = 0
        let hasAmpEnv = false

        for (const env of activeEnvs) {
          env.param.cancelScheduledValues(now)
          scheduleStages(
            env.param,
            env.release,
            ctx,
            1,
            env.base
          )
          maxRelease = Math.max(
            maxRelease,
            getEnvelopeDuration(env.release)
          )
          if (env.affectsAmplitude) hasAmpEnv = true
          console.log({ env })
        }

        // Arrêter les ConstantSourceNodes de cette voix
        for (const { node } of nodes.values()) {
          if (node && typeof node.stop === 'function') {
            console.log( { node, hasAmpEnv })
            try { node.stop(now + (hasAmpEnv ? maxRelease + 0.05 : 0.05 )); } catch {}
          }
        }

        for (const src of sources) {
          src.stop(now + (hasAmpEnv ? maxRelease + 0.05 : 0.05))
        }
      }
    }
  }

  /* =========================
   * Public API
   * ========================= */

  async function noteOn(note, velocity = 1) {
    await init()
    startMainPatch()

    if (voices.has(note)) {
      voices.get(note).stop()
      voices.delete(note)
    }

    voices.set(note, createVoice(note, velocity))
  }

  function noteOff(note) {
    const voice = voices.get(note)
    if (!voice) return
    voice.stop()
    voices.delete(note)
  }

  function stopAll() {
    for (const v of voices.values()) v.stop()
    voices.clear()
  }

  // --- NOUVELLE FONCTION PUBLIQUE ---
  // Permet de mettre à jour dynamiquement la valeur d'un module 'constant'
  function updateConstantValue(patchType, moduleId, newValue) {
    if (!ready.value) return;

    const isMain = patchType === 'main';
    const nodesMap = isMain ? mainNodes : Array.from(voices.values()).flatMap(v => Array.from(v.nodes?.entries() || []));

    if (isMain) {
      const nodeData = mainNodes.get(moduleId);
      if (nodeData && nodeData.params.offset) {
        nodeData.params.offset.setValueAtTime(newValue, audioCtx.value.currentTime);
      }
    } else {
      // Pour le voicePatch, on doit itérer sur toutes les voix actives
      for (const [id, nodeData] of nodesMap) {
        if (id === moduleId && nodeData.params.offset) {
          nodeData.params.offset.setValueAtTime(newValue, audioCtx.value.currentTime);
        }
      }
    }
  }

  // Ajouter un flag ready pour permettre l'utilisation de updateConstantValue
  const ready = ref(false);
  // Il faudra le passer à true dans votre composant après l'init, ou exposer `init` différemment.

  return {
    init,
    rebuildMainPatch,
    noteOn,
    noteOff,
    stopAll,
    updateConstantValue, // Exposé pour la modulation dynamique
    // ready, // Si vous souhaitez l'exposer pour une gestion plus fine
  }
}