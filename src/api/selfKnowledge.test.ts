import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { server } from "../test/server.js";
import { API_BASE_URL } from "../test/handlers.js";
import { ApiError } from "./client.js";
import { SelfKnowledgeValidationError, getSelfKnowledge, putSelfKnowledge } from "./selfKnowledge.js";

const PAYLOAD = {
  enabled: true,
  viewers: false,
  creator: "",
  repository: "",
  description: "",
  defaults: { creator: "Built-in creator", repository: "github.com/x/y" }
};

describe("self-knowledge client", () => {
  it("getSelfKnowledge returns the payload shape", async () => {
    server.use(http.get(`${API_BASE_URL}/api/self-knowledge`, () => HttpResponse.json(PAYLOAD)));
    expect(await getSelfKnowledge()).toEqual(PAYLOAD);
  });

  it("putSelfKnowledge sends only the given keys (partial update)", async () => {
    let body: unknown;
    server.use(
      http.put(`${API_BASE_URL}/api/self-knowledge`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(PAYLOAD);
      })
    );
    await putSelfKnowledge({ viewers: true });
    expect(body).toEqual({ viewers: true });
  });

  it("maps a 422 to a typed validation error carrying per-field codes", async () => {
    server.use(
      http.put(`${API_BASE_URL}/api/self-knowledge`, () =>
        HttpResponse.json(
          { detail: "invalid_self_knowledge", errors: [{ field: "repository", code: "invalid" }] },
          { status: 422 }
        )
      )
    );
    const err = await putSelfKnowledge({ repository: "x" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SelfKnowledgeValidationError);
    expect((err as SelfKnowledgeValidationError).errors).toEqual([{ field: "repository", code: "invalid" }]);
  });

  it("maps a non-JSON 422 to a validation error with no detail", async () => {
    server.use(http.put(`${API_BASE_URL}/api/self-knowledge`, () => new HttpResponse("nope", { status: 422 })));
    const err = await putSelfKnowledge({}).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SelfKnowledgeValidationError);
    expect((err as SelfKnowledgeValidationError).errors).toEqual([]);
  });

  it("maps a 503 to a plain ApiError carrying the status", async () => {
    server.use(http.put(`${API_BASE_URL}/api/self-knowledge`, () => new HttpResponse(null, { status: 503 })));
    const err = await putSelfKnowledge({ enabled: false }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).not.toBeInstanceOf(SelfKnowledgeValidationError);
    expect((err as ApiError).status).toBe(503);
  });

  it("getSelfKnowledge throws an ApiError with status 404 when the route is absent", async () => {
    server.use(http.get(`${API_BASE_URL}/api/self-knowledge`, () => new HttpResponse(null, { status: 404 })));
    const err = await getSelfKnowledge().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(404);
  });
});
