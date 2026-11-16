import { http, HttpResponse } from "msw";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { server } from "../../../test/server.js";
import { API_BASE_URL, makeDownloadJob } from "../../../test/handlers.js";
import { useUiLocaleStore } from "../../../i18n/locale.js";
import type { ModelDownloadJob } from "../../../api/modelDownloads.js";
import { ModelDownloadsPanel as PanelComponent, type ModelDownloadsPanelProps } from "./ModelDownloadsPanel.js";

const ModelDownloadsPanel: React.FC<ModelDownloadsPanelProps> = PanelComponent;

function renderPanel(props: ModelDownloadsPanelProps = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(React.createElement(QueryClientProvider, { client: queryClient }, React.createElement(ModelDownloadsPanel, props)));
  return queryClient;
}

function serveJobs(jobs: ModelDownloadJob[] | (() => ModelDownloadJob[])) {
  server.use(
    http.get(`${API_BASE_URL}/api/models/downloads`, () => {
      const list = typeof jobs === "function" ? jobs() : jobs;
      const active = list.find((j) => ["queued", "downloading", "retrying"].includes(j.state));
      return HttpResponse.json({ jobs: list, active_job_id: active?.id ?? null, max_retries: 3 });
    })
  );
}

beforeEach(() => {
  useUiLocaleStore.setState({ locale: "en" });
});

describe("ModelDownloadsPanel", () => {
  it("renders nothing when there are no relevant jobs", async () => {
    serveJobs([makeDownloadJob({ state: "cancelled" })]);
    renderPanel();
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("shows an interrupted-download prompt and resumes it", async () => {
    serveJobs([makeDownloadJob({ id: "job-int", state: "paused", interrupted: true, percent: 70 })]);
    let resumed = "";
    server.use(
      http.post(`${API_BASE_URL}/api/models/downloads/:id/resume`, ({ params }) => {
        resumed = String(params.id);
        return HttpResponse.json(makeDownloadJob({ id: "job-int", state: "queued" }));
      })
    );
    renderPanel();

    expect(await screen.findByText("Download interrupted")).toBeInTheDocument();
    expect(screen.getByText(/The download of qwen3:1\.7b stopped when the app closed/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Resume" }));
    await waitFor(() => expect(resumed).toBe("job-int"));
  });

  it("pauses and cancels an active job", async () => {
    serveJobs([makeDownloadJob({ id: "job-a", state: "downloading" })]);
    const hits: string[] = [];
    server.use(
      http.post(`${API_BASE_URL}/api/models/downloads/:id/:action`, ({ params }) => {
        hits.push(`${String(params.id)}/${String(params.action)}`);
        return HttpResponse.json(makeDownloadJob({ id: "job-a", state: "paused" }));
      })
    );
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "Pause" }));
    await waitFor(() => expect(hits).toContain("job-a/pause"));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(hits).toContain("job-a/cancel"));
  });

  it("shows the resumed note when the backend percent drops below what was shown", async () => {
    let calls = 0;
    serveJobs(() => {
      calls += 1;
      return [makeDownloadJob({ id: "job-r", state: "downloading", percent: calls === 1 ? 70 : 40 })];
    });
    renderPanel();
    expect(await screen.findByText("70%")).toBeInTheDocument();
    expect(screen.queryByText("Resumed from the last saved point.")).not.toBeInTheDocument();
    // Next ~1s poll reports the lower checkpoint percent.
    expect(await screen.findByText("40%", undefined, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.getByText("Resumed from the last saved point.")).toBeInTheDocument();
  });

  it("shows the resumed note after resuming an interrupted job", async () => {
    let resumed = false;
    serveJobs(() =>
      resumed
        ? [makeDownloadJob({ id: "job-i", state: "downloading", percent: 40, interrupted: false })]
        : [makeDownloadJob({ id: "job-i", state: "paused", percent: 40, interrupted: true })]
    );
    server.use(
      http.post(`${API_BASE_URL}/api/models/downloads/:id/resume`, () => {
        resumed = true;
        return HttpResponse.json(makeDownloadJob({ id: "job-i", state: "queued", interrupted: false }));
      })
    );
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "Resume" }));
    expect(await screen.findByText("Resumed from the last saved point.")).toBeInTheDocument();
  });

  it("refreshes models on completion and 'Use this model' dispatches switch_model", async () => {
    let calls = 0;
    serveJobs(() => {
      calls += 1;
      return [
        calls === 1
          ? makeDownloadJob({ id: "job-c", tag: "llama3.2:3b", state: "downloading", percent: 95 })
          : makeDownloadJob({ id: "job-c", tag: "llama3.2:3b", state: "completed", percent: 100, installed: true })
      ];
    });
    let modelsFetches = 0;
    server.use(
      http.get(`${API_BASE_URL}/api/models`, () => {
        modelsFetches += 1;
        return HttpResponse.json({ catalog: {}, discovered: ["llama3.2:3b"], current_model: "qwen3:1.7b", tiers: {}, active_tier: "fast" });
      })
    );
    let commandBody: unknown = null;
    server.use(
      http.post(`${API_BASE_URL}/api/commands`, async ({ request }) => {
        commandBody = await request.json();
        return HttpResponse.json({ accepted: true, command_id: "c1", status: "queued", state_version: 1 });
      })
    );
    renderPanel();
    const useButton = await screen.findByRole("button", { name: "Use this model" }, { timeout: 3000 });
    // Mount fetch + the completion-triggered refresh, so the new model becomes selectable.
    await waitFor(() => expect(modelsFetches).toBeGreaterThanOrEqual(2));
    expect(screen.getByText("llama3.2:3b is installed and available.")).toBeInTheDocument();
    fireEvent.click(useButton);
    await waitFor(() => expect(commandBody).toEqual({ command: "switch_model", payload: { value: "llama3.2:3b" } }));
  });

  it("currentModel overrides the LLM current model when gating 'Use this model'", async () => {
    serveJobs([makeDownloadJob({ id: "job-v", tag: "qwen3-vl:4b", state: "completed", percent: 100, installed: true })]);
    server.use(
      http.get(`${API_BASE_URL}/api/models`, () =>
        HttpResponse.json({ catalog: {}, discovered: [], current_model: "qwen3:1.7b", tiers: {}, active_tier: "fast" })
      )
    );
    renderPanel({ currentModel: "qwen3-vl:4b" });
    await screen.findByText("qwen3-vl:4b is installed and available.");
    expect(screen.queryByRole("button", { name: "Use this model" })).not.toBeInTheDocument();
  });

  it("invalidates extra keys on completion", async () => {
    let calls = 0;
    serveJobs(() => {
      calls += 1;
      return [
        makeDownloadJob({ id: "job-x", tag: "m:1", state: calls === 1 ? "downloading" : "completed", percent: calls === 1 ? 90 : 100, installed: calls === 1 ? null : true })
      ];
    });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidated: unknown[] = [];
    const original = queryClient.invalidateQueries.bind(queryClient);
    queryClient.invalidateQueries = ((filters?: { queryKey?: unknown }) => {
      invalidated.push(filters?.queryKey);
      return original(filters as never);
    }) as typeof queryClient.invalidateQueries;
    render(
      React.createElement(
        QueryClientProvider,
        { client: queryClient },
        React.createElement(ModelDownloadsPanel, { invalidateKeys: [["extra"]] })
      )
    );
    await screen.findByText("m:1 is installed and available.", undefined, { timeout: 3000 });
    await waitFor(() => expect(invalidated).toContainEqual(["extra"]));
  });

  it("shows every relevant job when no jobFilter is given", async () => {
    serveJobs([
      makeDownloadJob({ id: "job-chat", tag: "hf.co/x/Chat-9B", state: "paused" }),
      makeDownloadJob({ id: "job-vl", tag: "qwen3-vl:2b-instruct", state: "failed" })
    ]);
    renderPanel();
    await waitFor(() => expect(screen.getAllByText(/hf\.co\/x\/Chat-9B|qwen3-vl:2b-instruct/).length).toBeGreaterThanOrEqual(2));
  });

  it("jobFilter hides the jobs it rejects", async () => {
    serveJobs([
      makeDownloadJob({ id: "job-chat", tag: "hf.co/x/Chat-9B", state: "paused" }),
      makeDownloadJob({ id: "job-vl", tag: "qwen3-vl:2b-instruct", state: "failed" })
    ]);
    renderPanel({ jobFilter: (job) => job.tag.includes("-vl") });
    expect((await screen.findAllByText(/qwen3-vl:2b-instruct/)).length).toBeGreaterThan(0);
    expect(screen.queryByText(/hf\.co\/x\/Chat-9B/)).not.toBeInTheDocument();
  });

  it("renders nothing when the jobFilter rejects every job", async () => {
    serveJobs([makeDownloadJob({ id: "job-chat", tag: "hf.co/x/Chat-9B", state: "completed", installed: true })]);
    renderPanel({ jobFilter: () => false });
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByRole("region", { name: /download/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/hf\.co\/x\/Chat-9B/)).not.toBeInTheDocument();
  });
});
