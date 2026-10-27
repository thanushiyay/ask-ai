import { ref } from 'vue';

const STORAGE_KEY = 'askai.conversations.v1';
const MAX_CONVERSATIONS = 30;
const TITLE_LENGTH = 70;

const isConversation = (c) => c && typeof c.id === 'string' && Array.isArray(c.messages);

function read() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter(isConversation) : [];
  } catch {
    return [];
  }
}

/** Saves, dropping the oldest conversations if the browser's storage quota is exceeded. */
function write(conversations) {
  let list = conversations;
  while (list.length) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
      return;
    } catch {
      // Full or blocked (private mode). History is a convenience, so shrink it and try again.
      list = list.slice(0, -1);
    }
  }
}

export function useConversationHistory() {
  const conversations = ref(read());

  function save(id, messages) {
    if (!id || !messages?.length) return;
    const firstPrompt = messages.find((m) => m.role === 'user' && !m.system)?.text ?? 'Conversation';
    let snapshot;
    try {
      snapshot = JSON.parse(JSON.stringify(messages));
    } catch {
      return;
    }
    const entry = {
      id,
      title: firstPrompt.length > TITLE_LENGTH ? `${firstPrompt.slice(0, TITLE_LENGTH - 1)}…` : firstPrompt,
      updatedAt: Date.now(),
      messages: snapshot,
    };
    conversations.value = [entry, ...conversations.value.filter((c) => c.id !== id)].slice(
      0,
      MAX_CONVERSATIONS,
    );
    write(conversations.value);
  }

  function remove(id) {
    conversations.value = conversations.value.filter((c) => c.id !== id);
    write(conversations.value);
  }

  function clear() {
    conversations.value = [];
    write([]);
  }

  return { conversations, save, remove, clear };
}
