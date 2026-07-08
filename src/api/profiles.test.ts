import { http, HttpResponse } from "msw";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import React from "react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { server } from "../test/server.js";
import {
  API_BASE_URL,
  defaultStatus,
  switchConflictHandler,
  switchNotFoundHandler,
  switchQueueFullHandler
} from "../test/handlers.js";
import { useSwitchStore } from "../store/switchStore.js";
import { createPerfil, deletePerfil, getPerfil, updatePerfil, useProfilesQuery, useSwitchProfileMutation } from "./profiles.js";
import { ConflictError, NotFoundError, ValidationError } from "./client.js";
import { MODELS_QUERY_KEY } from "./models.js";
import { STATUS_QUERY_KEY, usePollUntilApplied } from "./status.js";

function createWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
}

/** Same as createWrapper, but also hands back the QueryClient instance so a
 * test can spy on invalidateQueries. */
function createWrapperWithClient() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
  return { queryClient, wrapper };
}

/** Mirrors the real usage pattern (Slice B): target is derived reactively
 * from the store, so it naturally becomes `null` once a switch converges. */
function useSwitchAndReconcile() {
  const mutation = useSwitchProfileMutation();
  const pendingSwitch = useSwitchStore((state) => state.pendingSwitch);
  const statusQuery = usePollUntilApplied(pendingSwitch?.name ?? null);
  return { mutation, statusQuery };
}

/**
 * Simulates backend idempotency dedupe (obs #2811): a NEW Idempotency-Key
 * enqueues + applies a fresh command; a REPLAYED key returns the same
 * command_id and does NOT re-apply.
 */
function keyRotationScenarioHandlers() {
  const headersSeen: string[] = [];
  const commandsByKey = new Map<string, string>();
  let activeProfile = "default";
  let counter = 0;

  const switchHandler = http.post(`${API_BASE_URL}/api/perfiles/switch`, async ({ request }) => {
    const key = request.headers.get("Idempotency-Key") ?? "";
    headersSeen.push(key);
    const { name } = (await request.json()) as { name: string };

    let commandId = commandsByKey.get(key);
    if (!commandId) {
      counter += 1;
      commandId = `cmd-${counter}`;
      commandsByKey.set(key, commandId);
      activeProfile = name;
    }
    return HttpResponse.json({ accepted: true, command_id: commandId, status: "queued" });
  });

  const statusHandler = http.get(`${API_BASE_URL}/api/status`, () =>
    HttpResponse.json({
      is_ready: true,
      current_model: "qwen3-tts",
      is_speaking: false,
      is_processing: false,
      active_profile: activeProfile,
      health: {
        vram_status: "ok",
        rtf_status: "ok",
        ollama_status: "ok",
        qwen_status: "ok",
        overall_status: "ok",
        ollama_lifecycle: "running",
        qwen_lifecycle: "running",
        free_vram_mb: 4096,
        rtf_rolling_avg: 0.3,
        last_updated: 0
      },
      state_version: counter
    })
  );

  return { switchHandler, statusHandler, headersSeen };
}

beforeEach(() => {
  useSwitchStore.setState({ pendingSwitch: null });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useProfilesQuery (spec R4)", () => {
  it("parses the profile list from GET /api/perfiles via generated types (no hardcoded shape)", async () => {
    const { result } = renderHook(() => useProfilesQuery(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.data).toEqual({ profiles: ["default", "Akira"] }));
  });

  it("shows a non-destructive empty state when the list is empty", async () => {
    server.use(http.get(`${API_BASE_URL}/api/perfiles`, () => HttpResponse.json({ profiles: [] })));

    const { result } = renderHook(() => useProfilesQuery(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.data).toEqual({ profiles: [] }));
    expect(result.current.isError).toBe(false);
  });

  it("surfaces a non-destructive error state when the request fails, without a stale/hardcoded list", async () => {
    server.use(http.get(`${API_BASE_URL}/api/perfiles`, () => HttpResponse.json({ detail: "boom" }, { status: 500 })));

    const { result } = renderHook(() => useProfilesQuery(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
  });
});

describe("useSwitchProfileMutation (spec R5, R6, R7)", () => {
  it("resolves a stable Idempotency-Key per switch intent, reused across retries", async () => {
    const seen: string[] = [];
    server.use(
      http.post(`${API_BASE_URL}/api/perfiles/switch`, ({ request }) => {
        seen.push(request.headers.get("Idempotency-Key") ?? "");
        return HttpResponse.json({ accepted: true, command_id: "cmd-1", status: "queued" });
      })
    );

    const { result } = renderHook(() => useSwitchProfileMutation(), { wrapper: createWrapper() });

    await act(async () => {
      await result.current.mutateAsync({ name: "Akira" });
    });
    await act(async () => {
      await result.current.mutateAsync({ name: "Akira" });
    });

    expect(seen).toHaveLength(2);
    expect(seen[0]).toBe(seen[1]);
    expect(seen[0]).not.toBe("");
  });

  it("on success sets pendingSwitch to applying without an optimistic active_profile write", async () => {
    server.use(
      http.post(`${API_BASE_URL}/api/perfiles/switch`, () =>
        HttpResponse.json({ accepted: true, command_id: "cmd-2", status: "queued" })
      )
    );

    const { result } = renderHook(() => useSwitchProfileMutation(), { wrapper: createWrapper() });

    await act(async () => {
      await result.current.mutateAsync({ name: "Akira" });
    });

    const pending = useSwitchStore.getState().pendingSwitch;
    expect(pending).toEqual({ name: "Akira", commandId: "cmd-2", status: "applying" });
  });

  it("S5: invalidates MODELS_QUERY_KEY alongside STATUS_QUERY_KEY on the applying path, so a profile switch doesn't leave ModelCard showing a stale model", async () => {
    server.use(
      http.post(`${API_BASE_URL}/api/perfiles/switch`, () =>
        HttpResponse.json({ accepted: true, command_id: "cmd-2b", status: "queued" })
      )
    );

    const { queryClient, wrapper } = createWrapperWithClient();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useSwitchProfileMutation(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ name: "Akira" });
    });

    expect(invalidateSpy).toHaveBeenCalledWith(expect.objectContaining({ queryKey: MODELS_QUERY_KEY }));
  });

  it("F1 regression: re-switching to a previously-converged profile rotates the Idempotency-Key and re-enqueues (does not get stuck applying)", async () => {
    const { switchHandler, statusHandler, headersSeen } = keyRotationScenarioHandlers();
    server.use(switchHandler, statusHandler);

    const { result } = renderHook(() => useSwitchAndReconcile(), { wrapper: createWrapper() });

    // 1. switch to Akira, converge.
    await act(async () => {
      await result.current.mutation.mutateAsync({ name: "Akira" });
    });
    await waitFor(() => expect(useSwitchStore.getState().pendingSwitch).toBeNull());

    // 2. switch to default, converge.
    await act(async () => {
      await result.current.mutation.mutateAsync({ name: "default" });
    });
    await waitFor(() => expect(useSwitchStore.getState().pendingSwitch).toBeNull());

    // 3. switch BACK to Akira — must be a fresh key (re-enqueue), not a replay
    // of the first Akira command, and must converge (not get stuck applying).
    await act(async () => {
      await result.current.mutation.mutateAsync({ name: "Akira" });
    });

    expect(headersSeen).toHaveLength(3);
    expect(headersSeen[2]).not.toBe(headersSeen[0]);

    await waitFor(() => expect(useSwitchStore.getState().pendingSwitch).toBeNull());
  });

  it("R6 guard: idempotent replay of an already-registered pending intent does not re-trigger a redundant applying transition", async () => {
    let calls = 0;
    server.use(
      http.post(`${API_BASE_URL}/api/perfiles/switch`, () => {
        calls += 1;
        return HttpResponse.json({ accepted: true, command_id: "cmd-replay", status: "queued" });
      })
    );

    const { result } = renderHook(() => useSwitchProfileMutation(), { wrapper: createWrapper() });

    await act(async () => {
      await result.current.mutateAsync({ name: "Akira" });
    });

    const setPendingSpy = vi.spyOn(useSwitchStore.getState(), "setPending");

    await act(async () => {
      await result.current.mutateAsync({ name: "Akira" });
    });

    expect(calls).toBe(2);
    expect(setPendingSpy).not.toHaveBeenCalled();
    expect(useSwitchStore.getState().pendingSwitch).toEqual({
      name: "Akira",
      commandId: "cmd-replay",
      status: "applying"
    });
  });

  it("switching to the already-active profile resolves pending cleanly without a spurious applying transition", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData(STATUS_QUERY_KEY, { ...defaultStatus, active_profile: "default" });
    const wrapper = ({ children }: { children: ReactNode }) =>
      React.createElement(QueryClientProvider, { client: queryClient }, children);

    server.use(
      http.post(`${API_BASE_URL}/api/perfiles/switch`, () =>
        HttpResponse.json({ accepted: true, command_id: "cmd-noop", status: "queued" })
      )
    );

    const { result } = renderHook(() => useSwitchProfileMutation(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ name: "default" });
    });

    expect(useSwitchStore.getState().pendingSwitch).toBeNull();
  });

  it("S5: invalidates MODELS_QUERY_KEY alongside STATUS_QUERY_KEY on the already-active no-op path too", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData(STATUS_QUERY_KEY, { ...defaultStatus, active_profile: "default" });
    const wrapper = ({ children }: { children: ReactNode }) =>
      React.createElement(QueryClientProvider, { client: queryClient }, children);
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    server.use(
      http.post(`${API_BASE_URL}/api/perfiles/switch`, () =>
        HttpResponse.json({ accepted: true, command_id: "cmd-noop-2", status: "queued" })
      )
    );

    const { result } = renderHook(() => useSwitchProfileMutation(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ name: "default" });
    });

    expect(invalidateSpy).toHaveBeenCalledWith(expect.objectContaining({ queryKey: MODELS_QUERY_KEY }));
  });

  it("429 arriving while a prior pendingSwitch exists leaves it untouched", async () => {
    useSwitchStore.getState().setPending({ name: "Akira", commandId: "cmd-existing", status: "applying" });
    server.use(switchQueueFullHandler());

    const { result } = renderHook(() => useSwitchProfileMutation(), { wrapper: createWrapper() });

    await act(async () => {
      await result.current.mutateAsync({ name: "Bianca" }).catch(() => undefined);
    });

    expect(useSwitchStore.getState().pendingSwitch).toEqual({
      name: "Akira",
      commandId: "cmd-existing",
      status: "applying"
    });
  });

  it("429 does not flip to applying and does not touch active_profile", async () => {
    server.use(switchQueueFullHandler());

    const { result } = renderHook(() => useSwitchProfileMutation(), { wrapper: createWrapper() });

    await act(async () => {
      await result.current.mutateAsync({ name: "Akira" }).catch(() => undefined);
    });

    expect(useSwitchStore.getState().pendingSwitch).toBeNull();
  });

  it("409 arriving while a prior pendingSwitch exists does not flip it to applying (left untouched)", async () => {
    useSwitchStore.getState().setPending({ name: "Akira", commandId: "cmd-existing", status: "applying" });
    server.use(switchConflictHandler());

    const { result } = renderHook(() => useSwitchProfileMutation(), { wrapper: createWrapper() });

    await act(async () => {
      await result.current.mutateAsync({ name: "Bianca" }).catch(() => undefined);
    });

    expect(useSwitchStore.getState().pendingSwitch).toEqual({
      name: "Akira",
      commandId: "cmd-existing",
      status: "applying"
    });
  });

  it("409 does not flip to applying, previous active_profile stays displayed", async () => {
    server.use(switchConflictHandler());

    const { result } = renderHook(() => useSwitchProfileMutation(), { wrapper: createWrapper() });

    await act(async () => {
      await result.current.mutateAsync({ name: "Akira" }).catch(() => undefined);
    });

    expect(useSwitchStore.getState().pendingSwitch).toBeNull();
  });

  it("404 clears any pendingSwitch and does not flip to applying", async () => {
    useSwitchStore.getState().setPending({ name: "Ghost", commandId: "cmd-old", status: "applying" });
    server.use(switchNotFoundHandler());

    const { result } = renderHook(() => useSwitchProfileMutation(), { wrapper: createWrapper() });

    await act(async () => {
      await result.current.mutateAsync({ name: "Ghost" }).catch(() => undefined);
    });

    expect(useSwitchStore.getState().pendingSwitch).toBeNull();
  });
});

describe("profiles CRUD (opencohost/api/main.py GET/POST/PUT/DELETE /api/perfiles)", () => {
  describe("getPerfil", () => {
    it("parses {name, prompt, use_system} from GET /api/perfiles/:name", async () => {
      server.use(
        http.get(`${API_BASE_URL}/api/perfiles/Akira`, () =>
          HttpResponse.json({ name: "Akira", prompt: "Sos ingeniosa y filosa.", use_system: false })
        )
      );

      const result = await getPerfil("Akira");

      expect(result).toEqual({ name: "Akira", prompt: "Sos ingeniosa y filosa.", use_system: false });
    });

    it("maps 404 to NotFoundError carrying the backend detail", async () => {
      server.use(
        http.get(`${API_BASE_URL}/api/perfiles/Ghost`, () =>
          HttpResponse.json({ detail: "profile not found" }, { status: 404 })
        )
      );

      await expect(getPerfil("Ghost")).rejects.toThrow(NotFoundError);
    });
  });

  describe("createPerfil", () => {
    it("POSTs {name, prompt} and parses the persisted ProfileDetailResponse", async () => {
      let capturedBody: unknown;
      server.use(
        http.post(`${API_BASE_URL}/api/perfiles`, async ({ request }) => {
          capturedBody = await request.json();
          return HttpResponse.json({ name: "Nueva", prompt: "Personalidad nueva", use_system: false });
        })
      );

      const result = await createPerfil({ name: "Nueva", prompt: "Personalidad nueva" });

      expect(capturedBody).toEqual({ name: "Nueva", prompt: "Personalidad nueva" });
      expect(result).toEqual({ name: "Nueva", prompt: "Personalidad nueva", use_system: false });
    });

    it("maps 409 to ConflictError when the profile name already exists", async () => {
      server.use(
        http.post(`${API_BASE_URL}/api/perfiles`, () =>
          HttpResponse.json({ detail: "profile already exists" }, { status: 409 })
        )
      );

      await expect(createPerfil({ name: "Akira", prompt: "" })).rejects.toThrow(ConflictError);
    });

    it("maps 422 to ValidationError carrying the backend detail", async () => {
      server.use(
        http.post(`${API_BASE_URL}/api/perfiles`, () =>
          HttpResponse.json({ detail: "invalid profile name" }, { status: 422 })
        )
      );

      await expect(createPerfil({ name: "", prompt: "" })).rejects.toThrow(ValidationError);
    });
  });

  describe("updatePerfil", () => {
    it("PUTs the partial body to /api/perfiles/:name and parses the updated ProfileDetailResponse (rename)", async () => {
      let capturedBody: unknown;
      server.use(
        http.put(`${API_BASE_URL}/api/perfiles/Akira`, async ({ request }) => {
          capturedBody = await request.json();
          return HttpResponse.json({ name: "Akira 2", prompt: "Prompt actualizado", use_system: false });
        })
      );

      const result = await updatePerfil("Akira", { new_name: "Akira 2", prompt: "Prompt actualizado" });

      expect(capturedBody).toEqual({ new_name: "Akira 2", prompt: "Prompt actualizado" });
      expect(result).toEqual({ name: "Akira 2", prompt: "Prompt actualizado", use_system: false });
    });

    it("maps 404 to NotFoundError when the source profile does not exist", async () => {
      server.use(
        http.put(`${API_BASE_URL}/api/perfiles/Ghost`, () =>
          HttpResponse.json({ detail: "profile not found" }, { status: 404 })
        )
      );

      await expect(updatePerfil("Ghost", { prompt: "x" })).rejects.toThrow(NotFoundError);
    });

    it("maps 409 to ConflictError when new_name collides with an existing profile", async () => {
      server.use(
        http.put(`${API_BASE_URL}/api/perfiles/Akira`, () =>
          HttpResponse.json({ detail: "profile already exists" }, { status: 409 })
        )
      );

      await expect(updatePerfil("Akira", { new_name: "default" })).rejects.toThrow(ConflictError);
    });
  });

  describe("deletePerfil", () => {
    it("DELETEs /api/perfiles/:name and parses {ok: true}", async () => {
      server.use(http.delete(`${API_BASE_URL}/api/perfiles/Akira`, () => HttpResponse.json({ ok: true })));

      const result = await deletePerfil("Akira");

      expect(result).toEqual({ ok: true });
    });

    it("maps the 409 last-profile guard to ConflictError carrying the backend detail", async () => {
      server.use(
        http.delete(`${API_BASE_URL}/api/perfiles/default`, () =>
          HttpResponse.json({ detail: "cannot delete the last profile" }, { status: 409 })
        )
      );

      await expect(deletePerfil("default")).rejects.toThrow(ConflictError);
      await expect(deletePerfil("default")).rejects.toThrow("cannot delete the last profile");
    });

    it("maps 404 to NotFoundError when the profile does not exist", async () => {
      server.use(
        http.delete(`${API_BASE_URL}/api/perfiles/Ghost`, () =>
          HttpResponse.json({ detail: "profile not found" }, { status: 404 })
        )
      );

      await expect(deletePerfil("Ghost")).rejects.toThrow(NotFoundError);
    });
  });
});
