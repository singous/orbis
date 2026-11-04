import { OrbisLogo } from "./OrbisLogo";

type OrbisAttributionProps = { appearance: "share" | "provider" };

export function OrbisAttribution({ appearance }: OrbisAttributionProps) {
  const provider = appearance === "provider";
  const Name = provider ? "strong" : "span";
  return <span className={provider ? "inline-flex basis-full flex-wrap items-center gap-x-1.5 gap-y-2" : "ms-auto inline-flex items-center gap-3 text-[.8rem] text-(--ob-share-muted-foreground)"}>
    <span className={`inline-flex items-center gap-1.5 ${provider ? "" : "max-[760px]:hidden"}`}>
      {provider ? "由 " : null}<OrbisLogo size={20} /><Name>Orbis{provider ? null : " · 实时文档分享"}</Name>{provider ? " 提供支持" : null}
    </span>
    <a href="/licenses/" className={`inline-flex min-h-6 items-center rounded-sm underline decoration-from-font underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current pointer-coarse:min-h-(--ob-control-height-touch) ${provider ? "basis-full" : "text-xs"}`}>源码与许可</a>
  </span>;
}
