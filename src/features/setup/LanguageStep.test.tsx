import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { server } from "../../test/server.js";
import { API_BASE_URL, defaultI18nState, i18nStateHandler } from "../../test/handlers.js";
import { reloadBackend } from "../../lib/backendControl.js";
import { useUiLocaleStore } from "../../i18n/locale.js";
import { RESTART_HOOK } from "../shared/RestartToApply.js";
import { KiraLanguageStep, LanguageStep, NarratorStep } from "./SetupSteps.js";

vi.mock("../../lib/backendControl.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/backendControl.js")>()),
  reloadBackend: vi.fn()
}));

/** Records every PUT /api/i18n body. */
function recordPuts(active = defaultI18nState.active_locale) {
  const puts: string[] = [];
  server.use(
    http.put(`${API_BASE_URL}/api/i18n`, async ({ request }) => {
      const { locale } = (await request.json()) as { locale: string };
      puts.push(locale);
      return HttpResponse.json({ ...defaultI18nState, active_locale: active, persisted_locale: locale, pending_restart: locale !== active });
    })
  );
  return puts;
}

function renderLanguageStep() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <LanguageStep />
    </QueryClientProvider>
  );
  return queryClient;
}

function renderKiraStep(props: { onBeforeRestart?: () => Promise<void> | void } = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <KiraLanguageStep {...props} />
    </QueryClientProvider>
  );
  return queryClient;
}

beforeEach(() => {
  window.localStorage.clear();
  useUiLocaleStore.getState().setLocale("es");
  vi.mocked(reloadBackend).mockReset();
});

describe("LanguageStep (UI language only)", () => {
  it("applies the UI language immediately without calling PUT /api/i18n or mentioning restart", async () => {
    const puts = recordPuts();
    renderLanguageStep();
    fireEvent.click(screen.getByRole("button", { name: "English" }));
    expect(useUiLocaleStore.getState().locale).toBe("en");
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(puts).toEqual([]);
    expect(screen.queryByRole("button", { name: /restart to apply/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/restart/i)).not.toBeInTheDocument();
  });
});

describe("KiraLanguageStep (Kira speech language + immediate restart)", () => {
  it("preselects from the persisted/active backend locale instead of overwriting UI locale", async () => {
    useUiLocaleStore.getState().setLocale("en");
    server.use(i18nStateHandler({ ...defaultI18nState, active_locale: "es", persisted_locale: "es", pending_restart: false }));
    renderKiraStep();
    await waitFor(() => expect(screen.getByRole("button", { name: "Español" })).toHaveAttribute("aria-pressed", "true"));
    expect(screen.getByRole("button", { name: "English" })).toHaveAttribute("aria-pressed", "false");
    expect(useUiLocaleStore.getState().locale).toBe("en");
  });

  it("persists Kira's backend locale, updates ['i18n'] cache, and offers RestartToApply immediately without altering UI locale", async () => {
    const puts = recordPuts();
    const queryClient = renderKiraStep();
    fireEvent.click(screen.getByRole("button", { name: "English" }));
    await waitFor(() => expect(puts).toEqual(["en"]));
    expect(useUiLocaleStore.getState().locale).toBe("es");
    await waitFor(() =>
      expect(queryClient.getQueryData<{ pending_restart: boolean }>(["i18n"])?.pending_restart).toBe(true)
    );
    expect(await screen.findByRole("button", { name: /Reiniciar para aplicar/i })).toBeInTheDocument();
    expect(screen.queryByText(/pantalla de la voz/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/voice screen/i)).not.toBeInTheDocument();
  });

  it("runs onBeforeRestart before reloadBackend and afterReload when Restart to apply is clicked", async () => {
    recordPuts();
    const order: string[] = [];
    const onBeforeRestart = vi.fn(async () => {
      await Promise.resolve();
      order.push("before");
    });
    const reload = vi.mocked(reloadBackend).mockImplementation(async () => {
      order.push("reload");
      return { ok: true };
    });
    const afterReload = vi.fn(() => order.push("afterReload"));
    RESTART_HOOK.afterReload = afterReload;

    renderKiraStep({ onBeforeRestart });
    fireEvent.click(screen.getByRole("button", { name: "English" }));
    fireEvent.click(await screen.findByRole("button", { name: /Reiniciar para aplicar/i }));

    await waitFor(() => expect(afterReload).toHaveBeenCalledTimes(1));
    expect(onBeforeRestart).toHaveBeenCalledTimes(1);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(order).toEqual(["before", "reload", "afterReload"]);
  });

  it("shows no restart notice or button when the choice matches the active language", async () => {
    const puts = recordPuts();
    renderKiraStep();
    fireEvent.click(screen.getByRole("button", { name: "Español" }));
    await waitFor(() => expect(puts).toEqual(["es"]));
    expect(screen.queryByRole("button", { name: /Reiniciar para aplicar/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/reiniciar/i)).not.toBeInTheDocument();
  });

  it("keeps the wizard usable and says so when saving fails", async () => {
    server.use(http.put(`${API_BASE_URL}/api/i18n`, () => HttpResponse.json({ detail: "boom" }, { status: 500 })));
    renderKiraStep();
    fireEvent.click(screen.getByRole("button", { name: "English" }));
    expect(await screen.findByText(/No pude guardar el idioma de Kira/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Español" })).toBeEnabled();
  });

  it("best-effort syncs set_piper_voice ('es' -> 'neutral', 'en' -> 'english') alongside putI18nLocale", async () => {
    recordPuts();
    const commands: Array<{ command: string; payload: { value: unknown } }> = [];
    server.use(
      http.post(`${API_BASE_URL}/api/commands`, async ({ request }) => {
        commands.push((await request.json()) as { command: string; payload: { value: unknown } });
        return HttpResponse.json({ accepted: true, command_id: "cmd-1", status: "queued", state_version: 2 });
      })
    );
    renderKiraStep();
    fireEvent.click(screen.getByRole("button", { name: "English" }));
    await waitFor(() =>
      expect(commands).toContainEqual({ command: "set_piper_voice", payload: { value: "english" } })
    );
    fireEvent.click(screen.getByRole("button", { name: "Español" }));
    await waitFor(() =>
      expect(commands).toContainEqual({ command: "set_piper_voice", payload: { value: "neutral" } })
    );
  });

  it("never fails or blocks when set_piper_voice fails (engine unavailable)", async () => {
    const puts = recordPuts();
    server.use(
      http.post(`${API_BASE_URL}/api/commands`, () => HttpResponse.json({ accepted: false }, { status: 503 }))
    );
    renderKiraStep();
    fireEvent.click(screen.getByRole("button", { name: "English" }));
    await waitFor(() => expect(puts).toEqual(["en"]));
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(screen.queryByText(/No pude guardar el idioma de Kira/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "English" })).toBeEnabled();
  });
});

describe("NarratorStep (S5a pressed visual feedback)", () => {
  it("shows clear pressed styling and a Check icon on the selected option", () => {
    const onHearKira = vi.fn();
    const { rerender } = render(<NarratorStep hearKira={null} onHearKira={onHearKira} />);
    const yesBtn = screen.getByRole("button", { name: "Sí, quiero escucharla" });
    const noBtn = screen.getByRole("button", { name: "No, solo texto" });
    expect(yesBtn).toHaveAttribute("aria-pressed", "false");
    expect(noBtn).toHaveAttribute("aria-pressed", "false");
    expect(yesBtn.querySelector("svg")).toBeNull();
    expect(noBtn.querySelector("svg")).toBeNull();

    rerender(<NarratorStep hearKira={true} onHearKira={onHearKira} />);
    expect(yesBtn).toHaveAttribute("aria-pressed", "true");
    expect(yesBtn.className).toContain("aria-[pressed=true]:border-primary");
    expect(yesBtn.className).toContain("aria-[pressed=true]:bg-accent-soft");
    expect(yesBtn.querySelector("svg")).not.toBeNull();
    expect(noBtn.querySelector("svg")).toBeNull();

    rerender(<NarratorStep hearKira={false} onHearKira={onHearKira} />);
    expect(noBtn).toHaveAttribute("aria-pressed", "true");
    expect(noBtn.className).toContain("aria-[pressed=true]:border-primary");
    expect(noBtn.className).toContain("aria-[pressed=true]:bg-accent-soft");
    expect(noBtn.querySelector("svg")).not.toBeNull();
    expect(yesBtn.querySelector("svg")).toBeNull();
  });
});
