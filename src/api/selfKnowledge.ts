import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, authFetch, getApiBaseUrl } from "./client.js";

/**
 * Self-knowledge endpoints (opencohost/api/routers/self_knowledge.py) are newer
 * than the OpenAPI snapshot, so this module is hand-typed, the same
 * self-contained pattern as src/api/guardrails.ts.
 *
 * Older backends do not serve the route at all: a 404 (or a network error) is
 * a normal "not available" state for the caller, not a failure.
 */

export type SelfKnowledgeField = "enabled" | "viewers" | "creator" | "repository" | "description";

export interface SelfKnowledgeResponse {
  enabled: boolean;
  viewers: boolean;
  creator: string;
  repository: string;
  description: string;
  /** What Kira says while a field is empty; shown as a placeholder. */
  defaults: { creator: string; repository: string };
}

/** PUT is a partial update: only the keys present change. */
export type SelfKnowledgeUpdate = Partial<Omit<SelfKnowledgeResponse, "defaults">>;

export type SelfKnowledgeErrorCode = "unknown" | "invalid" | "too_long";

export interface SelfKnowledgeFieldError {
  field: string;
  code: SelfKnowledgeErrorCode;
}

/** 422 `{detail: "invalid_self_knowledge", errors: [{field, code}]}`. */
export class SelfKnowledgeValidationError extends ApiError {
  readonly errors: SelfKnowledgeFieldError[];
  constructor(errors: SelfKnowledgeFieldError[]) {
    super("invalid self knowledge", 422);
    this.name = "SelfKnowledgeValidationError";
    this.errors = errors;
  }
}

const PATH = "/api/self-knowledge";

export async function getSelfKnowledge(): Promise<SelfKnowledgeResponse> {
  const res = await authFetch(`${getApiBaseUrl()}${PATH}`);
  if (!res.ok) {
    throw new ApiError(`GET ${PATH} failed with ${res.status}`, res.status);
  }
  return (await res.json()) as SelfKnowledgeResponse;
}

export async function putSelfKnowledge(update: SelfKnowledgeUpdate): Promise<SelfKnowledgeResponse> {
  const res = await authFetch(`${getApiBaseUrl()}${PATH}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(update)
  });
  if (res.status === 422) {
    let errors: SelfKnowledgeFieldError[] = [];
    try {
      const parsed = (await res.json()) as { errors?: unknown };
      if (Array.isArray(parsed.errors)) errors = parsed.errors as SelfKnowledgeFieldError[];
    } catch {
      // non-JSON 422 body: surface the typed error with no detail
    }
    throw new SelfKnowledgeValidationError(errors);
  }
  if (!res.ok) {
    throw new ApiError(`PUT ${PATH} failed with ${res.status}`, res.status);
  }
  return (await res.json()) as SelfKnowledgeResponse;
}

export const SELF_KNOWLEDGE_QUERY_KEY = ["self-knowledge"] as const;

/** A missing route (404) or an unreachable backend (non-ApiError) means "not available here". */
export function isSelfKnowledgeUnavailable(error: unknown): boolean {
  return !(error instanceof ApiError) || error.status === 404;
}

export function useSelfKnowledgeQuery() {
  return useQuery({
    queryKey: SELF_KNOWLEDGE_QUERY_KEY,
    queryFn: getSelfKnowledge,
    // An absent route will not appear on retry; do not spam the backend.
    retry: false
  });
}

/**
 * Optimistic save: the cache flips immediately, rolls back to the snapshot on
 * any failure, and is replaced by the server's response on success.
 */
export function useSelfKnowledgeSave() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: putSelfKnowledge,
    onMutate: async (update: SelfKnowledgeUpdate) => {
      await queryClient.cancelQueries({ queryKey: SELF_KNOWLEDGE_QUERY_KEY });
      const previous = queryClient.getQueryData<SelfKnowledgeResponse>(SELF_KNOWLEDGE_QUERY_KEY);
      if (previous) queryClient.setQueryData<SelfKnowledgeResponse>(SELF_KNOWLEDGE_QUERY_KEY, { ...previous, ...update });
      return { previous };
    },
    onError: (_error, _update, context) => {
      if (context?.previous) queryClient.setQueryData(SELF_KNOWLEDGE_QUERY_KEY, context.previous);
    },
    onSuccess: (saved) => queryClient.setQueryData(SELF_KNOWLEDGE_QUERY_KEY, saved)
  });
}
