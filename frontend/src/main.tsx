import React from "react";
import ReactDOM from "react-dom/client";

import { App } from "./app/App";
import { initializeAppearance } from "./shared/theme/appearance";
import "./styles/index.css";
import "./styles/document-prose.css";
import "./styles/collaboration.css";
import "./styles/notebook-icons.css";

const disposeAppearance = initializeAppearance();
if (import.meta.hot) import.meta.hot.dispose(disposeAppearance);

async function start() {
  // Retain server-rendered reading content while the interactive reader loads.
  if (document.getElementById("orbis-site-bootstrap")) await import("./features/sites/PublicSitePage");
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode><App /></React.StrictMode>,
  );
}
void start().catch((error: unknown) => { console.error("Unable to start the interactive reader", error); });
