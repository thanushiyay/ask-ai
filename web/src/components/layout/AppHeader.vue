<script setup>
import { onBeforeUnmount, ref } from 'vue';
import AppIcon from '@/components/ui/AppIcon.vue';
import { MORE_EXAMPLES } from '@/constants/examples.js';

const CONFIRM_RESET_MS = 4000;

defineProps({ title: { type: String, required: true }, busy: Boolean, canChat: Boolean });
const emit = defineEmits(['menu', 'example', 'reset', 'details']);

const examplesOpen = ref(false);
const confirmingReset = ref(false);
let resetTimer;

function pickExample(prompt) {
  examplesOpen.value = false;
  emit('example', prompt);
}

/** Reset wipes every change made in the demo, so it takes a second click to confirm. */
function onReset() {
  if (!confirmingReset.value) {
    confirmingReset.value = true;
    resetTimer = setTimeout(() => (confirmingReset.value = false), CONFIRM_RESET_MS);
    return;
  }
  clearTimeout(resetTimer);
  confirmingReset.value = false;
  emit('reset');
}

function onMenuKey(event) {
  if (event.key === 'Escape') examplesOpen.value = false;
}

onBeforeUnmount(() => clearTimeout(resetTimer));
</script>

<template>
  <header class="header">
    <button class="btn ghost icon-only menu" aria-label="Open conversations" @click="$emit('menu')">
      <AppIcon name="menu" />
    </button>
    <h1 class="title" :title="title">{{ title }}</h1>
    <div class="actions">
      <div class="examples" @keydown="onMenuKey">
        <button
          class="btn ghost"
          :disabled="busy || !canChat"
          :aria-expanded="examplesOpen"
          aria-haspopup="menu"
          @click="examplesOpen = !examplesOpen"
        >
          <AppIcon name="spark" :size="16" />
          <span class="label">Examples</span>
        </button>
        <Transition name="pop">
          <div v-if="examplesOpen" class="menu-popover" role="menu">
            <p class="menu-title">Try one of these</p>
            <button v-for="p in MORE_EXAMPLES" :key="p" role="menuitem" @click="pickExample(p)">
              {{ p }}
            </button>
          </div>
        </Transition>
        <div v-if="examplesOpen" class="backdrop" @click="examplesOpen = false" />
      </div>
      <button
        class="btn ghost"
        :class="{ confirming: confirmingReset }"
        :disabled="busy"
        :title="confirmingReset ? 'Click again to restore the sample data' : 'Restore the sample data'"
        @click="onReset"
      >
        <AppIcon name="refresh" :size="16" />
        <span class="label">{{ confirmingReset ? 'Click to confirm' : 'Reset data' }}</span>
      </button>
      <button class="btn" @click="$emit('details')">
        <AppIcon name="panel" :size="16" />
        <span class="label">Details</span>
      </button>
    </div>
  </header>
</template>

<style scoped>
.header {
  display: flex;
  align-items: center;
  gap: 12px;
  height: 58px;
  padding: 0 20px;
  border-bottom: 1px solid var(--line);
  background: var(--surface);
}
.menu {
  display: none;
}
.title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  font-size: 14.5px;
  font-weight: 600;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.actions {
  display: flex;
  align-items: center;
  gap: 4px;
}
.examples {
  position: relative;
}
.backdrop {
  position: fixed;
  inset: 0;
  z-index: 29;
}
.menu-popover {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  z-index: 30;
  display: flex;
  flex-direction: column;
  width: 380px;
  padding: 6px;
  border: 1px solid var(--line);
  border-radius: var(--r-lg);
  background: var(--surface);
  box-shadow: var(--shadow-lg);
}
.menu-title {
  padding: 6px 10px 4px;
  font-size: 12.5px;
  color: var(--ink-3);
}
.menu-popover button {
  padding: 9px 10px;
  border: 0;
  border-radius: var(--r-sm);
  background: none;
  font-size: 13.5px;
  line-height: 1.45;
  text-align: left;
  color: var(--ink-2);
}
.menu-popover button:hover,
.menu-popover button:focus-visible {
  background: var(--surface-2);
  color: var(--ink);
}
.confirming {
  background: var(--wait-soft);
  color: var(--wait);
}
.btn.confirming:hover:not(:disabled) {
  background: var(--wait-soft);
  color: var(--wait);
}
.pop-enter-active,
.pop-leave-active {
  transition:
    opacity 0.15s var(--ease),
    translate 0.15s var(--ease);
}
.pop-enter-from,
.pop-leave-to {
  opacity: 0;
  translate: 0 -4px;
}
@media (max-width: 860px) {
  .header {
    padding: 0 10px;
  }
  .menu {
    display: inline-flex;
  }
  .label {
    display: none;
  }
  .confirming .label {
    display: inline;
  }
  .menu-popover {
    position: fixed;
    top: 62px;
    right: 10px;
    width: min(360px, calc(100vw - 20px));
  }
}
</style>
