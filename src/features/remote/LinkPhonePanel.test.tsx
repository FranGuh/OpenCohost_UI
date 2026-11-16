import { http, HttpResponse } from "msw";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useUiLocaleStore } from "../../i18n/locale.js";
import { server } from "../../test/server.js";
import { API_BASE_URL } from "../../test/handlers.js";
import { LinkPhonePanel } from "./LinkPhonePanel.js";

const CODE = "K7Q2-M9XT";
const URL_KEY = "oc-remote-gateway-url";

const DEVICES = [
  { device_id: "d1", name: "Pixel 9", created_at: 1_700_000_000, last_used_at: 1_700_100_000, revoked: false },
  { device_id: "d2", name: "Old tablet", created_at: 1_690_000_000, last_used_at: null, revoked: false }
];

function renderPanel() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(React.createElement(QueryClientProvider, { client: queryClient }, React.createElement(LinkPhonePanel)));
}

function serve(opts: { devices?: unknown[]; disabled?: boolean; expiresInS?: number } = {}) {
  const state = { devices: opts.devices ?? [], deletes: [] as string[], mints: 0 };
  const disabled = () => HttpResponse.json({ error: "gateway_disabled" }, { status: 409 });
  server.use(
    http.get(`${API_BASE_URL}/api/remote/devices`, () => (opts.disabled ? disabled() : HttpResponse.json({ devices: state.devices }))),
    http.post(`${API_BASE_URL}/api/remote/pair-code`, () => {
      if (opts.disabled) return disabled();
      state.mints += 1;
      return HttpResponse.json({ code: CODE, expires_at: Date.now() / 1000 + (opts.expiresInS ?? 120), gateway_port: 8780 });
    }),
    http.delete(`${API_BASE_URL}/api/remote/devices/:id`, ({ params }) => {
      state.deletes.push(String(params.id));
      state.devices = state.devices.filter((d) => (d as { device_id: string }).device_id !== params.id);
      return HttpResponse.json({ device_id: params.id, revoked: true });
    })
  );
  return state;
}

describe("LinkPhonePanel", () => {
  // Test default locale is es; assert on the en copy.
  beforeEach(() => {
    useUiLocaleStore.setState({ locale: "en" });
    window.localStorage.clear();
  });
  afterEach(() => {
    useUiLocaleStore.setState({ locale: "es" });
    vi.restoreAllMocks();
  });

  it("explains how to enable the gateway when the backend answers 409 gateway_disabled", async () => {
    serve({ disabled: true });
    renderPanel();
    expect(await screen.findByText(/remote gateway is off/i)).toBeInTheDocument();
    expect(screen.getByText(/OPENCOHOST_REMOTE_GATEWAY=1/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Generate pairing code" })).not.toBeInTheDocument();
  });

  it("renders the phone access disclaimer in English", async () => {
    serve();
    renderPanel();
    expect(
      await screen.findByText(
        "Phone access works by invitation (one-time pairing code) or can be configured via an AI agent through the gateway and system environment variables."
      )
    ).toBeInTheDocument();
  });

  it("renders the phone access disclaimer in Spanish", async () => {
    useUiLocaleStore.setState({ locale: "es" });
    serve();
    renderPanel();
    expect(
      await screen.findByText(
        "El uso del teléfono funciona mediante invitación (código temporal de emparejamiento) o puede ser configurado mediante un agente de IA a través de la pasarela y variables de entorno del sistema."
      )
    ).toBeInTheDocument();
  });

  it("shows the code, a countdown and the link built from the stored base URL", async () => {
    serve();
    window.localStorage.setItem(URL_KEY, "https://kira.example.com/");
    renderPanel();
    await userEvent.click(await screen.findByRole("button", { name: "Generate pairing code" }));
    expect(await screen.findByText(CODE)).toBeInTheDocument();
    expect(screen.getByText(/Expires in [12]:\d\d/)).toBeInTheDocument();
    expect(screen.getByText(/works once and expires in 2 minutes/i)).toBeInTheDocument();
    expect(screen.getByText(`https://kira.example.com/#code=${CODE}`)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy link" })).toBeInTheDocument();
  });

  it("persists the public URL as a per-viewer preference", async () => {
    serve();
    renderPanel();
    const input = await screen.findByLabelText("Public gateway URL");
    fireEvent.change(input, { target: { value: "https://kira.example.com" } });
    expect(window.localStorage.getItem(URL_KEY)).toBe("https://kira.example.com");
  });

  it("copies the full link", async () => {
    serve();
    window.localStorage.setItem(URL_KEY, "https://kira.example.com");
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "Generate pairing code" }));
    fireEvent.click(await screen.findByRole("button", { name: "Copy link" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(`https://kira.example.com/#code=${CODE}`));
  });

  it("shows the code without a link when no base URL is set", async () => {
    serve();
    renderPanel();
    await userEvent.click(await screen.findByRole("button", { name: "Generate pairing code" }));
    expect(await screen.findByText(CODE)).toBeInTheDocument();
    expect(screen.queryByText(/#code=/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Copy link" })).not.toBeInTheDocument();
  });

  it("counts down and hides the code once it expires", async () => {
    serve({ expiresInS: 1 });
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "Generate pairing code" }));
    expect(await screen.findByText(CODE)).toBeInTheDocument();
    expect(await screen.findByText(/code expired/i, {}, { timeout: 4000 })).toBeInTheDocument();
    expect(screen.queryByText(CODE)).not.toBeInTheDocument();
  });

  it("lists devices with name, created and last used, and no hashes", async () => {
    serve({ devices: [{ ...DEVICES[0], token_hash: "deadbeef" }, DEVICES[1]] });
    renderPanel();
    const row = (await screen.findByText("Pixel 9")).closest("li") as HTMLElement;
    expect(within(row).getByText(/Created/)).toBeInTheDocument();
    expect(within(row).getByText(/Last used/)).toBeInTheDocument();
    const other = screen.getByText("Old tablet").closest("li") as HTMLElement;
    expect(within(other).getByText(/Never used/)).toBeInTheDocument();
    expect(screen.queryByText(/deadbeef/)).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^Revoke / })).toHaveLength(2);
  });

  it("asks for confirmation before revoking, then calls DELETE", async () => {
    const state = serve({ devices: DEVICES });
    renderPanel();
    await userEvent.click(await screen.findByRole("button", { name: "Revoke Pixel 9" }));
    expect(state.deletes).toEqual([]);
    expect(screen.getByText(/Revoke Pixel 9\?/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Yes, revoke" }));
    await waitFor(() => expect(state.deletes).toEqual(["d1"]));
    await waitFor(() => expect(screen.queryByText("Pixel 9")).not.toBeInTheDocument());
  });

  it("cancelling the confirm step does not call DELETE", async () => {
    const state = serve({ devices: DEVICES });
    renderPanel();
    await userEvent.click(await screen.findByRole("button", { name: "Revoke Pixel 9" }));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(state.deletes).toEqual([]);
    expect(screen.getByText("Pixel 9")).toBeInTheDocument();
  });

  it("never writes the pairing code to the console", async () => {
    serve();
    window.localStorage.setItem(URL_KEY, "https://kira.example.com");
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) => vi.spyOn(console, m));
    renderPanel();
    await userEvent.click(await screen.findByRole("button", { name: "Generate pairing code" }));
    await screen.findByText(CODE);
    for (const spy of spies) {
      expect(JSON.stringify(spy.mock.calls)).not.toContain(CODE);
    }
  });
});
