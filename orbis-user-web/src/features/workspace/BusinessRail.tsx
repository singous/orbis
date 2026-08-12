import { BookOpen, Home, LibraryBig, Sparkles } from "lucide-react";
import { Link } from "react-router-dom";

import { NavIcon } from "../../shared/ui/NavItem";
import { Tooltip } from "../../shared/ui/Tooltip";

export function BusinessRail() {
  return (
    <aside className="workspace-business-rail">
      <Link to="/documents" aria-label="Orbis 在线文档" className="workspace-brand">
        O
      </Link>
      <nav className="workspace-business-nav" aria-label="业务板块">
        <Tooltip label="首页" side="right">
          <NavIcon to="/home" label="首页" icon={<Home aria-hidden="true" size={18} />} />
        </Tooltip>
        <Tooltip label="在线文档" side="right">
          <NavIcon to="/documents" label="在线文档" icon={<BookOpen aria-hidden="true" size={18} />} />
        </Tooltip>
        <div aria-hidden="true" className="my-1 h-px w-7 bg-[var(--border-inverse)]" />
        <Tooltip label="知识库 · 即将上线" side="right">
          <NavIcon
            to="/knowledge"
            label="知识库"
            hint="即将上线"
            icon={<LibraryBig aria-hidden="true" size={18} />}
          />
        </Tooltip>
        <Tooltip label="记忆 · 即将上线" side="right">
          <NavIcon
            to="/memory"
            label="记忆"
            hint="即将上线"
            icon={<Sparkles aria-hidden="true" size={18} />}
          />
        </Tooltip>
      </nav>
    </aside>
  );
}
