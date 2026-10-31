import { DropdownMenu, DropdownMenuItem, DropdownMenuCheckboxItem, DropdownMenuRadioGroup } from "@orbis/ui/dropdown-menu";
import { Popover } from "@orbis/ui/popover";
import { Tooltip } from "@orbis/ui/tooltip";
import { RadioGroup } from "@orbis/ui/radio-group";

<DropdownMenu open onOpenChange={() => {}}>内容</DropdownMenu>;
<DropdownMenuItem asChild><a href="/guide">指南</a></DropdownMenuItem>;
<DropdownMenuCheckboxItem checked onCheckedChange={checked => { const boolean: boolean = checked; void boolean; }}>固定</DropdownMenuCheckboxItem>;
<DropdownMenuRadioGroup<number> value={0} onValueChange={value => { const number: number = value; void number; }} />;
// @ts-expect-error a controlled menu requires an owner.
<DropdownMenu open>内容</DropdownMenu>;
// @ts-expect-error controlled and default open states are mutually exclusive.
<Popover open defaultOpen onOpenChange={() => {}}>内容</Popover>;
// @ts-expect-error tooltip render details are private; compose the trigger.
<Tooltip render={<button />}>内容</Tooltip>;
// @ts-expect-error checkbox checked and defaultChecked cannot be combined.
<DropdownMenuCheckboxItem checked defaultChecked onCheckedChange={() => {}}>固定</DropdownMenuCheckboxItem>;
// @ts-expect-error radio group callback preserves the specified value type.
<RadioGroup<number> value={0} onValueChange={(value: string) => { void value; }} />;
