import { Suspense, type ReactNode } from "react";
import { SearchPaletteProvider } from "../features/search/search-palette-context";
import { WorkspaceLoadingPage } from "../features/workspace/WorkspaceLoadingPage";

/** 路由代码加载前后共享搜索会话，替换加载框架时不销毁用户正在输入的浮层。 */
export function WorkspaceRoute({ children }: { children: ReactNode }) {
  return <SearchPaletteProvider>
    <Suspense fallback={<WorkspaceLoadingPage />}>{children}</Suspense>
  </SearchPaletteProvider>;
}
