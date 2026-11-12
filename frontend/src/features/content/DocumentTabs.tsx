import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@orbis/ui/tabs";

export function DocumentTabs({ id, panels }: { id: string; panels: Array<{ title: string; content: ReactNode }> }) {
  // Published HTML owns these stable anchor IDs. Keep every panel mounted so a
  // hash link into hidden content can reveal its panel before scrolling.
  const [selected, setSelected] = useState(0);
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
  function choose(index: number) {
    pendingScroll.current = null;
    setSelected(index);
    const panelId = id + "-panel-" + index;
    window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search + "#" + panelId);
  }
  if (!panels.length) return null;
  return <Tabs className="doc-tabs" value={active} onValueChange={value => choose(Number(value))}>
    <TabsList aria-label="内容标签" activateOnFocus>{panels.map((panel, index) => <TabsTrigger key={index} value={index} id={id + "-tab-" + index}>{panel.title}</TabsTrigger>)}</TabsList>
    {panels.map((panel, index) => <TabsContent key={index} value={index} keepMounted className="doc-tab-panel">
      <div id={id + "-panel-" + index} ref={(element) => { containers.current[index] = element; }}>{panel.content}</div>
    </TabsContent>)}
  </Tabs>;
}
