import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, ValidationError, authFetch, getApiBaseUrl } from "./client.js";

/**
 * GET/PUT/DELETE /api/personalization (opencohost/api/main.py ~851-915,
 * kira_personalization_onboarding_20260705 Phase 2) has no generated type
 * yet — hand-typed from opencohost/api/models.py::PersonalizationResponse/
 * PersonalizationUpdateRequest. Global (profile-independent) store — see
 * design.md §1/§4. Field caps mirror opencohost/config/settings.py's
 * PERSONALIZATION_*_MAX constants. ponytail: keep in sync manually.
 */
export interface PersonalizationResponse {
  enabled: boolean;
  nickname: string;
  occupation: string;
  interests: string;
  custom_instructions: string;
  updated_at: string | null;
}

export type PersonalizationUpdateRequest = Partial<Omit<PersonalizationResponse, "updated_at">>;

/** DELETE /api/personalization response — hand-typed from the literal
 * `{"ok": True}` return (main.py:915), same shape as DeleteProfileResponse. */
export interface ClearPersonalizationResponse {
  ok: true;
}

export const PERSONALIZATION_NICKNAME_MAX = 60;
export const PERSONALIZATION_OCCUPATION_MAX = 120;
export const PERSONALIZATION_INTERESTS_MAX = 240;
export const PERSONALIZATION_INSTRUCTIONS_MAX = 400;

export const PERSONALIZATION_QUERY_KEY = ["personalization"] as const;

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

export async function getPersonalization(): Promise<PersonalizationResponse> {
  const res = await fetch(`${getApiBaseUrl()}/api/personalization`);
  if (!res.ok) {
    throw new ApiError(`GET /api/personalization failed with ${res.status}`, res.status);
  }
  return (await res.json()) as PersonalizationResponse;
}

/**
 * PUT /api/personalization — partial update, every field optional (an
 * omitted field leaves the stored value unchanged server-side). 422 per
 * field cap violation (main.py:871-885), 503 on a genuine write failure
 * (`personalization_write_failed`, never swallowed).
 */
export async function putPersonalization(body: PersonalizationUpdateRequest): Promise<PersonalizationResponse> {
  const res = await authFetch(`${getApiBaseUrl()}/api/personalization`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (res.status === 422) {
    throw new ValidationError(await extractDetail(res, "invalid personalization"));
  }
  if (res.status === 503) {
    throw new ApiError(await extractDetail(res, "personalization_write_failed"), 503);
  }
  if (!res.ok) {
    throw new ApiError(`PUT /api/personalization failed with ${res.status}`, res.status);
  }
  return (await res.json()) as PersonalizationResponse;
}

/** DELETE /api/personalization — clears the store to empty defaults (the
 * "clear personalization" purge action). 503 on a genuine write failure. */
export async function deletePersonalization(): Promise<ClearPersonalizationResponse> {
  const res = await authFetch(`${getApiBaseUrl()}/api/personalization`, { method: "DELETE" });
  if (res.status === 503) {
    throw new ApiError(await extractDetail(res, "personalization_write_failed"), 503);
  }
  if (!res.ok) {
    throw new ApiError(`DELETE /api/personalization failed with ${res.status}`, res.status);
  }
  return (await res.json()) as ClearPersonalizationResponse;
}

export function usePersonalizationQuery() {
  return useQuery({
    queryKey: PERSONALIZATION_QUERY_KEY,
    queryFn: getPersonalization
  });
}

/** Writes the returned document straight into the cache (mirrors
 * useUpdateAvatarConfigMutation) — no full refetch needed after a save. */
export function useUpdatePersonalizationMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: putPersonalization,
    onSuccess: (data) => {
      queryClient.setQueryData(PERSONALIZATION_QUERY_KEY, data);
    }
  });
}

/** Clear only returns `{ok: true}` (no document), so invalidate instead of
 * setQueryData — the refetch picks up the real cleared defaults from GET
 * (mirrors useMemoriaPurgeMutation's stats invalidation). */
export function useClearPersonalizationMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deletePersonalization,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: PERSONALIZATION_QUERY_KEY });
    }
  });
}
