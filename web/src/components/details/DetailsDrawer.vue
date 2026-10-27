<script setup>
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import AppIcon from '@/components/ui/AppIcon.vue';
import RunPanel from '@/components/details/RunPanel.vue';
import DataPanel from '@/components/details/DataPanel.vue';
import CatalogPanel from '@/components/details/CatalogPanel.vue';
import BenchPanel from '@/components/details/BenchPanel.vue';

defineProps({ tab: { type: String, default: 'run' }, requestId: String, dataVersion: Number });
const emit = defineEmits(['update:tab', 'close']);

const TABS = [
  {
    id: 'run',
    label: 'Activity',
    icon: 'activity',
    desc: 'What the last request did: steps, model calls, time and cost.',
  },
  {
    id: 'data',
    label: 'Data',
    icon: 'database',
    desc: 'Browse the sample records and see what Ask AI changed.',
  },
  {
    id: 'catalog',
    label: 'Actions',
    icon: 'bolt',
    desc: 'Everything Ask AI can do: 500 actions across 50 areas.',
  },
  {
    id: 'bench',
    label: 'Benchmark',
    icon: 'chart',
    desc: 'Speed, cost and accuracy measured on 114 test scenarios.',
  },
];

const drawer = ref(null);
let previousFocus = null;

function onKey(event) {
  if (event.key === 'Escape') emit('close');
}
onMounted(() => {
  previousFocus = document.activeElement;
  window.addEventListener('keydown', onKey);
  nextTick(() => drawer.value?.focus());
});
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey);
  previousFocus?.focus?.();
});
</script>

<template>
  <div class="overlay" @click.self="emit('close')">
    <aside
      ref="drawer"
      class="drawer"
      role="dialog"
      aria-modal="true"
      aria-labelledby="details-title"
      tabindex="-1"
    >
      <header>
        <h3 id="details-title">Details</h3>
        <button class="btn ghost icon-only" aria-label="Close details" @click="emit('close')">
          <AppIcon name="x" />
        </button>
      </header>
      <nav class="tabs" role="tablist" aria-label="Details sections">
        <button
          v-for="t in TABS"
          :key="t.id"
          role="tab"
          :aria-selected="tab === t.id"
          :class="{ on: tab === t.id }"
          @click="emit('update:tab', t.id)"
        >
          <AppIcon :name="t.icon" :size="15" /> {{ t.label }}
        </button>
      </nav>
      <p class="desc">{{ TABS.find((t) => t.id === tab)?.desc }}</p>
      <div class="panel scroll" role="tabpanel">
        <RunPanel v-if="tab === 'run'" :request-id="requestId" />
        <DataPanel v-else-if="tab === 'data'" :version="dataVersion" />
        <CatalogPanel v-else-if="tab === 'catalog'" />
        <BenchPanel v-else />
      </div>
    </aside>
  </div>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  z-index: 70;
  display: flex;
  justify-content: flex-end;
  background: var(--scrim);
}
.drawer {
  display: flex;
  flex-direction: column;
  width: min(560px, 100vw);
  height: 100%;
  background: var(--surface);
  box-shadow: var(--shadow-lg);
}
.drawer:focus {
  outline: none;
}
header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 14px 4px 22px;
}
h3 {
  font-size: 17px;
}
.tabs {
  display: flex;
  gap: 2px;
  padding: 6px 16px;
  overflow-x: auto;
}
.tabs button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 12px;
  border: 0;
  border-radius: var(--r-sm);
  background: none;
  font-size: 13.5px;
  font-weight: 500;
  white-space: nowrap;
  color: var(--ink-2);
}
.tabs button:hover {
  background: var(--surface-2);
}
.tabs button.on {
  background: var(--accent-soft);
  color: var(--accent);
}
.desc {
  padding: 2px 22px 12px;
  border-bottom: 1px solid var(--line);
  font-size: 13px;
  color: var(--ink-3);
}
.panel {
  flex: 1;
  min-height: 0;
  padding: 18px 22px 32px;
}
.panel :deep(h4) {
  margin: 24px 0 8px;
  font-size: 13.5px;
  font-weight: 600;
}
.panel :deep(h4:first-child) {
  margin-top: 0;
}
.panel :deep(.empty) {
  padding: 48px 12px;
  font-size: 14px;
  text-align: center;
  color: var(--ink-3);
}
.panel :deep(.empty strong) {
  display: block;
  margin-bottom: 6px;
  color: var(--ink);
}
.panel :deep(.stats) {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}
.panel :deep(.stat) {
  padding: 11px 13px;
  border-radius: var(--r);
  background: var(--surface-2);
}
.panel :deep(.stat span) {
  display: block;
  font-size: 12px;
  color: var(--ink-3);
}
.panel :deep(.stat strong) {
  font-size: 19px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.01em;
}
.panel :deep(.row) {
  display: flex;
  gap: 8px;
  margin-bottom: 10px;
}
.panel :deep(.note) {
  margin-top: 10px;
  font-size: 12.5px;
  color: var(--ink-3);
}
.panel :deep(.chip-list) {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.panel :deep(.chip-list code) {
  padding: 2px 7px;
  border-radius: 6px;
  background: var(--surface-2);
  font-size: 11.5px;
}
@media (max-width: 560px) {
  .panel {
    padding: 16px;
  }
}
</style>
