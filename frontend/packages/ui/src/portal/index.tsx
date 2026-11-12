import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { usePortalTheme } from "../internal/use-portal-theme";
import { OverlayScopeProvider } from "../internal/overlay-scope";

function Portal({ container, children }: { container: Element | DocumentFragment; children?: ReactNode }) {
  const { anchor, theme, portalStyle } = usePortalTheme();
  const scope = { "data-theme": theme, className: theme === "dark" ? "dark" : undefined, style: portalStyle };
  const empty = children == null || typeof children === "boolean";
  return <><span hidden ref={anchor} />{empty ? null : createPortal(
    <OverlayScopeProvider value={scope}><div data-slot="portal" data-theme={theme} className={scope.className} style={{ ...portalStyle, display: "contents" }}>{children}</div></OverlayScopeProvider>,
    container,
  )}</>;
}

export { Portal, OverlayScopeProvider };
export { readPortalTheme, useElementTheme } from "../internal/use-portal-theme";
export type { PortalThemeSnapshot } from "../internal/use-portal-theme";
export type { OverlayScope } from "../internal/overlay-scope";
