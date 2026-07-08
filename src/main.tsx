import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { App } from "./App.js";
import { queryClient } from "./api/queryClient.js";
import { bootstrapBackend } from "./lib/backendBootstrap.js";
import "./styles/tokens.css";
import "./styles.css";

/**
 * Async wrapper (not a top-level await) so bootstrapBackend's Tauri
 * `invoke("backend_info")` call resolves the real base URL before the
 * first render — but a failed/missing invoke still renders immediately
 * (bootstrapBackend never throws), so this never hangs a plain browser dev
 * session or a broken Tauri IPC boundary.
 */
async function main() {
  await bootstrapBackend();

  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </React.StrictMode>
  );
}

void main();
