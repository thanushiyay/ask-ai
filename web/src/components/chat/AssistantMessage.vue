<script setup>
import { computed } from 'vue';
import AppIcon from '@/components/ui/AppIcon.vue';
import StepList from '@/components/chat/StepList.vue';
import ConfirmationCard from '@/components/chat/ConfirmationCard.vue';
import { formatCost, formatDuration, plural, renderText } from '@/lib/format.js';

// Outcome chips stay quiet: a coloured dot and a word. Colour is never the only signal.
const OUTCOMES = {
  completed: { tone: 'good', label: 'Done' },
  answer: { tone: 'good', label: 'Answered' },
  partial: { tone: 'issue', label: 'Partly done' },
  failed: { tone: 'issue', label: 'Not completed' },
  clarify: { tone: 'wait', label: 'Needs a detail' },
  confirm: { tone: 'wait', label: 'Waiting for approval' },
  unsupported: { tone: 'neutral', label: 'Not available' },
  cancelled: { tone: 'neutral', label: 'Cancelled' },
  error: { tone: 'issue', label: 'Problem' },
};

const ERROR_TITLES = {
  offline: 'Server unreachable',
  busy: 'Still working on the last request',
  invalid: 'Message not accepted',
  server: 'Something went wrong',
};

const props = defineProps({
  message: { type: Object, required: true },
  busy: Boolean,
  interactive: Boolean,
});
const emit = defineEmits(['confirm', 'cancel', 'choose', 'retry', 'copy', 'inspect']);

const running = computed(() => props.message.status === 'running');
const answer = computed(() => props.message.text || props.message.streamText);
const intro = computed(() => props.message.planMessage || props.message.preview);
const showIntro = computed(
  () => intro.value && !answer.value?.startsWith(intro.value) && !props.message.confirm,
);
const thinking = computed(() => running.value && !intro.value && !props.message.steps.length);
const outcome = computed(() => (running.value ? null : (OUTCOMES[props.message.outcome] ?? null)));
const confirmation = computed(() => props.message.confirm);
const pendingConfirmation = computed(() => confirmation.value && !confirmation.value.resolved);
const choices = computed(() => {
  const clarify = props.message.clarify;
  return clarify && !clarify.resolved && clarify.options?.length ? clarify.options : [];
});
const optionLabel = (option) =>
  typeof option === 'string' ? option : (option?.label ?? option?.name ?? option?.id ?? '');
const error = computed(() => props.message.error);
const copyable = computed(() => (answer.value && !confirmation.value ? answer.value : ''));
const actionCount = computed(() => props.message.metrics?.actionCalls ?? 0);
const canRetry = computed(
  () => props.interactive && props.message.retryable && error.value && error.value.kind !== 'invalid',
);
</script>

<template>
  <article class="assistant" :aria-busy="running">
    <header class="meta">
      <span class="mark" aria-hidden="true"><AppIcon name="logo" :size="13" :stroke-width="2.4" /></span>
      <span class="name">Ask AI</span>
      <span v-if="outcome" class="chip" :class="outcome.tone">
        <i aria-hidden="true" />
        {{ outcome.label }}
      </span>
    </header>

    <div class="body">
      <div v-if="thinking" class="thinking" role="status">
        <span class="pulse" aria-hidden="true" />
        {{ message.statusText }}
      </div>

      <p v-if="showIntro" class="intro">{{ intro }}</p>
      <p v-if="message.assumptions?.length && !confirmation" class="assumptions">
        <AppIcon name="info" :size="14" />
        <span>Assumed {{ message.assumptions.join('; ') }}.</span>
      </p>

      <StepList v-if="message.steps.length" :steps="message.steps" :running="running" />

      <ConfirmationCard
        v-if="pendingConfirmation"
        :summary="intro"
        :pending="confirmation.pending"
        :busy="busy"
        :interactive="interactive"
        @confirm="emit('confirm')"
        @cancel="emit('cancel')"
      />
      <p v-else-if="confirmation?.resolved" class="resolution">
        <AppIcon :name="confirmation.resolved === 'confirmed' ? 'check' : 'minus'" :size="14" />
        {{
          confirmation.resolved === 'confirmed'
            ? 'Approved — the result follows below.'
            : 'Cancelled — nothing was changed.'
        }}
      </p>

      <div
        v-if="answer && !confirmation"
        class="answer"
        :class="{ streaming: running && !message.text }"
        v-html="renderText(answer)"
      />

      <div v-if="choices.length" class="choices" role="group" aria-label="Choose one">
        <button
          v-for="(option, i) in choices"
          :key="option?.id ?? i"
          class="choice"
          :disabled="busy || !interactive"
          @click="emit('choose', option)"
        >
          {{ optionLabel(option) }}
        </button>
        <p v-if="!interactive" class="stale">This question was replaced by a newer message.</p>
      </div>
      <p
        v-else-if="message.clarify?.resolved && typeof message.clarify.resolved === 'string'"
        class="resolution"
      >
        <AppIcon name="check" :size="14" /> You chose {{ message.clarify.resolved }}
      </p>

      <div v-if="error" class="notice issue" role="alert">
        <AppIcon class="notice-icon" :name="error.kind === 'offline' ? 'offline' : 'attention'" :size="18" />
        <div class="notice-body">
          <strong>{{ ERROR_TITLES[error.kind] ?? ERROR_TITLES.server }}</strong>
          <p>{{ error.text }}</p>
        </div>
        <button v-if="canRetry" class="btn sm" :disabled="busy" @click="emit('retry')">
          <AppIcon name="retry" :size="14" /> Try again
        </button>
      </div>
    </div>

    <footer v-if="!running && (message.metrics || answer)" class="footer">
      <template v-if="message.metrics">
        <span title="Total time" class="tabular">
          <AppIcon name="clock" :size="13" /> {{ formatDuration(message.metrics.totalMs) }}
        </span>
        <span v-if="message.metrics.costUsd != null" title="Estimated model cost" class="tabular">
          <AppIcon name="coin" :size="13" /> {{ formatCost(message.metrics.costUsd) }}
        </span>
        <span v-if="actionCount" title="Platform actions run" class="tabular">
          <AppIcon name="bolt" :size="13" /> {{ plural(actionCount, 'action') }}
        </span>
      </template>
      <span class="spacer" />
      <button v-if="copyable" class="link" title="Copy reply" @click="emit('copy', copyable)">
        <AppIcon name="copy" :size="13" /> Copy
      </button>
      <button v-if="message.metrics" class="link" @click="emit('inspect')">
        <AppIcon name="panel" :size="13" /> Details
      </button>
    </footer>
  </article>
</template>

<style scoped>
.assistant {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.meta {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 22px;
}
.mark {
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  border-radius: 7px;
  background: var(--accent);
  color: var(--accent-ink);
}
.name {
  font-size: 13.5px;
  font-weight: 600;
}
.chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-left: 2px;
  font-size: 12.5px;
  color: var(--ink-3);
}
.chip i {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--ink-3);
}
.chip.good i {
  background: var(--ok);
}
.chip.wait i {
  background: var(--wait);
}
.chip.issue i {
  background: var(--issue);
}
.body {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding-left: 30px;
  min-width: 0;
}
.thinking {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 14px;
  color: var(--ink-2);
}
.pulse {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: var(--accent);
  animation: breathe 1.4s var(--ease) infinite;
}
@keyframes breathe {
  0%,
  100% {
    opacity: 0.35;
    transform: scale(0.8);
  }
  50% {
    opacity: 1;
    transform: scale(1.1);
  }
}
.intro {
  font-weight: 500;
}
.assumptions {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  margin-top: -4px;
  font-size: 13px;
  color: var(--ink-3);
}
.assumptions .icon {
  margin-top: 3px;
}
.answer {
  line-height: 1.68;
  overflow-wrap: anywhere;
}
.answer :deep(p) {
  margin: 0 0 9px;
}
.answer :deep(p:last-child) {
  margin-bottom: 0;
}
.answer :deep(p.h) {
  margin-top: 6px;
  font-weight: 600;
}
.answer :deep(ul),
.answer :deep(ol) {
  margin: 4px 0 10px;
  padding-left: 22px;
}
.answer :deep(li) {
  margin: 3px 0;
}
.answer :deep(li::marker) {
  color: var(--ink-3);
}
.answer :deep(code) {
  padding: 1px 5px;
  border-radius: 5px;
  background: var(--surface-2);
}
.answer.streaming::after {
  content: '';
  display: inline-block;
  width: 7px;
  height: 15px;
  margin-left: 2px;
  vertical-align: -2px;
  border-radius: 2px;
  background: var(--accent);
  animation: caret 1s steps(2) infinite;
}
@keyframes caret {
  50% {
    opacity: 0;
  }
}
.resolution {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: var(--ink-3);
}
.choices {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.choice {
  padding: 7px 14px;
  border: 1px solid var(--line-2);
  border-radius: 999px;
  background: var(--surface);
  font-size: 13.5px;
  font-weight: 500;
  text-align: left;
  transition:
    border-color 0.15s,
    background 0.15s;
}
.choice:hover:not(:disabled) {
  border-color: var(--accent);
  background: var(--accent-soft);
}
.choice:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
.stale {
  width: 100%;
  font-size: 12.5px;
  color: var(--ink-3);
}
.notice {
  align-items: center;
}
.notice-body {
  flex: 1;
  min-width: 0;
}
.notice-body p {
  font-size: 13.5px;
}
.footer {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 16px;
  margin-left: 30px;
  font-size: 12.5px;
  color: var(--ink-3);
}
.footer span {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.spacer {
  flex: 1;
}
.link {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 6px;
  border: 0;
  border-radius: 6px;
  background: none;
  font-size: 12.5px;
  font-weight: 500;
  color: var(--ink-3);
}
.link:hover {
  background: var(--surface-2);
  color: var(--ink);
}
@media (max-width: 560px) {
  .body,
  .footer {
    padding-left: 0;
    margin-left: 0;
  }
  .notice {
    flex-wrap: wrap;
  }
}
</style>
