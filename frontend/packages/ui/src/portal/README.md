# Portal

Status: experimental. This Orbis-owned component preserves the source theme when editor menus or a stable embedded host render outside their original DOM subtree. It adds no dependency or copied upstream code.

```tsx
import { Portal, readPortalTheme } from "@orbis/ui/portal";

<Portal container={host}>{menu}</Portal>
```

`container` is an `Element` or `DocumentFragment` supplied by the owner. Keep the same container reference when moving an embedded editor: moving that host between its placeholder and `body` preserves the portal's child DOM, component state and drafts. Changing the container selects a different React portal target and can remount its children.

A hidden source anchor uses the same internal theme subscription as the overlay primitives. The target receives a `data-slot="ob-portal"` wrapper with `display: contents`, the nearest `data-theme`, and the resolved `--ob-*` variables. This adds no layout box. Ancestor theme/class/style and the existing forced-colors/reduced-motion/pointer media queries resynchronize that snapshot. Ordinary domain variables are outside this contract.

`null`, `undefined` and boolean children leave the target empty; the source anchor remains in the owning React tree. This preserves toolbar hosts that hide themselves with `:empty`. The Portal also ends the source Toolbar scope, so menu controls do not register in the toolbar behind them. Position, role, accessible naming, focus, dismissal and host lifecycle remain with the consumer.

`readPortalTheme(element): PortalThemeSnapshot` exposes the same one-time DOM snapshot (`theme`, `portalStyle`) for native drag previews. Apply its theme and custom properties to the newly created preview before mounting it. It does not subscribe or manage that element's lifetime. No Base UI props or types are public.
