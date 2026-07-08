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
  useAgendaSessionActionMutation,
  useCohostProfilesQuery,
  useSaveCohostProfileMutation,
  useSelectCohostProfileMutation
} from "./agenda.js";

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
