import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useEventStore } from "../store/eventStore.js";
import type { AppEventSource } from "../store/eventStore.js";
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

describe("emitAppEvent — KNOWN_SILENT drop + ptt toast exception", () => {
  it("drops KNOWN_SILENT server actions with no store event, no toast, and NO DEV warn", () => {
    const sink = vi.fn();
    setToastSink(sink);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    for (const key of ["motor.speaking_start", "motor.speaking_end", "motor.idle", "ptt.flushed", "ptt.auto_stopped"]) {
      const [source, action] = key.split(".");
      emitAppEvent({ source: source as AppEventSource, action }, "srv-x", { toast: false });
    }
    expect(useEventStore.getState().events).toHaveLength(0);
    expect(sink).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("still DEV-warns for a genuinely unrecognized key (not in KNOWN_SILENT)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    emitAppEvent({ source: "motor" as AppEventSource, action: "totally-made-up" });
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it("toasts ptt.started/stopped/error server echoes even when toast:false", () => {
    const sink = vi.fn();
    setToastSink(sink);
    emitAppEvent({ source: "ptt", action: "started" }, "srv-7", { toast: false });
    emitAppEvent({ source: "ptt", action: "stopped" }, "srv-8", { toast: false });
    emitAppEvent({ source: "ptt", action: "error" }, "srv-9", { toast: false });
    expect(sink).toHaveBeenCalledTimes(3);
    expect(sink).toHaveBeenNthCalledWith(1, "PTT escuchando", "ok");
    expect(sink).toHaveBeenNthCalledWith(2, "PTT enviado a Kira", "ok");
    expect(useEventStore.getState().events).toHaveLength(3); // also in the feed
  });

  it("still suppresses the toast for a NON-ptt server echo with toast:false (feed only)", () => {
    const sink = vi.fn();
    setToastSink(sink);
    emitAppEvent({ source: "motor", action: "ready" }, "srv-10", { toast: false });
    expect(useEventStore.getState().events).toHaveLength(1);
    expect(sink).not.toHaveBeenCalled();
  });

  it("toasts ptt.buffer_full with the cap-cue copy even when toast:false, and lands in the feed", () => {
    const sink = vi.fn();
    setToastSink(sink);
    emitAppEvent({ source: "ptt", action: "buffer_full" }, "srv-x", { toast: false });
    expect(sink).toHaveBeenCalledTimes(1);
    expect(sink).toHaveBeenCalledWith(
      "Buffer de voz lleno — lo que sigas diciendo en este envío se pierde. Soltá F10 para mandar.",
      "ok"
    );
    expect(useEventStore.getState().events).toHaveLength(1);
  });

  it("forward-compat: an unmapped future ptt.* literal is silently dropped (old UI vs newer server)", () => {
    const sink = vi.fn();
    setToastSink(sink);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    emitAppEvent({ source: "ptt", action: "some_future_action" });
    expect(useEventStore.getState().events).toHaveLength(0);
    expect(sink).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
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
