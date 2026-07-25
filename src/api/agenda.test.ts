import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import React from "react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { server } from "../test/server.js";
import {
  API_BASE_URL,
  agendaSessionActionErrorHandler,
  cohostProfileSaveErrorHandler,
  cohostProfileSaveValidationHandler,
  cohostProfileSelectNotFoundHandler,
  cohostProfilesGetHandler,
  defaultAgenda,
  defaultCohostProfiles
} from "../test/handlers.js";
import { ApiError, NotFoundError, ValidationError, setApiToken } from "./client.js";
import {
  getCohostProfiles,
  postAgendaSessionAction,
  postAgendaTopic,
  saveCohostProfile,
  selectCohostProfile,
  useAgendaEvents,
  useAgendaSessionActionMutation,
  useCohostProfilesQuery,
  useSaveCohostProfileMutation,
  useSelectCohostProfileMutation,
  AGENDA_EVENT_CAP,
  AGENDA_QUERY_KEY
} from "./agenda.js";
import { act } from "@testing-library/react";
import type { AgendaResponse } from "./agenda.js";

function createWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
}

/**
 * agent_context_gateway Phase 4 (ADR-5): representative wiring proof that
 * mutating agenda calls actually go through authFetch — the other mutating
 * modules (memoria/music/profiles/stream/obs/avatar) apply the exact same
 * one-line `fetch` -> `authFetch` swap, so this single call site stands in
 * for the pattern rather than duplicating the same proof six more times.
 */
describe("agenda mutating calls attach the cached operator token", () => {
  afterEach(() => {
    setApiToken(null);
  });

  it("postAgendaTopic sends Authorization when a token is cached", async () => {
    setApiToken("op-secret");
    let capturedHeader: string | null = null;
    server.use(
      http.post(`${API_BASE_URL}/api/agenda/topic`, ({ request }) => {
        capturedHeader = request.headers.get("Authorization");
        return HttpResponse.json(defaultAgenda);
      })
    );

    await postAgendaTopic({ title: "topic" });

    expect(capturedHeader).toBe("Bearer op-secret");
  });

  it("postAgendaTopic still succeeds with no Authorization header when no token is cached (D2)", async () => {
    const result = await postAgendaTopic({ title: "topic" });
    expect(result).toBeTruthy();
  });
});

describe("postAgendaSessionAction", () => {
  it("posts the action and resolves with the resulting AgendaResponse", async () => {
    const result = await postAgendaSessionAction({ action: "enable" });
    expect(result).toEqual(defaultAgenda);
  });

  it("throws ApiError when the agenda is unavailable (503)", async () => {
    server.use(agendaSessionActionErrorHandler());
    await expect(postAgendaSessionAction({ action: "soft_stop" })).rejects.toThrow(ApiError);
  });
});

describe("useAgendaSessionActionMutation", () => {
  it("writes the returned AgendaResponse straight into the agenda query cache", async () => {
    const { result } = renderHook(() => useAgendaSessionActionMutation(), { wrapper: createWrapper() });
    result.current.mutate({ action: "emergency_stop" });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(defaultAgenda);
  });
});

describe("getCohostProfiles", () => {
  it("returns the saved profiles list", async () => {
    const result = await getCohostProfiles();
    expect(result).toEqual(defaultCohostProfiles);
  });
});

describe("useCohostProfilesQuery", () => {
  it("hydrates from GET /api/agenda/cohost-profiles", async () => {
    const { result } = renderHook(() => useCohostProfilesQuery(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.data).toEqual(defaultCohostProfiles));
  });
});

describe("saveCohostProfile", () => {
  it("posts name/style/priority/length and returns the updated profiles list", async () => {
    const result = await saveCohostProfile({ name: "Nueva", style: "estilo nuevo" });
    expect(result.profiles.some((profile) => profile.name === "Nueva")).toBe(true);
  });

  it("throws ValidationError on 422 (empty profile name)", async () => {
    server.use(cohostProfileSaveValidationHandler("empty profile name"));
    await expect(saveCohostProfile({ name: "", style: "x" })).rejects.toThrow(ValidationError);
  });

  it("throws ApiError on 503 (cohost_write_failed)", async () => {
    server.use(cohostProfileSaveErrorHandler());
    await expect(saveCohostProfile({ name: "Nueva", style: "x" })).rejects.toThrow(ApiError);
  });
});

describe("useSaveCohostProfileMutation", () => {
  it("writes the returned profiles list into the cohost-profiles query cache", async () => {
    server.use(cohostProfilesGetHandler(defaultCohostProfiles));
    const { result } = renderHook(() => useSaveCohostProfileMutation(), { wrapper: createWrapper() });
    result.current.mutate({ name: "Nueva", style: "estilo nuevo" });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.profiles.some((profile) => profile.name === "Nueva")).toBe(true);
  });
});

describe("selectCohostProfile", () => {
  it("posts the profile name and returns the selected confirmation", async () => {
    const result = await selectCohostProfile({ name: "Natural" });
    expect(result).toEqual({ selected: "Natural" });
  });

  it("throws NotFoundError on 404 (unknown profile)", async () => {
    server.use(cohostProfileSelectNotFoundHandler());
    await expect(selectCohostProfile({ name: "Inexistente" })).rejects.toThrow(NotFoundError);
  });
});

describe("useSelectCohostProfileMutation", () => {
  it("invalidates the agenda query on success so profile_style refetches", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) =>
      React.createElement(QueryClientProvider, { client: queryClient }, children);
    const invalidateSpy = queryClient.invalidateQueries.bind(queryClient);
    let invalidatedKeys: unknown[] = [];
    queryClient.invalidateQueries = ((options?: { queryKey?: unknown[] }) => {
      if (options?.queryKey) invalidatedKeys.push(options.queryKey);
      return invalidateSpy(options);
    }) as typeof queryClient.invalidateQueries;

    const { result } = renderHook(() => useSelectCohostProfileMutation(), { wrapper });
    result.current.mutate({ name: "Natural" });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invalidatedKeys).toEqual([["agenda"]]);
  });
});

/**
 * Progressive-slowdown guard (2026-07-24). `useAgendaEvents` accumulated its
 * event array forever, and BOTH that array and the internal `seen` dedup Set
 * grew unbounded for the whole life of a stream. Every one of those events
 * becomes a row that ConversationPanel re-maps/re-sorts/re-filters on every
 * render, so an uncapped list is a per-render cost multiplier over a multi-hour
 * session. Same ring-buffer contract as eventStore's EVENT_CAP: bounded length,
 * oldest-first eviction, newest kept.
 */
describe("useAgendaEvents ring buffer (progressive-slowdown guard)", () => {
  /** Snapshot whose active topic has spoken `turns` turns — each new value
   * diffs into exactly one "turno N" event. */
  function snapshotAtTurn(turns: number): AgendaResponse {
    return {
      ...defaultAgenda,
      active_topic: { ...defaultAgenda.active_topic!, turns_spoken: turns }
    };
  }

  it("caps the accumulated event stream at AGENDA_EVENT_CAP, evicting oldest-first", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) =>
      React.createElement(QueryClientProvider, { client: queryClient }, children);

    // Seed the cache before mount so the hook has data on first render; the
    // first snapshot only anchors the baseline and emits nothing.
    queryClient.setQueryData(AGENDA_QUERY_KEY, snapshotAtTurn(0));
    const { result } = renderHook(() => useAgendaEvents(), { wrapper });

    // Every id the hook has EVER emitted, in order. react-query coalesces
    // rapid cache writes, so not every pushed snapshot becomes an event — we
    // record what actually landed instead of assuming a 1:1 mapping, which
    // makes the eviction assertion below exact rather than probabilistic.
    const emitted: string[] = [];
    const record = () => {
      for (const event of result.current) {
        if (!emitted.includes(event.id)) emitted.push(event.id);
      }
    };

    const target = AGENDA_EVENT_CAP + 25;
    for (let turn = 1; emitted.length < target && turn <= target * 20; turn++) {
      // Push snapshots straight into the shared cache — the same observer the
      // poll feeds, without paying a real 1500ms interval per event.
      await act(async () => {
        queryClient.setQueryData(AGENDA_QUERY_KEY, snapshotAtTurn(turn));
      });
      record();
    }
    expect(emitted.length).toBeGreaterThan(AGENDA_EVENT_CAP); // the flood really overflowed

    const events = result.current;
    // Bounded: this is the whole point — an uncapped stream grew forever.
    expect(events).toHaveLength(AGENDA_EVENT_CAP);
    // Oldest-first eviction, order preserved oldest -> newest (what the
    // timeline sorts on): the survivors are exactly the last CAP emitted.
    expect(events.map((e) => e.id)).toEqual(emitted.slice(emitted.length - AGENDA_EVENT_CAP));
    expect(events.some((e) => e.id === emitted[0])).toBe(false); // the very first is gone

    // Dedup survives the cap change: the old implementation deduped against an
    // unbounded `seen` Set that grew for the whole stream. Dedup now rides on
    // the retained window instead, so re-observing a snapshot that is still in
    // that window must NOT duplicate its event line.
    await act(async () => {
      queryClient.setQueryData(AGENDA_QUERY_KEY, snapshotAtTurn(0)); // rewind
    });
    await act(async () => {
      queryClient.setQueryData(AGENDA_QUERY_KEY, snapshotAtTurn(target)); // replay a retained id
    });
    const ids = result.current.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(result.current.length).toBeLessThanOrEqual(AGENDA_EVENT_CAP);
  });
});
