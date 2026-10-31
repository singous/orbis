# Toolbar

`Toolbar` groups real controls into a single Tab stop. Horizontal arrow keys move between controls; vertical toolbars use Up/Down. Disabled buttons are skipped. `loopFocus` defaults to the Base UI behavior and can be disabled. Home/End are not part of the current contract; the previous toolbar implementation did not handle them either.

```tsx
import { Toolbar } from "@orbis/ui/toolbar";
import { Button } from "@orbis/ui/button";
import { Select } from "@orbis/ui/select";

<Toolbar aria-label="格式">
  <Button>撤销</Button>
  <Select label="段落" defaultValue="text" options={[{ value: "text", label: "正文" }]} />
  <Button>重做</Button>
</Toolbar>
```

Button and Select participate automatically through a package-private scope; application code does not need a separate toolbar-specific button API. Button retains its existing ref, disabled/loading, accessible-name and class/style-state contracts. Select retains ownership of its value and state styles while composing its trigger with Base UI's toolbar button.

The scope ends at Dialog, Select, DropdownMenu, Popover, Tooltip and Toast portal surfaces. Buttons inside a toolbar-opened popup remain part of that popup and do not register in the underlying toolbar. Do not bypass the public overlay components with a custom portal and assume the toolbar scope ends automatically.

Give every toolbar an accessible label. The Story covers real Chromium keyboard traversal, disabled controls, Select values, Tab exit/reentry and portal isolation. No application state, editor selection or canvas behavior belongs in this component.
