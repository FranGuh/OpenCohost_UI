import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, authFetch, getApiBaseUrl } from "./client.js";

/**
 * Output guardrail policy endpoints (opencohost/api/routers/guardrails.py)
 * are newer than the OpenAPI snapshot, so this module is hand-typed, the same
 * self-contained pattern as src/api/pronunciation.ts.
 *
 * `tier` is data: the UI renders controls from it and never hardcodes which
 * rule ids are toggleable. Unknown ids and categories must stay renderable.
 */

export type GuardrailTier = "locked" | "toggleable";
export type GuardrailCategory = "safety" | "persona" | "style";

export interface GuardrailRule {
  id: string;
  tier: GuardrailTier;
  category: GuardrailCategory;
  enabled: boolean;
}

export interface GuardrailsResponse {
  rules: GuardrailRule[];
}

export type GuardrailErrorCode = "unknown" | "locked" | "invalid";

export interface GuardrailFieldError {
  id: string;
  code: GuardrailErrorCode;
}

/** 422 `{detail: "invalid_guardrails", errors: [{id, code}]}`. */
export class GuardrailsValidationError extends ApiError {
  readonly errors: GuardrailFieldError[];
  constructor(errors: GuardrailFieldError[]) {
    super("invalid guardrails", 422);
    this.name = "GuardrailsValidationError";
    this.errors = errors;
  }
}

const PATH = "/api/guardrails";

export async function getGuardrails(): Promise<GuardrailsResponse> {
  const res = await authFetch(`${getApiBaseUrl()}${PATH}`);
  if (!res.ok) {
    throw new ApiError(`GET ${PATH} failed with ${res.status}`, res.status);
  }
  return (await res.json()) as GuardrailsResponse;
}

/** Full replace: `disabled` is the complete list of disabled rule ids. */
export async function putGuardrails(disabled: string[]): Promise<GuardrailsResponse> {
  const res = await authFetch(`${getApiBaseUrl()}${PATH}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ disabled })
  });
  if (res.status === 422) {
    let errors: GuardrailFieldError[] = [];
    try {
      const parsed = (await res.json()) as { errors?: unknown };
      if (Array.isArray(parsed.errors)) errors = parsed.errors as GuardrailFieldError[];
    } catch {
      // non-JSON 422 body: surface the typed error with no detail
    }
    throw new GuardrailsValidationError(errors);
  }
  if (!res.ok) {
    throw new ApiError(`PUT ${PATH} failed with ${res.status}`, res.status);
  }
  return (await res.json()) as GuardrailsResponse;
}

export const GUARDRAILS_QUERY_KEY = ["guardrails"] as const;

export function useGuardrailsQuery() {
  return useQuery({ queryKey: GUARDRAILS_QUERY_KEY, queryFn: getGuardrails });
}

/**
 * Optimistic save: the cache flips immediately, rolls back to the snapshot on
 * any failure, and is replaced by the server's response on success.
 */
export function useGuardrailsSave() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: putGuardrails,
    onMutate: async (disabled: string[]) => {
      await queryClient.cancelQueries({ queryKey: GUARDRAILS_QUERY_KEY });
      const previous = queryClient.getQueryData<GuardrailsResponse>(GUARDRAILS_QUERY_KEY);
      if (previous) {
        queryClient.setQueryData<GuardrailsResponse>(GUARDRAILS_QUERY_KEY, {
          rules: previous.rules.map((r) => (r.tier === "toggleable" ? { ...r, enabled: !disabled.includes(r.id) } : r))
        });
      }
      return { previous };
    },
    onError: (_error, _disabled, context) => {
      if (context?.previous) queryClient.setQueryData(GUARDRAILS_QUERY_KEY, context.previous);
    },
    onSuccess: (saved) => queryClient.setQueryData(GUARDRAILS_QUERY_KEY, saved)
  });
}
