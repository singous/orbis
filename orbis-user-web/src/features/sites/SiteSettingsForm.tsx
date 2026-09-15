import { SITE_KINDS, type SiteConfig, type SiteKind } from "./schemas";

export function SiteSettingsForm({ value, onChange, disabled = false }: {
  value: SiteConfig; onChange: (value: SiteConfig) => void; disabled?: boolean;
}) {
  return <fieldset className="site-settings-fields" disabled={disabled}>
    <label className="mvp-field">站点名称<input required maxLength={160} value={value.name} onChange={(event) => onChange({ ...value, name: event.target.value })} placeholder="例如：Orbis 使用手册" /></label>
    <label className="mvp-field">站点路径<div className="site-slug-field"><span>/s/</span><input required pattern="[a-z0-9]+(-[a-z0-9]+)*" maxLength={80} value={value.slug} onChange={(event) => onChange({ ...value, slug: event.target.value })} placeholder="team-handbook" /></div><small>小写英文、数字和连字符。发布后可通过此路径访问。</small></label>
    <label className="mvp-field">站点简介<textarea rows={3} maxLength={2000} value={value.description} onChange={(event) => onChange({ ...value, description: event.target.value })} placeholder="告诉读者，他们可以在这里找到什么。" /></label>
    <label className="mvp-field">站点场景<select value={value.site_kind} onChange={(event) => onChange({ ...value, site_kind: event.target.value as SiteKind })}>{Object.entries(SITE_KINDS).map(([kind, item]) => <option value={kind} key={kind}>{item.label}</option>)}</select><small>{SITE_KINDS[value.site_kind].description}</small></label>
    <label className="mvp-field">主题色<div className="site-color-field"><input type="color" aria-label="主题色" value={value.accent_color} onChange={(event) => onChange({ ...value, accent_color: event.target.value })} /><span>{value.accent_color}</span></div></label>
  </fieldset>;
}
