import type { ReactNode } from "react";
import type { SiteConfig, SiteSources } from "./schemas";
import { SiteSectionHeading } from "./SiteManagementLayout";
import { SiteSettingsForm } from "./SiteSettingsForm";
import { SiteSourceEditor } from "./SiteSourceEditor";

/** 创建与编辑共用站点字段编排；保存、来源解析和手动目录更新仍归页面所有。 */
export function SiteDraftFields({ value, onChange, disabled, autoFocusName, saved, sources, savedAtMs, children, layout = "stack" }: {
  value: SiteConfig;
  onChange: (value: SiteConfig) => void;
  disabled: boolean;
  autoFocusName?: boolean;
  saved?: boolean;
  sources?: SiteSources;
  savedAtMs?: number;
  children?: ReactNode;
  layout?: "stack" | "columns";
}) {
  const settings = <SiteSettingsForm autoFocusName={autoFocusName} value={value} onChange={onChange} disabled={disabled} />;
  const source = <SiteSourceEditor value={value.source} onChange={source => onChange({ ...value, source })} disabled={disabled} saved={saved} sources={sources} savedAtMs={savedAtMs} />;
  return layout === "columns" ? <div className="site-editor-layout grid grid-cols-[minmax(250px,.72fr)_minmax(470px,1.28fr)] items-start gap-6 max-[1000px]:grid-cols-1">
    <section><SiteSectionHeading title="站点设置" description="名称、场景、品牌与阅读外观。" />{settings}</section>
    <div className="grid gap-6">{source}{children}</div>
  </div> : <>{settings}{source}</>;
}
