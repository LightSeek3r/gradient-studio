import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { getDevtools } from "../../lib/devtools-api";
import { App } from "../../ui/App";
import "../../ui/panel.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App api={getDevtools()} />
  </StrictMode>,
);
