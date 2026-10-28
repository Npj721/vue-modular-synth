import { ref, computed } from "vue";

const DEFAULT_BASE_URL = "http://127.0.0.1:1234";

export function normalizeBaseUrl(url) {
  let value = String(url || DEFAULT_BASE_URL).trim().replace(/\/+$/, "");

  // Tolère une URL saisie sans schéma (ex. "127.0.0.1:1234").
  if (value && !/^https?:\/\//i.test(value)) value = `http://${value}`;

  return value;
}

export { DEFAULT_BASE_URL };

export function useLmStudioAPI(options = {}) {
  // URL modifiable à chaud depuis le panneau de configuration.
  const baseUrl = ref(normalizeBaseUrl(options.baseUrl));

  const models = ref([]);
  const loading = ref(false);
  const chatting = ref(false);
  const error = ref(null);
  const lastResponse = ref(null);
  const conversationId = ref(null);

  const availableModels = computed(() =>
    models.value.filter((model) => model.type === "llm"),
  );

  const loadedModels = computed(() =>
    availableModels.value.filter(
      (model) =>
        Array.isArray(model.loaded_instances) &&
        model.loaded_instances.length > 0,
    ),
  );

  async function request(path, body) {
    const response = await fetch(`${baseUrl.value}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: body === undefined ? {} : { "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

    const data = await response.json().catch(() => null);

    if (!response.ok) {
      throw new Error(data?.error || `Erreur HTTP ${response.status}`);
    }

    return data;
  }

  async function refreshModels() {
    error.value = null;

    try {
      const data = await request("/api/v1/models");
      models.value = data.models || [];
      return models.value;
    } catch (err) {
      error.value = err.message;
      throw err;
    }
  }

  async function loadModel(modelKey, options = {}) {
    loading.value = true;
    error.value = null;

    try {
      const result = await request("/api/v1/models/load", {
        model: modelKey,
        ...options,
      });

      await refreshModels();
      return result;
    } catch (err) {
      error.value = err.message;
      throw err;
    } finally {
      loading.value = false;
    }
  }

  async function unloadModel(instanceId) {
    loading.value = true;
    error.value = null;

    try {
      const result = await request("/api/v1/models/unload", {
        instance_id: instanceId,
      });

      await refreshModels();
      return result;
    } catch (err) {
      error.value = err.message;
      throw err;
    } finally {
      loading.value = false;
    }
  }

  function resetConversation() {
    conversationId.value = null;
    lastResponse.value = null;
  }

  // Contrôleur de la requête de chat en cours, utilisé par cancelChat().
  let activeChatController = null;

  /** Interrompt la génération en cours (bouton « Annuler »). */
  function cancelChat() {
    if (activeChatController) {
      activeChatController.abort();
    }
  }

  /**
   * Change l'URL du serveur LM Studio à chaud. La conversation en cours est
   * réinitialisée : son response_id appartient à l'ancien serveur.
   */
  function setBaseUrl(url) {
    baseUrl.value = normalizeBaseUrl(url);
    // La liste des modèles appartient à l'ancien serveur : on l'oublie.
    models.value = [];
    error.value = null;
    resetConversation();
  }

  async function chat(
    model,
    message,
    onDelta = () => {},
    systemPrompt = "",
    options = {},
  ) {
    chatting.value = true;
    error.value = null;

    const controller = new AbortController();
    activeChatController = controller;

    const { temperature, maxTokens } = options;

    try {
      const response = await fetch(`${baseUrl.value}/api/v1/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        signal: controller.signal,
        body: JSON.stringify({
          model,
          input: message,
          stream: true,
          store: true,
          // Pas de context_length ici : le contexte est fixé au chargement.
          // Envoyer une autre taille ferait recharger le modèle par LM Studio.
          ...(Number.isFinite(temperature) ? { temperature } : {}),
          // Une valeur négative (dont -1) signifie "sans limite" : on omet
          // simplement le champ pour laisser LM Studio générer librement.
          // On traite aussi 0 comme "sans limite" : l'envoyer produirait une
          // réponse vide.
          ...(Number.isFinite(maxTokens) && maxTokens > 0
            ? { max_output_tokens: maxTokens }
            : {}),
          ...(conversationId.value
            ? { previous_response_id: conversationId.value }
            : { system_prompt: systemPrompt }),
        }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(
          data?.error?.message ||
            data?.error ||
            `Erreur HTTP ${response.status}`,
        );
      }

      if (!response.body) {
        throw new Error("Impossible de lire le flux de réponse.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      let buffer = "";
      let fullText = "";
      let reasoningText = "";

      function processEvent(block) {
        const dataLines = block
          .split(/\r?\n/)
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart());

        if (!dataLines.length) return;

        let event;

        try {
          event = JSON.parse(dataLines.join("\n"));
        } catch {
          return;
        }

        if (event.type === "message.delta") {
          const chunk = event.content || "";
          fullText += chunk;
          onDelta(chunk);
        }

        if (event.type === "reasoning.delta") {
          reasoningText += event.content || "";
        }

        if (event.type === "chat.end") {
          lastResponse.value = event.result;
          conversationId.value =
            event.result?.response_id || conversationId.value;

          // Certains modèles n'envoient aucun message.delta mais fournissent
          // le texte final agrégé dans chat.end. On récupère ce texte pour
          // éviter une bulle assistant vide.
          const finalMessage = (event.result?.output ?? [])
            .filter((item) => item?.type === "message")
            .map((item) => item.content ?? "")
            .join("");

          if (
            finalMessage &&
            finalMessage !== fullText &&
            finalMessage.startsWith(fullText)
          ) {
            const suffix = finalMessage.slice(fullText.length);
            fullText = finalMessage;
            if (suffix) onDelta(suffix);
          }

          if (!fullText.trim()) {
            const stats = event.result?.stats ?? {};
            const onlyReasoning =
              reasoningText.trim().length > 0 ||
              Number(stats.reasoning_output_tokens) > 0;

            fullText = onlyReasoning
              ? "Réponse vide : le modèle a produit uniquement du raisonnement. Mets Max tokens à -1 (ou augmente-le), ou choisis un modèle sans raisonnement forcé."
              : "Réponse vide du modèle. Mets Max tokens à -1 (ou augmente-le), puis réessaie.";
            onDelta(fullText);
          }
        }

        if (event.type === "error") {
          throw new Error(
            event.error?.message ||
              event.error ||
              "Erreur pendant la génération.",
          );
        }
      }

      while (true) {
        const { value, done } = await reader.read();

        buffer += decoder.decode(value || new Uint8Array(), {
          stream: !done,
        });

        const blocks = buffer.split(/\r?\n\r?\n/);
        buffer = blocks.pop() || "";

        for (const block of blocks) {
          processEvent(block);
        }

        if (done) break;
      }

      if (buffer.trim()) {
        processEvent(buffer);
      }

      return fullText;
    } catch (err) {
      // Une annulation volontaire n'est pas une erreur à afficher.
      if (err.name === "AbortError") {
        error.value = null;
      } else {
        error.value = err.message;
      }

      throw err;
    } finally {
      if (activeChatController === controller) {
        activeChatController = null;
      }
      chatting.value = false;
    }
  }

  return {
    models,
    availableModels,
    loadedModels,
    loading,
    chatting,
    error,
    lastResponse,
    baseUrl,
    setBaseUrl,
    refreshModels,
    loadModel,
    unloadModel,
    chat,
    cancelChat,
    conversationId,
    resetConversation,
  };
}
