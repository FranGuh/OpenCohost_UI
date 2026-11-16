import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useUiLocaleStore } from "../../i18n/locale.js";
import { useEventStore } from "../../store/eventStore.js";
import { useVisionReadyNotice } from "./useVisionReadyNotice.js";

type Phase = "off" | "starting" | "ready" | "error";

function readyEvents() {
  return useEventStore.getState().events.filter((e) => e.source === "vision" && e.action === "ready");
}

describe("useVisionReadyNotice", () => {
  beforeEach(() => {
    useUiLocaleStore.setState({ locale: "en" });
    useEventStore.setState({ events: [] });
  });
  afterEach(() => useUiLocaleStore.setState({ locale: "es" }));

  it("notifies once when vision goes from starting to ready, not on later polls", () => {
    const { rerender } = renderHook(({ phase }: { phase: Phase }) => useVisionReadyNotice(phase), {
      initialProps: { phase: "starting" as Phase }
    });
    expect(readyEvents()).toHaveLength(0);
    rerender({ phase: "ready" });
    rerender({ phase: "ready" });
    rerender({ phase: "ready" });
    expect(readyEvents()).toHaveLength(1);
    expect(readyEvents()[0]!.label).toBe("Vision is ready");
  });

  it("stays silent when the first thing the app sees is already ready", () => {
    renderHook(() => useVisionReadyNotice("ready"));
    expect(readyEvents()).toHaveLength(0);
  });

  it("stays silent for off to ready and for starting to error", () => {
    const { rerender } = renderHook(({ phase }: { phase: Phase }) => useVisionReadyNotice(phase), {
      initialProps: { phase: "off" as Phase }
    });
    rerender({ phase: "ready" });
    rerender({ phase: "starting" });
    rerender({ phase: "error" });
    expect(readyEvents()).toHaveLength(0);
  });

  it("notifies again for a genuinely new starting to ready transition", () => {
    const { rerender } = renderHook(({ phase }: { phase: Phase }) => useVisionReadyNotice(phase), {
      initialProps: { phase: "starting" as Phase }
    });
    rerender({ phase: "ready" });
    rerender({ phase: "starting" });
    rerender({ phase: "ready" });
    expect(readyEvents()).toHaveLength(2);
  });
});
