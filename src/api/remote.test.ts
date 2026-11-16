import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it } from "vitest";
import { server } from "../test/server.js";
import { API_BASE_URL } from "../test/handlers.js";
import { ApiError, setApiToken } from "./client.js";
import {
  RemoteGatewayDisabledError,
  deleteRemoteDevice,
  getRemoteDevices,
  getRemoteMessages,
  isGatewayDisabled,
  postPairCode
} from "./remote.js";

const DEVICE = { device_id: "d1", name: "Phone", created_at: 100, last_used_at: null, revoked: false };

describe("remote client", () => {
  afterEach(() => setApiToken(null));

  it("GET devices goes through authFetch with the operator token", async () => {
    setApiToken("op-secret");
    let header: string | null = null;
    server.use(
      http.get(`${API_BASE_URL}/api/remote/devices`, ({ request }) => {
        header = request.headers.get("Authorization");
        return HttpResponse.json({ devices: [DEVICE] });
      })
    );
    expect((await getRemoteDevices()).devices).toEqual([DEVICE]);
    expect(header).toBe("Bearer op-secret");
  });

  it("POST pair-code goes through authFetch with the operator token", async () => {
    setApiToken("op-secret");
    let header: string | null = null;
    server.use(
      http.post(`${API_BASE_URL}/api/remote/pair-code`, ({ request }) => {
        header = request.headers.get("Authorization");
        return HttpResponse.json({ code: "ABCD1234", expires_at: 1234, gateway_port: 8780 });
      })
    );
    expect(await postPairCode()).toEqual({ code: "ABCD1234", expires_at: 1234, gateway_port: 8780 });
    expect(header).toBe("Bearer op-secret");
  });

  it("DELETE device goes through authFetch with the operator token and encodes the id", async () => {
    setApiToken("op-secret");
    let header: string | null = null;
    let url = "";
    server.use(
      http.delete(`${API_BASE_URL}/api/remote/devices/:id`, ({ request }) => {
        header = request.headers.get("Authorization");
        url = new URL(request.url).pathname;
        return HttpResponse.json({ device_id: "a/b", revoked: true });
      })
    );
    expect(await deleteRemoteDevice("a/b")).toEqual({ device_id: "a/b", revoked: true });
    expect(header).toBe("Bearer op-secret");
    expect(url).toBe("/api/remote/devices/a%2Fb");
  });

  it("maps 409 gateway_disabled to a typed disabled error on all three calls", async () => {
    const disabled = () => HttpResponse.json({ error: "gateway_disabled" }, { status: 409 });
    server.use(
      http.get(`${API_BASE_URL}/api/remote/devices`, disabled),
      http.post(`${API_BASE_URL}/api/remote/pair-code`, disabled),
      http.delete(`${API_BASE_URL}/api/remote/devices/:id`, disabled)
    );
    for (const call of [() => getRemoteDevices(), () => postPairCode(), () => deleteRemoteDevice("d1")]) {
      const err = await call().catch((e: unknown) => e);
      expect(err).toBeInstanceOf(RemoteGatewayDisabledError);
      expect(isGatewayDisabled(err)).toBe(true);
    }
  });

  it("other failures stay generic ApiErrors, not the disabled state", async () => {
    server.use(http.get(`${API_BASE_URL}/api/remote/devices`, () => new HttpResponse(null, { status: 500 })));
    const err = await getRemoteDevices().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(isGatewayDisabled(err)).toBe(false);
  });
});

describe("remote messages client", () => {
  afterEach(() => setApiToken(null));

  it("GET messages sends the operator token and the after cursor", async () => {
    setApiToken("op-secret");
    let header: string | null = null;
    let search = "";
    server.use(
      http.get(`${API_BASE_URL}/api/remote/messages`, ({ request }) => {
        header = request.headers.get("Authorization");
        search = new URL(request.url).search;
        return HttpResponse.json({
          items: [{ seq: 4, text: "hola", accepted_at: 10, device_id: "d1", device_label: "Pixel" }],
          latest_seq: 4
        });
      })
    );
    const body = await getRemoteMessages(3);
    expect(body.items[0]?.text).toBe("hola");
    expect(body.latest_seq).toBe(4);
    expect(header).toBe("Bearer op-secret");
    expect(search).toBe("?after=3");
  });

  it("maps 409 gateway_disabled to the typed error", async () => {
    server.use(
      http.get(`${API_BASE_URL}/api/remote/messages`, () =>
        HttpResponse.json({ error: "gateway_disabled" }, { status: 409 })
      )
    );
    await expect(getRemoteMessages(0)).rejects.toSatisfy(isGatewayDisabled);
  });
});
