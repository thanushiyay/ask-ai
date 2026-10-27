<script setup>
import AppIcon from '@/components/ui/AppIcon.vue';
import { SUGGESTIONS } from '@/constants/examples.js';

defineProps({ disabled: Boolean, missingKey: Boolean });
defineEmits(['pick']);
</script>

<template>
  <section class="welcome">
    <div class="hero">
      <h2>What should we get done today?</h2>
      <p>
        Describe it the way you'd tell a colleague. Ask AI plans the steps across your CRM, shows each one as
        it runs, and waits for your approval before sending, deleting or changing many records.
      </p>
    </div>

    <div v-if="missingKey" class="notice wait" role="status">
      <AppIcon class="notice-icon" name="info" :size="18" />
      <div>
        <strong>Connect a model to start chatting</strong>
        <p>
          Add <code>OPENAI_API_KEY=sk-…</code> to <code>server/.env</code>, restart the server and refresh
          this page. You can still browse the data and all 500 actions under Details.
        </p>
      </div>
    </div>

    <div class="grid">
      <button
        v-for="s in SUGGESTIONS"
        :key="s.title"
        class="card"
        :disabled="disabled"
        @click="$emit('pick', s.prompt)"
      >
        <span class="top">
          <span class="ic"><AppIcon :name="s.icon" :size="16" /></span>
          <span class="kind">{{ s.kind }}</span>
        </span>
        <strong>{{ s.title }}</strong>
        <span class="prompt">{{ s.prompt }}</span>
      </button>
    </div>

    <p class="facts">
      <span><AppIcon name="shield" :size="15" /> Risky actions wait for you</span>
      <span><AppIcon name="database" :size="15" /> Sample data, reset anytime</span>
      <span><AppIcon name="bolt" :size="15" /> 500 actions across 50 areas</span>
    </p>
  </section>
</template>

<style scoped>
.welcome {
  display: flex;
  flex-direction: column;
  gap: 28px;
  max-width: 820px;
  margin: 0 auto;
  padding: 7vh 0 24px;
}
.hero {
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-width: 600px;
}
h2 {
  font-size: clamp(28px, 3.6vw, 40px);
  font-weight: 600;
  line-height: 1.1;
  letter-spacing: -0.032em;
}
.hero p {
  font-size: 16px;
  color: var(--ink-2);
}
.grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}
.card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 14px 15px 15px;
  border: 1px solid var(--line);
  border-radius: var(--r-lg);
  background: var(--surface);
  text-align: left;
  transition:
    border-color 0.15s,
    background 0.15s;
}
.card:hover:not(:disabled) {
  border-color: var(--accent-line);
  background: var(--accent-soft);
}
.card:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
.top {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}
.ic {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border-radius: 8px;
  background: var(--surface-2);
  color: var(--accent);
}
.kind {
  font-size: 12px;
  color: var(--ink-3);
}
.card strong {
  font-size: 14.5px;
  font-weight: 600;
}
.prompt {
  display: -webkit-box;
  overflow: hidden;
  font-size: 13px;
  color: var(--ink-2);
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
}
.facts {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 22px;
  font-size: 13px;
  color: var(--ink-3);
}
.facts span {
  display: inline-flex;
  align-items: center;
  gap: 7px;
}
@media (max-width: 900px) {
  .grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
@media (max-width: 560px) {
  .grid {
    grid-template-columns: 1fr;
  }
  .welcome {
    padding-top: 20px;
  }
}
</style>
