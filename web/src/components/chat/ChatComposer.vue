<script setup>
import { computed, nextTick, ref, watch } from 'vue';
import AppIcon from '@/components/ui/AppIcon.vue';
import { MAX_MESSAGE_LENGTH } from '@/composables/useChat.js';

const MAX_HEIGHT = 200;
const COUNTER_FROM = MAX_MESSAGE_LENGTH - 400;

const props = defineProps({
  busy: Boolean,
  disabled: Boolean,
  disabledReason: { type: String, default: '' },
});
const emit = defineEmits(['submit', 'stop']);
const text = defineModel({ type: String, default: '' });

const field = ref(null);
const length = computed(() => text.value.length);
const tooLong = computed(() => length.value > MAX_MESSAGE_LENGTH);
const canSend = computed(
  () => Boolean(text.value.trim()) && !props.busy && !props.disabled && !tooLong.value,
);
const placeholder = computed(() => {
  if (props.disabled) return props.disabledReason || 'Chat is unavailable right now';
  if (props.busy) return 'Working on it — you can type your next message';
  return 'Tell Ask AI what to do in your CRM…';
});

watch(text, () =>
  nextTick(() => {
    const el = field.value;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT)}px`;
  }),
);

function submit() {
  if (canSend.value) emit('submit', text.value);
}

function onKeydown(event) {
  // isComposing / keyCode 229: never send while an IME (e.g. Japanese, Chinese input) is composing.
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && event.keyCode !== 229) {
    event.preventDefault();
    submit();
  } else if (event.key === 'Escape' && props.busy) {
    emit('stop');
  }
}

defineExpose({ focus: () => field.value?.focus() });
</script>

<template>
  <form class="composer" @submit.prevent="submit">
    <div class="field" :class="{ disabled, invalid: tooLong }">
      <textarea
        ref="field"
        v-model="text"
        rows="1"
        :placeholder="placeholder"
        :disabled="disabled"
        aria-label="Message"
        :aria-invalid="tooLong"
        enterkeyhint="send"
        @keydown="onKeydown"
      />
      <span v-if="length > COUNTER_FROM" class="counter tabular" :class="{ over: tooLong }">
        {{ length.toLocaleString() }} / {{ MAX_MESSAGE_LENGTH.toLocaleString() }}
      </span>
      <button
        v-if="busy"
        class="action stop"
        type="button"
        aria-label="Stop"
        title="Stop (Esc)"
        @click="emit('stop')"
      >
        <AppIcon name="stop" :size="15" :stroke-width="2.2" />
      </button>
      <button v-else class="action" type="submit" :disabled="!canSend" aria-label="Send" title="Send (Enter)">
        <AppIcon name="send" :size="17" :stroke-width="2.2" />
      </button>
    </div>
    <p class="hint">
      <template v-if="tooLong"
        >Shorten your message to {{ MAX_MESSAGE_LENGTH.toLocaleString() }} characters to send it.</template
      >
      <template v-else
        >Enter to send, Shift + Enter for a new line. Anything risky waits for your approval.</template
      >
    </p>
  </form>
</template>

<style scoped>
.composer {
  padding: 10px 24px 16px;
  padding-bottom: max(16px, env(safe-area-inset-bottom));
  background: linear-gradient(to bottom, transparent, var(--surface) 22%);
}
.field {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  max-width: var(--thread-width);
  margin: 0 auto;
  padding: 8px 8px 8px 16px;
  border: 1px solid var(--line-2);
  border-radius: var(--r-xl);
  background: var(--surface);
  box-shadow: var(--shadow);
  transition:
    border-color 0.15s,
    box-shadow 0.15s;
}
.field:focus-within {
  border-color: var(--accent);
  box-shadow:
    0 0 0 3px var(--accent-soft),
    var(--shadow);
}
.field.invalid {
  border-color: var(--issue);
}
.field.disabled {
  background: var(--surface-2);
  box-shadow: none;
}
textarea {
  flex: 1;
  min-width: 0;
  max-height: 200px;
  padding: 7px 0;
  border: 0;
  background: none;
  line-height: 1.5;
  resize: none;
}
textarea:focus {
  outline: none;
}
textarea::placeholder {
  color: var(--ink-3);
}
textarea:disabled {
  cursor: not-allowed;
}
.counter {
  align-self: center;
  font-size: 12px;
  color: var(--ink-3);
}
.counter.over {
  color: var(--issue);
}
.action {
  display: grid;
  flex: none;
  place-items: center;
  width: 36px;
  height: 36px;
  border: 0;
  border-radius: 50%;
  background: var(--accent);
  color: var(--accent-ink);
  transition:
    background 0.15s,
    transform 0.1s;
}
.action:hover:not(:disabled) {
  background: var(--accent-hover);
}
.action:active:not(:disabled) {
  transform: scale(0.94);
}
.action:disabled {
  background: var(--surface-3);
  color: var(--ink-3);
  cursor: not-allowed;
}
.action.stop {
  background: var(--ink);
  color: var(--surface);
}
.action.stop:hover {
  background: var(--ink-2);
}
.hint {
  max-width: var(--thread-width);
  margin: 8px auto 0;
  font-size: 12px;
  text-align: center;
  color: var(--ink-3);
}
@media (max-width: 860px) {
  .composer {
    padding: 8px 12px 12px;
  }
  .hint {
    display: none;
  }
}
</style>
