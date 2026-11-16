import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { server } from "../../test/server.js";
import { lastReplyHandler } from "../../test/handlers.js";
import { useUiLocaleStore } from "../../i18n/locale.js";

vi.mock("../../api/liveTranscript.js", () => ({ useLiveTranscript: () => undefined }));
const openExternalUrl = vi.fn().mockResolvedValue(true);
vi.mock("../../lib/openUrl.js", () => ({
  openExternalUrl: (url: string) => openExternalUrl(url)
}));

import { ConversationPanel } from "./ConversationPanel.js";

function renderPanel() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(React.createElement(QueryClientProvider, { client: queryClient }, React.createElement(ConversationPanel)));
}

describe("ConversationPanel sources under a web answer", () => {
  beforeEach(() => {
    openExternalUrl.mockClear();
    useUiLocaleStore.setState({ locale: "en" });
    window.localStorage.clear();
  });

  it("shows the real sources under Kira's reply and a click opens the attributed URL externally", async () => {
    server.use(
      lastReplyHandler({
        turn_id: 11,
        text: "The patch ships on Friday.",
        web_searched: true,
        web_sources: [
          { host: "wiki.example.org", url: "https://wiki.example.org/b" },
          { host: "news.example.com", url: "https://news.example.com/a?id=1" }
        ]
      })
    );
    renderPanel();
    await screen.findByText(/The patch ships on Friday/);
    expect(await screen.findByText("Sources")).toBeInTheDocument();
    const wiki = await screen.findByRole("link", { name: "Open wiki.example.org in your browser" });
    await userEvent.click(wiki);
    expect(openExternalUrl).toHaveBeenCalledWith("https://wiki.example.org/b?utm_source=opencohost");
    await userEvent.click(screen.getByRole("link", { name: "Open news.example.com in your browser" }));
    expect(openExternalUrl).toHaveBeenLastCalledWith("https://news.example.com/a?id=1&utm_source=opencohost");
  });

  it("shows no sources row for a reply without sources", async () => {
    server.use(lastReplyHandler({ turn_id: 12, text: "Just a plain answer.", web_searched: false, web_sources: null }));
    renderPanel();
    await screen.findByText(/Just a plain answer/);
    expect(screen.queryByText("Sources")).toBeNull();
    expect(screen.queryByRole("link", { name: /Open .* in your browser/ })).toBeNull();
  });

  it("adds the sources when the final reply lands after the streamed text", async () => {
    server.use(lastReplyHandler({ turn_id: 14, text: "Streamed words.", is_streaming: true, web_sources: null }));
    renderPanel();
    await screen.findByText(/Streamed words/);
    expect(screen.queryByText("Sources")).toBeNull();
    server.use(
      lastReplyHandler({
        turn_id: 14,
        text: "Streamed words.",
        is_streaming: false,
        web_sources: [{ host: "a.com", url: "https://a.com/1" }]
      })
    );
    expect(await screen.findByRole("link", { name: "Open a.com in your browser" }, { timeout: 8000 })).toBeInTheDocument();
  }, 15000);

  it("keeps sources in memory only: nothing about them reaches browser storage", async () => {
    server.use(
      lastReplyHandler({
        turn_id: 13,
        text: "Answer with sources.",
        web_sources: [{ host: "a.com", url: "https://a.com/secret-path?token=abc" }]
      })
    );
    renderPanel();
    await screen.findByRole("link", { name: "Open a.com in your browser" });
    const dump = JSON.stringify({ ...window.localStorage }) + JSON.stringify({ ...window.sessionStorage });
    expect(dump).not.toContain("secret-path");
    expect(dump).not.toContain("a.com");
  });
});
