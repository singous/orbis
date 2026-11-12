import { useState } from "react";
import { Button } from "@orbis/ui/button";
import { Pause, Play } from "../../shared/ui/icons";

export function AuthIllustration() {
  const [paused, setPaused] = useState(false);

  return <>
    <div className="group/art -mx-6 mt-2 flex min-h-0 flex-1 items-center justify-center" data-motion-paused={paused} aria-hidden="true">
      <img className="block size-full max-h-155 min-h-0 max-w-170 animate-ob-auth-orbit object-contain group-data-[motion-paused=true]/art:[animation-play-state:paused] max-[900px]:animate-none motion-reduce:animate-none motion-reduce:transform-none" src="/images/auth-orbit.webp" alt="" width={1254} height={1254} decoding="async" />
    </div>
    <div className="flex flex-none items-center justify-between gap-4 text-[11px] leading-[18px] font-medium tracking-[.13em] text-ob-auth-showcase-footer">
      <span>STUDY. WORK. YOUR WAY.</span>
      <Button
        className="h-8 min-h-8 flex-none rounded-full border-ob-auth-showcase-border px-2.5 text-xs tracking-normal text-ob-auth-showcase-foreground enabled:hover:bg-ob-auth-showcase-foreground/10 motion-reduce:hidden"
        size="sm"
        variant="ghost"
        aria-label={paused ? "播放动画（插画）" : "暂停动画（插画）"}
        onClick={() => setPaused(value => !value)}
      >
        {paused ? <Play aria-hidden="true" className="size-3.5" /> : <Pause aria-hidden="true" className="size-3.5" />}
        {paused ? "播放动画" : "暂停动画"}
      </Button>
    </div>
  </>;
}
