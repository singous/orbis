import { createContext, createElement, type ReactNode } from "react";

export const ToolbarScopeContext = createContext(false);

export function ToolbarScopeBoundary({ children }: { children: ReactNode }) {
  return createElement(ToolbarScopeContext.Provider, { value: false }, children);
}
