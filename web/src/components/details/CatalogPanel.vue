<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { api } from '@/lib/api.js';

const PROBE_DELAY_MS = 250;
const RENDER_LIMIT = 150;

const cat = ref(null);
const error = ref('');
const q = ref('');
const mod = ref('');
const probe = ref('');
const probeResult = ref(null);
const probeError = ref('');
const open = ref(null);
let probeTimer;
let probeTicket = 0;

async function load() {
  error.value = '';
  try {
    cat.value = await api.catalog();
  } catch (e) {
    error.value = e.message;
  }
}
onMounted(load);
onBeforeUnmount(() => clearTimeout(probeTimer));

const filtered = computed(() => {
  if (!cat.value) return [];
  const s = q.value.trim().toLowerCase();
  return cat.value.actions.filter(
    (a) =>
      (!mod.value || a.module === mod.value) &&
      (!s || `${a.id} ${a.title} ${a.description}`.toLowerCase().includes(s)),
  );
});
const shown = computed(() => filtered.value.slice(0, RENDER_LIMIT));

watch(probe, (value) => {
  clearTimeout(probeTimer);
  const text = value.trim();
  if (!text) {
    probeResult.value = null;
    probeError.value = '';
    return;
  }
  probeTimer = setTimeout(async () => {
    const ticket = ++probeTicket;
    try {
      const result = await api.searchTools(text);
      if (ticket === probeTicket) {
        probeResult.value = result;
        probeError.value = '';
      }
    } catch (e) {
      if (ticket === probeTicket) probeError.value = e.message;
    }
  }, PROBE_DELAY_MS);
});

const EFFECT = {
  read: 'Looks up data',
  write: 'Changes data',
  destructive: 'Removes or cancels',
  external: 'Customers can see it',
};
</script>

<template>
  <div v-if="error" class="notice issue">
    <div style="flex: 1">
      <strong>Couldn't load the actions</strong>
      <p>{{ error }}</p>
    </div>
    <button class="btn sm" @click="load">Try again</button>
  </div>
  <div v-else-if="!cat" class="empty">Loading actions…</div>
  <div v-else>
    <h4>Which actions would Ask AI consider?</h4>
    <input
      v-model="probe"
      class="input"
      type="search"
      maxlength="2000"
      placeholder="Type a request, e.g. “refund Julian $20”"
      aria-label="Test a request"
    />
    <p v-if="probeError" class="note issue-text">{{ probeError }}</p>
    <div v-else-if="probeResult" style="margin-top: 10px">
      <p class="muted" style="margin-bottom: 8px; font-size: 12.5px">
        {{ probeResult.ids?.length ?? 0 }} of 500 picked in {{ (probeResult.ms ?? 0).toFixed(1) }} ms. Closest
        areas:
        {{
          (probeResult.moduleTop ?? [])
            .map((m) => m.id)
            .slice(0, 3)
            .join(', ') || 'none'
        }}.
      </p>
      <div class="chip-list">
        <code v-for="id in probeResult.ids ?? []" :key="id">{{ id }}</code>
      </div>
    </div>

    <h4>All actions</h4>
    <div class="row">
      <select v-model="mod" class="input" style="width: 45%" aria-label="Area">
        <option value="">All 50 areas</option>
        <option v-for="m in cat.modules" :key="m.id" :value="m.id">{{ m.title }}</option>
      </select>
      <input
        v-model="q"
        class="input"
        type="search"
        placeholder="Search actions"
        aria-label="Search actions"
      />
    </div>
    <p class="muted" style="margin-bottom: 6px; font-size: 12.5px">
      {{ filtered.length }} actions<template v-if="filtered.length > RENDER_LIMIT">
        — showing the first {{ RENDER_LIMIT }}; narrow the search to see more</template
      >
    </p>
    <table class="table">
      <tbody>
        <template v-for="a in shown" :key="a.id">
          <tr class="click" :aria-expanded="open === a.id" @click="open = open === a.id ? null : a.id">
            <td>
              <span style="font-weight: 500">{{ a.title }}</span>
              <div class="muted" style="font-size: 12px">{{ a.description }}</div>
            </td>
            <td class="muted" style="font-size: 12px; white-space: nowrap">
              {{ EFFECT[a.effect] ?? a.effect }}
            </td>
          </tr>
          <tr v-if="open === a.id">
            <td colspan="2">
              <p class="muted" style="margin-bottom: 6px; font-size: 12px">
                {{ a.ref }} · <code>{{ a.id }}</code>
              </p>
              <pre>{{ a.signature }}</pre>
            </td>
          </tr>
        </template>
      </tbody>
    </table>
  </div>
</template>
