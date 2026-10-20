/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_APP_SURFACE?: "web" | "desktop";
}

interface Window {
  /** Set by a desktop host before loading the application entry point. */
  __ORBIS_HOST__?: { readonly surface?: "web" | "desktop" };
}
