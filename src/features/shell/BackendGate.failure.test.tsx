import { http, HttpResponse } from "msw";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { server } from "../../test/server.js";
import { API_BASE_URL } from "../../test/handlers.js";
import { BackendGate } from "./BackendGate.js";
import { REPORT_ISSUE_URL } from "./supportUrls.js";

vi.mock("../../lib/backendBootstrap.js", () => ({
  bootstrapBackend: () => Promise.resolve({ runtimeRequired: false, backendError: null }),
  getBackendBootstrapError: () => null,
  resetBackendBootstrap: () => undefined
}));

const control = vi.hoisted(() => ({ getBackendStatus: vi.fn(), reloadBackend: vi.fn() }));
vi.mock("../../lib/backendControl.js", () => ({
  getBackendStatus: () => control.getBackendStatus(),
  reloadBackend: () => control.reloadBackend()
}));

const open = vi.hoisted(() => vi.fn());
vi.mock("../../lib/openUrl.js", () => ({ openExternalUrl: (url: string) => open(url) }));
vi.mock("../../lib/appVersion.js", () => ({ getAppVersion: () => Promise.resolve("9.9.9") }));

const STATUS = {
  managed: true,
  child_alive: false,
  restarting: false,
  gave_up: true,
  restarts: 1,
  error_code: "backend_exited",
  log_path: "C:/data/logs/backend.log",
  last_line: "ModuleNotFoundError: boom"
};

function renderGate() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <BackendGate pollIntervalMs={5} failureThreshold={1}>
        <div>app</div>
      </BackendGate>
    </QueryClientProvider>
  );
}

let clipboardWrite: ReturnType<typeof vi.fn>;

beforeEach(() => {
  control.getBackendStatus.mockReset();
  control.reloadBackend.mockReset();
  open.mockReset();
  server.use(http.get(`${API_BASE_URL}/api/health`, () => HttpResponse.json({ detail: "down" }, { status: 503 })));
  clipboardWrite = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { value: { writeText: clipboardWrite }, configurable: true });
});

describe("BackendGate engine-failure card", () => {
  it("shows the error code verbatim with its cause sentence", async () => {
    control.getBackendStatus.mockResolvedValue(STATUS);
    renderGate();
    const alert = await screen.findByRole("alert");
    await waitFor(() => expect(alert).toHaveTextContent("backend_exited"));
    expect(alert).toHaveTextContent(/se detuvo/i);
  });

  it("shows a stable placeholder code when the engine started but never became healthy", async () => {
    control.getBackendStatus.mockResolvedValue({ ...STATUS, error_code: null, gave_up: false, child_alive: false });
    renderGate();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("backend_not_healthy");
    expect(alert).toHaveTextContent(/nunca llegó a responder/i);
  });

  it("shows the placeholder when there is no supervisor at all (browser)", async () => {
    control.getBackendStatus.mockResolvedValue(null);
    renderGate();
    expect(await screen.findByRole("alert")).toHaveTextContent("backend_not_healthy");
  });

  it("keeps Retry as the autofocused primary action", async () => {
    control.getBackendStatus.mockResolvedValue(STATUS);
    renderGate();
    const retry = await screen.findByRole("button", { name: "Reintentar" });
    expect(retry).toHaveFocus();
  });

  it("copies a plain-text details block to the clipboard and confirms", async () => {
    control.getBackendStatus.mockResolvedValue(STATUS);
    renderGate();
    await userEvent.click(await screen.findByRole("button", { name: /copiar detalles/i }));
    await waitFor(() => expect(clipboardWrite).toHaveBeenCalledTimes(1));
    const text = clipboardWrite.mock.calls[0][0] as string;
    expect(text).toContain("OpenCohost 9.9.9");
    expect(text).toContain("Error code: backend_exited");
    expect(text).toContain("Restarts: 1");
    expect(text).toContain("C:/data/logs/backend.log");
    expect(text).toContain("ModuleNotFoundError: boom");
    expect(await screen.findByText(/detalles copiados/i)).toBeInTheDocument();
  });

  it("shows a failure state when the clipboard is unavailable", async () => {
    clipboardWrite.mockRejectedValue(new Error("denied"));
    control.getBackendStatus.mockResolvedValue(STATUS);
    renderGate();
    await userEvent.click(await screen.findByRole("button", { name: /copiar detalles/i }));
    expect(await screen.findByText(/no se pudo copiar/i)).toBeInTheDocument();
  });

  it("warns that the details can include folder names", async () => {
    control.getBackendStatus.mockResolvedValue(STATUS);
    renderGate();
    expect(await screen.findByText(/nombres de carpetas/i)).toBeInTheDocument();
  });

  it("opens the plain issue URL, with no prefilled body", async () => {
    control.getBackendStatus.mockResolvedValue(STATUS);
    renderGate();
    await userEvent.click(await screen.findByRole("button", { name: /reportar un problema/i }));
    expect(open).toHaveBeenCalledWith(REPORT_ISSUE_URL);
    expect(open.mock.calls[0][0]).not.toContain("body=");
  });
});
