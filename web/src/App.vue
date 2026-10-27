<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { api } from '@/lib/api.js';
import { useChat } from '@/composables/useChat.js';
import { useConversationHistory } from '@/composables/useConversationHistory.js';
import { useTheme } from '@/composables/useTheme.js';
import AppIcon from '@/components/ui/AppIcon.vue';
import AppSidebar from '@/components/layout/AppSidebar.vue';
import AppHeader from '@/components/layout/AppHeader.vue';
import WelcomeScreen from '@/components/chat/WelcomeScreen.vue';
import AssistantMessage from '@/components/chat/AssistantMessage.vue';
import ChatComposer from '@/components/chat/ChatComposer.vue';
import DetailsDrawer from '@/components/details/DetailsDrawer.vue';

const TOAST_MS = 2800;
const NEAR_BOTTOM_PX = 120;
const HEALTH_RETRY_MS = 5000;

const health = ref(null);
const draft = ref('');
const sidebarOpen = ref(false);
const drawerOpen = ref(false);
const drawerTab = ref('run');
const dataVersion = ref(0);
const toast = ref(null);
const thread = ref(null);
const composer = ref(null);
const pinnedToBottom = ref(true);
let toastTimer;
let healthTimer;

const { theme, toggle: toggleTheme } = useTheme();
const history = useConversationHistory();
const chat = useChat({
  onEvent: (type) => {
    if (type === 'done') dataVersion.value++;
    if (type === 'start') pinnedToBottom.value = true;
    if (pinnedToBottom.value) scrollToEnd();
  },
  onSettled: () => {
    history.save(chat.sessionId.value, chat.messages.value);
    if (pinnedToBottom.value) scrollToEnd();
    nextTick(() => composer.value?.focus());
  },
});
const { messages, busy, agent, sessionId, lastRequestId, title, latestAssistant } = chat;

const offline = computed(() => health.value?.ok === false);
const missingKey = computed(() => health.value?.hasApiKey === false);
const canChat = computed(() => !offline.value && !missingKey.value);

async function checkHealth() {
  clearTimeout(healthTimer);
  try {
    health.value = await api.health();
  } catch {
    health.value = { ok: false };
    healthTimer = setTimeout(checkHealth, HEALTH_RETRY_MS);
  }
}

function onGlobalKey(event) {
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(event.target?.tagName) || event.target?.isContentEditable;
  if (event.key === '/' && !typing && !drawerOpen.value) {
    event.preventDefault();
    composer.value?.focus();
  }
}

onMounted(() => {
  checkHealth();
  composer.value?.focus();
  window.addEventListener('keydown', onGlobalKey);
});
onBeforeUnmount(() => {
  clearTimeout(toastTimer);
  clearTimeout(healthTimer);
  window.removeEventListener('keydown', onGlobalKey);
});

// A message that errors because the server went away is a good moment to re-check it.
watch(busy, (now, before) => {
  if (before && !now && latestAssistant.value?.error?.kind === 'offline') checkHealth();
});

// Programmatic smooth scrolling only ever moves down, so only an upward scroll means the user is
// reading history; reaching the bottom again re-pins the view.
let lastScrollTop = 0;
function onScroll() {
  const el = thread.value;
  if (!el) return;
  const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
  if (nearBottom) pinnedToBottom.value = true;
  else if (el.scrollTop < lastScrollTop - 4) pinnedToBottom.value = false;
  lastScrollTop = el.scrollTop;
}

function scrollToEnd(smooth = true) {
  nextTick(() => {
    const el = thread.value;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
  });
}

function jumpToLatest() {
  pinnedToBottom.value = true;
  scrollToEnd();
}

function showToast(text, tone = 'good') {
  clearTimeout(toastTimer);
  toast.value = { text, tone };
  toastTimer = setTimeout(() => (toast.value = null), TOAST_MS);
}

function submit(text) {
  if (!canChat.value) return;
  if (chat.send(text)) {
    draft.value = '';
    pinnedToBottom.value = true;
    scrollToEnd();
  }
}

function startNewChat() {
  chat.reset();
  draft.value = '';
  sidebarOpen.value = false;
  nextTick(() => composer.value?.focus());
}

function openConversation(conversation) {
  if (busy.value) {
    showToast('Wait for the current request to finish, or stop it first.', 'wait');
    return;
  }
  chat.restore(conversation);
  sidebarOpen.value = false;
  pinnedToBottom.value = true;
  scrollToEnd(false);
}

function removeConversation(conversation) {
  if (conversation.id === sessionId.value && busy.value) return;
  history.remove(conversation.id);
  if (conversation.id === sessionId.value) startNewChat();
}

async function resetData() {
  if (busy.value) return;
  try {
    await api.reset();
    dataVersion.value++;
    startNewChat();
    showToast('Sample data is back to its starting state');
  } catch (error) {
    showToast(error.message, 'issue');
  }
}

async function copyReply(text) {
  try {
    await navigator.clipboard.writeText(text);
    showToast('Copied to clipboard');
  } catch {
    showToast('Copying is blocked in this browser', 'issue');
  }
}

function openDetails(tab = 'run') {
  drawerTab.value = tab;
  drawerOpen.value = true;
}
</script>

<template>
  <div class="app">
    <AppSidebar
      v-model:agent="agent"
      :conversations="history.conversations.value"
      :active-id="sessionId"
      :health="health"
      :busy="busy"
      :open="sidebarOpen"
      :theme="theme"
      @new-chat="startNewChat"
      @open="openConversation"
      @remove="removeConversation"
      @close="sidebarOpen = false"
      @toggle-theme="toggleTheme"
    />

    <main class="main">
      <AppHeader
        :title="messages.length ? title : 'New conversation'"
        :busy="busy"
        :can-chat="canChat"
        @menu="sidebarOpen = true"
        @example="submit"
        @reset="resetData"
        @details="openDetails()"
      />

      <div v-if="offline" class="banner" role="status">
        <AppIcon name="offline" :size="16" />
        <span>Can't reach the Ask AI server. Retrying every few seconds…</span>
        <button class="btn sm" @click="checkHealth">Retry now</button>
      </div>

      <div ref="thread" class="thread-scroll scroll" @scroll.passive="onScroll">
        <WelcomeScreen
          v-if="!messages.length"
          :disabled="busy || !canChat"
          :missing-key="missingKey"
          @pick="submit"
        />
        <div v-else class="thread" aria-live="polite" aria-relevant="additions">
          <template v-for="(m, i) in messages" :key="m.createdAt ?? i">
            <div v-if="m.role === 'user'" class="user-message" :class="{ system: m.system }">
              <p v-if="m.system">
                <AppIcon :name="m.text === 'Approved' ? 'check' : 'x'" :size="13" />
                {{ m.text }}
              </p>
              <p v-else>{{ m.text }}</p>
            </div>
            <AssistantMessage
              v-else
              :message="m"
              :busy="busy"
              :interactive="m === latestAssistant"
              @confirm="chat.confirm(m)"
              @cancel="chat.cancel(m)"
              @choose="(option) => chat.choose(m, option)"
              @retry="chat.retry(m)"
              @copy="copyReply"
              @inspect="openDetails('run')"
            />
          </template>
        </div>
      </div>

      <div class="composer-dock">
        <Transition name="lift">
          <button
            v-if="!pinnedToBottom && messages.length"
            class="jump"
            aria-label="Jump to latest message"
            @click="jumpToLatest"
          >
            <AppIcon name="arrowDown" :size="16" />
          </button>
        </Transition>
        <ChatComposer
          ref="composer"
          v-model="draft"
          :busy="busy"
          :disabled="!canChat"
          :disabled-reason="offline ? 'Waiting for the server…' : missingKey ? 'Add an API key to start' : ''"
          @submit="submit"
          @stop="chat.stop()"
        />
      </div>
    </main>

    <Transition name="drawer">
      <DetailsDrawer
        v-if="drawerOpen"
        v-model:tab="drawerTab"
        :request-id="lastRequestId"
        :data-version="dataVersion"
        @close="drawerOpen = false"
      />
    </Transition>

    <Transition name="lift">
      <div v-if="toast" class="toast" :class="toast.tone" role="status">
        <AppIcon :name="toast.tone === 'good' ? 'check' : 'attention'" :size="16" />
        {{ toast.text }}
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.app {
  display: grid;
  grid-template-columns: 272px minmax(0, 1fr);
  height: 100vh;
  height: 100dvh;
  background: var(--bg);
}
.main {
  position: relative;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  background: var(--surface);
}
.banner {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 20px;
  border-bottom: 1px solid var(--wait-line);
  background: var(--wait-soft);
  font-size: 13.5px;
  color: var(--ink-2);
}
.banner .icon {
  color: var(--wait);
}
.banner span {
  flex: 1;
}
.thread-scroll {
  flex: 1;
  padding: 32px 24px 8px;
}
.thread {
  display: flex;
  flex-direction: column;
  gap: 28px;
  max-width: var(--thread-width);
  margin: 0 auto;
  padding-bottom: 24px;
}
.user-message {
  display: flex;
  justify-content: flex-end;
}
.user-message p {
  max-width: min(560px, 85%);
  padding: 10px 15px;
  border-radius: var(--r-lg) var(--r-lg) 4px var(--r-lg);
  background: var(--user-bubble);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.user-message.system p {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 11px;
  border-radius: 999px;
  background: transparent;
  border: 1px solid var(--line);
  font-size: 12.5px;
  color: var(--ink-3);
}
.composer-dock {
  position: relative;
}
.jump {
  position: absolute;
  top: -48px;
  left: 50%;
  z-index: 5;
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  border: 1px solid var(--line);
  border-radius: 50%;
  background: var(--surface);
  color: var(--ink-2);
  box-shadow: var(--shadow);
  transform: translateX(-50%);
}
.jump:hover {
  color: var(--ink);
}
.toast {
  position: fixed;
  bottom: 108px;
  left: 50%;
  z-index: 90;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  max-width: calc(100vw - 32px);
  padding: 9px 15px;
  border-radius: 999px;
  background: var(--ink);
  font-size: 13.5px;
  color: var(--surface);
  box-shadow: var(--shadow-lg);
  transform: translateX(-50%);
}
.toast.good .icon {
  color: var(--accent-line);
}
.toast.issue .icon,
.toast.wait .icon {
  color: var(--wait-line);
}
.lift-enter-active,
.lift-leave-active {
  transition:
    opacity 0.2s var(--ease),
    translate 0.2s var(--ease);
}
.lift-enter-from,
.lift-leave-to {
  opacity: 0;
  translate: 0 6px;
}
@media (max-width: 860px) {
  .app {
    grid-template-columns: 1fr;
  }
  .thread-scroll {
    padding: 20px 14px 8px;
  }
  .banner {
    padding: 8px 14px;
  }
}
</style>
