import { http, HttpResponse } from "msw";
import { QueryClient, QueryClientProvider, focusManager } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import React from "react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { server } from "../test/server.js";
import { API_BASE_URL } from "../test/handlers.js";
import { useEventStore } from "../store/eventStore.js";
import { useAgendaEvents } from "./agenda.js";
import { useLastReply } from "./chat.js";
import { useServerEventLog } from "./events.js";
import { useLiveTranscript } from "./liveTranscript.js";
import { usePttServerSignal } from "./ptt.js";
import { useStatusQuery } from "./status.js";

/**
 * OWNER DECISION (2026-07-24) — the cockpit must stay live while the window is
 * covered.
 *
 * Every live-state poll used to carry `refetchIntervalInBackground: false`.
 * When the window is occluded (behind OBS or a fullscreen game — the NORMAL
 * state for a streamer) or hidden, react-query stops the interval, and since
 * nothing else in this app advances state independently, the whole UI froze by
 * construction at zero CPU cost. It only caught up on focus, via the default
 * `refetchOnWindowFocus` burst — which is exactly the moment the operator no
 * longer needs the catch-up. The owner reported this as "it freezes when I come
 * back and use PTT — it does not report state until I focus or click".
 *
 * Saving CPU while backgrounded is not a goal on a streaming rig. These hooks
 * carry live state and must keep the SAME cadence while backgrounded (no
 * adaptive/degraded background cadence — deliberately kept simple).
 *
 * NOT covered here: `usePttHold`'s flush poll in ptt.ts, which is owned by a
 * concurrent track and was deliberately left untouched.
 */

interface PollCase {
  name: string;
  path: string;
  body: unknown;
  intervalMs: number;
  render: () => unknown;
}

const CASES: PollCase[] = [
  {
    name: "useStatusQuery (GET /api/status)",
    path: "/api/status",
    body: { active_profile: "default", is_speaking: false, state: "idle" },
    intervalMs: 2000,
    render: () => useStatusQuery()
  },
  {
    name: "useLastReply (GET /api/chat/last-reply)",
    path: "/api/chat/last-reply",
    body: { text: null, turn_id: 0, source: null },
    intervalMs: 1500,
    render: () => useLastReply()
  },
  {
    name: "useAgendaEvents (GET /api/agenda)",
    path: "/api/agenda",
    body: { enabled: false, current_topic: null, queue: [], history: [] },
    intervalMs: 1500,
    render: () => useAgendaEvents()
  },
  {
    name: "useServerEventLog (GET /api/events)",
    path: "/api/events",
    body: { events: [], cursor: 0, boot: 1 },
    intervalMs: 1500,
    render: () => useServerEventLog()
  },
  {
    name: "useLiveTranscript (GET /api/ptt/state — the PTT path the owner reported)",
    path: "/api/ptt/state",
    body: { state: "idle", session_id: null, buffered_chars: 0, last_error: null, stt_ws_url: null },
    intervalMs: 1000,
    render: () => useLiveTranscript(() => {})
  },
  {
    // Feeds the avatar's "escuchando" signal. Same endpoint/cadence as the
    // transcript echo above (they share one query key, so one poll serves both),
    // and it MUST survive backgrounding: the external F10 bridge is held
    // precisely while the window sits behind the game.
    name: "usePttServerSignal (GET /api/ptt/state — the avatar's listening signal)",
    path: "/api/ptt/state",
    body: { state: "idle", session_id: null, buffered_chars: 0, last_error: null, stt_ws_url: null },
    intervalMs: 1000,
    render: () => usePttServerSignal()
  }
];

function createWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
}

beforeEach(() => {
  vi.useFakeTimers();
  useEventStore.setState({ events: [] });
});

afterEach(() => {
  focusManager.setFocused(undefined);
  vi.useRealTimers();
});

describe("live-state polls keep running while the window is backgrounded", () => {
  for (const testCase of CASES) {
    it(`${testCase.name} keeps fetching after focus is lost`, async () => {
      let calls = 0;
      server.use(
        http.get(`${API_BASE_URL}${testCase.path}`, () => {
          calls += 1;
          return HttpResponse.json(testCase.body as Record<string, unknown>);
        })
      );

      renderHook(() => testCase.render(), { wrapper: createWrapper() });
      await act(() => vi.advanceTimersByTimeAsync(0));
      expect(calls).toBe(1); // mount fetch

      // The window goes behind OBS / the game. Under the OLD
      // refetchIntervalInBackground:false this stayed pinned at 1 forever.
      focusManager.setFocused(false);
      await act(() => vi.advanceTimersByTimeAsync(testCase.intervalMs * 4));

      expect(calls).toBeGreaterThanOrEqual(3);
    });
  }
});
