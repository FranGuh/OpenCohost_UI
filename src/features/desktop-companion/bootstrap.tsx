import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DesktopCompanion } from "./DesktopCompanion.js";
import "../../styles/tokens.css";
import "../../styles.css";
import "./desktop.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

document.documentElement.dataset.desktopCompanion = "";
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <DesktopCompanion />
    </QueryClientProvider>
  </React.StrictMode>
);
