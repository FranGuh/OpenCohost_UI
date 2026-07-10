import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useEventStore } from "../store/eventStore.js";
import { emitAppEvent, sanitizeDetail, setToastSink, subscribeMutationEvents } from "./appEvents.js";
import type { AppEventInput } from "./appEvents.js";

beforeEach(() => {
  useEventStore.setState({ events: [] });
  setToastSink(null);
});

describe("sanitizeDetail", () => {
  it("passes a short identifier unchanged", () => {
    expect(sanitizeDetail("qwen3:8b")).toBe("qwen3:8b");
  });

  it("flattens newlines/tabs into single spaces", () => {
    expect(sanitizeDetail("a\nb\tc")).toBe("a b c");
  });

  it("rejects (returns undefined) a 7+-word sentence — body-shaped, not identifier-shaped", () => {
    expect(sanitizeDetail("hola Kira contame cómo viene el stream")).toBeUndefined();
  });

  it("truncates a long single token to 48 chars + ellipsis", () => {
    const longToken = "a".repeat(60);
    const result = sanitizeDetail(longToken);
    expect(result).toBe(`${"a".repeat(48)}…`);
  });

  it("returns undefined for empty/whitespace-only input", () => {
    expect(sanitizeDetail("")).toBeUndefined();
    expect(sanitizeDetail("   ")).toBeUndefined();
  });
});

describe("emitAppEvent", () => {
  it("with a whitelisted key: appends exactly one store event with the template label and calls the toast sink once with (label, tone)", () => {
    const sink = vi.fn();
    setToastSink(sink);
    emitAppEvent({ source: "model", action: "switch", detail: "qwen3:8b" });

    const events = useEventStore.getState().events;
    expect(events).toHaveLength(1);
    expect(events[0].label).toBe("Cambio de modelo enviado → qwen3:8b");
    expect(sink).toHaveBeenCalledTimes(1);
    expect(sink).toHaveBeenCalledWith("Cambio de modelo enviado → qwen3:8b", "ok");
  });

  it("with an unknown source.action: leaves the store untouched and never calls the sink", () => {
    const sink = vi.fn();
    setToastSink(sink);
    emitAppEvent({ source: "model", action: "not-a-real-action" });

    expect(useEventStore.getState().events).toHaveLength(0);
    expect(sink).not.toHaveBeenCalled();
  });

  it("privacy: body-like fields cannot leak — extra text/body fields are ignored, only the whitelisted template label is stored/toasted", () => {
    const sink = vi.fn();
    setToastSink(sink);
    const leaky = {
      source: "model",
      action: "switch",
      detail: "ok",
      text: "raw Kira dialogue",
      body: "viewer chat"
    } as unknown as AppEventInput;
    emitAppEvent(leaky);

    const events = useEventStore.getState().events;
    expect(events).toHaveLength(1);
    expect(events[0].label).toBe("Cambio de modelo enviado → ok");
    expect(events[0].label).not.toMatch(/dialogue|chat/);
    expect(sink).toHaveBeenCalledWith("Cambio de modelo enviado → ok", "ok");
    // @ts-expect-error — AppEventInput has no `label`/`text` field; a hook cannot hand this module a sentence.
    const rejectedAtCompileTime: AppEventInput = { source: "model", action: "switch", label: "nope" };
    void rejectedAtCompileTime;
  });
});

describe("subscribeMutationEvents", () => {
  function buildQueryClient() {
    return new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  }

  it("emits exactly one event on success for a mutation with static meta.event, none while pending", async () => {
    const queryClient = buildQueryClient();
    subscribeMutationEvents(queryClient);

    let resolveFn!: () => void;
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => (markStarted = resolve));
    const mutation = queryClient.getMutationCache().build(queryClient, {
      mutationFn: () =>
        new Promise<{ ok: true }>((resolve) => {
          resolveFn = () => resolve({ ok: true });
          markStarted();
        }),
      meta: { event: { source: "obs", action: "toggle", detail: "on" } }
    });

    const promise = mutation.execute(undefined);
    expect(useEventStore.getState().events).toHaveLength(0); // still pending

    await started; // mutationFn has been invoked, resolveFn is assigned
    expect(useEventStore.getState().events).toHaveLength(0); // still pending — mutationFn hasn't resolved yet
    resolveFn();
    await promise;

    const events = useEventStore.getState().events;
    expect(events).toHaveLength(1);
    expect(events[0].label).toBe("OBS activado");
  });

  it("resolves function-form meta with the mutation's own variables into the correct detail", async () => {
    const queryClient = buildQueryClient();
    subscribeMutationEvents(queryClient);

    const mutation = queryClient.getMutationCache().build(queryClient, {
      mutationFn: async (vars: { name: string }) => ({ ok: true, name: vars.name }),
      meta: {
        event: (variables) => ({ source: "profile", action: "switch", detail: (variables as { name: string }).name })
      }
    });

    await mutation.execute({ name: "Akira" });

    const events = useEventStore.getState().events;
    expect(events).toHaveLength(1);
    expect(events[0].label).toBe("Perfil → Akira");
  });

  it("emits nothing for a mutation without meta, even when its variables contain body-shaped text", async () => {
    const queryClient = buildQueryClient();
    subscribeMutationEvents(queryClient);

    const mutation = queryClient.getMutationCache().build(queryClient, {
      mutationFn: async (vars: { text: string }) => ({ ok: true, echo: vars.text })
    });

    await mutation.execute({ text: "viewer chat body" });

    const events = useEventStore.getState().events;
    expect(events).toHaveLength(0);
    expect(JSON.stringify(events)).not.toMatch(/viewer chat body/);
  });

  it("stops emitting after unsubscribe", async () => {
    const queryClient = buildQueryClient();
    const unsubscribe = subscribeMutationEvents(queryClient);
    unsubscribe();

    const mutation = queryClient.getMutationCache().build(queryClient, {
      mutationFn: async () => ({ ok: true }),
      meta: { event: { source: "stream", action: "connect" } }
    });

    await mutation.execute(undefined);

    expect(useEventStore.getState().events).toHaveLength(0);
  });
});
