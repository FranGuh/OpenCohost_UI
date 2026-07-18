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
  armEditorialCard,
  listEditorialCards,
  postEditorialCard,
  useArmCardMutation,
  useCardsQuery,
  useCreateCardMutation
} from "./editorialCards.js";
import type { EditorialCardCreateRequest, EditorialCardListItem } from "./editorialCards.js";

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
  updated_at: "2026-07-18T00:00:00+00:00"
};

const sampleCreateBody: EditorialCardCreateRequest = {
  agent: "operator",
  topic: "arc raiders launch",
  summary: "New extraction shooter dropped today.",
  streamer_take: "Excited, will try it live.",
  counterpoints: ["might be buggy on day one"],
  discussion_hooks: ["compare to Tarkov"],
  triggers: ["arc raiders", "extraction shooter"],
  expires_at: null
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
  it("invalidates the cards query on success", async () => {
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
  });
});
