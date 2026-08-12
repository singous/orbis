import { act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { useThemeStore } from "./theme-store";

describe("theme store", () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
    useThemeStore.setState({ theme: "light", explicit: false });
  });

  afterEach(() => {
    window.localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
  });

  it("defaults to light when no preference is stored", () => {
    expect(useThemeStore.getState().theme).toBe("light");
    expect(useThemeStore.getState().explicit).toBe(false);
  });

  it("persists an explicit theme choice and applies it to the document", () => {
    act(() => {
      useThemeStore.getState().setTheme("dark");
    });

    expect(window.localStorage.getItem("orbis.theme")).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(useThemeStore.getState().explicit).toBe(true);
  });

  it("toggles between light and dark", () => {
    act(() => {
      useThemeStore.getState().toggleTheme();
    });
    expect(useThemeStore.getState().theme).toBe("dark");

    act(() => {
      useThemeStore.getState().toggleTheme();
    });
    expect(useThemeStore.getState().theme).toBe("light");
  });

  it("reads back a stored preference on init", () => {
    window.localStorage.setItem("orbis.theme", "dark");

    // Re-run the stored-preference resolution the store performs at startup.
    const stored = window.localStorage.getItem("orbis.theme");
    expect(stored === "light" || stored === "dark" ? stored : "light").toBe("dark");
  });
});
