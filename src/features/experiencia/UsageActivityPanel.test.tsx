import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { server } from "../../test/server.js";
import { API_BASE_URL } from "../../test/handlers.js";
import { t } from "../../i18n/t.js";
import { UsageActivityPanel } from "./UsageActivityPanel.js";

const baseSummary = {
  from: "2025-11-10",
  to: "2026-11-09",
  enabled: true,
  first_recorded: "2026-11-09",
  days: [{ date: "2026-11-09", calls: 12, prompt_tokens: 9000, completion_tokens: 800, compute_ms: 15000 }],
  by_model: [
    { model: "gemma4:e4b", provider: "local", calls: 10, prompt_tokens: 8000, completion_tokens: 700, compute_ms: 12000 },
    { model: "gpt-cloud-x", provider: "cloud", calls: 2, prompt_tokens: 1000, completion_tokens: 100, compute_ms: 3000 }
  ],
  by_kind: [
    { kind: "turn", calls: 9, prompt_tokens: 7000, completion_tokens: 600, compute_ms: 10000 },
    { kind: "memoria_judge", calls: 3, prompt_tokens: 2000, completion_tokens: 200, compute_ms: 5000 }
  ],
  by_source: [{ source: "ptt", calls: 9, prompt_tokens: 7000, completion_tokens: 600, compute_ms: 10000 }],
  by_profile: [{ profile_id: "kira", calls: 12, prompt_tokens: 9000, completion_tokens: 800, compute_ms: 15000 }],
  cache: { estimated_reused_tokens: 4200, real_available: false, real_prompt_tokens: null, real_reused_tokens: null },
  decisions: [{ decision_id: "vision", asked: 20, laya_acted: 14, rule_acted: 6, by_status: { ok: 18, timeout: 2 } }]
};

function useSummary(body: unknown, status = 200) {
  server.use(
    http.get(`${API_BASE_URL}/api/usage/summary`, () =>
      status === 200 ? HttpResponse.json(body as object) : new HttpResponse(null, { status })
    )
  );
}

function renderPanel(onClose = vi.fn()) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <UsageActivityPanel open onClose={onClose} />
    </QueryClientProvider>
  );
  return { onClose };
}

const k = (suffix: string) => `experiencia.usage.${suffix}` as Parameters<typeof t>[0];

describe("UsageActivityPanel", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows loading, then the totals", async () => {
    useSummary(baseSummary);
    renderPanel();
    expect(screen.getByText(t(k("state.loading")))).toBeInTheDocument();
    const calls = await screen.findByTestId("usage-total-calls");
    expect(calls).toHaveTextContent("12");
    expect(screen.getByTestId("usage-total-prompt")).toHaveTextContent("9.0k");
    expect(screen.getByTestId("usage-total-completion")).toHaveTextContent("800");
    expect(screen.getByTestId("usage-total-compute")).toHaveTextContent("15s");
  });

  it("shows the privacy line", async () => {
    useSummary(baseSummary);
    renderPanel();
    expect(await screen.findByText(t(k("privacy")))).toBeInTheDocument();
  });

  it("labels each heatmap cell with date, calls, tokens and compute time", async () => {
    useSummary(baseSummary);
    renderPanel();
    await screen.findByTestId("usage-total-calls");
    const label = t(k("heatmap.cell"), { date: "2026-11-09", calls: 12, tokens: "9.8k", compute: "15s" });
    expect(screen.getByLabelText(label)).toBeInTheDocument();
    expect(screen.getByLabelText(t(k("heatmap.cellEmpty"), { date: "2026-11-08" }))).toBeInTheDocument();
  });

  it("re-aggregates the calendar when the range changes", async () => {
    useSummary(baseSummary);
    renderPanel();
    await screen.findByTestId("usage-total-calls");
    expect(screen.getByTestId("usage-heatmap")).toHaveAttribute("data-granularity", "day");
    const group = screen.getByRole("group", { name: t(k("range.label")) });
    await userEvent.click(within(group).getByRole("button", { name: t(k("range.month")) }));
    expect(screen.getByTestId("usage-heatmap")).toHaveAttribute("data-granularity", "month");
    expect(
      screen.getByLabelText(t(k("heatmap.cell"), { date: "2026-11", calls: 12, tokens: "9.8k", compute: "15s" }))
    ).toBeInTheDocument();
    await userEvent.click(within(group).getByRole("button", { name: t(k("range.year")) }));
    expect(
      screen.getByLabelText(t(k("heatmap.cell"), { date: "2026", calls: 12, tokens: "9.8k", compute: "15s" }))
    ).toBeInTheDocument();
  });

  it("breaks usage down by model (with provider badge), kind, source and profile", async () => {
    useSummary(baseSummary);
    renderPanel();
    await screen.findByTestId("usage-total-calls");
    const models = screen.getByTestId("usage-by-model");
    expect(within(models).getByText("gemma4:e4b")).toBeInTheDocument();
    expect(within(models).getByText(t(k("provider.local")))).toBeInTheDocument();
    expect(within(models).getByText("gpt-cloud-x")).toBeInTheDocument();
    expect(within(models).getByText(t(k("provider.cloud")))).toBeInTheDocument();
    const kinds = screen.getByTestId("usage-by-kind");
    expect(within(kinds).getByText(t(k("kind.turn")))).toBeInTheDocument();
    expect(within(kinds).getByText(t(k("kind.memoria_judge")))).toBeInTheDocument();
    expect(within(screen.getByTestId("usage-by-source")).getByText(t(k("source.ptt")))).toBeInTheDocument();
    expect(within(screen.getByTestId("usage-by-profile")).getByText("kira")).toBeInTheDocument();
  });

  it("labels the cache figure as estimated when the real one is unavailable", async () => {
    useSummary(baseSummary);
    renderPanel();
    await screen.findByTestId("usage-total-calls");
    const cache = screen.getByTestId("usage-cache");
    expect(within(cache).getByText(t(k("cache.estimatedBadge")))).toBeInTheDocument();
    expect(cache).toHaveTextContent(t(k("cache.estimated"), { reused: "4.2k" }));
  });

  it("shows the real reuse ratio when available", async () => {
    useSummary({
      ...baseSummary,
      cache: { estimated_reused_tokens: 4200, real_available: true, real_prompt_tokens: 10000, real_reused_tokens: 7500 }
    });
    renderPanel();
    await screen.findByTestId("usage-total-calls");
    const cache = screen.getByTestId("usage-cache");
    expect(within(cache).getByText(t(k("cache.realBadge")))).toBeInTheDocument();
    expect(cache).toHaveTextContent(t(k("cache.real"), { reused: "7.5k", prompt: "10.0k", percent: 75 }));
    expect(within(cache).queryByText(t(k("cache.estimatedBadge")))).toBeNull();
  });

  it("shows LAYA decisions with asked, LAYA acted, rule acted and statuses", async () => {
    useSummary(baseSummary);
    renderPanel();
    await screen.findByTestId("usage-total-calls");
    const laya = screen.getByTestId("usage-laya");
    expect(within(laya).getByText("vision")).toBeInTheDocument();
    expect(laya).toHaveTextContent(`20 ${t(k("laya.asked"))}`);
    expect(laya).toHaveTextContent(`14 ${t(k("laya.layaActed"))}`);
    expect(laya).toHaveTextContent(`6 ${t(k("laya.ruleActed"))}`);
    expect(laya).toHaveTextContent("ok 18");
    expect(laya).toHaveTextContent("timeout 2");
  });

  it("shows the empty state when nothing was recorded", async () => {
    useSummary({ ...baseSummary, days: [], by_model: [], by_kind: [], by_source: [], by_profile: [], decisions: [] });
    renderPanel();
    expect(await screen.findByText(t(k("state.empty")))).toBeInTheDocument();
  });

  it("explains tracking is off when the ledger is disabled", async () => {
    useSummary({ ...baseSummary, enabled: false, days: [], by_model: [], by_kind: [], decisions: [] });
    renderPanel();
    const msg = await screen.findByText(/OPENCOHOST_USAGE_LEDGER/);
    expect(msg).toHaveTextContent(t(k("state.disabled")));
  });

  it("shows a friendly not-available message on 404", async () => {
    useSummary(null, 404);
    renderPanel();
    expect(await screen.findByText(t(k("state.unavailable")))).toBeInTheDocument();
  });

  it("shows an error message on other failures", async () => {
    useSummary(null, 500);
    renderPanel();
    expect(await screen.findByText(t(k("state.error")))).toBeInTheDocument();
  });

  describe("export", () => {
    let createUrl: ReturnType<typeof vi.fn>;
    let clickSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      createUrl = vi.fn(() => "blob:usage");
      Object.defineProperty(URL, "createObjectURL", { configurable: true, writable: true, value: createUrl });
      Object.defineProperty(URL, "revokeObjectURL", { configurable: true, writable: true, value: vi.fn() });
      clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    });

    it("asks for confirmation and downloads nothing until confirmed", async () => {
      useSummary(baseSummary);
      let hits = 0;
      server.use(
        http.get(`${API_BASE_URL}/api/usage/export`, ({ request }) => {
          hits += 1;
          const fmt = new URL(request.url).searchParams.get("format");
          return new HttpResponse(fmt === "csv" ? "date\n" : "[]", { headers: { "Content-Type": "text/plain" } });
        })
      );
      renderPanel();
      await screen.findByTestId("usage-total-calls");
      await userEvent.click(screen.getByRole("button", { name: t(k("export.csv")) }));
      expect(screen.getByText(t(k("export.confirm")))).toBeInTheDocument();
      expect(hits).toBe(0);
      await userEvent.click(screen.getByRole("button", { name: t(k("export.go")) }));
      await waitFor(() => expect(clickSpy).toHaveBeenCalledTimes(1));
      expect(hits).toBe(1);
      expect(createUrl).toHaveBeenCalledTimes(1);
      const anchor = clickSpy.mock.contexts[0] as HTMLAnchorElement;
      expect(anchor.download).toBe("opencohost-activity.csv");
    });

    it("does not download when the confirmation is cancelled", async () => {
      useSummary(baseSummary);
      renderPanel();
      await screen.findByTestId("usage-total-calls");
      await userEvent.click(screen.getByRole("button", { name: t(k("export.json")) }));
      await userEvent.click(screen.getByRole("button", { name: t("ui.confirm.cancel") }));
      expect(screen.queryByText(t(k("export.confirm")))).toBeNull();
      expect(clickSpy).not.toHaveBeenCalled();
    });
  });

  describe("delete", () => {
    it("purges after confirmation and reloads the summary", async () => {
      let gets = 0;
      let body: unknown = null;
      server.use(
        http.get(`${API_BASE_URL}/api/usage/summary`, () => {
          gets += 1;
          return HttpResponse.json(baseSummary);
        }),
        http.post(`${API_BASE_URL}/api/usage/purge`, async ({ request }) => {
          body = await request.json();
          return HttpResponse.json({ deleted: true });
        })
      );
      renderPanel();
      await screen.findByTestId("usage-total-calls");
      await userEvent.click(screen.getByRole("button", { name: t(k("delete.button")) }));
      expect(screen.getByText(t(k("delete.confirm")))).toBeInTheDocument();
      expect(body).toBeNull();
      await userEvent.click(screen.getByRole("button", { name: t(k("delete.go")) }));
      await waitFor(() => expect(body).toEqual({ confirm: "DELETE_USAGE" }));
      await waitFor(() => expect(gets).toBe(2));
    });

    it("does not purge when the confirmation is cancelled", async () => {
      useSummary(baseSummary);
      let posted = false;
      server.use(
        http.post(`${API_BASE_URL}/api/usage/purge`, () => {
          posted = true;
          return HttpResponse.json({ deleted: true });
        })
      );
      renderPanel();
      await screen.findByTestId("usage-total-calls");
      await userEvent.click(screen.getByRole("button", { name: t(k("delete.button")) }));
      await userEvent.click(screen.getByRole("button", { name: t("ui.confirm.cancel") }));
      expect(posted).toBe(false);
    });
  });
});
