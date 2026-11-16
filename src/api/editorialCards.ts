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
  single_use?: boolean;
  /** Verified-facts fields of an active card; omitted when empty. */
  must_say?: string[];
  forbidden_claims?: string[];
  discount_code?: string;
  link?: string;
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
  single_use: boolean;
  /** Several cards may be active at once; absent on older backends. */
  active?: boolean;
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
 * (design D4: the route returns all statuses; the UI groups them with a
 * status filter). `/api/agent/*` requires a Bearer token unconditionally,
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

/** Arming a card can change editorial_cards_by_status counts shown in
 * GET /api/memoria/stats (MemoryCard) — invalidate both, same as create. */
export function useArmCardMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: armEditorialCard,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: editorialCardsQueryKey() });
      void queryClient.invalidateQueries({ queryKey: ["memoria-stats"] });
    }
  });
}

// ---------------------------------------------------------------------------
// Active cards (operator routes in opencohost/api/routers/active_cards.py).
// Hand-typed from opencohost/api/models.py::ActiveCard*. ponytail: keep in sync.
// ---------------------------------------------------------------------------

/** GET /api/editorial/cards/{id} — ActiveCardOut. */
export interface ActiveCard {
  id: string;
  topic: string;
  topic_slug: string;
  status: string;
  origin: string;
  summary: string;
  streamer_take: string;
  active: boolean;
  single_use: boolean;
  must_say: string[];
  forbidden_claims: string[];
  discount_code: string;
  link: string;
  updated_at: string;
}

/** PUT /api/editorial/cards/{id}/fields body — only the keys sent change. */
export interface ActiveCardFieldsUpdate {
  must_say?: string[];
  forbidden_claims?: string[];
  discount_code?: string;
  link?: string;
}

/** The connected backend predates the active card routes (route-missing 404
 * or network failure). The rest of the editorial pane must keep working. */
export class ActiveCardUnavailableError extends ApiError {
  constructor() {
    super("active card routes not available in this backend", 404);
    this.name = "ActiveCardUnavailableError";
  }
}

async function cardFetch(path: string, init?: RequestInit): Promise<Response> {
  try {
    return await authFetch(`${getApiBaseUrl()}/api/editorial/cards${path}`, init);
  } catch {
    throw new ActiveCardUnavailableError();
  }
}

/** Maps the shared error shapes of active_cards.py: 404 card_not_found, 409
 * state refusal (card_not_activatable, card_not_disableable), 422 dataclass
 * message, 503 store error. Any other 404 means the route itself is missing. */
async function cardJson<T>(res: Response, what: string): Promise<T> {
  if (res.ok) return (await res.json()) as T;
  const detail = await extractDetail(res, what);
  if (res.status === 404) {
    if (detail === "card_not_found") throw new NotFoundError(detail);
    throw new ActiveCardUnavailableError();
  }
  if (res.status === 409) throw new ConflictError(detail);
  if (res.status === 422) throw new ValidationError(detail);
  throw new ApiError(detail === what ? `${what} failed with ${res.status}` : detail, res.status);
}

const jsonInit = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body)
});

export async function getActiveCard(cardId: string): Promise<ActiveCard> {
  const res = await cardFetch(`/${encodeURIComponent(cardId)}`);
  return cardJson<ActiveCard>(res, "GET card");
}

export async function putActiveCardFields(cardId: string, body: ActiveCardFieldsUpdate): Promise<ActiveCard> {
  const res = await cardFetch(`/${encodeURIComponent(cardId)}/fields`, jsonInit("PUT", body));
  return cardJson<ActiveCard>(res, "PUT card fields");
}

export async function activateEditorialCard(cardId: string): Promise<{ id: string; active: boolean }> {
  const res = await cardFetch(`/${encodeURIComponent(cardId)}/activate`, { method: "POST" });
  return cardJson(res, "activate card");
}

export async function deactivateEditorialCard(cardId: string): Promise<{ id: string; active: boolean }> {
  const res = await cardFetch(`/${encodeURIComponent(cardId)}/deactivate`, { method: "POST" });
  return cardJson(res, "deactivate card");
}

export async function disableEditorialCard(cardId: string): Promise<{ id: string; status: string }> {
  const res = await cardFetch(`/${encodeURIComponent(cardId)}/disable`, { method: "POST" });
  return cardJson(res, "disable card");
}

export async function deleteEditorialCard(cardId: string): Promise<{ id: string; deleted: boolean }> {
  const res = await cardFetch(`/${encodeURIComponent(cardId)}`, { method: "DELETE" });
  return cardJson(res, "delete card");
}

function useCardAction<TArg, TRes>(fn: (arg: TArg) => Promise<TRes>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: editorialCardsQueryKey() });
      void queryClient.invalidateQueries({ queryKey: ["memoria-stats"] });
    }
  });
}

export const useActivateCardMutation = () => useCardAction(activateEditorialCard);
export const useDeactivateCardMutation = () => useCardAction(deactivateEditorialCard);
export const useDisableCardMutation = () => useCardAction(disableEditorialCard);
export const useDeleteCardMutation = () => useCardAction(deleteEditorialCard);
export const useSaveCardFieldsMutation = () =>
  useCardAction(({ id, fields }: { id: string; fields: ActiveCardFieldsUpdate }) => putActiveCardFields(id, fields));
