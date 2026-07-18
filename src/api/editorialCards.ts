import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, ConflictError, NotFoundError, ValidationError, authFetch, getApiBaseUrl } from "./client.js";

async function extractDetail(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { detail?: string };
    return body.detail ?? fallback;
  } catch {
    // non-JSON error body — fall back to a generic message instead of
    // letting res.json() throw an opaque SyntaxError.
    return fallback;
  }
}

/**
 * POST /api/agent/cards body (opencohost/api/main.py::post_agent_card,
 * knowledge_cards_upload_20260718 WU2) — hand-typed from
 * opencohost/api/models.py::AgentCardRequest. `agent` is the literal
 * "operator" string from the UI (AgentName requires min_length=1).
 * ponytail: keep in sync manually.
 */
export interface EditorialCardCreateRequest {
  agent: string;
  topic: string;
  summary: string;
  streamer_take: string;
  counterpoints: string[];
  discussion_hooks: string[];
  triggers: string[];
  expires_at: string | null;
}

/** POST /api/agent/cards response — hand-typed from AgentCardResponse.
 * `demoted:true` means an existing ARMED/ACTIVE card was force-demoted
 * back to DRAFT by this upsert (design D5). ponytail: keep in sync
 * manually. */
export interface EditorialCardCreateResponse {
  id: string;
  topic_slug: string;
  status: string;
  demoted: boolean;
}

/** One row of GET /api/agent/cards — hand-typed from AgentCardListItem.
 * Light projection only (design D4): no summary/streamer_take/list
 * fields. ponytail: keep in sync manually. */
export interface EditorialCardListItem {
  id: string;
  topic: string;
  topic_slug: string;
  status: string;
  origin: string;
  expires_at: string | null;
  updated_at: string;
}

/** GET /api/agent/cards response — hand-typed from AgentCardsListResponse.
 * ponytail: keep in sync manually. */
export interface EditorialCardsListResponse {
  cards: EditorialCardListItem[];
}

/** POST /api/agent/cards/{card_id}/arm response — hand-typed from
 * AgentCardArmResponse. ponytail: keep in sync manually. */
export interface EditorialCardArmResponse {
  id: string;
  status: string;
}

/**
 * GET /api/agent/cards — light projection of every editorial card
 * (design D4: the route returns all statuses, the UI filters to
 * draft/armed). `/api/agent/*` requires a Bearer token unconditionally,
 * so this uses authFetch (unlike memoria's open GET routes).
 */
export async function listEditorialCards(): Promise<EditorialCardsListResponse> {
  const res = await authFetch(`${getApiBaseUrl()}/api/agent/cards`);
  if (!res.ok) {
    throw new ApiError(`GET /api/agent/cards failed with ${res.status}`, res.status);
  }
  return (await res.json()) as EditorialCardsListResponse;
}

/**
 * POST /api/agent/cards — creates or upserts a card. 422 covers every
 * dataclass validation failure (topic/summary/streamer_take length,
 * raw-dump rejection, bad expires_at); 503 is editorial_cards_unavailable
 * (store init/write failed).
 */
export async function postEditorialCard(
  body: EditorialCardCreateRequest
): Promise<EditorialCardCreateResponse> {
  const res = await authFetch(`${getApiBaseUrl()}/api/agent/cards`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (res.status === 422) {
    throw new ValidationError(await extractDetail(res, "invalid editorial card"));
  }
  if (res.status === 503) {
    throw new ApiError(await extractDetail(res, "editorial_cards_unavailable"), 503);
  }
  if (!res.ok) {
    throw new ApiError(`POST /api/agent/cards failed with ${res.status}`, res.status);
  }
  return (await res.json()) as EditorialCardCreateResponse;
}

/**
 * POST /api/agent/cards/{card_id}/arm — mirrors CLI arm semantics
 * (idempotent on an already-ARMED card). 404 = card gone, 409 = expired
 * or already USED/ACTIVE, 503 = store unavailable.
 */
export async function armEditorialCard(cardId: string): Promise<EditorialCardArmResponse> {
  const res = await authFetch(`${getApiBaseUrl()}/api/agent/cards/${encodeURIComponent(cardId)}/arm`, {
    method: "POST"
  });
  if (res.status === 404) {
    throw new NotFoundError(await extractDetail(res, "card_not_found"));
  }
  if (res.status === 409) {
    throw new ConflictError(await extractDetail(res, "card_not_armable"));
  }
  if (res.status === 503) {
    throw new ApiError(await extractDetail(res, "editorial_cards_unavailable"), 503);
  }
  if (!res.ok) {
    throw new ApiError(`POST /api/agent/cards/${cardId}/arm failed with ${res.status}`, res.status);
  }
  return (await res.json()) as EditorialCardArmResponse;
}

export function editorialCardsQueryKey() {
  return ["editorial-cards"] as const;
}

export function useCardsQuery() {
  return useQuery({ queryKey: editorialCardsQueryKey(), queryFn: listEditorialCards });
}

/** A new/re-armed card can change editorial_cards_by_status counts shown
 * in GET /api/memoria/stats (MemoryCard) — invalidate both. */
export function useCreateCardMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: postEditorialCard,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: editorialCardsQueryKey() });
      void queryClient.invalidateQueries({ queryKey: ["memoria-stats"] });
    }
  });
}

export function useArmCardMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: armEditorialCard,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: editorialCardsQueryKey() })
  });
}
