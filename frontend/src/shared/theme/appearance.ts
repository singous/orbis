import { createStore } from "zustand/vanilla";

export type AppearanceMode = "light" | "dark" | "system";
export const APPEARANCE_STORAGE_KEY = "orbis.appearance";
const SYSTEM_DARK_QUERY = "(prefers-color-scheme: dark)";

export function isAppearanceMode(value: unknown): value is AppearanceMode {
  return value === "light" || value === "dark" || value === "system";
}

function readAppearanceMode(): AppearanceMode {
  try {
    const value = window.localStorage.getItem(APPEARANCE_STORAGE_KEY);
    return isAppearanceMode(value) ? value : "system";
  } catch { return "system"; }
}

export const appearanceStore = createStore<{ mode: AppearanceMode }>(() => ({ mode: readAppearanceMode() }));

export function setAppearanceMode(mode: AppearanceMode) {
  appearanceStore.setState({ mode });
  try { window.localStorage.setItem(APPEARANCE_STORAGE_KEY, mode); } catch { /* The current session can still change appearance. */ }
}

/** Initialize once at the app entry, outside React rendering and StrictMode. */
export function initializeAppearance(): () => void {
  const media = typeof window.matchMedia === "function" ? window.matchMedia(SYSTEM_DARK_QUERY) : null;
  appearanceStore.setState({ mode: readAppearanceMode() });
  const apply = () => {
    const mode = appearanceStore.getState().mode;
    document.documentElement.dataset.themeMode = mode;
    document.documentElement.dataset.theme = mode === "system" ? media?.matches ? "dark" : "light" : mode;
  };
  const syncStorage = (event: StorageEvent) => {
    if (event.key !== APPEARANCE_STORAGE_KEY && event.key !== null) return;
    appearanceStore.setState({ mode: readAppearanceMode() });
  };
  apply();
  const unsubscribe = appearanceStore.subscribe(apply);
  media?.addEventListener?.("change", apply);
  window.addEventListener("storage", syncStorage);
  return () => {
    unsubscribe();
    media?.removeEventListener?.("change", apply);
    window.removeEventListener("storage", syncStorage);
  };
}
