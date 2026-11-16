import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useUiLocale } from "../i18n/locale.js";
import { primaryLocale } from "./profiles.js";
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

function normalizeLocale(locale?: string): string | undefined {
  const trimmed = locale?.trim();
  if (!trimmed) return undefined;
  return primaryLocale(trimmed) || undefined;
}

function withLocale(path: string, locale?: string): string {
  const normalized = normalizeLocale(locale);
  return normalized ? `${path}?locale=${encodeURIComponent(normalized)}` : path;
}

export async function getPersonalization(locale?: string): Promise<PersonalizationResponse> {
  const res = await fetch(withLocale(`${getApiBaseUrl()}/api/personalization`, locale));
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
export async function putPersonalization(
  body: PersonalizationUpdateRequest,
  locale?: string
): Promise<PersonalizationResponse> {
  const res = await authFetch(withLocale(`${getApiBaseUrl()}/api/personalization`, locale), {
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
export async function deletePersonalization(locale?: string): Promise<ClearPersonalizationResponse> {
  const res = await authFetch(withLocale(`${getApiBaseUrl()}/api/personalization`, locale), {
    method: "DELETE"
  });
  if (res.status === 503) {
    throw new ApiError(await extractDetail(res, "personalization_write_failed"), 503);
  }
  if (!res.ok) {
    throw new ApiError(`DELETE /api/personalization failed with ${res.status}`, res.status);
  }
  return (await res.json()) as ClearPersonalizationResponse;
}

export function personalizationQueryKey(locale: string) {
  return [...PERSONALIZATION_QUERY_KEY, normalizeLocale(locale) ?? locale] as const;
}

export function usePersonalizationQuery(localeArg?: string, options: { enabled?: boolean } = {}) {
  const { locale: activeLocale } = useUiLocale();
  const locale = normalizeLocale(localeArg) ?? activeLocale;
  return useQuery({
    queryKey: personalizationQueryKey(locale),
    queryFn: () => getPersonalization(locale),
    enabled: options.enabled ?? true
  });
}

/** Writes the returned document straight into the cache (mirrors
 * useUpdateAvatarConfigMutation) — no full refetch needed after a save. */
export function useUpdatePersonalizationMutation(localeArg?: string) {
  const { locale: activeLocale } = useUiLocale();
  const locale = normalizeLocale(localeArg) ?? activeLocale;
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: PersonalizationUpdateRequest) => putPersonalization(body, locale),
    onSuccess: (data) => {
      queryClient.setQueryData(personalizationQueryKey(locale), data);
    }
  });
}

/** Clear only returns `{ok: true}` (no document), so invalidate instead of
 * setQueryData — the refetch picks up the real cleared defaults from GET
 * (mirrors useMemoriaPurgeMutation's stats invalidation). */
export function useClearPersonalizationMutation(localeArg?: string) {
  const { locale: activeLocale } = useUiLocale();
  const locale = normalizeLocale(localeArg) ?? activeLocale;
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => deletePersonalization(locale),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: personalizationQueryKey(locale) });
    }
  });
}
