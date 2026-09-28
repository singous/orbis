import { Input as HeroInput } from "@heroui/react/input";
import { TextArea as HeroTextArea } from "@heroui/react/textarea";
import { InputGroup } from "@heroui/react/input-group";
import { SelectField } from "../../shared/ui/SelectField";
import { ColorField } from "../../shared/ui/ColorField";
import { ActionButton } from "../../shared/ui/ActionButton";
import { Plus, X } from "lucide-react";
import { SITE_KINDS, type SiteBranding, type SiteConfig, type SiteKind } from "./schemas";

const DEFAULT_BRANDING: SiteBranding = { logo_url: null, links: [], footer_links: [], cta: null, theme: "system" };

function LinkList({ label, value, onChange }: { label: string; value: SiteBranding["links"]; onChange: (value: SiteBranding["links"]) => void }) {
  return <div className="site-branding-link-list">
    <span>{label}</span>
    {value.map((link, index) => <div key={index}>
      <HeroInput aria-label={`${label} ${index + 1} 名称`} required value={link.label} placeholder="名称" onChange={(event) => onChange(value.map((item, position) => position === index ? { ...item, label: event.target.value } : item))} />
      <HeroInput aria-label={`${label} ${index + 1} 地址`} required type="url" value={link.url} placeholder="https://example.com" onChange={(event) => onChange(value.map((item, position) => position === index ? { ...item, url: event.target.value } : item))} />
      <ActionButton type="button" aria-label={`移除${label} ${index + 1}`} onClick={() => onChange(value.filter((_, position) => position !== index))}><X size={14} /></ActionButton>
    </div>)}
    <ActionButton className="site-branding-add-link" type="button" onClick={() => onChange([...value, { label: "", url: "" }])}><Plus size={13} />添加链接</ActionButton>
  </div>;
}

export function SiteSettingsForm({ value, onChange, disabled = false, autoFocusName = false }: {
  value: SiteConfig; onChange: (value: SiteConfig) => void; disabled?: boolean; autoFocusName?: boolean;
}) {
  const branding = value.branding ?? DEFAULT_BRANDING;
  const updateBranding = (patch: Partial<SiteBranding>) => onChange({ ...value, branding: { ...branding, ...patch } });
  const updateCta = (patch: Partial<NonNullable<SiteBranding["cta"]>>) => {
    const next = { label: branding.cta?.label ?? "", url: branding.cta?.url ?? "", ...patch };
    updateBranding({ cta: next.label || next.url ? next : null });
  };
  return <fieldset className="site-settings-fields" disabled={disabled}>
    <label className="mvp-field">站点名称<HeroInput autoFocus={autoFocusName} required maxLength={160} value={value.name} onChange={(event) => onChange({ ...value, name: event.target.value })} placeholder="例如：Orbis 使用手册" /></label>
    <label className="mvp-field">站点路径<InputGroup fullWidth className="site-slug-field"><InputGroup.Prefix>/s/</InputGroup.Prefix><InputGroup.Input required pattern="[a-z0-9]+(-[a-z0-9]+)*" maxLength={80} value={value.slug} onChange={(event) => onChange({ ...value, slug: event.target.value })} placeholder="team-handbook" /></InputGroup><small>小写英文、数字和连字符。发布后可通过此路径访问。</small></label>
    <label className="mvp-field site-description-field">站点简介<HeroTextArea rows={3} maxLength={2000} value={value.description} onChange={(event) => onChange({ ...value, description: event.target.value })} placeholder="告诉读者，他们可以在这里找到什么。" /></label>
    <SelectField label="站点场景" value={value.site_kind} disabled={disabled} onChange={(site_kind) => onChange({ ...value, site_kind: site_kind as SiteKind })} options={Object.entries(SITE_KINDS).map(([kind, item]) => ({ value: kind, label: item.label }))} description={SITE_KINDS[value.site_kind].description} />
    <ColorField value={value.accent_color} disabled={disabled} onChange={(accent_color) => onChange({ ...value, accent_color })} />
    <div className="site-branding-fields">
      <div className="site-branding-heading"><strong>品牌与阅读外观</strong><span>链接和外观会随每次发布固定到公开版本。</span></div>
      <label className="mvp-field">Logo 地址<HeroInput type="url" value={branding.logo_url ?? ""} placeholder="https://example.com/logo.svg" onChange={(event) => updateBranding({ logo_url: event.target.value || null })} /><small>服务端会在预览与发布时校验公开 URL。</small></label>
      <SelectField label="阅读主题" value={branding.theme} disabled={disabled} onChange={(theme) => updateBranding({ theme: theme as SiteBranding["theme"] })} options={[{ value: "system", label: "跟随系统" }, { value: "light", label: "浅色" }, { value: "dark", label: "深色" }]} />
      <LinkList label="顶栏链接" value={branding.links} onChange={(links) => updateBranding({ links })} />
      <LinkList label="页脚链接" value={branding.footer_links} onChange={(footer_links) => updateBranding({ footer_links })} />
      <div className="site-branding-cta"><span>行动按钮</span><div>
        <HeroInput aria-label="行动按钮名称" required={Boolean(branding.cta?.url)} value={branding.cta?.label ?? ""} placeholder="联系我们" onChange={(event) => updateCta({ label: event.target.value })} />
        <HeroInput aria-label="行动按钮地址" required={Boolean(branding.cta?.label)} type="url" value={branding.cta?.url ?? ""} placeholder="https://example.com/contact" onChange={(event) => updateCta({ url: event.target.value })} />
      </div></div>
    </div>
  </fieldset>;
}
