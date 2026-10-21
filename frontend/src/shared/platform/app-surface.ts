export type AppSurface = "web" | "desktop";

function validSurface(value: unknown): value is AppSurface {
  return value === "web" || value === "desktop";
}

/** Host configuration is explicit; viewport size only controls responsive layout. */
export function resolveAppSurface(hostSurface: unknown, buildSurface: unknown): AppSurface {
  if (validSurface(hostSurface)) return hostSurface;
  if (validSurface(buildSurface)) return buildSurface;
  return "web";
}

export function getAppSurface(): AppSurface {
  return resolveAppSurface(
    typeof window === "undefined" ? undefined : window.__ORBIS_HOST__?.surface,
    import.meta.env.VITE_APP_SURFACE,
  );
}
