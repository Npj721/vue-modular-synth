import { ref, computed } from "vue";

const DEFAULT_BASE_URL = "http://172.30.160.1:1234";

export function useLmStudioAPI(options = {}) {
  const baseUrl = (options.baseUrl || DEFAULT_BASE_URL).replace(/\/$/, "");

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
    const response = await fetch(`${baseUrl}${path}`, {
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

  async function chat(model, message, onDelta = () => {}) {
    chatting.value = true;
    error.value = null;

    try {
      const response = await fetch(`${baseUrl}/api/v1/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          input: message,
          stream: true,
          store: true,
          ...(conversationId.value
            ? { previous_response_id: conversationId.value }
            : {}),
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

        if (event.type === "chat.end") {
          lastResponse.value = event.result;
          conversationId.value =
            event.result?.response_id || conversationId.value;
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
      error.value = err.message;
      throw err;
    } finally {
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
    refreshModels,
    loadModel,
    unloadModel,
    chat,
    conversationId,
    resetConversation,
  };
}
