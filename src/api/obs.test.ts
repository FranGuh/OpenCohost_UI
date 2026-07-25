import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import React from "react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { defaultObsConfig } from "../test/handlers.js";
import { subscribeMutationEvents } from "../lib/appEvents.js";
import { useEventStore } from "../store/eventStore.js";
import { OBS_CONFIG_QUERY_KEY, useObsConfigQuery, useTestObsConnectionMutation, useUpdateObsConfigMutation } from "./obs.js";

function createWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  subscribeMutationEvents(queryClient);
  const wrapper = ({ children }: { children: ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
  return wrapper;
}

function createWrapperWithClient() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
  return { queryClient, wrapper };
}

beforeEach(() => {
  useEventStore.setState({ events: [] });
});

describe("useUpdateObsConfigMutation event emission (obs.config vs obs.toggle)", () => {
  it("emits obs.config, not obs.toggle, when enabled is unchanged and only source changes", async () => {
    const wrapper = createWrapper();
    const { result: query } = renderHook(() => useObsConfigQuery(), { wrapper });
    await waitFor(() => expect(query.current.data).toEqual(defaultObsConfig));

    const { result: mutation } = renderHook(() => useUpdateObsConfigMutation(), { wrapper });
    mutation.current.mutate({
      enabled: defaultObsConfig.enabled, // unchanged — this is what ObsCard.save() always sends
      host: defaultObsConfig.host,
      port: defaultObsConfig.port,
      source: "New Scene"
    });
    await waitFor(() => expect(mutation.current.isSuccess).toBe(true));

    const events = useEventStore.getState().events;
    expect(events).toHaveLength(1);
    expect(events[0].label).toBe("OBS escena → New Scene");
  });

  it("emits obs.toggle when enabled actually flips", async () => {
    const wrapper = createWrapper();
    const { result: query } = renderHook(() => useObsConfigQuery(), { wrapper });
    await waitFor(() => expect(query.current.data).toEqual(defaultObsConfig));

    const { result: mutation } = renderHook(() => useUpdateObsConfigMutation(), { wrapper });
    mutation.current.mutate({
      enabled: !defaultObsConfig.enabled,
      host: defaultObsConfig.host,
      port: defaultObsConfig.port,
      source: defaultObsConfig.source
    });
    await waitFor(() => expect(mutation.current.isSuccess).toBe(true));

    const events = useEventStore.getState().events;
    expect(events).toHaveLength(1);
    expect(events[0].label).toBe(defaultObsConfig.enabled ? "OBS desactivado" : "OBS activado");
  });
});

// F1 sibling fix (multi_provider_llm_20260723's llmProvider.ts): TanStack retains
// mutation.state.variables — the request body — in the MutationCache for ~gcTime
// after settle. `password` must be scrubbed off it in onSettled, same as api_key.
describe("useUpdateObsConfigMutation credential retention (F1 leak sweep)", () => {
  it("scrubs the plaintext password from the QueryCache AND the retained MutationCache after a successful save", async () => {
    const { queryClient, wrapper } = createWrapperWithClient();
    const { result } = renderHook(() => useUpdateObsConfigMutation(), { wrapper });

    result.current.mutate({
      enabled: defaultObsConfig.enabled,
      host: defaultObsConfig.host,
      port: defaultObsConfig.port,
      source: defaultObsConfig.source,
      password: "s3cr3t-obs-pass"
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // Never round-trips into the query cache (password_set only).
    expect(JSON.stringify(queryClient.getQueryData(OBS_CONFIG_QUERY_KEY))).not.toContain("s3cr3t-obs-pass");
    // F1: nor lingers in mutation.state.variables on the retained MutationCache.
    expect(JSON.stringify(queryClient.getMutationCache().getAll())).not.toContain("s3cr3t-obs-pass");
  });
});

describe("useTestObsConnectionMutation credential retention (F1 leak sweep)", () => {
  it("scrubs the plaintext password from the retained MutationCache after 'Probar conexión'", async () => {
    const { queryClient, wrapper } = createWrapperWithClient();
    const { result } = renderHook(() => useTestObsConnectionMutation(), { wrapper });

    result.current.mutate({ host: defaultObsConfig.host, port: defaultObsConfig.port, password: "s3cr3t-obs-pass" });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(JSON.stringify(queryClient.getMutationCache().getAll())).not.toContain("s3cr3t-obs-pass");
  });
});
