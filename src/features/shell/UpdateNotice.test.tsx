import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { server } from "../../test/server.js";
import { API_BASE_URL } from "../../test/handlers.js";
import { ToastProvider } from "../../ui/Toast.js";
import { useUiLocaleStore } from "../../i18n/locale.js";

const open = vi.hoisted(() => vi.fn());
vi.mock("../../lib/openUrl.js", () => ({ openExternalUrl: (url: string) => open(url) }));

import { UpdateNotice, resetUpdateNoticeForTests } from "./UpdateNotice.js";

const URL_ = "https://github.com/plynte-labs/opencohost/releases/tag/v0.5.0-alpha.2";

function serve(body: Record<string, unknown>) {
  const calls = { n: 0 };
  server.use(
    http.get(`${API_BASE_URL}/api/update`, () => {
      calls.n += 1;
      return HttpResponse.json(body);
    })
  );
  return calls;
}

function renderNotice() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <UpdateNotice />
      </ToastProvider>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  open.mockReset();
  resetUpdateNoticeForTests();
  useUiLocaleStore.setState({ locale: "es" });
});

describe("UpdateNotice", () => {
  it("shows a notice with the new version and opens the release page", async () => {
    serve({ enabled: true, current: "0.5.0a1", latest: "0.5.0-alpha.2", newer: true, url: URL_ });
    renderNotice();
    expect(await screen.findByText("Nueva versión 0.5.0-alpha.2 disponible")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Ver en GitHub" }));
    expect(open).toHaveBeenCalledWith(URL_);
  });

  it("speaks English when the UI locale is en", async () => {
    useUiLocaleStore.setState({ locale: "en" });
    serve({ enabled: true, current: "0.5.0a1", latest: "0.5.0-alpha.2", newer: true, url: URL_ });
    renderNotice();
    expect(await screen.findByText("New version 0.5.0-alpha.2 available")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "View on GitHub" })).toBeInTheDocument();
  });

  it("shows nothing when there is no newer version, or the check is off", async () => {
    const calls = serve({ enabled: true, current: "0.5.0a1", latest: "0.5.0a1", newer: false, url: null });
    renderNotice();
    await waitFor(() => expect(calls.n).toBe(1));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("accepts the repo's canonical casing from GitHub", async () => {
    const url = "https://github.com/plynte-labs/OpenCohost/releases/tag/v0.5.0";
    serve({ enabled: true, current: "0.5.0a1", latest: "0.5.0", newer: true, url });
    renderNotice();
    expect(await screen.findByRole("status")).toBeInTheDocument();
  });

  it("does not show a notice for an off-GitHub link", async () => {
    const calls = serve({ enabled: true, current: "0.5.0a1", latest: "9.0.0", newer: true, url: "https://evil.example/x" });
    renderNotice();
    await waitFor(() => expect(calls.n).toBe(1));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("is dismissible and does not come back in the same launch", async () => {
    const calls = serve({ enabled: true, current: "0.5.0a1", latest: "0.5.0-alpha.2", newer: true, url: URL_ });
    const first = renderNotice();
    await screen.findByText("Nueva versión 0.5.0-alpha.2 disponible");
    await userEvent.click(screen.getByRole("button", { name: /cerrar|dismiss|descartar/i }));
    // jsdom never fires transitionend, so the exit phase (opacity-0) is the observable dismissal.
    await waitFor(() => expect(screen.getByRole("status")).toHaveClass("opacity-0"));
    first.unmount();
    renderNotice();
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByText(/Nueva versión/)).not.toBeInTheDocument();
    expect(calls.n).toBe(1);
  });

  it("fails silent when the backend errors", async () => {
    server.use(http.get(`${API_BASE_URL}/api/update`, () => HttpResponse.json({}, { status: 500 })));
    renderNotice();
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
