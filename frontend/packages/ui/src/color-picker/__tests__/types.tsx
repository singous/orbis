import { createRef } from "react";
import { ColorPicker } from "@orbis/ui/color-picker";

<ColorPicker ref={createRef<HTMLDivElement>()} value="#123456" onValueChange={value => { const color: string = value; void color; }} onValueChangeEnd={() => {}} className={state => state.disabled ? "disabled" : undefined} />;
// @ts-expect-error the public API keeps third-party prop names private.
<ColorPicker color="#123456" onChange={() => {}} />;
// @ts-expect-error color values are strings, not third-party HSV state objects.
<ColorPicker value={{ h: 0, s: 0, v: 0 }} onValueChange={() => {}} />;
