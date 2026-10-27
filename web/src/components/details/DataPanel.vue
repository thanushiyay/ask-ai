<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { api } from '@/lib/api.js';

const SEARCH_DELAY_MS = 250;

const props = defineProps({ version: Number });
const overview = ref(null);
const col = ref('tasks');
const q = ref('');
const rows = ref(null);
const open = ref(null);
const error = ref('');
let searchTimer;

const cols = computed(() =>
  Object.keys(overview.value?.counts ?? {})
    .filter((c) => !c.startsWith('_'))
    .sort(),
);
const changed = computed(() => new Set(rows.value?.changedIds ?? []));
const nice = (c) => c.replace(/_/g, ' ').replace(/^./, (x) => x.toUpperCase());
const title = (r) =>
  r.name ??
  r.title ??
  r.subject ??
  r.number ??
  r.code ??
  (typeof r.body === 'string' ? r.body.slice(0, 50) : null) ??
  r.id;
let latest = 0;

async function loadRows() {
  const ticket = ++latest; // ignore responses that arrive after a newer query
  try {
    const result = await api.collection(col.value, q.value);
    if (ticket === latest) rows.value = result;
  } catch (e) {
    if (ticket === latest) error.value = e.message;
  }
}

async function load() {
  error.value = '';
  try {
    overview.value = await api.data();
    if (!overview.value.counts?.[col.value]) col.value = cols.value[0] ?? col.value;
    await loadRows();
  } catch (e) {
    error.value = e.message;
  }
}

watch(() => props.version, load, { immediate: true });
watch(col, () => {
  open.value = null;
  loadRows();
});
watch(q, () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(loadRows, SEARCH_DELAY_MS);
});
onBeforeUnmount(() => clearTimeout(searchTimer));

const OPS = { create: 'Created', update: 'Updated', delete: 'Deleted' };
</script>

<template>
  <div v-if="error" class="notice issue">
    <div style="flex: 1">
      <strong>Couldn't load the data</strong>
      <p>{{ error }}</p>
    </div>
    <button class="btn sm" @click="load">Try again</button>
  </div>
  <div v-else-if="!overview" class="empty">Loading data…</div>
  <div v-else>
    <h4>Recent changes</h4>
    <p v-if="!overview.recentChanges?.length" class="muted" style="font-size: 13px">
      Nothing has changed yet. Records Ask AI creates or updates show up here.
    </p>
    <table v-else class="table">
      <tbody>
        <tr
          v-for="(c, i) in overview.recentChanges.slice(0, 10)"
          :key="i"
          class="click"
          @click="col = c.collection"
        >
          <td :class="c.op === 'delete' ? 'issue-text' : 'good-text'" style="white-space: nowrap">
            {{ OPS[c.op] ?? c.op }}
          </td>
          <td>{{ nice(c.collection) }}</td>
          <td>
            <code>{{ c.id }}</code>
          </td>
        </tr>
      </tbody>
    </table>

    <h4>Browse records</h4>
    <div class="row">
      <select v-model="col" class="input" style="width: 48%" aria-label="Record type">
        <option v-for="c in cols" :key="c" :value="c">{{ nice(c) }} ({{ overview.counts[c] }})</option>
      </select>
      <input
        v-model="q"
        class="input"
        type="search"
        placeholder="Search records"
        aria-label="Search records"
      />
    </div>
    <p v-if="rows && !rows.items.length" class="muted" style="font-size: 13px">No records match.</p>
    <table v-else-if="rows" class="table">
      <tbody>
        <template v-for="r in rows.items" :key="r.id">
          <tr
            class="click"
            :class="{ changed: changed.has(r.id) }"
            :aria-expanded="open === r.id"
            @click="open = open === r.id ? null : r.id"
          >
            <td>
              {{ title(r) }}
              <div class="muted" style="font-size: 12px">
                <code>{{ r.id }}</code>
              </div>
            </td>
            <td class="muted" style="white-space: nowrap">{{ r.status ?? '' }}</td>
          </tr>
          <tr v-if="open === r.id">
            <td colspan="2">
              <pre>{{ JSON.stringify(r, null, 2) }}</pre>
            </td>
          </tr>
        </template>
      </tbody>
    </table>
    <p v-if="rows" class="note">
      Showing {{ rows.items.length }} of {{ rows.total }}. Highlighted rows were created or changed by Ask AI.
    </p>
  </div>
</template>

<style scoped>
tr.changed td {
  background: var(--accent-soft);
}
tr.changed td:first-child {
  box-shadow: inset 2px 0 0 var(--accent);
}
</style>
