<script setup>
import { computed, onMounted, ref } from 'vue';
import { api } from '@/lib/api.js';

const report = ref(null);
const error = ref('');

async function load() {
  error.value = '';
  try {
    report.value = await api.benchmark();
  } catch (e) {
    error.value = e.message;
  }
}
onMounted(load);

const pct = (v) => (Number.isFinite(v) ? `${(v * 100).toFixed(1)}%` : '–');
const ms = (v) =>
  !Number.isFinite(v) ? '–' : v >= 1000 ? `${(v / 1000).toFixed(2)} s` : `${Math.round(v)} ms`;
const usd = (v) => (Number.isFinite(v) ? `$${v.toFixed(4)}` : '–');

const opt = computed(() => report.value?.runs?.optimized?.summary ?? null);
const base = computed(() => report.value?.runs?.baseline?.summary ?? null);
const targets = computed(() => report.value?.targets?.optimized ?? []);
const measured = computed(() => targets.value.filter((t) => t.measured !== false));
const failures = computed(() => opt.value?.failures ?? []);
const rows = computed(() => [
  ['Tasks done correctly', (s) => pct(s?.quality?.taskSuccess)],
  ['Right actions chosen', (s) => pct(s?.quality?.actionSelection)],
  ['Simple request, typical time', (s) => ms(s?.latency?.direct?.endToEnd?.p50)],
  ['Complex request, first real result', (s) => ms(s?.latency?.complex?.firstResult?.p50)],
  ['Complex request, slowest 5%', (s) => ms(s?.latency?.complex?.endToEnd?.p95)],
  ['Cost per request', (s) => usd(s?.cost?.perRequestUsd)],
  ['Cost per successful task', (s) => usd(s?.cost?.perSuccessfulTaskUsd)],
  ['Model calls per request', (s) => s?.cost?.modelCallsPerRequest ?? '–'],
]);
</script>

<template>
  <div v-if="error" class="notice issue">
    <div style="flex: 1">
      <strong>Couldn't load the benchmark</strong>
      <p>{{ error }}</p>
    </div>
    <button class="btn sm" @click="load">Try again</button>
  </div>
  <div v-else-if="!report" class="empty">Loading…</div>
  <div v-else-if="!report.available || !opt" class="empty">
    <strong>No benchmark yet</strong>
    Run <code>npm run bench</code> from the project folder. It runs both assistant modes on 114 scenarios and
    the results appear here.
  </div>
  <div v-else>
    <div class="stats">
      <div class="stat">
        <span>Tasks done correctly</span><strong>{{ pct(opt.quality?.taskSuccess) }}</strong>
      </div>
      <div class="stat">
        <span>Cost per request</span><strong>{{ usd(opt.cost?.perRequestUsd) }}</strong>
      </div>
      <div class="stat">
        <span>Simple request, typical time</span><strong>{{ ms(opt.latency?.direct?.endToEnd?.p50) }}</strong>
      </div>
      <div class="stat">
        <span>Targets met</span
        ><strong>{{ measured.filter((t) => t.met).length }} / {{ measured.length }}</strong>
      </div>
    </div>

    <template v-if="targets.length">
      <h4>Targets</h4>
      <table class="table">
        <thead>
          <tr>
            <th>Metric</th>
            <th>Goal</th>
            <th>Result</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="t in targets" :key="t.name">
            <td>{{ t.name }}</td>
            <td class="muted">{{ t.targetDisplay }}</td>
            <td v-if="t.measured === false" class="muted">Not measured</td>
            <td v-else :class="t.met ? 'good-text' : 'issue-text'">
              {{ t.display }}{{ t.met ? '' : ' (missed)' }}
            </td>
          </tr>
        </tbody>
      </table>
    </template>

    <template v-if="base">
      <h4>Smart vs baseline</h4>
      <table class="table">
        <thead>
          <tr>
            <th></th>
            <th>Baseline</th>
            <th>Smart</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="[label, fmt] in rows" :key="label">
            <td>{{ label }}</td>
            <td class="tabular">{{ fmt(base) }}</td>
            <td class="tabular">{{ fmt(opt) }}</td>
          </tr>
        </tbody>
      </table>
    </template>

    <h4>Scenarios that failed ({{ failures.length }})</h4>
    <p v-if="!failures.length" class="muted" style="font-size: 13px">None.</p>
    <ul v-else style="margin: 0; padding-left: 18px; font-size: 13px">
      <li v-for="f in failures" :key="f.id" style="margin-bottom: 4px">
        <strong style="font-weight: 500">{{ f.id }}</strong
        >: {{ (f.failed ?? []).join('; ') }}
      </li>
    </ul>
  </div>
</template>
