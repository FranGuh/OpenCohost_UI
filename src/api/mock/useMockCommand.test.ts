import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useMockCommand } from "./useMockCommand.js";

describe("useMockCommand", () => {
  it("flips pending true on run() then false after the simulated delay", async () => {
    const { result } = renderHook(() => useMockCommand(10));
    expect(result.current.pending).toBe(false);

    act(() => {
      void result.current.run();
    });
    expect(result.current.pending).toBe(true);

    await waitFor(() => expect(result.current.pending).toBe(false));
  });

  it("consumes the payload into variables instead of discarding it", async () => {
    const { result } = renderHook(() => useMockCommand<string>(10));
    expect(result.current.variables).toBeUndefined();

    act(() => {
      void result.current.run("model-a");
    });
    expect(result.current.variables).toBe("model-a");

    await waitFor(() => expect(result.current.pending).toBe(false));
    expect(result.current.variables).toBe("model-a");
  });

  it("keeps two instances independent — one pending doesn't affect the other", async () => {
    const { result: a } = renderHook(() => useMockCommand(10));
    const { result: b } = renderHook(() => useMockCommand(10));

    act(() => {
      void a.current.run();
    });
    expect(a.current.pending).toBe(true);
    expect(b.current.pending).toBe(false);

    await waitFor(() => expect(a.current.pending).toBe(false));
  });
});
