import { createContext, useContext, type CSSProperties, type ReactNode } from "react";

export type OverlayScope = { "data-theme"?: "light" | "dark"; className?: string; style?: CSSProperties };

const OverlayScopeContext = createContext<OverlayScope | undefined>(undefined);

export function OverlayScopeProvider({ value, children }: { value?: OverlayScope; children: ReactNode }) {
  return <OverlayScopeContext.Provider value={value}>{children}</OverlayScopeContext.Provider>;
}

export function useOverlayScope() {
  return useContext(OverlayScopeContext);
}
