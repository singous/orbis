import { useLayoutEffect, useState, type CSSProperties } from "react";

export type PortalThemeSnapshot = { theme: "light" | "dark"; portalStyle: CSSProperties };

const themeVariables = new Set([
  "--background", "--foreground", "--card", "--card-foreground", "--popover", "--popover-foreground",
  "--primary", "--primary-foreground", "--secondary", "--secondary-foreground", "--muted", "--muted-foreground",
  "--accent", "--accent-foreground", "--destructive", "--border", "--input", "--ring", "--radius",
  "--font-sans", "--font-heading", "--font-mono",
]);

export function readPortalTheme(element: Element): PortalThemeSnapshot {
  const computed = getComputedStyle(element);
  const portalStyle = Object.fromEntries(Array.from(computed)
    .filter(name => themeVariables.has(name) || name.startsWith("--ob-") || name.startsWith("--reading-"))
    .map(name => [name, computed.getPropertyValue(name)]));
  portalStyle["--font-sans"] = computed.fontFamily;
  return { theme: element.closest("[data-theme]")?.getAttribute("data-theme") === "dark" ? "dark" : "light", portalStyle };
}

export function useElementTheme(element: Element | null) {
  const [snapshot, setSnapshot] = useState<PortalThemeSnapshot>();
  useLayoutEffect(() => {
    if (!element) return;
    const update = () => setSnapshot(readPortalTheme(element));
    update();
    const observer = new MutationObserver(update);
    for (let current: Element | null = element; current; current = current.parentElement) {
      observer.observe(current, { attributes: true, attributeFilter: ["data-theme", "class", "style"] });
    }
    const media = ["(forced-colors: active)", "(prefers-reduced-motion: reduce)", "(pointer: coarse)"].map(query => window.matchMedia(query));
    for (const query of media) query.addEventListener("change", update);
    return () => {
      observer.disconnect();
      for (const query of media) query.removeEventListener("change", update);
    };
  }, [element]);
  return snapshot;
}

export function usePortalTheme() {
  const [element, anchor] = useState<HTMLSpanElement | null>(null);
  return { anchor, ...useElementTheme(element) };
}
