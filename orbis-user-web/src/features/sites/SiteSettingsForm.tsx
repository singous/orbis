import { Plus, X } from "lucide-react";
import { SITE_KINDS, type SiteBranding, type SiteConfig, type SiteKind } from "./schemas";

const DEFAULT_BRANDING: SiteBranding = { logo_url: null, links: [], footer_links: [], cta: null, theme: "system" };

function LinkList({ label, value, onChange }: { label: string; value: SiteBranding["links"]; onChange: (value: SiteBranding["links"]) => void }) {
  return <div className="site-branding-link-list">
    <span>{label}</span>
    {value.map((link, index) => <div key={index}>
      <input aria-label={`${label} ${index + 1} 名称`} required value={link.label} placeholder="名称" onChange={(event) => onChange(value.map((item, position) => position === index ? { ...item, label: event.target.value } : item))} />
      <input aria-label={`${label} ${index + 1} 地址`} required type="url" value={link.url} placeholder="https://example.com" onChange={(event) => onChange(value.map((item, position) => position === index ? { ...item, url: event.target.value } : item))} />
      <button type="button" aria-label={`移除${label} ${index + 1}`} onClick={() => onChange(value.filter((_, position) => position !== index))}><X size={14} /></button>
    </div>)}
    <button className="site-branding-add-link" type="button" onClick={() => onChange([...value, { label: "", url: "" }])}><Plus size={13} />添加链接</button>
  </div>;
}

export function SiteSettingsForm({ value, onChange, disabled = false }: {
  value: SiteConfig; onChange: (value: SiteConfig) => void; disabled?: boolean;
}) {
  const branding = value.branding ?? DEFAULT_BRANDING;
  const updateBranding = (patch: Partial<SiteBranding>) => onChange({ ...value, branding: { ...branding, ...patch } });
  const updateCta = (patch: Partial<NonNullable<SiteBranding["cta"]>>) => {
    const next = { label: branding.cta?.label ?? "", url: branding.cta?.url ?? "", ...patch };
    updateBranding({ cta: next.label || next.url ? next : null });
  };
  return <fieldset className="site-settings-fields" disabled={disabled}>
    <label className="mvp-field">站点名称<input required maxLength={160} value={value.name} onChange={(event) => onChange({ ...value, name: event.target.value })} placeholder="例如：Orbis 使用手册" /></label>
    <label className="mvp-field">站点路径<div className="site-slug-field"><span>/s/</span><input required pattern="[a-z0-9]+(-[a-z0-9]+)*" maxLength={80} value={value.slug} onChange={(event) => onChange({ ...value, slug: event.target.value })} placeholder="team-handbook" /></div><small>小写英文、数字和连字符。发布后可通过此路径访问。</small></label>
    <label className="mvp-field site-description-field">站点简介<textarea rows={3} maxLength={2000} value={value.description} onChange={(event) => onChange({ ...value, description: event.target.value })} placeholder="告诉读者，他们可以在这里找到什么。" /></label>
    <label className="mvp-field">站点场景<select value={value.site_kind} onChange={(event) => onChange({ ...value, site_kind: event.target.value as SiteKind })}>{Object.entries(SITE_KINDS).map(([kind, item]) => <option value={kind} key={kind}>{item.label}</option>)}</select><small>{SITE_KINDS[value.site_kind].description}</small></label>
    <label className="mvp-field">主题色<div className="site-color-field"><input type="color" aria-label="主题色" value={value.accent_color} onChange={(event) => onChange({ ...value, accent_color: event.target.value })} /><span>{value.accent_color}</span></div></label>
    <div className="site-branding-fields">
      <div className="site-branding-heading"><strong>品牌与阅读外观</strong><span>链接和外观会随每次发布固定到公开版本。</span></div>
      <label className="mvp-field">Logo 地址<input type="url" value={branding.logo_url ?? ""} placeholder="https://example.com/logo.svg" onChange={(event) => updateBranding({ logo_url: event.target.value || null })} /><small>服务端会在预览与发布时校验公开 URL。</small></label>
      <label className="mvp-field">阅读主题<select value={branding.theme} onChange={(event) => updateBranding({ theme: event.target.value as SiteBranding["theme"] })}><option value="system">跟随系统</option><option value="light">浅色</option><option value="dark">深色</option></select></label>
      <LinkList label="顶栏链接" value={branding.links} onChange={(links) => updateBranding({ links })} />
      <LinkList label="页脚链接" value={branding.footer_links} onChange={(footer_links) => updateBranding({ footer_links })} />
      <div className="site-branding-cta"><span>行动按钮</span><div>
        <input aria-label="行动按钮名称" required={Boolean(branding.cta?.url)} value={branding.cta?.label ?? ""} placeholder="联系我们" onChange={(event) => updateCta({ label: event.target.value })} />
        <input aria-label="行动按钮地址" required={Boolean(branding.cta?.label)} type="url" value={branding.cta?.url ?? ""} placeholder="https://example.com/contact" onChange={(event) => updateCta({ url: event.target.value })} />
      </div></div>
    </div>
  </fieldset>;
}
