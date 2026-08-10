import { http, HttpResponse } from "msw";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { describe, expect, it } from "vitest";
import { server } from "../../test/server.js";
import {
  API_BASE_URL,
  commandConflictHandler,
  commandNetworkErrorHandler,
  commandValidationHandler,
  defaultTtsConfig,
  frozenStatusHandler
} from "../../test/handlers.js";
import { VoiceCard } from "./VoiceCard.js";

function renderCard() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(React.createElement(QueryClientProvider, { client: queryClient }, React.createElement(VoiceCard)));
}

function defaultCommandHandler() {
  return http.post(`${API_BASE_URL}/api/commands`, () =>
    HttpResponse.json({ accepted: true, command_id: "cmd-1", status: "queued", state_version: 1 })
  );
}

describe("VoiceCard populates from GET /api/tts/config", () => {
  it("shows the live piper_voice, local-only, closest speed preset, and engine", async () => {
    renderCard();
    await waitFor(() =>
      expect(screen.getByRole("combobox", { name: "Idioma" })).toHaveTextContent("🇦🇷 Argentina")
    );
    expect(screen.getByRole("switch", { name: "Solo TTS local (Piper)" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("button", { name: "Media" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("combobox", { name: "Motor TTS" })).toHaveTextContent("Ligero (Edge-TTS)");
  });

  it("surfaces a GET error honestly instead of a stale/hardcoded config", async () => {
    server.use(
      http.get(`${API_BASE_URL}/api/tts/config`, () => HttpResponse.json({ detail: "boom" }, { status: 500 }))
    );
    renderCard();
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
  });

  it("disables the Pesado engine option when heavy_available is false", async () => {
    renderCard();
    const motor = await screen.findByRole("combobox", { name: "Motor TTS" });
    await waitFor(() => expect(motor).toHaveTextContent("Ligero (Edge-TTS)"));
    fireEvent.click(motor);
    expect(screen.getByRole("option", { name: "Pesado (Heavy)" })).toHaveAttribute("aria-disabled", "true");
  });
});

describe("VoiceCard set_piper_voice — accepted -> poll -> applied", () => {
  it("dispatches set_piper_voice, disables only the select while applying", async () => {
    // state_version pinned — never advances independently of a subsequent
    // POST, matching the real single-dispatcher counter; convergence here
    // must come from the optimistic timer, not a state_version comparison.
    server.use(frozenStatusHandler(1));
    server.use(defaultCommandHandler());
    renderCard();

    const select = await screen.findByRole("combobox", { name: "Idioma" });
    fireEvent.click(select);
    fireEvent.click(screen.getByRole("option", { name: "🌎 Neutral" }));

    expect(select).toHaveTextContent("🌎 Neutral");
    expect(select).toBeDisabled();
    expect(screen.getByText("aplicando…")).toBeInTheDocument();

    // independence — the other three controls stay enabled
    expect(screen.getByRole("switch", { name: "Solo TTS local (Piper)" })).not.toBeDisabled();
    expect(screen.getByRole("button", { name: "Media" })).not.toBeDisabled();
    expect(screen.getByRole("combobox", { name: "Motor TTS" })).not.toBeDisabled();

    await waitFor(() => expect(select).not.toBeDisabled());
  });
});

describe("VoiceCard set_tts_speed / set_tts_local_only / set_motor_tts — accepted -> poll -> applied", () => {
  it("dispatches set_tts_speed as the numeric length_scale for the chosen preset", async () => {
    // state_version pinned — never advances independently of a subsequent
    // POST, matching the real single-dispatcher counter; convergence here
    // must come from the optimistic timer, not a state_version comparison.
    server.use(frozenStatusHandler(1));
    let capturedBody: unknown;
    server.use(
      http.post(`${API_BASE_URL}/api/commands`, async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json({ accepted: true, command_id: "cmd-speed", status: "queued", state_version: 1 });
      })
    );
    renderCard();

    fireEvent.click(await screen.findByRole("button", { name: "Lenta" }));
    expect(screen.getByRole("button", { name: "Lenta" })).toHaveAttribute("aria-pressed", "true");
    await waitFor(() => expect(capturedBody).toEqual({ command: "set_tts_speed", payload: { value: 1.45 } }));
    await waitFor(() => expect(screen.queryByText("aplicando…")).not.toBeInTheDocument());
  });

  it("toggles set_tts_local_only and updates the hint copy", async () => {
    // state_version pinned — never advances independently of a subsequent
    // POST, matching the real single-dispatcher counter; convergence here
    // must come from the optimistic timer, not a state_version comparison.
    server.use(frozenStatusHandler(1));
    server.use(defaultCommandHandler());
    renderCard();

    const toggle = await screen.findByRole("switch", { name: "Solo TTS local (Piper)" });
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(screen.getByText(/Modo nube desactivado/)).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("aplicando…")).not.toBeInTheDocument());
  });

  it("dispatches set_motor_tts on engine change", async () => {
    // state_version pinned — never advances independently of a subsequent
    // POST, matching the real single-dispatcher counter; convergence here
    // must come from the optimistic timer, not a state_version comparison.
    server.use(frozenStatusHandler(1));
    // heavy_available:true so the Pesado engine option is selectable (the
    // custom ui/Select refuses clicks on a disabled option, unlike a native
    // <select> where fireEvent.change bypassed the disabled attribute).
    server.use(
      http.get(`${API_BASE_URL}/api/tts/config`, () => HttpResponse.json({ ...defaultTtsConfig, heavy_available: true }))
    );
    let capturedBody: unknown;
    server.use(
      http.post(`${API_BASE_URL}/api/commands`, async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json({ accepted: true, command_id: "cmd-engine", status: "queued", state_version: 1 });
      })
    );
    renderCard();

    const select = await screen.findByRole("combobox", { name: "Motor TTS" });
    await waitFor(() => expect(select).toHaveTextContent("Ligero (Edge-TTS)"));
    fireEvent.click(select);
    fireEvent.click(screen.getByRole("option", { name: "Pesado (Heavy)" }));

    expect(select).toHaveTextContent("Pesado (Heavy)");
    await waitFor(() => expect(capturedBody).toEqual({ command: "set_motor_tts", payload: { value: "pesado" } }));
    await waitFor(() => expect(select).not.toBeDisabled());
  });
});

describe("VoiceCard command errors surface honestly", () => {
  it("shows a 409 conflict alert", async () => {
    server.use(commandConflictHandler());
    renderCard();
    const select = await screen.findByRole("combobox", { name: "Idioma" });
    fireEvent.click(select);
    fireEvent.click(screen.getByRole("option", { name: "🌎 Neutral" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/conflict/));
  });

  it("shows a 422 validation alert with the backend detail", async () => {
    server.use(commandValidationHandler("set_tts_speed requires a numeric value"));
    renderCard();
    fireEvent.click(await screen.findByRole("button", { name: "Lenta" }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("set_tts_speed requires a numeric value")
    );
  });

  it("shows a network-error alert", async () => {
    server.use(commandNetworkErrorHandler());
    renderCard();
    const toggle = await screen.findByRole("switch", { name: "Solo TTS local (Piper)" });
    fireEvent.click(toggle);
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
  });
});

describe("VoiceCard heavy-TTS disclosure", () => {
  it("shows a note that reference-voice is experimental-gated and out of scope", async () => {
    renderCard();
    await screen.findByRole("combobox", { name: "Idioma" });
    expect(screen.getByText(/EXPERIMENTAL_HEAVY_TTS_ENABLED/)).toBeInTheDocument();
  });
});
