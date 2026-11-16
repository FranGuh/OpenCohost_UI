import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useUiLocale } from "../i18n/locale.js";
import { primaryLocale } from "./profiles.js";
import { ApiError, authFetch, getApiBaseUrl } from "./client.js";

/**
 * TTS pronunciation dictionary endpoints (opencohost/api/routers/i18n_tts.py)
 * are newer than the OpenAPI snapshot, so this module is hand-typed, the same
 * self-contained pattern as src/api/ptt.ts and src/api/speech.ts.
 *
 * PRIVACY: dictionary entries never appear in an error message.
 */

export interface PronunciationEntry {
  match: string;
  replace: string;
}

export interface PronunciationLimits {
  max_entries: number;
  match_max: number;
  replace_max: number;
}

export interface PronunciationResponse {
  entries: PronunciationEntry[];
  limits: PronunciationLimits;
}

export type PronunciationErrorField = "match" | "replace" | "entries";
export type PronunciationErrorCode =
  | "too_many_entries"
  | "not_list"
  | "not_object"
  | "not_string"
  | "empty"
  | "too_long"
  | "duplicate"
  | "forbidden_char";

export interface PronunciationFieldError {
  index: number;
  field: PronunciationErrorField;
  code: PronunciationErrorCode;
}

/** 422 `{detail: "invalid_pronunciation", errors: [...]}`. */
export class PronunciationValidationError extends ApiError {
  readonly errors: PronunciationFieldError[];
  constructor(errors: PronunciationFieldError[]) {
    super("invalid pronunciation dictionary", 422);
    this.name = "PronunciationValidationError";
    this.errors = errors;
  }
}

const PATH = "/api/tts/pronunciation";

function normalizeLocale(locale?: string): string | undefined {
  const trimmed = locale?.trim();
  if (!trimmed) return undefined;
  return primaryLocale(trimmed) || undefined;
}

function withLocale(url: string, locale?: string): string {
  const normalized = normalizeLocale(locale);
  return normalized ? `${url}?locale=${encodeURIComponent(normalized)}` : url;
}

export async function getPronunciation(locale?: string): Promise<PronunciationResponse> {
  const res = await authFetch(withLocale(`${getApiBaseUrl()}${PATH}`, locale));
  if (!res.ok) {
    throw new ApiError(`GET ${PATH} failed with ${res.status}`, res.status);
  }
  return (await res.json()) as PronunciationResponse;
}

export async function putPronunciation(
  entries: PronunciationEntry[],
  locale?: string
): Promise<PronunciationResponse> {
  const res = await authFetch(withLocale(`${getApiBaseUrl()}${PATH}`, locale), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ entries })
  });
  if (res.status === 422) {
    let errors: PronunciationFieldError[] = [];
    try {
      const parsed = (await res.json()) as { errors?: unknown };
      if (Array.isArray(parsed.errors)) errors = parsed.errors as PronunciationFieldError[];
    } catch {
      // non-JSON 422 body: surface the typed error with no field detail
    }
    throw new PronunciationValidationError(errors);
  }
  if (!res.ok) {
    throw new ApiError(`PUT ${PATH} failed with ${res.status}`, res.status);
  }
  return (await res.json()) as PronunciationResponse;
}

export const PRONUNCIATION_QUERY_KEY = ["tts", "pronunciation"] as const;

export function pronunciationQueryKey(locale: string) {
  return [...PRONUNCIATION_QUERY_KEY, normalizeLocale(locale) ?? locale] as const;
}

export function usePronunciationQuery(localeArg?: string, options: { enabled?: boolean } = {}) {
  const { locale: activeLocale } = useUiLocale();
  const locale = normalizeLocale(localeArg) ?? activeLocale;
  return useQuery({
    queryKey: pronunciationQueryKey(locale),
    queryFn: () => getPronunciation(locale),
    enabled: options.enabled ?? true
  });
}

export function usePronunciationSave(localeArg?: string) {
  const { locale: activeLocale } = useUiLocale();
  const locale = normalizeLocale(localeArg) ?? activeLocale;
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (entries: PronunciationEntry[]) => putPronunciation(entries, locale),
    onSuccess: (saved) => queryClient.setQueryData(pronunciationQueryKey(locale), saved)
  });
}
