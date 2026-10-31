type OrbisLogoProps = {
  variant?: "mark" | "horizontal";
  size?: number;
  className?: string;
};

/** Decorative artwork; the parent link or adjacent text supplies its accessible name. */
export function OrbisLogo({ variant = "mark", size = 28, className = "" }: OrbisLogoProps) {
  return <svg
    className={`orbis-logo ${className}`}
    width={variant === "horizontal" ? size * 1000 / 360 : size}
    height={size}
    viewBox={variant === "horizontal" ? "0 0 1000 360" : "0 0 360 360"}
    aria-hidden="true"
    focusable="false"
    style={{ flexShrink: 0 }}
  >
    <use href="/brand/orbis-mark.svg#orbis-mark" />
    {variant === "horizontal" ? <use href="/brand/orbis-wordmark.svg#orbis-wordmark" transform="translate(430 100.7) scale(1.3)" /> : null}
  </svg>;
}
