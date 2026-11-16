import { http, HttpResponse } from "msw";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { server } from "../../../test/server.js";
import { API_BASE_URL } from "../../../test/handlers.js";
import { useUiLocaleStore } from "../../../i18n/locale.js";
import { HfModelPicker } from "./HfModelPicker.js";

function renderPicker() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(React.createElement(QueryClientProvider, { client: queryClient }, React.createElement(HfModelPicker)));
}

function lookup(value: string) {
  fireEvent.change(screen.getByLabelText("Hugging Face repository"), { target: { value } });
  fireEvent.click(screen.getByRole("button", { name: "Show quantizations" }));
}

beforeEach(() => {
  useUiLocaleStore.setState({ locale: "en" });
});

describe("HfModelPicker", () => {
  it.each([
    ["bartowski/SmolLM2-135M-Instruct-GGUF"],
    ["hf.co/bartowski/SmolLM2-135M-Instruct-GGUF"],
    ["https://huggingface.co/bartowski/SmolLM2-135M-Instruct-GGUF"]
  ])("normalizes %s to owner/repo before fetching quants", async (input) => {
    let path = "";
    server.use(
      http.get(`${API_BASE_URL}/api/models/hf/:owner/:repo/quants`, ({ params }) => {
        path = `${String(params.owner)}/${String(params.repo)}`;
        return HttpResponse.json({ owner: params.owner, repo: params.repo, vram_mb: 8192, quants: [] });
      })
    );
    renderPicker();
    lookup(input);
    await waitFor(() => expect(path).toBe("bartowski/SmolLM2-135M-Instruct-GGUF"));
  });

  it("shows an inline hint and does not fetch for unusable input", async () => {
    let fetched = false;
    server.use(
      http.get(`${API_BASE_URL}/api/models/hf/:owner/:repo/quants`, () => {
        fetched = true;
        return HttpResponse.json({});
      })
    );
    renderPicker();
    lookup("not a repo");
    expect(await screen.findByText(/Paste a repository as owner\/repo/)).toBeInTheDocument();
    expect(fetched).toBe(false);
  });

  it("lists quants with size and fit badge plus VRAM, and downloads the chosen quant tag", async () => {
    let postedTag = "";
    server.use(
      http.post(`${API_BASE_URL}/api/models/downloads`, async ({ request }) => {
        postedTag = ((await request.json()) as { tag: string }).tag;
        return HttpResponse.json({ id: "j", tag: postedTag, state: "queued" }, { status: 202 });
      })
    );
    renderPicker();
    lookup("bartowski/SmolLM2-135M-Instruct-GGUF");

    expect(await screen.findByText("Q4_K_M")).toBeInTheDocument();
    expect(screen.getByText("105.0 MB")).toBeInTheDocument();
    expect(screen.getByText("Fits your VRAM")).toBeInTheDocument();
    expect(screen.getByText("Q8_0")).toBeInTheDocument();
    expect(screen.getByText("9.00 GB")).toBeInTheDocument();
    expect(screen.getByText("Too large")).toBeInTheDocument();
    expect(screen.getByText("Your VRAM: 8.00 GB")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Download Q4_K_M" }));
    await waitFor(() => expect(postedTag).toBe("hf.co/bartowski/SmolLM2-135M-Instruct-GGUF:Q4_K_M"));
  });

  it.each([
    [404, "hf_repo_not_found", "The repository was not found on Hugging Face."],
    [502, "hf_unavailable", "Hugging Face is unavailable right now. Try again later."],
    [422, "invalid_hf_repo", "The repository is not valid."]
  ])("maps %s %s to i18n copy", async (status, detail, copy) => {
    server.use(
      http.get(`${API_BASE_URL}/api/models/hf/:owner/:repo/quants`, () => HttpResponse.json({ detail }, { status }))
    );
    renderPicker();
    lookup("owner/repo");
    expect(await screen.findByText(copy)).toBeInTheDocument();
  });

  it("shows the 409 download_active message", async () => {
    server.use(
      http.post(`${API_BASE_URL}/api/models/downloads`, () =>
        HttpResponse.json({ detail: "download_active", active_job_id: "busy" }, { status: 409 })
      )
    );
    renderPicker();
    lookup("bartowski/SmolLM2-135M-Instruct-GGUF");
    fireEvent.click(await screen.findByRole("button", { name: "Download Q4_K_M" }));
    expect(
      await screen.findByText("Another download is already in progress. Wait for it to finish or cancel it.")
    ).toBeInTheDocument();
  });
});
