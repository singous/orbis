import { readerFocus } from "./chrome";
import { List } from "../../../shared/ui/icons";
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
  const links = <nav className={mobile ? "pt-0.5 pb-3 pl-[22px]" : "border-l border-(--ob-reader-border) pl-[13px]"} aria-label="本页目录">{items.map((item) => <a className={`block pl-[calc(var(--ob-reader-outline-depth)*10px)] text-[length:var(--ob-prose-caption-size)] text-(--ob-reader-muted) hover:text-(--ob-reader-accent) aria-[current=location]:text-(--ob-reader-accent) ${mobile ? "my-2" : "my-2.5 leading-[1.5]"} ${readerFocus}`} key={item.id} href={`#${item.id}`} aria-current={activeId === item.id ? "location" : undefined} style={{ "--ob-reader-outline-depth": Math.max(0, item.level - 2) } as React.CSSProperties}>{item.text}</a>)}</nav>;
  return mobile
    ? <details className="site-reader-mobile-outline mt-[-12px] mb-7 hidden border-b border-(--ob-reader-border) text-(--ob-reader-muted) [@media(max-width:1180px)]:block"><summary className={`flex cursor-pointer items-center gap-[7px] py-2.5 text-[length:var(--ob-prose-caption-size)] ${readerFocus}`}><List aria-hidden="true" size={16} />本页目录</summary>{links}</details>
    : <aside aria-label="本页目录" className="site-reader-outline sticky top-[calc(var(--ob-reader-header-height)+29px)] mt-[47px] max-h-[calc(100dvh-var(--ob-reader-header-height)-57px)] self-start overflow-auto [@media(max-width:1180px)]:hidden"><span className="mb-3.5 flex items-center gap-[7px] text-[length:var(--ob-prose-caption-size)] font-[650] text-(--ob-reader-text)"><List aria-hidden="true" size={14} />本页目录</span>{links}</aside>;
}
