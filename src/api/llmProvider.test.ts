import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import React from "react";
import type { ReactNode } from "react";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { server } from "../test/server.js";
import { API_BASE_URL, defaultLlmProvider } from "../test/handlers.js";
import { ApiError, NotFoundError, ValidationError } from "./client.js";
import { subscribeMutationEvents } from "../lib/appEvents.js";
import { useEventStore } from "../store/eventStore.js";
import {
  getLlmProvider,
  isValidProfileId,
  putLlmProvider,
  suggestDuplicateId,
  suggestProfileId,
  useUpdateLlmProvider
} from "./llmProvider.js";
import type { LlmProviderRequest } from "./llmProvider.js";

function createWrapperWithClient() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
  return { queryClient, wrapper };
}

describe("suggestProfileId (sanitizes an invalid custom id into a valid one)", () => {
  it("turns the owner's 'z-ai' into 'z_ai' and it passes isValidProfileId", () => {
    const suggested = suggestProfileId("z-ai");
    expect(suggested).toBe("z_ai");
    expect(isValidProfileId(suggested)).toBe(true);
  });

  it("lowercases, collapses runs of invalid chars, and trims leading/trailing underscores", () => {
    expect(suggestProfileId("Mi Proveedor")).toBe("mi_proveedor");
    expect(suggestProfileId("  --GLM 5.2!!  ")).toBe("glm_5_2");
  });

  it("returns '' (unsuggestable) for input with no usable chars", () => {
    expect(suggestProfileId("---")).toBe("");
    expect(isValidProfileId(suggestProfileId("---"))).toBe(false);
  });
});

describe("suggestDuplicateId (a free '<source>_N' id for the 'Duplicar' flow)", () => {
  it("suggests 'nvidia_nim_2' when only 'nvidia_nim' exists", () => {
    const id = suggestDuplicateId("nvidia_nim", ["nvidia_nim"]);
    expect(id).toBe("nvidia_nim_2");
    expect(isValidProfileId(id)).toBe(true);
  });

  it("skips already-taken suffixes (…_2 taken → …_3)", () => {
    expect(suggestDuplicateId("nvidia_nim", ["nvidia_nim", "nvidia_nim_2"])).toBe("nvidia_nim_3");
  });

  it("sanitizes the source id first, so a hyphenated source still yields a valid id", () => {
    const id = suggestDuplicateId("z-ai", ["z_ai"]);
    expect(id).toBe("z_ai_2");
    expect(isValidProfileId(id)).toBe(true);
  });
});

describe("getLlmProvider", () => {
  it("parses the provider config (with per-profile api_key_set, never a key)", async () => {
    const result = await getLlmProvider();
    expect(result).toEqual(defaultLlmProvider);
    // Contract: no api_key field anywhere in the parsed shape.
    expect(JSON.stringify(result)).not.toContain("api_key\"");
    expect(result.profiles.openai.api_key_set).toBe(true);
  });

  it("throws NotFoundError on 404 (running backend predates the route)", async () => {
    server.use(http.get(`${API_BASE_URL}/api/llm/provider`, () => HttpResponse.json({ detail: "nope" }, { status: 404 })));
    await expect(getLlmProvider()).rejects.toBeInstanceOf(NotFoundError);
  });

  it("throws ApiError on a non-404 failure", async () => {
    server.use(http.get(`${API_BASE_URL}/api/llm/provider`, () => HttpResponse.json({ detail: "boom" }, { status: 500 })));
    await expect(getLlmProvider()).rejects.toBeInstanceOf(ApiError);
  });
});

describe("putLlmProvider", () => {
  it("sends the shaped body and parses the merged response", async () => {
    let capturedBody: unknown;
    server.use(
      http.put(`${API_BASE_URL}/api/llm/provider`, async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json({ ...defaultLlmProvider, active_provider: "openai" });
      })
    );
    const result = await putLlmProvider({ active_provider: "openai" });
    expect(capturedBody).toEqual({ active_provider: "openai" });
    expect(result.active_provider).toBe("openai");
  });

  it("throws ValidationError carrying the 422 detail (activation ladder)", async () => {
    server.use(
      http.put(`${API_BASE_URL}/api/llm/provider`, () =>
        HttpResponse.json({ detail: "api_key required for active cloud profile" }, { status: 422 })
      )
    );
    await expect(putLlmProvider({ active_provider: "openai" })).rejects.toMatchObject({
      name: "ValidationError",
      message: "api_key required for active cloud profile"
    });
  });

  it("carries delete_profile (and an optional active_provider switch) in the body", async () => {
    let capturedBody: unknown;
    server.use(
      http.put(`${API_BASE_URL}/api/llm/provider`, async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json({ ...defaultLlmProvider, active_provider: "local", profiles: {} });
      })
    );
    await putLlmProvider({ active_provider: "local", delete_profile: "openai" });
    expect(capturedBody).toEqual({ active_provider: "local", delete_profile: "openai" });
  });

  it("throws ApiError(503) carrying the write-failure detail", async () => {
    server.use(
      http.put(`${API_BASE_URL}/api/llm/provider`, () =>
        HttpResponse.json({ detail: "key_store_write_failed" }, { status: 503 })
      )
    );
    await expect(putLlmProvider({ profile_id: "openai", api_key: "sk-x" })).rejects.toMatchObject({
      status: 503,
      message: "key_store_write_failed"
    });
  });
});

describe("useUpdateLlmProvider", () => {
  beforeEach(() => {
    useEventStore.setState({ events: [] });
  });

  it("invalidates both the provider query and the models query on success", async () => {
    const { queryClient, wrapper } = createWrapperWithClient();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    const setSpy = vi.spyOn(queryClient, "setQueryData");

    const { result } = renderHook(() => useUpdateLlmProvider(), { wrapper });
    result.current.mutate({ active_provider: "openai" });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(setSpy).toHaveBeenCalledWith(["llm-provider"], expect.objectContaining({ active_provider: "openai" }));
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["models"] });
  });

  it("emits a provider.activate toast label — provider id only, never a key", async () => {
    const { queryClient, wrapper } = createWrapperWithClient();
    subscribeMutationEvents(queryClient);

    const { result } = renderHook(() => useUpdateLlmProvider(), { wrapper });
    result.current.mutate({ active_provider: "openai" });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const events = useEventStore.getState().events;
    expect(events).toHaveLength(1);
    expect(events[0].label).toBe("Proveedor LLM → openai");
  });

  it("emits an llm-provider.delete toast (id only) for a delete_profile PUT — not a save/activate label", async () => {
    const { queryClient, wrapper } = createWrapperWithClient();
    subscribeMutationEvents(queryClient);

    const { result } = renderHook(() => useUpdateLlmProvider(), { wrapper });
    // The switch-then-delete ergonomic PUT must still read as a DELETE, not an
    // "activate → Local" — delete is the operator's actual intent.
    result.current.mutate({ active_provider: "local", delete_profile: "openai" });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const events = useEventStore.getState().events;
    expect(events).toHaveLength(1);
    expect(events[0].label).toBe("Proveedor openai eliminado");
  });

  it("emits a provider.profile toast that never leaks the api_key value", async () => {
    const { queryClient, wrapper } = createWrapperWithClient();
    subscribeMutationEvents(queryClient);

    const { result } = renderHook(() => useUpdateLlmProvider(), { wrapper });
    const body: LlmProviderRequest = {
      profile_id: "openai",
      base_url: "https://api.openai.com/v1",
      model: "gpt-4o-mini",
      api_key: "sk-super-secret-value"
    };
    result.current.mutate(body);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const events = useEventStore.getState().events;
    expect(events).toHaveLength(1);
    expect(events[0].label).toBe("Proveedor openai guardado");
    expect(events[0].label).not.toContain("sk-super-secret-value");
    // The api_key must never reach the query cache either.
    expect(JSON.stringify(queryClient.getQueryData(["llm-provider"]))).not.toContain("sk-super-secret-value");
    // F1: nor linger in the retained MutationCache (mutation.state.variables
    // survives ~gcTime after settle by TanStack default) — it must be scrubbed.
    expect(JSON.stringify(queryClient.getMutationCache().getAll())).not.toContain("sk-super-secret-value");
  });
});
