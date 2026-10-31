import { Input } from "@orbis/ui/input";
import { Textarea } from "@orbis/ui/textarea";
import { SelectField } from "../../shared/ui/SelectField";
import { ColorField } from "../../shared/ui/ColorField";
import { SiteActionButton as Button } from "./SiteManagementLayout";
import { cn } from "@orbis/ui/cn";
import { SiteField, useSiteManagementAppearance } from "./SiteManagementLayout";
import { Plus, X } from "../../shared/ui/icons";
import { SITE_KINDS, type SiteBranding, type SiteConfig, type SiteKind } from "./schemas";

const DEFAULT_BRANDING: SiteBranding = { logo_url: null, links: [], footer_links: [], cta: null, theme: "system" };

function LinkList({ label, value, onChange }: { label: string; value: SiteBranding["links"]; onChange: (value: SiteBranding["links"]) => void }) {
  return <div className="grid gap-2">
    <span className="text-xs font-semibold text-ob-foreground">{label}</span>
    {value.map((link, index) => <div key={index} className="grid grid-cols-1 gap-[7px] min-[721px]:grid-cols-[minmax(90px,.65fr)_minmax(140px,1.35fr)_28px] pointer-coarse:min-[721px]:grid-cols-[minmax(90px,.65fr)_minmax(140px,1.35fr)_var(--ob-control-height-touch)] [&_input]:min-w-0">
      <Input aria-label={`${label} ${index + 1} 名称`} required value={link.label} placeholder="名称" onChange={(event) => onChange(value.map((item, position) => position === index ? { ...item, label: event.target.value } : item))} />
      <Input aria-label={`${label} ${index + 1} 地址`} required type="url" value={link.url} placeholder="https://example.com" onChange={(event) => onChange(value.map((item, position) => position === index ? { ...item, url: event.target.value } : item))} />
      <Button className="inline-flex items-center justify-center text-ob-muted-foreground enabled:hover:bg-(--ob-item-hover-bg) enabled:hover:text-ob-foreground" aria-label={`移除${label} ${index + 1}`} onClick={() => onChange(value.filter((_, position) => position !== index))}><X size={14} /></Button>
    </div>)}
    <Button className="inline-flex w-max items-center justify-center gap-[5px] px-[7px] py-[5px] text-xs text-ob-muted-foreground enabled:hover:bg-(--ob-item-hover-bg) enabled:hover:text-ob-foreground" onClick={() => onChange([...value, { label: "", url: "" }])}><Plus size={14} />添加链接</Button>
  </div>;
}

export function SiteSettingsForm({ value, onChange, disabled = false, autoFocusName = false }: {
  value: SiteConfig; onChange: (value: SiteConfig) => void; disabled?: boolean; autoFocusName?: boolean;
}) {
  const appearance = useSiteManagementAppearance();
  const branding = value.branding ?? DEFAULT_BRANDING;
  const updateBranding = (patch: Partial<SiteBranding>) => onChange({ ...value, branding: { ...branding, ...patch } });
  const updateCta = (patch: Partial<NonNullable<SiteBranding["cta"]>>) => {
    const next = { label: branding.cta?.label ?? "", url: branding.cta?.url ?? "", ...patch };
    updateBranding({ cta: next.label || next.url ? next : null });
  };
  return <fieldset className={cn("min-w-0 p-0", appearance === "create" ? "grid grid-cols-1 items-start gap-[21px] min-[561px]:grid-cols-2 min-[561px]:gap-x-5 min-[561px]:gap-y-6" : appearance === "editor" ? "flex flex-col gap-[22px]" : "flex flex-col gap-[23px]")} disabled={disabled}>
    <SiteField>站点名称<Input autoFocus={autoFocusName} required maxLength={160} value={value.name} onChange={(event) => onChange({ ...value, name: event.target.value })} placeholder="例如：Orbis 使用手册" /></SiteField>
    <SiteField>站点路径<span className="relative block w-full text-sm font-normal"><span aria-hidden="true" className="pointer-events-none absolute inset-y-0 start-3 flex items-center text-ob-muted-foreground">/s/</span><Input className="ps-11" required pattern="[a-z0-9]+(-[a-z0-9]+)*" maxLength={80} value={value.slug} onChange={(event) => onChange({ ...value, slug: event.target.value })} placeholder="team-handbook" /></span><small>小写英文、数字和连字符。发布后可通过此路径访问。</small></SiteField>
    <SiteField className={cn("", appearance === "create" && "col-auto min-[561px]:col-span-full [&_textarea]:min-h-[100px]")}>站点简介<Textarea rows={3} maxLength={2000} value={value.description} onChange={(event) => onChange({ ...value, description: event.target.value })} placeholder="告诉读者，他们可以在这里找到什么。" /></SiteField>
    <SelectField label="站点场景" value={value.site_kind} disabled={disabled} onChange={(site_kind) => onChange({ ...value, site_kind: site_kind as SiteKind })} options={Object.entries(SITE_KINDS).map(([kind, item]) => ({ value: kind, label: item.label }))} description={SITE_KINDS[value.site_kind].description} />
    <ColorField value={value.accent_color} disabled={disabled} onChange={(accent_color) => onChange({ ...value, accent_color })} />
    <div className={cn("grid gap-4.5 border-t border-ob-border pt-[22px]", appearance === "create" && "col-span-full")}>
      <div className="grid gap-[5px]"><strong className="text-xs font-semibold text-ob-foreground">品牌与阅读外观</strong><span className="text-xs text-ob-muted-foreground">链接和外观会随每次发布固定到公开版本。</span></div>
      <SiteField>Logo 地址<Input type="url" value={branding.logo_url ?? ""} placeholder="https://example.com/logo.svg" onChange={(event) => updateBranding({ logo_url: event.target.value || null })} /><small>服务端会在预览与发布时校验公开 URL。</small></SiteField>
      <SelectField label="阅读主题" value={branding.theme} disabled={disabled} onChange={(theme) => updateBranding({ theme: theme as SiteBranding["theme"] })} options={[{ value: "system", label: "跟随系统" }, { value: "light", label: "浅色" }, { value: "dark", label: "深色" }]} />
      <LinkList label="顶栏链接" value={branding.links} onChange={(links) => updateBranding({ links })} />
      <LinkList label="页脚链接" value={branding.footer_links} onChange={(footer_links) => updateBranding({ footer_links })} />
      <div className="grid gap-2"><span className="text-xs font-semibold text-ob-foreground">行动按钮</span><div className="grid grid-cols-1 gap-[7px] min-[721px]:grid-cols-[minmax(90px,.65fr)_minmax(140px,1.35fr)] [&_input]:min-w-0">
        <Input aria-label="行动按钮名称" required={Boolean(branding.cta?.url)} value={branding.cta?.label ?? ""} placeholder="联系我们" onChange={(event) => updateCta({ label: event.target.value })} />
        <Input aria-label="行动按钮地址" required={Boolean(branding.cta?.label)} type="url" value={branding.cta?.url ?? ""} placeholder="https://example.com/contact" onChange={(event) => updateCta({ url: event.target.value })} />
      </div></div>
    </div>
  </fieldset>;
}
