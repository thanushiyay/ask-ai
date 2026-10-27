<script setup>
const props = defineProps({
  name: { type: String, required: true },
  size: { type: Number, default: 18 },
  strokeWidth: { type: Number, default: 1.7 },
});

const P = {
  plus: 'M12 5v14M5 12h14',
  send: 'M12 19V5M5.5 11.5 12 5l6.5 6.5',
  stop: 'M8 7h8a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1z',
  logo: 'M7 18.5 12 6l5 12.5M9 14h6',
  spark:
    'M12 4l1.6 4.4L18 10l-4.4 1.6L12 16l-1.6-4.4L6 10l4.4-1.6L12 4zM18.5 15.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7.7-1.8z',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  x: 'M6 6l12 12M18 6L6 18',
  // A soft "needs attention" mark: a circle with a short line, used instead of a red warning triangle.
  attention: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 8v4.5M12 16h.01',
  help: 'M9.2 9.2a2.9 2.9 0 0 1 5.6 1c0 1.9-2.8 2.4-2.8 4.3M12 17.5h.01M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z',
  clock: 'M12 7.5V12l3 2M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z',
  coin: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM14.8 9.6c-.5-.9-1.5-1.4-2.8-1.4-1.6 0-2.8.8-2.8 1.9s1.2 1.5 2.8 1.9 2.8.9 2.8 1.9-1.2 1.9-2.8 1.9c-1.3 0-2.3-.5-2.8-1.4M12 6.5v1.7M12 15.8v1.7',
  panel: 'M4.5 5h15a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM14.5 5v14',
  database:
    'M4.5 6.5c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3-3.4-3-7.5-3-7.5 1.3-7.5 3zM4.5 6.5v11c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3v-11M4.5 12c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3',
  list: 'M9 6.5h11M9 12h11M9 17.5h11M4.5 6.5h.01M4.5 12h.01M4.5 17.5h.01',
  chart: 'M4 20V11M10 20V5M16 20v-7M21 20H3',
  activity: 'M3 12h4l3-7 4 14 3-7h4',
  refresh: 'M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4.5v4h-4',
  retry: 'M4.5 12a7.5 7.5 0 1 0 2.2-5.3M4.5 4.5v4h4',
  chevron: 'M9.5 6l6 6-6 6',
  down: 'M6 9.5l6 6 6-6',
  arrowDown: 'M12 5v14M6 13l6 6 6-6',
  chat: 'M20 11.5a7.5 7.5 0 0 1-11 6.6L4.5 19.5l1.3-4.2A7.5 7.5 0 1 1 20 11.5z',
  trash: 'M5 7h14M10 11v5.5M14 11v5.5M6.5 7l.8 12h9.4l.8-12M9.5 7V4.5h5V7',
  bolt: 'M13 3 5 13.5h6L10 21l8-10.5h-6L13 3z',
  users:
    'M15.5 19.5v-1.2a3.3 3.3 0 0 0-3.3-3.3H7.3A3.3 3.3 0 0 0 4 18.3v1.2M9.8 11.5a3.3 3.3 0 1 0 0-6.6 3.3 3.3 0 0 0 0 6.6zM20 19.5v-1.2a3.3 3.3 0 0 0-2.4-3.2M15.3 5a3.3 3.3 0 0 1 0 6.4',
  route:
    'M6 19.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM18 8.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM8 17.5h7a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h7',
  filter: 'M4 5.5h16l-6.2 7.2v5.6l-3.6 1.8v-7.4L4 5.5z',
  shield: 'M12 3.5 19 6v5.6c0 4.2-3 7.7-7 8.9-4-1.2-7-4.7-7-8.9V6l7-2.5z',
  ban: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM5.6 5.6l12.8 12.8',
  menu: 'M4 7h16M4 12h16M4 17h16',
  search: 'M11 18.5a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15zM20.5 20.5l-4.2-4.2',
  info: 'M12 16.5v-5M12 8h.01M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z',
  sun: 'M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4',
  moon: 'M19.5 14.5A7.5 7.5 0 0 1 9.5 4.5a7.5 7.5 0 1 0 10 10z',
  copy: 'M9 9h9.5a1 1 0 0 1 1 1v9.5a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V10a1 1 0 0 1 1-1zM5 15H4.5a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1H14a1 1 0 0 1 1 1V5',
  offline:
    'M3 3l18 18M8.5 16.5a5 5 0 0 1 7 0M5 12.6a10 10 0 0 1 4.2-2.4M19 12.6a10 10 0 0 0-3.3-2.1M2 9a15 15 0 0 1 4.5-2.9M22 9a15 15 0 0 0-10.4-4.2M12 20h.01',
  minus: 'M6 12h12',
};
</script>

<template>
  <svg
    :width="props.size"
    :height="props.size"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    :stroke-width="props.strokeWidth"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    focusable="false"
    class="icon"
  >
    <path :d="P[props.name] ?? P.info" />
  </svg>
</template>

<style scoped>
.icon {
  flex: none;
  display: block;
}
</style>
