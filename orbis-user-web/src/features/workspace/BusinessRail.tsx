import { BookOpen, Home, LibraryBig, Sparkles } from "lucide-react";
import { Link, NavLink } from "react-router-dom";

export function BusinessRail() {
  return (
    <aside className="workspace-business-rail">
      <Link to="/documents" aria-label="Orbis 在线文档" className="workspace-brand">O</Link>
      <nav className="workspace-business-nav" aria-label="业务板块">
        <NavLink to="/home" aria-label="首页" className={({ isActive }) => `business-rail-link ${isActive ? "is-active" : ""}`}>
          <Home aria-hidden="true" size={18} />
          <span>首页</span>
        </NavLink>
        <NavLink to="/documents" aria-label="在线文档" className={({ isActive }) => `business-rail-link ${isActive ? "is-active" : ""}`}>
          <BookOpen aria-hidden="true" size={18} />
          <span>在线文档</span>
        </NavLink>
        <button type="button" className="business-rail-link is-planned" disabled aria-disabled="true">
          <LibraryBig aria-hidden="true" size={18} />
          <span aria-disabled="true">知识库</span>
          <em>规划中</em>
        </button>
        <button type="button" className="business-rail-link is-planned" disabled aria-disabled="true">
          <Sparkles aria-hidden="true" size={18} />
          <span aria-disabled="true">记忆库</span>
          <em>规划中</em>
        </button>
      </nav>
    </aside>
  );
}
