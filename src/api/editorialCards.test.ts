import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import React from "react";
import type { ReactNode } from "react";
import { http, HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";
import { server } from "../test/server.js";
import { API_BASE_URL } from "../test/handlers.js";
import { ApiError, ConflictError, NotFoundError, ValidationError } from "./client.js";
import {
  ActiveCardUnavailableError,
  armEditorialCard,
  deleteEditorialCard,
  disableEditorialCard,
  getActiveCard,
  listEditorialCards,
  activateEditorialCard,
  putActiveCardFields,
  deactivateEditorialCard,
  postEditorialCard,
  useArmCardMutation,
  useCardsQuery,
  useCreateCardMutation
} from "./editorialCards.js";
import type { EditorialCardCreateRequest, EditorialCardListItem, ActiveCard } from "./editorialCards.js";

function createWrapperWithClient() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
  return { queryClient, wrapper };
}

const sampleCard: EditorialCardListItem = {
  id: "card_a",
  topic: "arc raiders launch",
  topic_slug: "arc-raiders-launch",
  status: "draft",
  origin: "operator",
  expires_at: null,
  updated_at: "2026-07-18T00:00:00+00:00",
  single_use: false
};

const sampleCreateBody: EditorialCardCreateRequest = {
  agent: "operator",
  topic: "arc raiders launch",
  summary: "New extraction shooter dropped today.",
  streamer_take: "Excited, will try it live.",
  counterpoints: ["might be buggy on day one"],
  discussion_hooks: ["compare to Tarkov"],
  triggers: ["arc raiders", "extraction shooter"],
  expires_at: null,
  single_use: false
};

describe("listEditorialCards", () => {
  it("parses the cards array", async () => {
    server.use(
      http.get(`${API_BASE_URL}/api/agent/cards`, () => HttpResponse.json({ cards: [sampleCard] }))
    );
    const result = await listEditorialCards();
    expect(result).toEqual({ cards: [sampleCard] });
  });

  it("throws ApiError on non-2xx", async () => {
    server.use(
      http.get(`${API_BASE_URL}/api/agent/cards`, () =>
        HttpResponse.json({ detail: "editorial_cards_unavailable" }, { status: 503 })
      )
    );
    await expect(listEditorialCards()).rejects.toThrow(ApiError);
  });
});

describe("postEditorialCard", () => {
  it("sends the shaped body and parses the response", async () => {
    let capturedBody: unknown = null;
    server.use(
      http.post(`${API_BASE_URL}/api/agent/cards`, async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json({
          id: "card_a",
          topic_slug: "arc-raiders-launch",
          status: "draft",
          demoted: false
        });
      })
    );
    const result = await postEditorialCard(sampleCreateBody);
    expect(capturedBody).toEqual(sampleCreateBody);
    expect(result).toEqual({
      id: "card_a",
      topic_slug: "arc-raiders-launch",
      status: "draft",
      demoted: false
    });
  });

  it("sends single_use:true when the request sets it", async () => {
    let capturedBody: unknown = null;
    server.use(
      http.post(`${API_BASE_URL}/api/agent/cards`, async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json({
          id: "card_a",
          topic_slug: "arc-raiders-launch",
          status: "draft",
          demoted: false
        });
      })
    );
    await postEditorialCard({ ...sampleCreateBody, single_use: true });
    expect(capturedBody).toMatchObject({ single_use: true });
  });

  it("throws ValidationError on 422", async () => {
    server.use(
      http.post(`${API_BASE_URL}/api/agent/cards`, () =>
        HttpResponse.json({ detail: "topic must not be empty" }, { status: 422 })
      )
    );
    await expect(postEditorialCard(sampleCreateBody)).rejects.toThrow(ValidationError);
  });

  it("throws ApiError(503) on editorial_cards_unavailable", async () => {
    server.use(
      http.post(`${API_BASE_URL}/api/agent/cards`, () =>
        HttpResponse.json({ detail: "editorial_cards_unavailable" }, { status: 503 })
      )
    );
    await expect(postEditorialCard(sampleCreateBody)).rejects.toMatchObject({ status: 503 });
  });
});

describe("armEditorialCard", () => {
  it("parses {id, status} on 200", async () => {
    server.use(
      http.post(`${API_BASE_URL}/api/agent/cards/card_a/arm`, () =>
        HttpResponse.json({ id: "card_a", status: "armed" })
      )
    );
    const result = await armEditorialCard("card_a");
    expect(result).toEqual({ id: "card_a", status: "armed" });
  });

  it("throws NotFoundError on 404", async () => {
    server.use(
      http.post(`${API_BASE_URL}/api/agent/cards/card_a/arm`, () =>
        HttpResponse.json({ detail: "card_not_found" }, { status: 404 })
      )
    );
    await expect(armEditorialCard("card_a")).rejects.toThrow(NotFoundError);
  });

  it("throws ConflictError on 409", async () => {
    server.use(
      http.post(`${API_BASE_URL}/api/agent/cards/card_a/arm`, () =>
        HttpResponse.json({ detail: "card_not_armable" }, { status: 409 })
      )
    );
    await expect(armEditorialCard("card_a")).rejects.toThrow(ConflictError);
  });
});

describe("useCardsQuery", () => {
  it("fetches and exposes the cards list", async () => {
    server.use(
      http.get(`${API_BASE_URL}/api/agent/cards`, () => HttpResponse.json({ cards: [sampleCard] }))
    );
    const { result } = renderHook(() => useCardsQuery(), { wrapper: createWrapperWithClient().wrapper });
    await waitFor(() => expect(result.current.data).toEqual({ cards: [sampleCard] }));
  });
});

describe("useCreateCardMutation", () => {
  it("invalidates the cards query and memoria stats on success", async () => {
    server.use(
      http.post(`${API_BASE_URL}/api/agent/cards`, () =>
        HttpResponse.json({ id: "card_a", topic_slug: "arc-raiders-launch", status: "draft", demoted: false })
      )
    );
    const { queryClient, wrapper } = createWrapperWithClient();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useCreateCardMutation(), { wrapper });
    result.current.mutate(sampleCreateBody);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(invalidateSpy).toHaveBeenCalledWith(expect.objectContaining({ queryKey: ["editorial-cards"] }));
    expect(invalidateSpy).toHaveBeenCalledWith(expect.objectContaining({ queryKey: ["memoria-stats"] }));
  });
});

describe("useArmCardMutation", () => {
  it("invalidates the cards query and memoria stats on success", async () => {
    server.use(
      http.post(`${API_BASE_URL}/api/agent/cards/card_a/arm`, () =>
        HttpResponse.json({ id: "card_a", status: "armed" })
      )
    );
    const { queryClient, wrapper } = createWrapperWithClient();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useArmCardMutation(), { wrapper });
    result.current.mutate("card_a");
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(invalidateSpy).toHaveBeenCalledWith(expect.objectContaining({ queryKey: ["editorial-cards"] }));
    expect(invalidateSpy).toHaveBeenCalledWith(expect.objectContaining({ queryKey: ["memoria-stats"] }));
  });
});

describe("active card routes", () => {
  const activeCard: ActiveCard = {
    id: "card_a",
    topic: "Acme",
    topic_slug: "acme",
    status: "draft",
    origin: "",
    summary: "s",
    streamer_take: "t",
    active: false,
    single_use: false,
    must_say: ["30 day returns"],
    forbidden_claims: ["best in the world"],
    discount_code: "KIRA10",
    link: "acme.example/kira",
    updated_at: "2026-10-04T00:00:00+00:00"
  };

  it("getActiveCard reads /api/editorial/cards/{id}", async () => {
    server.use(http.get(`${API_BASE_URL}/api/editorial/cards/card_a`, () => HttpResponse.json(activeCard)));
    expect(await getActiveCard("card_a")).toEqual(activeCard);
  });

  it("putActiveCardFields sends a PUT with the fields body", async () => {
    let body: Record<string, unknown> | undefined;
    server.use(
      http.put(`${API_BASE_URL}/api/editorial/cards/card_a/fields`, async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(activeCard);
      })
    );
    await putActiveCardFields("card_a", { must_say: ["x"] });
    expect(body).toEqual({ must_say: ["x"] });
  });

  it("putActiveCardFields maps 422 to ValidationError with the detail", async () => {
    server.use(
      http.put(`${API_BASE_URL}/api/editorial/cards/card_a/fields`, () =>
        HttpResponse.json({ detail: "link too long" }, { status: 422 })
      )
    );
    await expect(putActiveCardFields("card_a", { link: "x" })).rejects.toMatchObject({
      name: "ValidationError",
      message: "link too long"
    });
  });

  it("activateEditorialCard POSTs /activate and maps 409 to ConflictError", async () => {
    server.use(
      http.post(`${API_BASE_URL}/api/editorial/cards/card_a/activate`, () =>
        HttpResponse.json({ detail: "card_not_activatable" }, { status: 409 })
      )
    );
    await expect(activateEditorialCard("card_a")).rejects.toBeInstanceOf(ConflictError);
  });

  it("deactivate, disable and delete use the documented verbs", async () => {
    server.use(
      http.post(`${API_BASE_URL}/api/editorial/cards/card_a/deactivate`, () =>
        HttpResponse.json({ id: "card_a", active: false })
      ),
      http.post(`${API_BASE_URL}/api/editorial/cards/card_a/disable`, () =>
        HttpResponse.json({ id: "card_a", status: "expired" })
      ),
      http.delete(`${API_BASE_URL}/api/editorial/cards/card_a`, () =>
        HttpResponse.json({ id: "card_a", deleted: true })
      )
    );
    expect(await deactivateEditorialCard("card_a")).toEqual({ id: "card_a", active: false });
    expect(await disableEditorialCard("card_a")).toEqual({ id: "card_a", status: "expired" });
    expect(await deleteEditorialCard("card_a")).toEqual({ id: "card_a", deleted: true });
  });

  it("activate returns the active flag and several cards can be active", async () => {
    server.use(
      http.post(`${API_BASE_URL}/api/editorial/cards/a/activate`, () => HttpResponse.json({ id: "a", active: true })),
      http.post(`${API_BASE_URL}/api/editorial/cards/b/activate`, () => HttpResponse.json({ id: "b", active: true }))
    );
    expect(await activateEditorialCard("a")).toEqual({ id: "a", active: true });
    expect(await activateEditorialCard("b")).toEqual({ id: "b", active: true });
  });

  it("card_not_found 404 is NotFoundError", async () => {
    server.use(
      http.post(`${API_BASE_URL}/api/editorial/cards/card_a/activate`, () =>
        HttpResponse.json({ detail: "card_not_found" }, { status: 404 })
      )
    );
    await expect(activateEditorialCard("card_a")).rejects.toBeInstanceOf(NotFoundError);
  });

  it("a route-missing 404 becomes ActiveCardUnavailableError", async () => {
    server.use(
      http.post(`${API_BASE_URL}/api/editorial/cards/card_a/activate`, () =>
        HttpResponse.json({ detail: "Not Found" }, { status: 404 })
      )
    );
    await expect(activateEditorialCard("card_a")).rejects.toBeInstanceOf(ActiveCardUnavailableError);
  });

  it("a network failure becomes ActiveCardUnavailableError", async () => {
    server.use(http.post(`${API_BASE_URL}/api/editorial/cards/card_a/activate`, () => HttpResponse.error()));
    await expect(activateEditorialCard("card_a")).rejects.toBeInstanceOf(ActiveCardUnavailableError);
  });

  it("503 stays an ApiError", async () => {
    server.use(
      http.post(`${API_BASE_URL}/api/editorial/cards/card_a/activate`, () =>
        HttpResponse.json({ detail: "editorial_cards_unavailable" }, { status: 503 })
      )
    );
    await expect(activateEditorialCard("card_a")).rejects.toMatchObject({ status: 503 });
  });

  it("postEditorialCard forwards active card fields", async () => {
    let body: Record<string, unknown> | undefined;
    server.use(
      http.post(`${API_BASE_URL}/api/agent/cards`, async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ id: "c", topic_slug: "c", status: "draft", demoted: false });
      })
    );
    await postEditorialCard({ ...sampleCreateBody, must_say: ["a"] });
    expect(body).toMatchObject({ must_say: ["a"] });
  });
});
