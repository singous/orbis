import { HexColorPicker } from "react-colorful";
import { useImperativeHandle, useLayoutEffect, useRef, type ComponentProps, type CSSProperties } from "react";
import { cn } from "../cn";

type ColorPickerProps = Omit<ComponentProps<"div">, "onChange" | "className" | "style"> & {
  value: string;
  onValueChange: (value: string) => void;
  onValueChangeEnd?: (value: string) => void;
  disabled?: boolean;
  saturationLabel?: string;
  hueLabel?: string;
  className?: string | ((state: { disabled: boolean }) => string | undefined);
  style?: CSSProperties | ((state: { disabled: boolean }) => CSSProperties | undefined);
};
function ColorPicker({ value, onValueChange, onValueChangeEnd, disabled = false, saturationLabel = "饱和度与亮度", hueLabel = "色相", className, style, ref, ...props }: ColorPickerProps) {
  const root = useRef<HTMLDivElement>(null);
  useImperativeHandle(ref, () => root.current!, []);
  useLayoutEffect(() => {
    const localize = () => {
      const area = root.current!.querySelector<HTMLElement>(".react-colorful__saturation [role=slider]")!;
      const hue = root.current!.querySelector<HTMLElement>(".react-colorful__hue [role=slider]")!;
      area.setAttribute("aria-label", saturationLabel);
      hue.setAttribute("aria-label", hueLabel);
      for (const control of [area, hue]) {
        control.setAttribute("aria-disabled", String(disabled));
        control.tabIndex = disabled ? -1 : 0;
      }
      const values = area.getAttribute("aria-valuetext")?.match(/([\d.]+)%.*?([\d.]+)%/);
      if (values) {
        const description = `饱和度 ${values[1]}%，亮度 ${values[2]}%`;
        if (area.getAttribute("aria-valuetext") !== description) area.setAttribute("aria-valuetext", description);
        if (area.getAttribute("aria-valuenow") !== values[1]) area.setAttribute("aria-valuenow", values[1]);
        area.setAttribute("aria-valuemin", "0");
        area.setAttribute("aria-valuemax", "100");
      }
    };
    localize();
    // 固定版本的原语没有 label/disabled API；在适配边界维护中文描述与焦点语义。
    const observer = new MutationObserver(localize);
    observer.observe(root.current!, { subtree: true, attributes: true, attributeFilter: ["aria-valuetext", "aria-valuenow"] });
    return () => observer.disconnect();
  }, [disabled, saturationLabel, hueLabel]);
  const state = { disabled };
  return <div {...props} ref={root} role="group" aria-label={props["aria-label"] ?? "颜色选择器"} aria-disabled={disabled || undefined} inert={disabled} data-slot="ob-color-picker" data-disabled={disabled || undefined} className={cn("ob-color-picker", typeof className === "function" ? className(state) : className)} style={typeof style === "function" ? style(state) : style}>
    <HexColorPicker color={value} onChange={color => { if (!disabled) onValueChange(color.toUpperCase()); }} onChangeEnd={color => { if (!disabled) onValueChangeEnd?.(color.toUpperCase()); }} />
  </div>;
}
export { ColorPicker };
export type { ColorPickerProps };
