import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FirstRunGate } from "./FirstRunGate.js";
import { WelcomeCard } from "../experiencia/WelcomeCard.js";
import { SetupFlow } from "../setup/SetupFlow.js";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue({
    phase: "unconfigured",
    launchable: false,
    data_root: null,
    default_data_root: "C:/data",
    install_id: null,
    error_code: null,
    message: "",
    can_retry: false,
    progress: null
  })
}));

function withClient(node: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{node}</QueryClientProvider>;
}

describe("support links on the configuration surfaces", () => {
  it("first-run screen", async () => {
    render(<FirstRunGate onReady={() => undefined} />);
    expect(await screen.findByRole("button", { name: /reportar un problema/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /patrocinar/i })).toBeInTheDocument();
  });

  it("welcome card", () => {
    render(<WelcomeCard onDismiss={() => undefined} />);
    expect(screen.getByRole("button", { name: /reportar un problema/i })).toBeInTheDocument();
  });

  it("setup assistant modal", () => {
    render(withClient(<SetupFlow variant="modal" onClose={() => undefined} onComplete={() => undefined} />));
    expect(screen.getByRole("button", { name: /reportar un problema/i })).toBeInTheDocument();
  });

  it("setup assistant panel does not repeat them", () => {
    render(withClient(<SetupFlow variant="panel" onClose={() => undefined} onComplete={() => undefined} />));
    expect(screen.queryByRole("button", { name: /reportar un problema/i })).not.toBeInTheDocument();
  });
});
