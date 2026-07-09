import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import React from "react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { defaultObsConfig } from "../test/handlers.js";
import { subscribeMutationEvents } from "../lib/appEvents.js";
import { useEventStore } from "../store/eventStore.js";
import { useObsConfigQuery, useUpdateObsConfigMutation } from "./obs.js";

function createWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  subscribeMutationEvents(queryClient);
  const wrapper = ({ children }: { children: ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
  return wrapper;
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
