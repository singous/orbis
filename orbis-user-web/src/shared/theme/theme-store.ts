import { create } from "zustand";

export type Theme = "light" | "dark";

const STORAGE_KEY = "orbis.theme";

function systemTheme(): Theme {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return "light";
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function storedTheme(): Theme | null {
  if (typeof window === "undefined") {
    return null;
  }
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return stored === "light" || stored === "dark" ? stored : null;
}

function applyTheme(theme: Theme) {
  if (typeof document !== "undefined") {
    document.documentElement.dataset.theme = theme;
  }
}

type ThemeState = {
  theme: Theme;
  /** Whether the current theme came from an explicit user choice. */
  explicit: boolean;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
};

export const useThemeStore = create<ThemeState>((set, get) => {
  const stored = storedTheme();

  return {
    theme: stored ?? systemTheme(),
    explicit: stored !== null,
    setTheme: (theme) => {
      window.localStorage.setItem(STORAGE_KEY, theme);
      applyTheme(theme);
      set({ theme, explicit: true });
    },
    toggleTheme: () => {
      get().setTheme(get().theme === "light" ? "dark" : "light");
    },
  };
});

/**
 * Apply the initial theme and keep following the OS preference
 * until the user makes an explicit choice.
 */
export function initTheme() {
  applyTheme(useThemeStore.getState().theme);

  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return;
  }

  const media = window.matchMedia("(prefers-color-scheme: dark)");
  media.addEventListener("change", (event) => {
    if (useThemeStore.getState().explicit) {
      return;
    }
    const theme: Theme = event.matches ? "dark" : "light";
    applyTheme(theme);
    useThemeStore.setState({ theme });
  });
}
