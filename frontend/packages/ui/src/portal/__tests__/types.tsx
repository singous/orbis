import type { ReactNode, ComponentProps } from "react";
import { Portal, readPortalTheme, type PortalThemeSnapshot } from "@orbis/ui/portal";

const host = document.createElement("div");
const fragment = document.createDocumentFragment();
const props: ComponentProps<typeof Portal> = { container: host, children: "正文" as ReactNode };
<Portal {...props} />;
<Portal container={fragment}><button>菜单操作</button></Portal>;
<Portal container={host}>{null}</Portal>;
const snapshot: PortalThemeSnapshot = readPortalTheme(host);
const theme: "light" | "dark" = snapshot.theme;
void theme;
// @ts-expect-error a portal requires an actual owned DOM container.
<Portal container={null}>内容</Portal>;
// @ts-expect-error references are resolved by the consumer before passing the container.
<Portal container={{ current: host }}>内容</Portal>;
// @ts-expect-error third-party render customization is not part of the owned Portal API.
<Portal container={host} render={<section />}>内容</Portal>;
// @ts-expect-error a snapshot is read from an actual DOM element.
readPortalTheme(null);
