import { ColorArea } from "@heroui/react/color-area";
import { ColorField as HeroColorField } from "@heroui/react/color-field";
import { ColorPicker } from "@heroui/react/color-picker";
import { ColorSlider } from "@heroui/react/color-slider";
import { ColorSwatch } from "@heroui/react/color-swatch";
import { Label } from "@heroui/react/label";
import { useRef } from "react";
import { cn } from "./cn";

type ColorFieldProps = {
  value: string;
  onChange: (value: string) => void;
  onChangeEnd?: (value: string) => void;
  disabled?: boolean;
  label?: string;
  className?: string;
};

export function ColorField({ value, onChange, onChangeEnd, disabled = false, label = "主题色", className }: ColorFieldProps) {
  const latest = useRef(value);
  latest.current = value;
  const finish = (color: string) => { if (!disabled) onChangeEnd?.(color); };

  return (
    <div className={cn("orbis-color-field", className)}>
      <span className="orbis-field-label">{label}</span>
      <ColorPicker value={value} onChange={color => {
        if (disabled) return;
        latest.current = color.toString("hex");
        onChange(latest.current);
      }}>
        <ColorPicker.Trigger aria-label={`选择${label}`} isDisabled={disabled}>
          <ColorSwatch color={value} /><span>{value}</span>
        </ColorPicker.Trigger>
        <ColorPicker.Popover className="orbis-color-popover" placement="bottom start">
          <ColorArea
            isDisabled={disabled}
            onChangeEnd={color => finish(color.toString("hex"))}
            colorSpace="hsb"
            xChannel="saturation"
            yChannel="brightness"
            aria-label="饱和度与亮度"
          >
            <ColorArea.Thumb />
          </ColorArea>
          <ColorSlider isDisabled={disabled} onChangeEnd={color => finish(color.toString("hex"))} colorSpace="hsb" channel="hue" aria-label="色相">
            <ColorSlider.Track><ColorSlider.Thumb /></ColorSlider.Track>
          </ColorSlider>
          <HeroColorField isDisabled={disabled} aria-label="十六进制颜色">
            <Label>颜色值</Label>
            <HeroColorField.Group>
              {/* Input 的回调在 HeroUI 解析并提交颜色后执行，不能从外层 onBlur 读取旧颜色。 */}
              <HeroColorField.Input
                onBlur={() => finish(latest.current)}
                onKeyDown={event => {
                  if (!event.nativeEvent.isComposing && event.key === "Enter") finish(latest.current);
                }}
              />
            </HeroColorField.Group>
          </HeroColorField>
        </ColorPicker.Popover>
      </ColorPicker>
    </div>
  );
}
