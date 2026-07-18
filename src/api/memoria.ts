import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ApiError,
  NotFoundError,
  ValidationError,
  authFetch,
  getApiBaseUrl,
  getMemoriaList,
  getMemoriaStats,
  postMemoriaPurge
} from "./client.js";
import type { MemoriaRowResponse } from "./client.js";

async function extractMemoriaDetail(res: Response, fallback: string): Promise<string> {
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
 * POST /api/memoria/flags body (opencohost/api/main.py ~788-821) — hand-typed
 * from opencohost/api/models.py::MemoriaFlagsRequest. Every flag is optional;
 * an omitted flag is left unchanged server-side. F5: pin/private promote
 * status='curated' in the store; un-pin never demotes; `inactive` never
 * touches status. ponytail: keep in sync manually.
 */
export interface MemoriaFlagsRequest {
  profile_id: string;
  id: string;
  pinned?: boolean;
  private?: boolean;
  inactive?: boolean;
}

/** POST /api/memoria/delete body (opencohost/api/main.py ~823-842) —
 * hand-typed from MemoriaDeleteRequest. Hard-deletes one row by id.
 * ponytail: keep in sync manually. */
export interface MemoriaDeleteRequest {
  profile_id: string;
  id: string;
}

/**
 * POST /api/memoria/update body (opencohost/api/main.py ~844-880) —
 * hand-typed from MemoriaUpdateRequest. R8: title/content flow INBOUND
 * only — the response never echoes them (MemoriaMutationResponse is
 * ok-only), read-back stays metadata-only via GET /api/memoria/list. The
 * handler strips + length-caps both (422 on empty or over max length)
 * before writing. ponytail: keep in sync manually.
 */
export interface MemoriaUpdateRequest {
  profile_id: string;
  id: string;
  title: string;
  content: string;
}

/** POST /api/memoria/{flags,delete,update,capture} response
 * (opencohost/api/main.py) — hand-typed from MemoriaMutationResponse. R8:
 * never echoes title/content. ponytail: keep in sync manually. */
export interface MemoriaMutationResponse {
  ok: boolean;
}

/**
 * POST /api/memoria/import body (opencohost/api/main.py::post_memoria_import,
 * memoria_import_20260718 WU3) — hand-typed from MemoriaImportRequest. Imports
 * an external-AI export (Gemini/ChatGPT/Obsidian/free label) into the active
 * profile's store as 'imported' rows. `content` flows INBOUND only; the
 * response never echoes it (counts-only, R8). ponytail: keep in sync manually.
 */
export interface MemoriaImportRequest {
  profile_id: string;
  source_label: string;
  content: string;
}

/**
 * POST /api/memoria/import response — hand-typed from MemoriaImportResponse.
 * Counts ONLY (R8), one field per per-item outcome of the four-state insert:
 * `imported` = fresh rows; `skipped_duplicates` = already-present claims;
 * `skipped_too_short` = too few significant tokens; `skipped_cap` = creatable
 * rows left unattempted because the profile's import-cap headroom ran out;
 * `failed` = fail-open store errors. `ok` is False for the disabled no-op or
 * when any item failed to write. ponytail: keep in sync manually.
 */
export interface MemoriaImportResponse {
  ok: boolean;
  imported: number;
  skipped_duplicates: number;
  skipped_too_short: number;
  skipped_cap: number;
  failed: number;
}

/**
 * POST /api/memoria/capture body (opencohost/api/main.py ~882-890) —
 * hand-typed from MemoriaCaptureRequest. `paused=true` pauses auto-capture,
 * `false` resumes it — calls host.motor.set_memorias_private(paused)
 * DIRECTLY, not via /api/commands (design resolution 2905/D3). ponytail:
 * keep in sync manually.
 */
export interface MemoriaCaptureRequest {
  paused: boolean;
}

/** GET/POST /api/memoria/notice response (opencohost/api/main.py ~892-904) —
 * hand-typed from MemoriaNoticeResponse. F1 disclosure-banner state; fails
 * open to `dismissed:false` (banner shows) when absent. ponytail: keep in
 * sync manually. */
export interface MemoriaNoticeResponse {
  dismissed: boolean;
}

/** POST /api/memoria/notice body — hand-typed from MemoriaNoticeRequest.
 * ponytail: keep in sync manually. */
export interface MemoriaNoticeRequest {
  dismissed: boolean;
}

/**
 * POST /api/memoria/flags — partial flag update. 422 when every flag is
 * omitted (no-op rejected server-side), 404 for a missing/wrong-profile row,
 * 503 for memoria_unavailable (store init failed) or memoria_write_failed
 * (a genuine write failure, never swallowed — F5 freeze rule depends on
 * this surfacing honestly).
 */
export async function postMemoriaFlags(body: MemoriaFlagsRequest): Promise<MemoriaMutationResponse> {
  const res = await authFetch(`${getApiBaseUrl()}/api/memoria/flags`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (res.status === 422) {
    throw new ValidationError(await extractMemoriaDetail(res, "no flags provided"));
  }
  if (res.status === 404) {
    throw new NotFoundError(await extractMemoriaDetail(res, "memoria not found"));
  }
  if (res.status === 503) {
    throw new ApiError(await extractMemoriaDetail(res, "memoria_unavailable"), 503);
  }
  if (!res.ok) {
    throw new ApiError(`POST /api/memoria/flags failed with ${res.status}`, res.status);
  }
  return (await res.json()) as MemoriaMutationResponse;
}

/**
 * POST /api/memoria/delete — hard-delete one row by id. 404 for a
 * missing/wrong-profile row (the handler's pre-check owns "already gone"),
 * 503 for memoria_unavailable or a genuine write failure.
 */
export async function postMemoriaDelete(body: MemoriaDeleteRequest): Promise<MemoriaMutationResponse> {
  const res = await authFetch(`${getApiBaseUrl()}/api/memoria/delete`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (res.status === 404) {
    throw new NotFoundError(await extractMemoriaDetail(res, "memoria not found"));
  }
  if (res.status === 503) {
    throw new ApiError(await extractMemoriaDetail(res, "memoria_unavailable"), 503);
  }
  if (!res.ok) {
    throw new ApiError(`POST /api/memoria/delete failed with ${res.status}`, res.status);
  }
  return (await res.json()) as MemoriaMutationResponse;
}

/**
 * POST /api/memoria/update — operator edit of one row's title/content. 422
 * when either field is empty (post-strip) or exceeds the server's max
 * length, 404 for a missing/wrong-profile row, 503 for memoria_unavailable
 * or a genuine write failure.
 */
export async function postMemoriaUpdate(body: MemoriaUpdateRequest): Promise<MemoriaMutationResponse> {
  const res = await authFetch(`${getApiBaseUrl()}/api/memoria/update`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (res.status === 422) {
    throw new ValidationError(await extractMemoriaDetail(res, "invalid memoria update"));
  }
  if (res.status === 404) {
    throw new NotFoundError(await extractMemoriaDetail(res, "memoria not found"));
  }
  if (res.status === 503) {
    throw new ApiError(await extractMemoriaDetail(res, "memoria_unavailable"), 503);
  }
  if (!res.ok) {
    throw new ApiError(`POST /api/memoria/update failed with ${res.status}`, res.status);
  }
  return (await res.json()) as MemoriaMutationResponse;
}

/**
 * POST /api/memoria/import — bulk-import an external export into the active
 * profile's store. 422 covers every boundary refusal (empty content, oversize
 * >64KB, >100 parsed items, source_label >40 chars, or the profile already at
 * the import cap); 503 is memoria_unavailable (store down or the cap read
 * failed). A 200 always carries the per-item counts — including partial
 * outcomes like skipped_cap/failed — so the caller reports the real result,
 * never a fake all-or-nothing. Mirrors postMemoriaUpdate's error posture minus
 * the 404 (import has no row lookup).
 */
export async function postMemoriaImport(body: MemoriaImportRequest): Promise<MemoriaImportResponse> {
  const res = await authFetch(`${getApiBaseUrl()}/api/memoria/import`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (res.status === 422) {
    throw new ValidationError(await extractMemoriaDetail(res, "invalid memoria import"));
  }
  if (res.status === 503) {
    throw new ApiError(await extractMemoriaDetail(res, "memoria_unavailable"), 503);
  }
  if (!res.ok) {
    throw new ApiError(`POST /api/memoria/import failed with ${res.status}`, res.status);
  }
  return (await res.json()) as MemoriaImportResponse;
}

/**
 * POST /api/memoria/capture — session-scoped auto-capture pause/resume
 * toggle. No dedicated error branch server-side beyond the gated
 * ok:false no-op, so any non-2xx is a generic ApiError.
 */
export async function postMemoriaCapture(body: MemoriaCaptureRequest): Promise<MemoriaMutationResponse> {
  const res = await authFetch(`${getApiBaseUrl()}/api/memoria/capture`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    throw new ApiError(`POST /api/memoria/capture failed with ${res.status}`, res.status);
  }
  return (await res.json()) as MemoriaMutationResponse;
}

/** GET /api/memoria/notice — F1 disclosure-banner dismissed state. Fails
 * open to `dismissed:false` server-side, so any non-2xx here is an honest
 * transport/server error, not a banner-state fallback. */
export async function getMemoriaNotice(): Promise<MemoriaNoticeResponse> {
  const res = await fetch(`${getApiBaseUrl()}/api/memoria/notice`);
  if (!res.ok) {
    throw new ApiError(`GET /api/memoria/notice failed with ${res.status}`, res.status);
  }
  return (await res.json()) as MemoriaNoticeResponse;
}

/** POST /api/memoria/notice — sets the F1 disclosure-banner dismissed
 * state. Re-reads from disk server-side, so the response reflects actual
 * persisted state even if the underlying save swallowed a write error. */
export async function postMemoriaNotice(body: MemoriaNoticeRequest): Promise<MemoriaNoticeResponse> {
  const res = await authFetch(`${getApiBaseUrl()}/api/memoria/notice`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    throw new ApiError(`POST /api/memoria/notice failed with ${res.status}`, res.status);
  }
  return (await res.json()) as MemoriaNoticeResponse;
}

/**
 * FIX-A: the stats query is now per-profile — the key carries `profileId` so
 * the counts refetch (and invalidate) alongside the per-profile memoria list,
 * keeping the headline count and the row list in agreement. An empty
 * `profileId` (null active profile) still fetches global counts.
 */
export function memoriaStatsQueryKey(profileId: string) {
  return ["memoria-stats", profileId] as const;
}

export function useMemoriaStatsQuery(profileId: string) {
  return useQuery({
    queryKey: memoriaStatsQueryKey(profileId),
    queryFn: () => getMemoriaStats(profileId)
  });
}

export function memoriaListQueryKey(profileId: string) {
  return ["memoria-list", profileId] as const;
}

export function useMemoriaListQuery(profileId: string) {
  return useQuery({
    queryKey: memoriaListQueryKey(profileId),
    queryFn: () => getMemoriaList(profileId),
    enabled: Boolean(profileId)
  });
}

/**
 * GET /api/memoria/row/{id} — one row's full content (WU-H, operator
 * viewing decision, 2026-07-05). 404 for a missing/wrong-profile row
 * (identical body to the mutation endpoints' ownership guard), 503 for
 * memoria_unavailable. Content is NEVER fetched implicitly — only
 * useMemoriaRowQuery's manual refetch() (or a direct call to this
 * function) triggers the request.
 */
export async function getMemoriaRow(rowId: string, profileId: string): Promise<MemoriaRowResponse> {
  const res = await fetch(
    `${getApiBaseUrl()}/api/memoria/row/${encodeURIComponent(rowId)}?profile_id=${encodeURIComponent(profileId)}`
  );
  if (res.status === 404) {
    throw new NotFoundError(await extractMemoriaDetail(res, "memoria not found"));
  }
  if (res.status === 503) {
    throw new ApiError(await extractMemoriaDetail(res, "memoria_unavailable"), 503);
  }
  if (!res.ok) {
    throw new ApiError(`GET /api/memoria/row/${rowId} failed with ${res.status}`, res.status);
  }
  return (await res.json()) as MemoriaRowResponse;
}

export function memoriaRowQueryKey(profileId: string, rowId: string) {
  return ["memoria-row", profileId, rowId] as const;
}

/**
 * Lazy, click-to-load query for one row's content — `enabled: false` so
 * mounting a row NEVER fires the request; the caller (MemoryCard's "Ver
 * memoria" button) triggers the fetch by calling the returned `refetch()`.
 * This keeps GET /api/memoria/list content-free by construction: content
 * only ever loads on an explicit operator action, never on render.
 */
export function useMemoriaRowQuery(profileId: string, rowId: string) {
  return useQuery({
    queryKey: memoriaRowQueryKey(profileId, rowId),
    queryFn: () => getMemoriaRow(rowId, profileId),
    enabled: false
  });
}

/** Purge is destructive — empty the list cache AND invalidate the per-profile
 * stats so the headline counts refetch alongside the emptied list (mirrors the
 * flags/delete mutations). Without the stats invalidation the headline count
 * stays stale above an already-emptied list — the exact FIX-A inconsistency. */
export function useMemoriaPurgeMutation(profileId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => postMemoriaPurge(profileId),
    onSuccess: () => {
      queryClient.setQueryData(memoriaListQueryKey(profileId), { items: [] });
      void queryClient.invalidateQueries({ queryKey: memoriaStatsQueryKey(profileId) });
    }
  });
}

/** Flags mutate pinned/private/inactive on one row — invalidate both the
 * row list (flags/updated_at change) and the stats (pinned count changes). */
export function useMemoriaFlagsMutation(profileId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (flags: { id: string; pinned?: boolean; private?: boolean; inactive?: boolean }) =>
      postMemoriaFlags({ profile_id: profileId, ...flags }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: memoriaListQueryKey(profileId) });
      void queryClient.invalidateQueries({ queryKey: memoriaStatsQueryKey(profileId) });
    }
  });
}

/** Delete is destructive for one row — invalidate both the row list and the
 * stats (saved_memorias/pinned counts change). */
export function useMemoriaDeleteMutation(profileId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => postMemoriaDelete({ profile_id: profileId, id }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: memoriaListQueryKey(profileId) });
      void queryClient.invalidateQueries({ queryKey: memoriaStatsQueryKey(profileId) });
    }
  });
}

/** Import creates new 'imported' rows (and may skip duplicates/short/capped) —
 * both the row list AND the saved/pinned counts can change, so invalidate the
 * list and the stats (same shape as the delete mutation). */
export function useMemoriaImportMutation(profileId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { source_label: string; content: string }) =>
      postMemoriaImport({ profile_id: profileId, ...input }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: memoriaListQueryKey(profileId) });
      void queryClient.invalidateQueries({ queryKey: memoriaStatsQueryKey(profileId) });
    }
  });
}

/** Update edits title/content only — counts don't change, but
 * revision/updated_at do, so invalidate the row list (never the stats).
 * The lazy row query is enabled:false, so invalidating it would NOT refetch —
 * the stale cached content would seed the next edit of this row and silently
 * revert the save. Write the saved title/content straight into the row cache
 * instead so a re-edit sees the current values. */
export function useMemoriaUpdateMutation(profileId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, title, content }: { id: string; title: string; content: string }) =>
      postMemoriaUpdate({ profile_id: profileId, id, title, content }),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: memoriaListQueryKey(profileId) });
      queryClient.setQueryData(
        memoriaRowQueryKey(profileId, variables.id),
        (old: MemoriaRowResponse | undefined) =>
          old ? { ...old, title: variables.title, content: variables.content } : old
      );
    }
  });
}

/** Capture pause/resume is a session-scoped motor toggle — no persisted
 * row/count changes, so no query invalidation. */
export function useMemoriaCaptureMutation() {
  return useMutation({
    mutationFn: (paused: boolean) => postMemoriaCapture({ paused })
  });
}

export const MEMORIA_NOTICE_QUERY_KEY = ["memoria-notice"] as const;

export function useMemoriaNoticeQuery() {
  return useQuery({
    queryKey: MEMORIA_NOTICE_QUERY_KEY,
    queryFn: getMemoriaNotice
  });
}

/** Writes the returned dismissed state straight into the cache (mirrors
 * avatar/obs config mutations) — no full refetch needed for a single flag. */
export function useMemoriaNoticeMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: postMemoriaNotice,
    onSuccess: (data) => {
      queryClient.setQueryData(MEMORIA_NOTICE_QUERY_KEY, data);
    }
  });
}
