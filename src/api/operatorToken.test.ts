import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it } from "vitest";
import { server } from "../test/server.js";
import { API_BASE_URL } from "../test/handlers.js";
import { getMemoriaList, getMemoriaStats, setApiToken, updateModelContext, updateModelReasoning } from "./client.js";
import { getMemoriaNotice, getMemoriaRow, getMemoriaSettings } from "./memoria.js";

/**
 * API auth is ENFORCED by default (owner decision 2026-11-08): every sensitive
 * GET under /api/memoria/ and every mutating call must carry the operator token.
 */
describe("operator token on every sensitive request", () => {
  afterEach(() => setApiToken(null));

  function capture(method: "get" | "put", path: string, body: Record<string, unknown>) {
    const seen: { auth: string | null } = { auth: null };
    server.use(
      http[method](`${API_BASE_URL}${path}`, ({ request }) => {
        seen.auth = request.headers.get("Authorization");
        return HttpResponse.json(body);
      })
    );
    return seen;
  }

  it("memoria stats GET sends the token", async () => {
    setApiToken("op-secret");
    const seen = capture("get", "/api/memoria/stats", { total: 0 });
    await getMemoriaStats().catch(() => undefined);
    expect(seen.auth).toBe("Bearer op-secret");
  });

  it("memoria list GET sends the token", async () => {
    setApiToken("op-secret");
    const seen = capture("get", "/api/memoria/list", { items: [] });
    await getMemoriaList("p1").catch(() => undefined);
    expect(seen.auth).toBe("Bearer op-secret");
  });

  it("memoria notice GET sends the token", async () => {
    setApiToken("op-secret");
    const seen = capture("get", "/api/memoria/notice", { dismissed: false });
    await getMemoriaNotice().catch(() => undefined);
    expect(seen.auth).toBe("Bearer op-secret");
  });

  it("memoria settings GET sends the token", async () => {
    setApiToken("op-secret");
    const seen = capture("get", "/api/memoria/settings", {});
    await getMemoriaSettings().catch(() => undefined);
    expect(seen.auth).toBe("Bearer op-secret");
  });

  it("memoria row GET sends the token", async () => {
    setApiToken("op-secret");
    const seen = capture("get", "/api/memoria/row/:id", {});
    await getMemoriaRow("r1", "p1").catch(() => undefined);
    expect(seen.auth).toBe("Bearer op-secret");
  });

  it("PUT /api/models/reasoning sends the token", async () => {
    setApiToken("op-secret");
    const seen = capture("put", "/api/models/reasoning", { enabled: true });
    await updateModelReasoning({ enabled: true }).catch(() => undefined);
    expect(seen.auth).toBe("Bearer op-secret");
  });

  it("PUT /api/models/context sends the token", async () => {
    setApiToken("op-secret");
    const seen = capture("put", "/api/models/context", { model: "m", context_tokens: null });
    await updateModelContext({ model: "m", context_tokens: null }).catch(() => undefined);
    expect(seen.auth).toBe("Bearer op-secret");
  });
});
