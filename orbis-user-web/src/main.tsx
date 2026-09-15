import React from "react";
import ReactDOM from "react-dom/client";

import { App } from "./app/App";
import "./styles/index.css";
import "./styles/glass-theme.css";
import "./styles/base-mvp.css";
import "./styles/collaboration.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
