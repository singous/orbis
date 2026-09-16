import React from "react";
import ReactDOM from "react-dom/client";

import { App } from "./app/App";
import "./styles/index.css";
import "./styles/auth.css";
import "./styles/workspace-shell.css";
import "./styles/base-mvp.css";
import "./styles/collaboration.css";
import "./styles/workbench-pages.css";
import "./styles/notebook-icons.css";

async function start() {
  // Retain server-rendered reading content while the interactive reader loads.
  if (document.getElementById("orbis-site-bootstrap")) await import("./features/sites/PublicSitePage");
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode><App /></React.StrictMode>,
  );
}
void start().catch((error: unknown) => { console.error("Unable to start the interactive reader", error); });
