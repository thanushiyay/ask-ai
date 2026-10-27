import { ref, reactive, computed } from 'vue';
import { streamChat } from '@/lib/api.js';
import { applyChatEvent, createAssistantMessage, settleMessage } from '@/lib/chat-events.js';

export const MAX_MESSAGE_LENGTH = 4000;

const newSessionId = () =>
  globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;

/** Restored messages come from localStorage, so normalise anything a crash or old version left behind. */
function reviveMessage(m) {
  if (m?.role !== 'assistant')
    return { role: 'user', text: String(m?.text ?? ''), system: Boolean(m?.system) };
  const message = reactive({
    ...createAssistantMessage(),
    ...m,
    steps: (m.steps ?? []).map((s) => reactive(s)),
  });
  if (message.status !== 'done') settleMessage(message);
  if (typeof message.error === 'string') message.error = { kind: 'server', text: message.error };
  return message;
}

export function useChat({ onEvent, onSettled } = {}) {
  const sessionId = ref(newSessionId());
  const messages = ref([]);
  const agent = ref('optimized');
  const busy = ref(false);
  const lastRequestId = ref(null);
  let controller = null;
  let lastPayload = null;

  const title = computed(
    () => messages.value.find((m) => m.role === 'user' && !m.system)?.text ?? 'New conversation',
  );
  /** Only the newest assistant message may act on a pending confirmation or question. */
  const latestAssistant = computed(() => [...messages.value].reverse().find((m) => m.role === 'assistant'));

  async function request(payload) {
    if (busy.value) return;
    busy.value = true;
    lastPayload = payload;
    controller = new AbortController();
    const message = createAssistantMessage();
    message.retryable = Boolean(payload.message);
    messages.value.push(message);
    onEvent?.('start');
    let stopped = false;
    try {
      await streamChat(
        { sessionId: sessionId.value, agent: agent.value, ...payload },
        (type, event) => {
          if (type === 'start') lastRequestId.value = event.requestId;
          applyChatEvent(message, type, event);
          onEvent?.(type);
        },
        controller.signal,
      );
    } catch (err) {
      stopped = err.kind === 'aborted';
      if (!stopped) message.error = { kind: err.kind ?? 'server', text: err.message };
    } finally {
      settleMessage(message, { stopped });
      controller = null;
      busy.value = false;
      onSettled?.();
    }
  }

  function send(text) {
    const trimmed = String(text ?? '').trim();
    if (!trimmed || busy.value || trimmed.length > MAX_MESSAGE_LENGTH) return false;
    messages.value.push({ role: 'user', text: trimmed });
    request({ message: trimmed });
    return true;
  }

  function stop() {
    controller?.abort();
  }

  /** Re-sends the last typed message after a failure, replacing the failed reply. */
  function retry(message) {
    if (busy.value || !lastPayload?.message) return;
    const index = messages.value.indexOf(message);
    if (index >= 0) messages.value.splice(index, 1);
    request(lastPayload);
  }

  function confirm(message) {
    if (!message.confirm || message.confirm.resolved || busy.value) return;
    message.confirm.resolved = 'confirmed';
    messages.value.push({ role: 'user', text: 'Approved', system: true });
    request({ confirm: true });
  }

  function cancel(message) {
    if (!message.confirm || message.confirm.resolved || busy.value) return;
    message.confirm.resolved = 'cancelled';
    messages.value.push({ role: 'user', text: 'Cancelled', system: true });
    request({ cancel: true });
  }

  function optionText(option) {
    if (typeof option === 'string') return option;
    return String(option?.label ?? option?.name ?? option?.id ?? '').split(' · ')[0];
  }

  function choose(message, option) {
    const text = optionText(option);
    if (!text || busy.value || !message.clarify) return;
    message.clarify.resolved = text;
    send(text);
  }

  function reset() {
    stop();
    sessionId.value = newSessionId();
    messages.value = [];
    lastRequestId.value = null;
  }

  function restore(conversation) {
    if (busy.value || !conversation?.id) return;
    sessionId.value = conversation.id;
    messages.value = (conversation.messages ?? []).map(reviveMessage);
  }

  return {
    sessionId,
    messages,
    agent,
    busy,
    lastRequestId,
    title,
    latestAssistant,
    send,
    stop,
    retry,
    confirm,
    cancel,
    choose,
    reset,
    restore,
  };
}
