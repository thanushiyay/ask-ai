import { ref, watch } from 'vue';

const KEY = 'askai.theme';

function initial() {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === 'light' || saved === 'dark') return saved;
  } catch {
    /* storage blocked */
  }
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

/** Light/dark theme; follows the system until the user picks one, then remembers the choice. */
export function useTheme() {
  const theme = ref(initial());
  watch(
    theme,
    (value) => {
      document.documentElement.dataset.theme = value;
    },
    { immediate: true },
  );

  function toggle() {
    theme.value = theme.value === 'dark' ? 'light' : 'dark';
    try {
      localStorage.setItem(KEY, theme.value);
    } catch {
      /* storage blocked: the choice lasts for this visit */
    }
  }

  return { theme, toggle };
}
