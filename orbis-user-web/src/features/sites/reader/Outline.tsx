import { List } from "lucide-react";
import { useEffect, useState } from "react";

import type { ContentOutlineItem } from "../../content/ContentRenderer";

export function Outline({ items, mobile = false }: { items: ContentOutlineItem[]; mobile?: boolean }) {
  const [activeId, setActiveId] = useState(items[0]?.id);

  useEffect(() => {
    setActiveId(items[0]?.id);
    if (typeof IntersectionObserver === "undefined" || !items.length) return;
    const observer = new IntersectionObserver((entries) => {
      const visible = entries.filter((entry) => entry.isIntersecting).sort((left, right) => left.boundingClientRect.top - right.boundingClientRect.top);
      if (visible[0]) setActiveId(visible[0].target.id);
    }, { rootMargin: "-96px 0px -70%", threshold: [0, 1] });
    for (const item of items) {
      const heading = document.getElementById(item.id);
      if (heading) observer.observe(heading);
    }
    return () => observer.disconnect();
  }, [items]);

  if (!items.length) return null;
  const links = <nav aria-label="本页目录">{items.map((item) => <a key={item.id} href={`#${item.id}`} aria-current={activeId === item.id ? "location" : undefined} style={{ "--outline-depth": Math.max(0, item.level - 2) } as React.CSSProperties}>{item.text}</a>)}</nav>;
  return mobile
    ? <details className="site-reader-mobile-outline"><summary><List aria-hidden="true" size={15} />本页目录</summary>{links}</details>
    : <aside className="site-reader-outline"><span><List aria-hidden="true" size={14} />本页目录</span>{links}</aside>;
}
