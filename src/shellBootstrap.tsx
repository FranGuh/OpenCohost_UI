import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { App } from "./App.js";
import { queryClient } from "./api/queryClient.js";
import { openExternalUrl } from "./lib/openUrl.js";
import "./styles/tokens.css";
import "./styles.css";

if (typeof window !== "undefined") {
  window.addEventListener("click", (event) => {
    if (event.defaultPrevented) return;
    const target = (event.target as HTMLElement | null)?.closest?.("a[href^='http']");
    if (!target) return;
    const href = target.getAttribute("href");
    if (href) {
      event.preventDefault();
      void openExternalUrl(href);
    }
  });
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>
);
