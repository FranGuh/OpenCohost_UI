import { delay, http, HttpResponse } from "msw";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import React from "react";
import { describe, expect, it } from "vitest";
import { server } from "../../test/server.js";
import {
  API_BASE_URL,
  defaultStatus,
  llmProviderProbeArmedFalseHandler,
  llmProviderProbeUnavailableHandler
} from "../../test/handlers.js";
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
    // Container box was dropped now that the rail lives inside the h-10 title
    // bar — the chips sit directly on the bar (chips keep their own borders).
    expect(rail).not.toHaveClass("rounded-xl");
    expect(rail).not.toHaveClass("border");
    expect(rail).not.toHaveClass("shadow-soft");
    expect(rail).not.toHaveClass("bg-surface-1");
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

describe("StatusRail — resource numbers (runtime_findings_batch_20260731 F9/F14, unit 2.4)", () => {
  it("renders VRAM usada and the model residency estimates with real values", async () => {
    renderRail();
    const motor = await screen.findByText(/Motor OK/);
    await userEvent.click(motor);
    const dialog = screen.getByRole("dialog", { name: "Motor OK" });

    expect(dialog).toHaveTextContent("VRAM usada");
    expect(dialog).toHaveTextContent("4096/8192 MB");
    expect(dialog).toHaveTextContent("Modelo (estimado por Ollama)");
    expect(dialog).toHaveTextContent("Modelo residente (est.)");
    expect(dialog).toHaveTextContent("6144 MB");
    expect(dialog).toHaveTextContent("Modelo en VRAM (est.)");
    expect(dialog).toHaveTextContent("4352 MB");
    expect(dialog).toHaveTextContent("Spill a RAM (est.)");
    expect(dialog).toHaveTextContent("1792 MB");
    expect(dialog).toHaveTextContent("CPU/GPU");
    expect(dialog).toHaveTextContent("67% GPU / 33% CPU");
  });

  it("shows 'no disponible' for every residency row when no model is loaded / Ollama is down", async () => {
    server.use(
      http.get(`${API_BASE_URL}/api/status`, () =>
        HttpResponse.json({
          ...defaultStatus,
          health: {
            ...defaultStatus.health,
            model_resident_mb_est: null,
            model_vram_mb_est: null,
            model_ram_spill_mb_est: null,
            model_processor_split: null
          }
        })
      )
    );
    renderRail();

    const motor = await screen.findByText(/Motor OK/);
    await userEvent.click(motor);
    const dialog = screen.getByRole("dialog", { name: "Motor OK" });

    expect(dialog).toHaveTextContent("Modelo residente (est.)");
    expect(dialog).toHaveTextContent("Modelo en VRAM (est.)");
    expect(dialog).toHaveTextContent("Spill a RAM (est.)");
    expect(dialog).toHaveTextContent("CPU/GPU");
    // Every one of the four residency rows degrades to the same established
    // "no disponible" pattern (StatusRail.test.tsx:228) — plus the two 2.5
    // context rows, which also read "no disponible" here since this override
    // only touches `health`, leaving the fixture's default `ctx_telemetry: null`.
    const disponibleCount = dialog.textContent?.split("no disponible").length ?? 1;
    expect(disponibleCount - 1).toBe(6);
  });

  it("shows 'no disponible' for VRAM usada when vram_status is 'unavailable'", async () => {
    server.use(
      http.get(`${API_BASE_URL}/api/status`, () =>
        HttpResponse.json({ ...defaultStatus, health: { ...defaultStatus.health, vram_status: "unavailable" } })
      )
    );
    renderRail();

    const motor = await screen.findByText(/Motor OK/);
    await userEvent.click(motor);
    const dialog = screen.getByRole("dialog", { name: "Motor OK" });
    expect(dialog).toHaveTextContent("VRAM usada");
    expect(dialog).not.toHaveTextContent("undefined/undefined MB");
  });

  it("warns (amber) on the Spill a RAM row above the 2048 MB display threshold", async () => {
    server.use(
      http.get(`${API_BASE_URL}/api/status`, () =>
        HttpResponse.json({ ...defaultStatus, health: { ...defaultStatus.health, model_ram_spill_mb_est: 3000 } })
      )
    );
    renderRail();

    const motor = await screen.findByText(/Motor OK/);
    await userEvent.click(motor);
    const spillRow = screen.getByText(/Spill a RAM \(est\.\)/).closest("div");
    expect(spillRow?.querySelector('[aria-hidden="true"].bg-warn')).toBeInTheDocument();
  });

  it("does not warn on the Spill a RAM row at or below the 2048 MB display threshold", async () => {
    server.use(
      http.get(`${API_BASE_URL}/api/status`, () =>
        HttpResponse.json({ ...defaultStatus, health: { ...defaultStatus.health, model_ram_spill_mb_est: 2000 } })
      )
    );
    renderRail();

    const motor = await screen.findByText(/Motor OK/);
    await userEvent.click(motor);
    const spillRow = screen.getByText(/Spill a RAM \(est\.\)/).closest("div");
    expect(spillRow?.querySelector('[aria-hidden="true"].bg-warn')).not.toBeInTheDocument();
  });
});

describe("StatusRail — context telemetry (runtime_findings_batch_20260731 F10/2.3, unit 2.5)", () => {
  it("renders the Contexto (KV) section with the ratio percent and evicted pairs", async () => {
    server.use(
      http.get(`${API_BASE_URL}/api/status`, () =>
        HttpResponse.json({
          ...defaultStatus,
          ctx_telemetry: { ratio: 0.62, effective_ctx: 4096, native_ctx: 8192, evicted_pairs: 3, source: "direct" }
        })
      )
    );
    renderRail();

    const motor = await screen.findByText(/Motor OK/);
    await userEvent.click(motor);
    const dialog = screen.getByRole("dialog", { name: "Motor OK" });
    expect(dialog).toHaveTextContent("Contexto (KV)");
    expect(dialog).toHaveTextContent("Contexto usado");
    expect(dialog).toHaveTextContent("62 % de 4096");
    expect(dialog).toHaveTextContent("Pares evictados");
    expect(dialog).toHaveTextContent("3");
  });

  it("shows 'no disponible' for both context rows before the first generation (ctx_telemetry null)", async () => {
    renderRail();

    const motor = await screen.findByText(/Motor OK/);
    await userEvent.click(motor);
    const dialog = screen.getByRole("dialog", { name: "Motor OK" });
    expect(dialog).toHaveTextContent("Contexto usado");
    expect(dialog).toHaveTextContent("Pares evictados");
    const disponibleCount = dialog.textContent?.split("no disponible").length ?? 1;
    expect(disponibleCount - 1).toBeGreaterThanOrEqual(2);
  });
});

describe("StatusRail — cloud fallback chip (cloud_rearm_20260801 WU5, owner decision D-B)", () => {
  it("renders no cloud chip when fallback_active is false — the four existing chips stay unchanged", async () => {
    renderRail();
    await waitFor(() => expect(screen.getByText(/Motor OK/)).toBeInTheDocument());
    expect(screen.queryByText(/^Cloud:/)).not.toBeInTheDocument();
    expect(screen.getByText(defaultStatus.current_model as string)).toBeInTheDocument();
    expect(screen.getByText(/Kira: en espera/)).toBeInTheDocument();
    expect(screen.getByText(defaultStatus.active_profile)).toBeInTheDocument();
  });

  it("shows the attention chip WITH a countdown for ambiguous_429 when a probe is scheduled (a scheduled retry self-heals regardless of class)", async () => {
    server.use(
      http.get(`${API_BASE_URL}/api/status`, () =>
        HttpResponse.json({
          ...defaultStatus,
          fallback_active: true,
          fallback_reason: "ambiguous_429",
          next_cloud_probe_in_seconds: 42
        })
      )
    );
    renderRail();

    const chip = await screen.findByText("Cloud: reintentando");
    expect(chip).toHaveAttribute("data-taxonomy", "attention");

    await userEvent.click(chip);
    const dialog = screen.getByRole("dialog", { name: "Cloud: reintentando" });
    expect(dialog).toHaveTextContent("42s");
  });

  it("shows the action chip with no countdown for ambiguous_429 when no probe is scheduled (gave up / flag off)", async () => {
    server.use(
      http.get(`${API_BASE_URL}/api/status`, () =>
        HttpResponse.json({
          ...defaultStatus,
          fallback_active: true,
          fallback_reason: "ambiguous_429",
          next_cloud_probe_in_seconds: null
        })
      )
    );
    renderRail();

    const chip = await screen.findByText("Cloud: acción requerida");
    expect(chip).toHaveAttribute("data-taxonomy", "action");

    await userEvent.click(chip);
    const dialog = screen.getByRole("dialog", { name: "Cloud: acción requerida" });
    expect(dialog).not.toHaveTextContent(/reintento automático/);
  });

  it("shows the action chip with no countdown for bad_key with no probe scheduled (never auto-heals)", async () => {
    server.use(
      http.get(`${API_BASE_URL}/api/status`, () =>
        HttpResponse.json({
          ...defaultStatus,
          fallback_active: true,
          fallback_reason: "bad_key",
          next_cloud_probe_in_seconds: null
        })
      )
    );
    renderRail();

    const chip = await screen.findByText("Cloud: acción requerida");
    expect(chip).toHaveAttribute("data-taxonomy", "action");

    await userEvent.click(chip);
    const dialog = screen.getByRole("dialog", { name: "Cloud: acción requerida" });
    expect(dialog).not.toHaveTextContent(/reintento automático/);
  });

  it("shows the attention chip with a countdown for rate_limited (self-healing)", async () => {
    server.use(
      http.get(`${API_BASE_URL}/api/status`, () =>
        HttpResponse.json({
          ...defaultStatus,
          fallback_active: true,
          fallback_reason: "rate_limited",
          next_cloud_probe_in_seconds: 42
        })
      )
    );
    renderRail();

    const chip = await screen.findByText("Cloud: reintentando");
    expect(chip).toHaveAttribute("data-taxonomy", "attention");

    await userEvent.click(chip);
    const dialog = screen.getByRole("dialog", { name: "Cloud: reintentando" });
    expect(dialog).toHaveTextContent("42s");
  });

  it("clicking 'Probar ahora' calls the probe mutation and renders the armed result honestly", async () => {
    server.use(
      http.get(`${API_BASE_URL}/api/status`, () =>
        HttpResponse.json({
          ...defaultStatus,
          fallback_active: true,
          fallback_reason: "rate_limited",
          next_cloud_probe_in_seconds: 10
        })
      )
    );
    renderRail();

    const chip = await screen.findByText("Cloud: reintentando");
    await userEvent.click(chip);
    await userEvent.click(screen.getByRole("button", { name: "Probar ahora" }));

    expect(await screen.findByText(/Reintento armado/)).toBeInTheDocument();
  });

  it("renders armed:false honestly (e.g. a race where cloud already recovered) — never fakes success", async () => {
    server.use(
      http.get(`${API_BASE_URL}/api/status`, () =>
        HttpResponse.json({
          ...defaultStatus,
          fallback_active: true,
          fallback_reason: "ambiguous_429",
          next_cloud_probe_in_seconds: null
        })
      ),
      llmProviderProbeArmedFalseHandler("no_cloud_profile")
    );
    renderRail();

    const chip = await screen.findByText("Cloud: acción requerida");
    await userEvent.click(chip);
    await userEvent.click(screen.getByRole("button", { name: "Probar ahora" }));

    expect(await screen.findByText(/No se armó/)).toBeInTheDocument();
    expect(screen.queryByText(/Reintento armado/)).not.toBeInTheDocument();
  });

  it("renders a danger alert on a probe request failure (503) — never silently re-enables with no feedback", async () => {
    server.use(
      http.get(`${API_BASE_URL}/api/status`, () =>
        HttpResponse.json({
          ...defaultStatus,
          fallback_active: true,
          fallback_reason: "ambiguous_429",
          next_cloud_probe_in_seconds: null
        })
      ),
      llmProviderProbeUnavailableHandler()
    );
    renderRail();

    const chip = await screen.findByText("Cloud: acción requerida");
    await userEvent.click(chip);
    await userEvent.click(screen.getByRole("button", { name: "Probar ahora" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveAttribute("data-tone", "danger");
    expect(screen.queryByText(/Reintento armado/)).not.toBeInTheDocument();
    expect(screen.queryByText(/No se armó/)).not.toBeInTheDocument();
  });

  it("disables the 'Probar ahora' button while the probe mutation is pending", async () => {
    server.use(
      http.get(`${API_BASE_URL}/api/status`, () =>
        HttpResponse.json({
          ...defaultStatus,
          fallback_active: true,
          fallback_reason: "rate_limited",
          next_cloud_probe_in_seconds: 10
        })
      ),
      http.post(`${API_BASE_URL}/api/llm/provider/probe`, async () => {
        await delay(40);
        return HttpResponse.json({ armed: true, reason: null });
      })
    );
    renderRail();

    const chip = await screen.findByText("Cloud: reintentando");
    await userEvent.click(chip);
    const button = screen.getByRole("button", { name: "Probar ahora" });
    await userEvent.click(button);

    expect(button).toBeDisabled();
    await waitFor(() => expect(button).not.toBeDisabled());
  });
});
