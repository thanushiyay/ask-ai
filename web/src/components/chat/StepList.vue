<script setup>
import { ref, computed, watch } from 'vue';
import AppIcon from '@/components/ui/AppIcon.vue';
import { plural } from '@/lib/format.js';

const COLLAPSE_AFTER = 5;
const ATTENTION = new Set(['failed', 'awaiting', 'question', 'running', 'stopped', 'unknown']);
const STATUS_TEXT = {
  done: 'Done',
  running: 'Running',
  pending: 'Waiting to start',
  awaiting: 'Waiting for your approval',
  question: 'Waiting for your answer',
  failed: "Didn't complete",
  skipped: 'Skipped',
  stopped: 'Stopped',
  unknown: 'Result unknown',
};

const props = defineProps({
  steps: { type: Array, required: true },
  running: Boolean,
});

const showTech = ref(false);
const expanded = ref(true);
const active = computed(() => props.steps.filter((s) => s.status !== 'replaced'));
watch(
  () => props.running,
  (isRunning) => {
    if (!isRunning && active.value.length > COLLAPSE_AFTER) expanded.value = false;
  },
);

const done = computed(() => active.value.filter((s) => s.status === 'done').length);
const problems = computed(() => active.value.filter((s) => s.status === 'failed').length);
const hidden = computed(() => active.value.length - visible.value.length);
const visible = computed(() => {
  if (expanded.value) return active.value;
  const important = active.value.filter((s) => ATTENTION.has(s.status));
  const last = active.value.at(-1);
  return [...new Set([...important, last])].filter(Boolean);
});

const heading = computed(() => {
  if (props.running) return 'Working on it';
  if (active.value.some((s) => s.status === 'awaiting')) return 'Paused for your approval';
  if (active.value.some((s) => s.status === 'question')) return 'Paused until you answer below';
  if (problems.value) return `${plural(done.value, 'step')} done, ${problems.value} didn't complete`;
  return `${plural(done.value, 'step')} completed`;
});

function detail(s) {
  if (s.status === 'failed' || s.status === 'skipped') return s.error;
  if (s.status === 'awaiting') return 'Waiting for your approval';
  if (s.status === 'question') return 'Needs your answer below';
  if (s.status === 'pending' && !props.running) return 'Not started';
  if (s.status === 'stopped') return 'Stopped before it finished';
  if (s.status === 'unknown') return 'The connection closed before this step reported back';
  if (s.progress) return `${s.progress.done} of ${s.progress.total}`;
  if (s.status !== 'done') return null;
  if (s.total != null) {
    const base = `${s.count} of ${s.total} done`;
    return s.failedCount ? `${base} · ${s.failedCount} couldn't be done` : base;
  }
  if (s.count != null)
    return s.op ? `${plural(s.count, 'record')} kept` : `${plural(s.count, 'match', 'matches')}`;
  const r = s.record;
  return r?.name ?? r?.title ?? r?.number ?? r?.subject ?? null;
}

const pct = (s) => (s.progress?.total ? Math.round((s.progress.done / s.progress.total) * 100) : 0);
const ICONS = {
  done: 'check',
  awaiting: 'clock',
  question: 'help',
  failed: 'attention',
  skipped: 'minus',
  stopped: 'minus',
  unknown: 'minus',
};
</script>

<template>
  <section class="steps" :class="{ live: running }" aria-label="Plan progress">
    <header class="head">
      <span class="title">{{ heading }}</span>
      <span class="count tabular">{{ done }}/{{ active.length }}</span>
      <span class="spacer" />
      <button class="link" :aria-pressed="showTech" @click="showTech = !showTech">
        {{ showTech ? 'Hide action names' : 'Show action names' }}
      </button>
    </header>

    <ol class="rail">
      <li v-for="s in visible" :key="s.id" :class="s.status">
        <span class="node" :title="STATUS_TEXT[s.status]">
          <span v-if="s.status === 'running'" class="spin" aria-hidden="true" />
          <AppIcon v-else-if="ICONS[s.status]" :name="ICONS[s.status]" :size="12" :stroke-width="2.4" />
          <span class="sr">{{ STATUS_TEXT[s.status] }}</span>
        </span>
        <div class="txt">
          <span class="label">{{ s.label }}</span>
          <span v-if="detail(s)" class="detail">{{ detail(s) }}</span>
          <span v-if="s.progress" class="mini" aria-hidden="true"
            ><i :style="{ width: `${pct(s)}%` }"
          /></span>
          <code v-if="showTech" class="tech">{{ s.action ?? `${s.op} — runs in code, no model call` }}</code>
        </div>
      </li>
    </ol>

    <button
      v-if="active.length > COLLAPSE_AFTER"
      class="link more"
      :aria-expanded="expanded"
      @click="expanded = !expanded"
    >
      <AppIcon :name="expanded ? 'down' : 'chevron'" :size="14" />
      {{ expanded ? 'Show fewer steps' : `Show all ${active.length} steps (${hidden} hidden)` }}
    </button>
  </section>
</template>

<style scoped>
.steps {
  padding: 14px 16px 12px;
  border: 1px solid var(--line);
  border-radius: var(--r-lg);
  background: var(--surface-2);
}
.steps.live {
  border-color: var(--accent-line);
}
.head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 10px;
  margin-bottom: 10px;
  font-size: 13px;
}
.title {
  font-weight: 600;
}
.count {
  color: var(--ink-3);
}
.spacer {
  flex: 1;
}
.rail {
  position: relative;
  display: flex;
  flex-direction: column;
  margin: 0;
  padding: 0;
  list-style: none;
}
li {
  position: relative;
  display: flex;
  gap: 12px;
  padding: 5px 0 9px;
}
/* The connecting line between nodes; solid where the step is done. */
li:not(:last-child)::before {
  content: '';
  position: absolute;
  top: 27px;
  bottom: -3px;
  left: 10px;
  width: 1.5px;
  border-radius: 1px;
  background: var(--line-2);
}
li.done:not(:last-child)::before {
  background: var(--accent-line);
}
.node {
  position: relative;
  z-index: 1;
  display: grid;
  flex: none;
  place-items: center;
  width: 21px;
  height: 21px;
  border: 1.5px solid var(--line-2);
  border-radius: 50%;
  background: var(--surface);
  color: var(--ink-3);
  transition:
    background 0.25s var(--ease),
    border-color 0.25s var(--ease);
}
.done .node {
  border-color: var(--accent);
  background: var(--accent);
  color: var(--accent-ink);
}
.running .node {
  border-color: var(--accent-line);
}
.awaiting .node,
.question .node {
  border-color: var(--wait);
  background: var(--wait-soft);
  color: var(--wait);
}
.failed .node {
  border-color: var(--issue);
  background: var(--issue-soft);
  color: var(--issue);
}
.skipped .node,
.stopped .node,
.unknown .node {
  border-style: dashed;
}
.spin {
  width: 11px;
  height: 11px;
  border: 2px solid var(--accent);
  border-right-color: transparent;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
.txt {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
  padding-top: 1px;
}
.label {
  font-size: 14px;
  font-weight: 500;
  line-height: 1.4;
}
.pending .label,
.skipped .label,
.stopped .label {
  color: var(--ink-3);
}
.detail {
  font-size: 12.5px;
  color: var(--ink-2);
  overflow-wrap: anywhere;
}
.failed .detail {
  color: var(--issue);
}
.awaiting .detail,
.question .detail {
  color: var(--wait);
}
.mini {
  display: block;
  width: 140px;
  height: 3px;
  margin-top: 4px;
  overflow: hidden;
  border-radius: 2px;
  background: var(--surface-3);
}
.mini i {
  display: block;
  height: 100%;
  background: var(--accent);
  transition: width 0.3s var(--ease);
}
.tech {
  margin-top: 2px;
  font-size: 11.5px;
  color: var(--ink-3);
}
.link {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 0;
  border: 0;
  background: none;
  font-size: 12.5px;
  font-weight: 500;
  color: var(--ink-3);
}
.link:hover {
  color: var(--accent);
}
.more {
  margin: 2px 0 0 33px;
}
</style>
