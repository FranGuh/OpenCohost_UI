import { http, HttpResponse } from "msw";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import React from "react";
import { describe, expect, it } from "vitest";
import { server } from "../test/server.js";
import { API_BASE_URL, defaultStatus } from "../test/handlers.js";
import { StatusRail } from "./StatusRail.js";

function renderRail() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    React.createElement(QueryClientProvider, { client: queryClient }, React.createElement(StatusRail))
  );
}

describe("StatusRail (spec §3a — calm cockpit readout)", () => {
  it("shows a non-crashing loading chip before the first response resolves", () => {
    renderRail();
    expect(screen.getByText(/Conectando con el motor/)).toBeInTheDocument();
  });

  it("renders four instrument chips driven by useStatusQuery — not hardcoded", async () => {
    renderRail();

    await waitFor(() => expect(screen.getByText(/Motor OK/)).toBeInTheDocument());
    // Modelo chip: model name is a fact, always neutral — truncation now lives
    // on the label span (the rail no longer clips, so popovers can escape).
    const modelLabel = screen.getByText(defaultStatus.current_model as string);
    expect(modelLabel).toHaveClass("truncate");
    // Kira chip merges the old Voz + Inactivo axes.
    expect(screen.getByText(/Kira: en espera/)).toBeInTheDocument();
    // Perfil chip.
    expect(screen.getByText(defaultStatus.active_profile)).toBeInTheDocument();

    const rail = screen.getByRole("status", { name: "Estado operativo de OpenCohost" });
    expect(rail).not.toHaveClass("flex-wrap");
    // The deleted Health chip's word "Health" is gone (its data moved into the
    // Motor popover), and no chip says "Sistema" anymore.
    expect(screen.queryByText(/Health:/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Sistema:/)).not.toBeInTheDocument();
  });

  it("keeps a healthy app calm — only Motor OK, no red chip anywhere", async () => {
    renderRail();
    await waitFor(() => expect(screen.getByText(/Motor OK/)).toBeInTheDocument());
    expect(screen.getByText(/Motor OK/)).toHaveAttribute("data-taxonomy", "ok");
  });

  it("escalates a red health payload to the Motor 'necesita acción' action state", async () => {
    server.use(
      http.get(`${API_BASE_URL}/api/status`, () =>
        HttpResponse.json({
          ...defaultStatus,
          is_speaking: true,
          current_model: null,
          active_profile: "Akira",
          health: { ...defaultStatus.health, overall_status: "red", vram_status: "red" }
        })
      )
    );

    renderRail();

    const motor = await screen.findByText(/Motor: necesita acción/);
    expect(motor).toHaveAttribute("data-taxonomy", "action");
    // Modelo shows the null-model fallback; Kira reflects is_speaking; Perfil the name.
    expect(screen.getByText("sin modelo")).toBeInTheDocument();
    expect(screen.getByText(/Kira: hablando/)).toBeInTheDocument();
    expect(screen.getByText("Akira")).toBeInTheDocument();
  });

  it("rolls up a not-ready model (health OK) as an 'atención' preparando state", async () => {
    server.use(
      http.get(`${API_BASE_URL}/api/status`, () => HttpResponse.json({ ...defaultStatus, is_ready: false }))
    );
    renderRail();
    const motor = await screen.findByText(/Motor: preparando/);
    expect(motor).toHaveAttribute("data-taxonomy", "attention");
  });

  it("rolls up health=yellow (model ready) as an 'atención' state naming the dimension in its popover", async () => {
    server.use(
      http.get(`${API_BASE_URL}/api/status`, () =>
        HttpResponse.json({
          ...defaultStatus,
          health: { ...defaultStatus.health, overall_status: "yellow", vram_status: "yellow" }
        })
      )
    );
    renderRail();
    const motor = await screen.findByText(/Motor: atención/);
    expect(motor).toHaveAttribute("data-taxonomy", "attention");

    await userEvent.click(motor);
    const dialog = screen.getByRole("dialog", { name: "Motor: atención" });
    expect(dialog).toHaveTextContent("La salud está en amarillo (VRAM)");
    expect(dialog).toHaveTextContent("Kira sigue funcionando");
  });

  it("shows 'cargando modelo' when ollama_warming is true and the model isn't ready", async () => {
    server.use(
      http.get(`${API_BASE_URL}/api/status`, () =>
        HttpResponse.json({ ...defaultStatus, is_ready: false, ollama_warming: true })
      )
    );
    renderRail();
    await waitFor(() => expect(screen.getByText(/Motor: cargando modelo/)).toBeInTheDocument());
  });

  it("does not show 'cargando modelo' when ollama_warming is false or absent", async () => {
    renderRail();
    await waitFor(() => expect(screen.getByText(/Motor OK/)).toBeInTheDocument());
    expect(screen.queryByText(/cargando modelo/)).not.toBeInTheDocument();
  });

  it("rolls up health=unknown as a neutral 'Motor: …' state — no red input degrades", async () => {
    server.use(
      http.get(`${API_BASE_URL}/api/status`, () =>
        HttpResponse.json({ ...defaultStatus, health: { ...defaultStatus.health, overall_status: "unknown" } })
      )
    );
    renderRail();
    const motor = await screen.findByText(/Motor: …/);
    expect(motor).toHaveAttribute("data-taxonomy", "neutral");
  });

  it("on query error renders ONLY the Motor chip in its 'Sin conexión' action state (spec revision #5)", async () => {
    server.use(
      http.get(`${API_BASE_URL}/api/status`, () => HttpResponse.json({ detail: "boom" }, { status: 500 }))
    );
    renderRail();

    const motor = await screen.findByText(/Sin conexión/);
    expect(motor).toHaveAttribute("data-taxonomy", "action");
    // Modelo, Kira, and Perfil chips are omitted entirely — no placeholder copy.
    expect(screen.queryByText(/Modelo/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Kira/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Perfil/)).not.toBeInTheDocument();
  });
});

describe("StatusRail — Motor why-popover (a11y: keyboard + outside-click)", () => {
  it("opens on click and appends the health detail table with real numbers", async () => {
    const user = userEvent.setup();
    renderRail();

    const motor = await screen.findByText(/Motor OK/);
    expect(motor).toHaveAttribute("aria-expanded", "false");

    await user.click(motor);
    expect(motor).toHaveAttribute("aria-expanded", "true");

    const dialog = screen.getByRole("dialog", { name: "Motor OK" });
    expect(dialog).toHaveTextContent("Todo en orden");
    // Detail rows carry the deleted Health chip's data as real values.
    expect(dialog).toHaveTextContent("VRAM libre");
    expect(dialog).toHaveTextContent("4096 MB");
    expect(dialog).toHaveTextContent("RTF 0.30");
    expect(dialog).toHaveTextContent("Qwen (voz)");
  });

  it("closes on Escape and returns aria-expanded to false", async () => {
    const user = userEvent.setup();
    renderRail();

    const motor = await screen.findByText(/Motor OK/);
    await user.click(motor);
    expect(screen.getByRole("dialog", { name: "Motor OK" })).toBeInTheDocument();

    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Motor OK" })).not.toBeInTheDocument());
    expect(motor).toHaveAttribute("aria-expanded", "false");
  });

  it("closes on an outside click", async () => {
    const user = userEvent.setup();
    renderRail();

    const motor = await screen.findByText(/Motor OK/);
    await user.click(motor);
    expect(screen.getByRole("dialog", { name: "Motor OK" })).toBeInTheDocument();

    await user.click(document.body);
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Motor OK" })).not.toBeInTheDocument());
  });

  it("opens with the Enter key (keyboard operable)", async () => {
    const user = userEvent.setup();
    renderRail();

    const motor = await screen.findByText(/Motor OK/);
    motor.focus();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("dialog", { name: "Motor OK" })).toBeInTheDocument();
  });
});

describe("StatusRail — adjust round 2 (owner runtime feedback, 2026-07-15)", () => {
  it("names 'voz (Qwen)' in the red why-copy when qwen_status is 'unknown' — never empty parens", async () => {
    server.use(
      http.get(`${API_BASE_URL}/api/status`, () =>
        HttpResponse.json({
          ...defaultStatus,
          health: { ...defaultStatus.health, overall_status: "red", qwen_status: "unknown" }
        })
      )
    );
    renderRail();

    const motor = await screen.findByText(/Motor: necesita acción/);
    await userEvent.click(motor);
    const dialog = screen.getByRole("dialog", { name: "Motor: necesita acción" });
    // The dim that holds the backend red is named — no "()".
    expect(dialog).toHaveTextContent("La salud del sistema está en rojo (voz (Qwen))");
    expect(dialog).not.toHaveTextContent("()");
    // The Qwen detail row surfaces the cause: "sin iniciar" (not the raw "unknown").
    expect(dialog).toHaveTextContent("sin iniciar");
  });

  it("shows 'no disponible' (not '0 MB') for the VRAM row when vram_status is 'unavailable'", async () => {
    server.use(
      http.get(`${API_BASE_URL}/api/status`, () =>
        HttpResponse.json({
          ...defaultStatus,
          health: { ...defaultStatus.health, vram_status: "unavailable", free_vram_mb: 0 }
        })
      )
    );
    renderRail();

    const motor = await screen.findByText(/Motor OK/);
    await userEvent.click(motor);
    const dialog = screen.getByRole("dialog", { name: "Motor OK" });
    expect(dialog).toHaveTextContent("no disponible");
    expect(dialog).not.toHaveTextContent("0 MB");
  });

  it("shows 'sin datos aún' for the Velocidad row when rtf_rolling_avg is null", async () => {
    server.use(
      http.get(`${API_BASE_URL}/api/status`, () =>
        HttpResponse.json({ ...defaultStatus, health: { ...defaultStatus.health, rtf_rolling_avg: null } })
      )
    );
    renderRail();

    const motor = await screen.findByText(/Motor OK/);
    await userEvent.click(motor);
    const dialog = screen.getByRole("dialog", { name: "Motor OK" });
    expect(dialog).toHaveTextContent("sin datos aún");
  });

  it("drops the parens entirely on a red rollup whose dims are all clean/unavailable (never '()')", async () => {
    server.use(
      http.get(`${API_BASE_URL}/api/status`, () =>
        HttpResponse.json({
          ...defaultStatus,
          health: {
            ...defaultStatus.health,
            overall_status: "red",
            vram_status: "unavailable",
            rtf_status: "ok",
            ollama_status: "ok",
            qwen_status: "unavailable"
          }
        })
      )
    );
    renderRail();

    const motor = await screen.findByText(/Motor: necesita acción/);
    await userEvent.click(motor);
    const dialog = screen.getByRole("dialog", { name: "Motor: necesita acción" });
    expect(dialog).toHaveTextContent("La salud del sistema está en rojo.");
    expect(dialog).not.toHaveTextContent("()");
  });

  it("anchors the far-right Perfil chip's popover to the right edge (right-0), not left-0", async () => {
    renderRail();
    const perfil = await screen.findByText(defaultStatus.active_profile);
    await userEvent.click(perfil);
    const dialog = screen.getByRole("dialog", { name: defaultStatus.active_profile });
    expect(dialog).toHaveClass("right-0");
    expect(dialog).not.toHaveClass("left-0");
  });
});
