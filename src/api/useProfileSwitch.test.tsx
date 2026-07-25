import { http, HttpResponse } from "msw";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render } from "@testing-library/react";
import React from "react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { server } from "../test/server.js";
import { API_BASE_URL, defaultStatus } from "../test/handlers.js";
import { useSwitchStore } from "../store/switchStore.js";
import { ProfileSwitchProvider, useProfileSwitchContext } from "./useProfileSwitch.js";

/**
 * Progressive-slowdown guard (2026-07-24). `useProfileSwitch` consumes
 * `useStatusQuery`, so the provider re-renders every 2s for the whole session.
 * It minted a BRAND NEW context value object and a brand new `switchTo` closure
 * on every one of those renders, which invalidates the context for every
 * consumer below it (ProfilePlaylist, ProfileSwitcher, Sidebar, ControlsPanel)
 * every 2s — forever — even when nothing about the profile state changed.
 *
 * The value must stay referentially stable while its real inputs are unchanged.
 */

function createWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
}

/** Records the context value identity on every render it performs. Because the
 * provider's `children` element is referentially stable across the provider's
 * own re-renders, this probe re-renders ONLY when the context value actually
 * changes — which is exactly the cost being measured. */
function Probe({ seen }: { seen: unknown[] }) {
  const value = useProfileSwitchContext();
  seen.push(value);
  return null;
}

beforeEach(() => {
  vi.useFakeTimers();
  useSwitchStore.setState({ pendingSwitch: null });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("ProfileSwitchProvider context stability", () => {
  it("does not push a new context value to consumers on every status poll", async () => {
    // The real stream scenario: /api/status changes on essentially every poll
    // (is_speaking flips as Kira talks, state_version increments), so the
    // provider genuinely re-renders every 2s. But NONE of that touches the
    // profile state its consumers read — so no consumer should be re-rendered.
    let poll = 0;
    server.use(
      http.get(`${API_BASE_URL}/api/status`, () => {
        poll += 1;
        return HttpResponse.json({ ...defaultStatus, is_speaking: poll % 2 === 0, state_version: poll });
      })
    );

    const Wrapper = createWrapper();
    const seen: unknown[] = [];

    render(
      <Wrapper>
        <ProfileSwitchProvider>
          <Probe seen={seen} />
        </ProfileSwitchProvider>
      </Wrapper>
    );

    // Let both queries (profiles + status) settle so the inputs are steady.
    await act(() => vi.advanceTimersByTimeAsync(0));
    const settled = seen[seen.length - 1] as { switchTo: unknown; activeProfile?: string };
    expect(settled.activeProfile).toBeTruthy(); // guard: inputs really did settle
    const rendersAfterSettle = seen.length;

    // Three 2s status polls, each returning a genuinely different payload.
    await act(() => vi.advanceTimersByTimeAsync(6000));
    expect(poll).toBeGreaterThan(1); // guard: the poll really did fire

    expect(seen.length).toBe(rendersAfterSettle);
    expect(seen[seen.length - 1]).toBe(settled);
  });

  it("keeps the value and switchTo referentially stable across provider re-renders", async () => {
    const Wrapper = createWrapper();
    const seen: unknown[] = [];
    // A FRESH element each time, so the provider genuinely re-renders and the
    // probe genuinely re-reads the context (no React element-identity bailout).
    const tree = () => (
      <Wrapper>
        <ProfileSwitchProvider>
          <Probe seen={seen} />
        </ProfileSwitchProvider>
      </Wrapper>
    );

    const { rerender } = render(tree());
    await act(() => vi.advanceTimersByTimeAsync(0));
    const settled = seen[seen.length - 1] as { switchTo: unknown; activeProfile?: string };
    expect(settled.activeProfile).toBeTruthy();
    const rendersAfterSettle = seen.length;

    await act(async () => {
      rerender(tree());
    });
    await act(async () => {
      rerender(tree());
    });

    // The probe really did re-render (this test is not vacuous)...
    expect(seen.length).toBeGreaterThan(rendersAfterSettle);
    // ...and still saw the very same context value and callback.
    const latest = seen[seen.length - 1] as { switchTo: unknown };
    expect(latest).toBe(settled);
    expect(latest.switchTo).toBe(settled.switchTo);
  });
});
