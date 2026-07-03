import { http, HttpResponse } from "msw";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { server } from "../test/server.js";
import { API_BASE_URL, defaultStatus } from "../test/handlers.js";
import { useSwitchStore } from "../store/switchStore.js";
import { ProfileSwitchProvider } from "../api/useProfileSwitch.js";
import { ProfileSwitcher } from "./ProfileSwitcher.js";

function renderSwitcher() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    React.createElement(
      QueryClientProvider,
      { client: queryClient },
      React.createElement(ProfileSwitchProvider, null, React.createElement(ProfileSwitcher))
    )
  );
}

/**
 * Deterministically gates the SECOND `GET /api/status` response (the one the
 * mutation's onSuccess `invalidateQueries` triggers) behind a manually
 * released promise, so the transient "applying" state is 100% stable to
 * assert on instead of racing real time or fake-timer/microtask ordering.
 * The exact ~2s poll-transition mechanics are already covered at the hook
 * level in src/api/status.test.ts — this only proves the UI wiring reacts.
 */
function gatedStatusHandler(oldProfile: string, newProfile: string) {
  let calls = 0;
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const handler = http.get(`${API_BASE_URL}/api/status`, async () => {
    calls += 1;
    if (calls === 2) {
      await gate;
    }
    return HttpResponse.json({ ...defaultStatus, active_profile: calls > 1 ? newProfile : oldProfile });
  });
  return { handler, release: () => release() };
}

beforeEach(() => {
  useSwitchStore.setState({ pendingSwitch: null });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("ProfileSwitcher (spec R4, R5)", () => {
  it("lists profiles from useProfilesQuery and switches: queued -> applying -> applied", async () => {
    const { handler, release } = gatedStatusHandler("default", "Akira");
    server.use(handler);

    renderSwitcher();

    const select = (await screen.findByLabelText("Perfil activo")) as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe("default"));
    expect(screen.getByRole("option", { name: "Akira" })).toBeInTheDocument();

    fireEvent.change(select, { target: { value: "Akira" } });

    // call #2 (the invalidate-triggered refetch) is gated — "applying" is
    // guaranteed stable to observe here, not a race against convergence.
    await waitFor(() => expect(screen.getByText(/aplicando/)).toBeInTheDocument());
    expect(select).toBeDisabled();

    await act(async () => {
      release();
      await Promise.resolve();
    });

    await waitFor(() => expect(screen.queryByText(/aplicando/)).not.toBeInTheDocument());
    expect(select.value).toBe("Akira");
  });

  it("surfaces the timeout terminal state when a switch does not converge within ~15s", async () => {
    // default handler always returns active_profile: "default" — Akira never converges
    vi.useFakeTimers();

    renderSwitcher();
    await act(() => vi.advanceTimersByTimeAsync(0));

    const select = screen.getByLabelText("Perfil activo") as HTMLSelectElement;
    await act(async () => {
      fireEvent.change(select, { target: { value: "Akira" } });
      await vi.advanceTimersByTimeAsync(0);
    });

    await act(() => vi.advanceTimersByTimeAsync(15000));

    expect(screen.getByText(/tardando más de lo esperado/)).toBeInTheDocument();
  });
});
