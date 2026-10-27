<script setup>
import { computed } from 'vue';
import AppIcon from '@/components/ui/AppIcon.vue';

const MAX_TARGETS = 6;
const REASONS = {
  'externally visible': 'Customers will see this',
  destructive: 'Removes or cancels something',
};

const props = defineProps({
  summary: { type: String, default: '' },
  pending: { type: Array, default: () => [] },
  busy: Boolean,
  interactive: { type: Boolean, default: true },
});
defineEmits(['confirm', 'cancel']);

const reasonText = (reason) => REASONS[reason] ?? 'Changes many records at once';
const total = computed(() => props.pending.reduce((sum, p) => sum + (p.count ?? 1), 0));
</script>

<template>
  <section class="confirmation" aria-label="Approval needed">
    <header>
      <span class="badge"><AppIcon name="shield" :size="16" /></span>
      <div>
        <h3>Review before I continue</h3>
        <p v-if="summary">{{ summary }}</p>
      </div>
    </header>

    <ul>
      <li v-for="item in pending" :key="item.stepId">
        <div class="row">
          <strong>{{ item.label }}</strong>
          <span v-if="item.count > 1" class="count tabular">{{ item.count }} records</span>
        </div>
        <span class="reason">{{ reasonText(item.reason) }}</span>
        <span v-if="item.targets?.length" class="targets">
          {{ item.targets.slice(0, MAX_TARGETS).join(', ')
          }}<template v-if="item.count > MAX_TARGETS">, and {{ item.count - MAX_TARGETS }} more</template>
        </span>
      </li>
    </ul>

    <div v-if="interactive" class="actions">
      <button class="btn primary" :disabled="busy" @click="$emit('confirm')">
        <AppIcon name="check" :size="15" />
        {{ total > 1 ? `Approve ${total} changes` : 'Approve' }}
      </button>
      <button class="btn ghost" :disabled="busy" @click="$emit('cancel')">Cancel</button>
      <span class="hint">You can also reply with changes, like “only the first two”.</span>
    </div>
    <p v-else class="hint">This approval expired because the conversation moved on. Ask again to redo it.</p>
  </section>
</template>

<style scoped>
.confirmation {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 16px;
  border: 1px solid var(--wait-line);
  border-radius: var(--r-lg);
  background: var(--surface);
  box-shadow: var(--shadow-sm);
}
header {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}
.badge {
  display: grid;
  flex: none;
  place-items: center;
  width: 30px;
  height: 30px;
  border-radius: 9px;
  background: var(--wait-soft);
  color: var(--wait);
}
h3 {
  font-size: 14.5px;
}
header p {
  margin-top: 2px;
  font-size: 13.5px;
  color: var(--ink-2);
}
ul {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}
li {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 10px 12px;
  border-radius: var(--r);
  background: var(--surface-2);
  font-size: 14px;
}
.row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
}
.row strong {
  font-weight: 500;
}
.count {
  flex: none;
  font-size: 12.5px;
  color: var(--ink-2);
}
.reason {
  font-size: 12.5px;
  font-weight: 500;
  color: var(--wait);
}
.targets {
  font-size: 13px;
  color: var(--ink-2);
  overflow-wrap: anywhere;
}
.actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.hint {
  font-size: 12.5px;
  color: var(--ink-3);
}
.actions .hint {
  margin-left: 4px;
}
</style>
