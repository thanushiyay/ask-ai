<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import AppIcon from '@/components/ui/AppIcon.vue';
import { timeAgo } from '@/lib/format.js';

const emit = defineEmits(['new-chat', 'open', 'remove', 'update:agent', 'close', 'toggle-theme']);

const props = defineProps({
  conversations: { type: Array, required: true },
  activeId: { type: String, default: null },
  agent: { type: String, required: true },
  health: { type: Object, default: null },
  busy: Boolean,
  open: Boolean,
  theme: { type: String, default: 'light' },
});

const MODES = [
  { id: 'optimized', label: 'Smart', hint: 'Plans the whole task at once. Fast and low cost.' },
  { id: 'baseline', label: 'Baseline', hint: 'For comparison: one step at a time, all 500 actions loaded.' },
];

// Re-render relative times ("2 min ago") once a minute.
const now = ref(Date.now());
let ticker;
onMounted(() => (ticker = setInterval(() => (now.value = Date.now()), 60_000)));
onBeforeUnmount(() => clearInterval(ticker));

const today = computed(() => {
  const date = props.health?.now ? new Date(props.health.now) : null;
  if (!date || Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
});

const status = computed(() => {
  const h = props.health;
  if (!h) return { tone: 'neutral', text: 'Connecting…' };
  if (h.ok === false) return { tone: 'issue', text: 'Server unreachable' };
  if (!h.hasApiKey) return { tone: 'wait', text: 'No API key configured' };
  return { tone: 'good', text: `Ready · ${h.models?.planner ?? 'model'}` };
});

const pendingDelete = ref(null);
function askRemove(conversation) {
  pendingDelete.value = pendingDelete.value === conversation.id ? null : conversation.id;
}
function confirmRemove(conversation) {
  pendingDelete.value = null;
  emit('remove', conversation);
}

function onKey(event) {
  if (event.key === 'Escape' && props.open) emit('close');
}
onMounted(() => window.addEventListener('keydown', onKey));
onBeforeUnmount(() => window.removeEventListener('keydown', onKey));
</script>

<template>
  <aside class="sidebar" :class="{ open }" aria-label="Conversations and settings">
    <div class="brand">
      <span class="mark" aria-hidden="true"><AppIcon name="logo" :size="17" :stroke-width="2.4" /></span>
      <div class="brand-text">
        <strong>Ask AI</strong>
        <span>Northwind CRM</span>
      </div>
      <button class="btn ghost icon-only close" aria-label="Close menu" @click="$emit('close')">
        <AppIcon name="x" />
      </button>
    </div>

    <button class="btn primary new-chat" @click="$emit('new-chat')">
      <AppIcon name="plus" :size="16" />
      New conversation
    </button>

    <nav class="history scroll" aria-label="Recent conversations">
      <p class="section">Recent</p>
      <p v-if="!conversations.length" class="empty">
        Conversations you start are kept here, in this browser.
      </p>
      <div
        v-for="c in conversations"
        :key="c.id"
        class="item"
        :class="{ active: c.id === activeId, deleting: pendingDelete === c.id }"
      >
        <template v-if="pendingDelete === c.id">
          <span class="delete-q">Delete this conversation?</span>
          <button class="mini danger" @click="confirmRemove(c)">Delete</button>
          <button class="mini" @click="pendingDelete = null">Keep</button>
        </template>
        <template v-else>
          <button
            class="open"
            :disabled="busy && c.id !== activeId"
            :aria-current="c.id === activeId ? 'page' : undefined"
            @click="$emit('open', c)"
          >
            <span class="item-title">{{ c.title }}</span>
            <span class="item-time">{{ timeAgo(c.updatedAt, now) }}</span>
          </button>
          <button
            class="remove"
            :aria-label="`Delete conversation: ${c.title}`"
            :disabled="busy && c.id === activeId"
            @click="askRemove(c)"
          >
            <AppIcon name="trash" :size="14" />
          </button>
        </template>
      </div>
    </nav>

    <footer class="foot">
      <div class="mode">
        <p class="section">Assistant mode</p>
        <div class="segmented" role="radiogroup" aria-label="Assistant mode">
          <button
            v-for="mode in MODES"
            :key="mode.id"
            role="radio"
            :aria-checked="agent === mode.id"
            :class="{ active: agent === mode.id }"
            :disabled="busy"
            @click="$emit('update:agent', mode.id)"
          >
            {{ mode.label }}
          </button>
        </div>
        <p class="hint">{{ MODES.find((m) => m.id === agent)?.hint }}</p>
      </div>

      <div class="status-row">
        <div class="status" :class="status.tone" role="status">
          <i aria-hidden="true" />
          <span>{{ status.text }}</span>
        </div>
        <button
          class="btn ghost icon-only theme"
          :aria-label="theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'"
          :title="theme === 'dark' ? 'Light theme' : 'Dark theme'"
          @click="$emit('toggle-theme')"
        >
          <AppIcon :name="theme === 'dark' ? 'sun' : 'moon'" :size="16" />
        </button>
      </div>
      <p v-if="today" class="today">Data date: {{ today }}</p>
    </footer>
  </aside>
  <Transition name="fade">
    <div v-if="open" class="scrim" @click="$emit('close')" />
  </Transition>
</template>

<style scoped>
.sidebar {
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-height: 0;
  padding: 16px 12px 14px;
  border-right: 1px solid var(--line);
  background: var(--bg);
}
.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 2px 6px;
}
.mark {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border-radius: 10px;
  background: var(--accent);
  color: var(--accent-ink);
}
.brand-text strong {
  display: block;
  font-size: 15px;
  font-weight: 650;
  line-height: 1.25;
}
.brand-text span {
  display: block;
  font-size: 12.5px;
  color: var(--ink-3);
}
.close {
  display: none;
  margin-left: auto;
}
.new-chat {
  width: 100%;
}
.section {
  padding: 0 8px;
  margin-bottom: 4px;
  font-size: 12.5px;
  font-weight: 500;
  color: var(--ink-3);
}
.history {
  flex: 1;
  min-height: 0;
  margin: 0 -4px;
  padding: 0 4px;
}
.empty {
  padding: 6px 8px;
  font-size: 13px;
  color: var(--ink-3);
}
.item {
  position: relative;
  display: flex;
  align-items: center;
  gap: 4px;
  border-radius: var(--r-sm);
}
.item:hover,
.item.active {
  background: var(--surface-3);
}
.item.deleting {
  flex-wrap: wrap;
  padding: 8px;
  background: var(--issue-soft);
}
.open {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  padding: 7px 8px;
  border: 0;
  background: none;
  text-align: left;
}
.open:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}
.item-title {
  overflow: hidden;
  font-size: 13.5px;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.active .item-title {
  font-weight: 500;
}
.item-time {
  font-size: 11.5px;
  color: var(--ink-3);
}
.remove {
  display: grid;
  flex: none;
  place-items: center;
  width: 28px;
  height: 28px;
  margin-right: 4px;
  border: 0;
  border-radius: 6px;
  background: none;
  color: var(--ink-3);
  opacity: 0;
  transition: opacity 0.15s;
}
.item:hover .remove,
.item.active .remove,
.remove:focus-visible {
  opacity: 1;
}
.remove:hover:not(:disabled) {
  background: var(--surface);
  color: var(--issue);
}
.delete-q {
  width: 100%;
  margin-bottom: 6px;
  font-size: 13px;
}
.mini {
  padding: 3px 10px;
  border: 1px solid var(--line-2);
  border-radius: 6px;
  background: var(--surface);
  font-size: 12.5px;
}
.mini.danger {
  border-color: var(--issue);
  background: var(--issue);
  color: var(--surface);
}
.foot {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--line);
}
.segmented {
  display: grid;
  grid-template-columns: 1fr 1fr;
  padding: 3px;
  border-radius: var(--r-sm);
  background: var(--surface-3);
}
.segmented button {
  padding: 5px 8px;
  border: 0;
  border-radius: 6px;
  background: none;
  font-size: 13px;
  font-weight: 500;
  color: var(--ink-2);
}
.segmented button.active {
  background: var(--surface);
  color: var(--ink);
  box-shadow: var(--shadow-sm);
}
.segmented button:disabled {
  cursor: not-allowed;
}
.hint {
  margin-top: 6px;
  padding: 0 4px;
  font-size: 12px;
  line-height: 1.45;
  color: var(--ink-3);
}
.status-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.status {
  display: flex;
  flex: 1;
  align-items: center;
  gap: 8px;
  min-width: 0;
  padding: 0 4px;
  font-size: 12.5px;
  color: var(--ink-2);
}
.status span {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.status i {
  flex: none;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--ink-3);
}
.status.good i {
  background: var(--ok);
  box-shadow: 0 0 0 3px var(--ok-soft);
}
.status.wait i {
  background: var(--wait);
}
.status.issue i {
  background: var(--issue);
}
.today {
  padding: 0 4px;
  font-size: 12px;
  color: var(--ink-3);
}
.scrim {
  display: none;
}
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
@media (max-width: 860px) {
  .sidebar {
    position: fixed;
    inset: 0 auto 0 0;
    z-index: 80;
    width: min(300px, 86vw);
    box-shadow: var(--shadow-lg);
    transform: translateX(-102%);
    visibility: hidden;
    transition:
      transform 0.25s var(--ease),
      visibility 0s linear 0.25s;
  }
  .sidebar.open {
    transform: none;
    visibility: visible;
    transition: transform 0.25s var(--ease);
  }
  .close {
    display: inline-flex;
  }
  .remove {
    opacity: 1;
  }
  .scrim {
    position: fixed;
    inset: 0;
    z-index: 79;
    display: block;
    background: var(--scrim);
  }
}
</style>
