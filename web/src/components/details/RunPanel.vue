<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { api } from '@/lib/api.js';

const POLL_MS = 1200;
const MAX_POLLS = 50; // ~1 minute; a trace that never appears (e.g. after a reset) stops polling

const props = defineProps({ requestId: String });
const trace = ref(null);
const failed = ref('');
const open = ref(null);
const showTimeline = ref(false);
let timer;
let polls = 0;

async function load(id) {
  try {
    const result = await api.trace(id);
    if (id !== props.requestId) return; // a newer request was selected meanwhile
    trace.value = result;
  } catch (error) {
    if (id !== props.requestId) return;
    if (error.status === 404 && ++polls < MAX_POLLS) {
      timer = setTimeout(() => load(id), POLL_MS); // the request is still running
    } else {
      failed.value =
        error.status === 404 ? 'Details for this request are no longer available.' : error.message;
    }
  }
}

watch(
  () => props.requestId,
  (id) => {
    clearTimeout(timer);
    trace.value = null;
    failed.value = '';
    open.value = null;
    polls = 0;
    if (id) load(id);
  },
  { immediate: true },
);
onBeforeUnmount(() => clearTimeout(timer));

const ms = (v) => (v == null ? '–' : v >= 1000 ? `${(v / 1000).toFixed(2)} s` : `${Math.round(v)} ms`);
const usd = (v) => (Number.isFinite(v) ? `$${v.toFixed(5)}` : '–');
const PURPOSE = {
  plan: 'Planning',
  plan_repair: 'Fixing the plan',
  summarize: 'Writing the answer',
  react_step: 'Deciding the next step',
  embed_query: 'Understanding the request',
  embed_catalog: 'Indexing the 500 actions (once)',
};
const SKIP = new Set(['answer_delta', 'step_progress']);
const llmCalls = computed(() => trace.value?.llmCalls ?? []);
const actionCalls = computed(() => trace.value?.actionCalls ?? []);
const timeline = computed(() => (trace.value?.events ?? []).filter((e) => !SKIP.has(e.type)));
</script>

<template>
  <div v-if="!requestId" class="empty">
    <strong>Nothing to show yet</strong>
    Send a message and you'll see exactly what it did here.
  </div>
  <div v-else-if="failed" class="notice issue">
    <div>
      <strong>Couldn't load the details</strong>
      <p>{{ failed }}</p>
    </div>
  </div>
  <div v-else-if="!trace" class="empty">Collecting details…</div>
  <div v-else>
    <div class="stats">
      <div class="stat">
        <span>First useful reply</span><strong>{{ ms(trace.firstUsefulMs) }}</strong>
      </div>
      <div class="stat">
        <span>Total time</span><strong>{{ ms(trace.totalMs) }}</strong>
      </div>
      <div class="stat">
        <span>Model cost (estimated)</span><strong>{{ usd(trace.costUsd) }}</strong>
      </div>
      <div class="stat">
        <span>Model calls · actions run</span
        ><strong>{{ trace.modelCalls ?? 0 }} · {{ actionCalls.length }}</strong>
      </div>
    </div>

    <h4>Model calls</h4>
    <table class="table">
      <thead>
        <tr>
          <th>Purpose</th>
          <th>Tokens in / cached / out</th>
          <th>Time</th>
          <th>Cost</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(c, i) in llmCalls" :key="i">
          <td>
            {{ PURPOSE[c.purpose] ?? c.purpose }}
            <div class="muted" style="font-size: 12px">{{ c.model }}</div>
            <div v-if="c.error" class="issue-text" style="font-size: 12px">{{ c.error }}</div>
          </td>
          <td class="tabular">
            {{ (c.inputTokens ?? 0).toLocaleString() }} / {{ (c.cachedTokens ?? 0).toLocaleString() }} /
            {{ (c.outputTokens ?? 0).toLocaleString() }}
          </td>
          <td class="tabular">{{ ms(c.ms) }}</td>
          <td class="tabular">{{ usd(c.cost) }}</td>
        </tr>
        <tr v-if="!llmCalls.length">
          <td colspan="4" class="muted">
            No model calls were needed — for example, an approved plan just continued.
          </td>
        </tr>
      </tbody>
    </table>

    <h4>Actions run on your data ({{ actionCalls.length }})</h4>
    <p v-if="!actionCalls.length" class="muted" style="font-size: 13px">None.</p>
    <table v-else class="table">
      <tbody>
        <template v-for="(a, i) in actionCalls" :key="i">
          <tr class="click" :aria-expanded="open === i" @click="open = open === i ? null : i">
            <td>
              <code>{{ a.id }}</code>
            </td>
            <td :class="a.ok ? 'good-text' : 'issue-text'" style="white-space: nowrap">
              {{ a.ok ? 'Succeeded' : "Didn't complete" }}
            </td>
            <td class="muted tabular" style="white-space: nowrap">{{ ms(a.ms) }}</td>
          </tr>
          <tr v-if="open === i">
            <td colspan="3">
              <p v-if="a.error" class="issue-text" style="margin-bottom: 6px; font-size: 13px">
                {{ a.error.message ?? a.error }}
              </p>
              <pre>{{ JSON.stringify(a.args, null, 2) }}</pre>
            </td>
          </tr>
        </template>
      </tbody>
    </table>

    <h4>
      <button class="btn sm" @click="showTimeline = !showTimeline">
        {{ showTimeline ? 'Hide' : 'Show' }} full timeline
      </button>
    </h4>
    <table v-if="showTimeline" class="table">
      <tbody>
        <tr v-for="(e, i) in timeline" :key="i">
          <td class="muted tabular" style="white-space: nowrap">{{ ms(e.t) }}</td>
          <td>
            <strong style="font-weight: 500">{{ e.type }}</strong>
            <span class="muted">
              {{
                e.label ?? e.text ?? e.message ?? (e.tools ? `${e.tools.length} actions considered` : '')
              }}</span
            >
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
