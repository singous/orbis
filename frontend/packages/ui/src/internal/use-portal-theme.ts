import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";

export type PortalThemeSnapshot = { theme: "light" | "dark"; portalStyle: CSSProperties };

export function readPortalTheme(element: Element): PortalThemeSnapshot {
  const computed = getComputedStyle(element);
  const portalStyle = Object.fromEntries(Array.from(computed).filter(name => name.startsWith("--ob-")).map(name => [name, computed.getPropertyValue(name)]));
  return { theme: element.closest("[data-theme]")?.getAttribute("data-theme") === "dark" ? "dark" : "light", portalStyle };
}

export function usePortalTheme(openingElement?: Element | null) {
  const anchor = useRef<HTMLSpanElement>(null);
  const [snapshot, setSnapshot] = useState<PortalThemeSnapshot>({ theme: "light", portalStyle: {} });
  useLayoutEffect(() => {
    const update = () => {
      const element = openingElement ?? anchor.current!;
      setSnapshot(readPortalTheme(element));
    };
    update();
    // Portal 保留 body 的浮层边界，同时继承打开位置的主题和局部 token。
    const observer = new MutationObserver(update);
    for (let element = openingElement ?? anchor.current?.parentElement; element; element = element.parentElement) observer.observe(element, { attributes: true, attributeFilter: ["data-theme", "class", "style"] });
    const media = ["(forced-colors: active)", "(prefers-reduced-motion: reduce)", "(pointer: coarse)"].map(query => window.matchMedia(query));
    for (const query of media) query.addEventListener("change", update);
    return () => {
      observer.disconnect();
      for (const query of media) query.removeEventListener("change", update);
    };
  }, [openingElement]);
  return { anchor, ...snapshot };
}
