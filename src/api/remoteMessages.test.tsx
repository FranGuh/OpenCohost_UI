import { http, HttpResponse } from "msw";
import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { server } from "../test/server.js";
import { API_BASE_URL } from "../test/handlers.js";
import { useRemoteMessages, type RemoteMessage } from "./remote.js";

const item = (seq: number, text: string): RemoteMessage => ({
  seq,
  text,
  accepted_at: 100 + seq,
  device_id: "d1",
  device_label: "Pixel"
});

/** Serves the feed honoring the `after` cursor, like the backend. */
function feed(all: RemoteMessage[], seen: number[] = []) {
  return http.get(`${API_BASE_URL}/api/remote/messages`, ({ request }) => {
    const after = Number(new URL(request.url).searchParams.get("after") ?? "0");
    seen.push(after);
    return HttpResponse.json({
      items: all.filter((m) => m.seq > after),
      latest_seq: all.length ? all[all.length - 1]!.seq : 0
    });
  });
}

describe("useRemoteMessages", () => {
  it("does not replay what was already in the feed at mount", async () => {
    const all = [item(1, "viejo"), item(2, "tambien viejo")];
    const seen: number[] = [];
    server.use(feed(all, seen));
    const received: string[] = [];
    renderHook(() => useRemoteMessages((items) => received.push(...items.map((m) => m.text)), 20));
    await waitFor(() => expect(seen.length).toBeGreaterThanOrEqual(2));
    expect(received).toEqual([]);
    expect(seen.slice(0, 2)).toEqual([0, 2]);
  });

  it("delivers each new message once, in seq order", async () => {
    const all = [item(1, "viejo")];
    server.use(feed(all));
    const received: number[] = [];
    renderHook(() => useRemoteMessages((items) => received.push(...items.map((m) => m.seq)), 20));
    await new Promise((r) => setTimeout(r, 80));
    all.push(item(2, "nuevo"), item(3, "otro"));
    await waitFor(() => expect(received).toEqual([2, 3]));
    await new Promise((r) => setTimeout(r, 80));
    expect(received).toEqual([2, 3]);
  });

  it("a remount starts from the latest seq again (no replay)", async () => {
    const all = [item(1, "a")];
    server.use(feed(all));
    const first: number[] = [];
    const one = renderHook(() => useRemoteMessages((items) => first.push(...items.map((m) => m.seq)), 20));
    await new Promise((r) => setTimeout(r, 60));
    all.push(item(2, "b"));
    await waitFor(() => expect(first).toEqual([2]));
    one.unmount();
    const second: number[] = [];
    renderHook(() => useRemoteMessages((items) => second.push(...items.map((m) => m.seq)), 20));
    await new Promise((r) => setTimeout(r, 100));
    expect(second).toEqual([]);
  });

  it("stops polling when the gateway is disabled", async () => {
    let calls = 0;
    server.use(
      http.get(`${API_BASE_URL}/api/remote/messages`, () => {
        calls += 1;
        return HttpResponse.json({ error: "gateway_disabled" }, { status: 409 });
      })
    );
    renderHook(() => useRemoteMessages(() => {}, 10));
    await new Promise((r) => setTimeout(r, 120));
    expect(calls).toBe(1);
  });
});
