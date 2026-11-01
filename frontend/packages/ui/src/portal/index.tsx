import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { ToolbarScopeBoundary } from "../internal/toolbar-scope";
import { usePortalTheme } from "../internal/use-portal-theme";

type PortalProps = { container: Element | DocumentFragment; children?: ReactNode };

function Portal({ container, children }: PortalProps) {
  const { anchor, theme, portalStyle } = usePortalTheme();
  const empty = children == null || typeof children === "boolean";
  return <><span hidden ref={anchor} />{empty ? null : createPortal(
    <ToolbarScopeBoundary><div data-slot="ob-portal" data-theme={theme} style={{ ...portalStyle, display: "contents" }}>{children}</div></ToolbarScopeBoundary>,
    container,
  )}</>;
}

export { Portal };
export { readPortalTheme } from "../internal/use-portal-theme";
export type { PortalThemeSnapshot } from "../internal/use-portal-theme";
export type { PortalProps };
