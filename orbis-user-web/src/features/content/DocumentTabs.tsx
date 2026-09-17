import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

export function DocumentTabs({ id, panels }: { id: string; panels: Array<{ title: string; content: ReactNode }> }) {
  const [selected, setSelected] = useState(0);
  const controls = useRef<Array<HTMLButtonElement | null>>([]);
  const containers = useRef<Array<HTMLDivElement | null>>([]);
  const pendingScroll = useRef<HTMLElement | null>(null);
  const active = Math.min(selected, Math.max(0, panels.length - 1));
  useEffect(() => {
    const revealHash = () => {
      const target = document.getElementById(window.location.hash.slice(1));
      if (!target) return;
      const index = containers.current.findIndex((panel) => panel?.contains(target));
      if (index >= 0) { pendingScroll.current = target; setSelected(index); }
    };
    revealHash();
    window.addEventListener("hashchange", revealHash);
    return () => window.removeEventListener("hashchange", revealHash);
  }, [id, panels.length]);
  useLayoutEffect(() => {
    pendingScroll.current?.scrollIntoView?.({ block: "start" });
    pendingScroll.current = null;
  }, [active]);
  function choose(index: number, focus = false) {
    pendingScroll.current = null;
    setSelected(index);
    const panelId = id + "-panel-" + index;
    window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search + "#" + panelId);
    if (focus) controls.current[index]?.focus();
  }
  if (!panels.length) return null;
  return <div className="doc-tabs">
    <div className="doc-tabs-list" role="tablist" aria-label="内容标签">{panels.map((panel, index) => <button
      key={index} ref={(element) => { controls.current[index] = element; }} type="button" role="tab"
      id={id + "-tab-" + index} aria-controls={id + "-panel-" + index} aria-selected={active === index} tabIndex={active === index ? 0 : -1}
      onClick={() => choose(index)} onKeyDown={(event) => {
        const offsets: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1 };
        let target: number | undefined;
        if (event.key in offsets) target = (active + offsets[event.key] + panels.length) % panels.length;
        if (event.key === "Home") target = 0;
        if (event.key === "End") target = panels.length - 1;
        if (target !== undefined) { event.preventDefault(); choose(target, true); }
      }}>{panel.title}</button>)}</div>
    {panels.map((panel, index) => <div key={index} ref={(element) => { containers.current[index] = element; }}
      id={id + "-panel-" + index} role="tabpanel" aria-labelledby={id + "-tab-" + index} hidden={active !== index} className="doc-tab-panel">{panel.content}</div>)}
  </div>;
}
