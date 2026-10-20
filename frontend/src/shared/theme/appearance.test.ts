import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { APPEARANCE_STORAGE_KEY, appearanceStore, initializeAppearance, setAppearanceMode } from "./appearance";

let dispose: (() => void) | undefined;
let dark: boolean;
let mediaListeners: Set<() => void>;

beforeEach(() => {
  localStorage.clear();
  dark = false;
  mediaListeners = new Set();
  vi.spyOn(window, "matchMedia").mockImplementation((query): MediaQueryList => ({
    get matches() { return dark; }, media: query,
    onchange: null, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
    addEventListener: (_event: string, listener: unknown) => { if (typeof listener === "function") mediaListeners.add(listener as () => void); },
    removeEventListener: (_event: string, listener: unknown) => { if (typeof listener === "function") mediaListeners.delete(listener as () => void); },
  }));
});
afterEach(() => {
  dispose?.(); dispose = undefined;
  appearanceStore.setState({ mode: "system" });
  delete document.documentElement.dataset.theme;
  delete document.documentElement.dataset.themeMode;
  vi.restoreAllMocks();
});
const systemChanges = (value: boolean) => { dark = value; mediaListeners.forEach(listener => listener()); };

describe("application appearance", () => {
  it("restores a saved night mode before the application mounts", () => {
    localStorage.setItem(APPEARANCE_STORAGE_KEY, "dark");
    dispose = initializeAppearance();
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(appearanceStore.getState().mode).toBe("dark");
    setAppearanceMode("light");
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(localStorage.getItem(APPEARANCE_STORAGE_KEY)).toBe("light");
  });
  it("follows system changes only while the system option is selected", () => {
    dispose = initializeAppearance();
    systemChanges(true);
    expect(document.documentElement.dataset.theme).toBe("dark");
    setAppearanceMode("light");
    systemChanges(false); systemChanges(true);
    expect(document.documentElement.dataset.theme).toBe("light");
    setAppearanceMode("system");
    expect(document.documentElement.dataset.theme).toBe("dark");
    systemChanges(false);
    expect(document.documentElement.dataset.theme).toBe("light");
  });
  it("falls back to the system preference for an invalid saved mode", () => {
    dark = true;
    localStorage.setItem(APPEARANCE_STORAGE_KEY, "unexpected-mode");
    dispose = initializeAppearance();
    expect(appearanceStore.getState().mode).toBe("system");
    expect(document.documentElement.dataset.theme).toBe("dark");
  });
  it("synchronizes preferences across tabs and returns to system after clearing storage", () => {
    dispose = initializeAppearance();
    localStorage.setItem(APPEARANCE_STORAGE_KEY, "dark");
    window.dispatchEvent(new StorageEvent("storage", { key: APPEARANCE_STORAGE_KEY, newValue: "dark" }));
    expect(document.documentElement.dataset.theme).toBe("dark");
    localStorage.clear();
    window.dispatchEvent(new StorageEvent("storage", { key: null }));
    expect(appearanceStore.getState().mode).toBe("system");
    expect(document.documentElement.dataset.theme).toBe("light");
  });
  it("keeps session switching usable when storage reads and writes are blocked", () => {
    vi.spyOn(window.localStorage, "getItem").mockImplementation(() => { throw new Error("Storage blocked"); });
    vi.spyOn(window.localStorage, "setItem").mockImplementation(() => { throw new Error("Storage blocked"); });
    dark = true;
    dispose = initializeAppearance();
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(() => setAppearanceMode("light")).not.toThrow();
    expect(document.documentElement.dataset.theme).toBe("light");
  });
  it("removes its listeners when the app entry is disposed", () => {
    dispose = initializeAppearance();
    dispose(); dispose = undefined;
    expect(mediaListeners.size).toBe(0);
    setAppearanceMode("dark");
    expect(document.documentElement.dataset.theme).toBe("light");
  });
});
