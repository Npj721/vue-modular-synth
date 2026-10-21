
<script setup>
import { ref, computed, onMounted, nextTick } from "vue";
import { useLmStudioAPI } from "../composables/useLmStudioAPI";

const {
  availableModels,
  loadedModels,
  loading,
  chatting,
  error,
  refreshModels,
  loadModel,
  chat,
  conversationId,
  resetConversation,
} = useLmStudioAPI();

const selectedModel = ref("");
const input = ref("");
const messages = ref([]);
const chatContainer = ref(null);

const currentModel = computed(() =>
  availableModels.value.find((model) => model.key === selectedModel.value)
);

const isModelLoaded = computed(() =>
  loadedModels.value.some((model) => model.key === selectedModel.value)
);

onMounted(async () => {
  try {
    await refreshModels();

    if (availableModels.value.length) {
      selectedModel.value = availableModels.value[0].key;
    }
  } catch (err) {
    console.error("Impossible de récupérer les modèles :", err);
  }
});

async function handleLoadModel() {
  if (!selectedModel.value || loading.value) return;

  try {
    messages.value = [];
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

  messages.value.push({
    role: "user",
    content: question,
  });

  input.value = "";

  const answerIndex =
    messages.value.push({
      role: "assistant",
      content: "",
    }) - 1;

  await scrollToBottom();

  try {
    await chat(selectedModel.value, question, (chunk) => {
      messages.value[answerIndex].content += chunk;
      scrollToBottom();
    });
  } catch (err) {
    messages.value[answerIndex].content += `\n\nErreur : ${err.message}`;
  } finally {
    await scrollToBottom();
  }
}

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
