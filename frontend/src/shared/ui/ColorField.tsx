import { ColorArea } from "@heroui/react/color-area";
import { ColorField as HeroColorField } from "@heroui/react/color-field";
import { ColorPicker } from "@heroui/react/color-picker";
import { ColorSlider } from "@heroui/react/color-slider";
import { ColorSwatch } from "@heroui/react/color-swatch";
import { Label } from "@heroui/react/label";

export function ColorField({ value, onChange, disabled = false }: { value: string; onChange: (value: string) => void; disabled?: boolean }) {
  return <div className="orbis-color-field"><span className="orbis-field-label">主题色</span>
    <ColorPicker value={value} onChange={(color) => { if (!disabled) onChange(color.toString("hex")); }}>
      <ColorPicker.Trigger aria-label="选择主题色" isDisabled={disabled}><ColorSwatch color={value} /><span>{value}</span></ColorPicker.Trigger>
      <ColorPicker.Popover className="orbis-color-popover" placement="bottom start">
        <ColorArea isDisabled={disabled} colorSpace="hsb" xChannel="saturation" yChannel="brightness" aria-label="饱和度与亮度"><ColorArea.Thumb /></ColorArea>
        <ColorSlider isDisabled={disabled} colorSpace="hsb" channel="hue" aria-label="色相"><ColorSlider.Track><ColorSlider.Thumb /></ColorSlider.Track></ColorSlider>
        <HeroColorField isDisabled={disabled} aria-label="十六进制颜色"><Label>颜色值</Label><HeroColorField.Group><HeroColorField.Input /></HeroColorField.Group></HeroColorField>
      </ColorPicker.Popover>
    </ColorPicker>
  </div>;
}
