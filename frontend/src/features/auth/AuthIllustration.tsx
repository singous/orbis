import { Pause, Play } from "@gravity-ui/icons";
import { useState } from "react";

import { Button } from "../../shared/ui/Button";

export function AuthIllustration() {
  const [paused, setPaused] = useState(false);

  return <>
    <div className="auth-showcase-art" data-motion-paused={paused} aria-hidden="true">
      <img src="/images/auth-orbit.webp" alt="" width={1254} height={1254} decoding="async" />
    </div>
    <div className="auth-showcase-footer">
      <span>STUDY. WORK. YOUR WAY.</span>
      <Button
        className="auth-motion-toggle"
        size="sm"
        variant="ghost"
        aria-label={paused ? "播放插画动画" : "暂停插画动画"}
        icon={paused ? <Play aria-hidden="true" /> : <Pause aria-hidden="true" />}
        onClick={() => setPaused(value => !value)}
      >
        {paused ? "播放动画" : "暂停动画"}
      </Button>
    </div>
  </>;
}
