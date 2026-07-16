import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ApiError,
  ConflictError,
  NotFoundError,
  ValidationError,
  type StatusResponse,
  authFetch,
  getApiBaseUrl,
  getIdempotencyKey,
  getPerfiles,
  rotateIdempotencyKey,
  switchProfile
} from "./client.js";
import { useSwitchStore } from "../store/switchStore.js";
import { MODELS_QUERY_KEY } from "./models.js";
import { STATUS_QUERY_KEY } from "./status.js";

export const PROFILES_QUERY_KEY = ["perfiles"] as const;

/**
 * GET /api/perfiles/{name} response (opencohost/api/main.py ~613-627) — no
 * generated type yet (types.gen.ts snapshot predates this route). Hand-typed
 * from opencohost/api/models.py::ProfileDetailResponse. R8/D5: field-picked
 * — never chat content, only name/id/prompt/use_system. `id` is the stable
 * uuid memoria rows are stored keyed by (NOT the display name) — use it,
 * not `name`, for any /api/memoria/* call targeting this profile.
 * ponytail: keep in sync manually.
 */
export interface ProfileDetailResponse {
  name: string;
  id: string;
  prompt: string;
  use_system: boolean;
}

/** POST /api/perfiles body (opencohost/api/main.py ~629-650) — hand-typed
 * from ProfileCreateRequest. `use_system` defaults to `false` server-side
 * when omitted. ponytail: keep in sync manually. */
export interface ProfileCreateRequest {
  name: string;
  prompt: string;
  use_system?: boolean;
}

/** PUT /api/perfiles/{name} body (opencohost/api/main.py ~652-684) — hand-typed
 * from ProfileUpdateRequest. Every field is a PARTIAL update: an omitted
 * field leaves the stored value unchanged (`new_name` renames while
 * preserving the profile's stable on-disk id). ponytail: keep in sync manually. */
export interface ProfileUpdateRequest {
  new_name?: string;
  prompt?: string;
  use_system?: boolean;
}

/** DELETE /api/perfiles/{name} (opencohost/api/main.py ~686-702) has no
 * `response_model` — hand-typed from the literal `{"ok": True}` return,
 * same pattern as SwitchAccepted/CommandAccepted in client.ts.
 * ponytail: keep in sync manually. */
export interface DeleteProfileResponse {
  ok: true;
}

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

export async function getPerfil(name: string): Promise<ProfileDetailResponse> {
  const res = await fetch(`${getApiBaseUrl()}/api/perfiles/${encodeURIComponent(name)}`);
  if (res.status === 404) {
    throw new NotFoundError(await extractDetail(res, "profile not found"));
  }
  if (!res.ok) {
    throw new ApiError(`GET /api/perfiles/${name} failed with ${res.status}`, res.status);
  }
  return (await res.json()) as ProfileDetailResponse;
}

export async function createPerfil(body: ProfileCreateRequest): Promise<ProfileDetailResponse> {
  const res = await authFetch(`${getApiBaseUrl()}/api/perfiles`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

  if (res.status === 409) {
    throw new ConflictError(await extractDetail(res, "profile already exists"));
  }
  if (res.status === 422) {
    throw new ValidationError(await extractDetail(res, "invalid profile"));
  }
  if (res.status === 503) {
    throw new ApiError(await extractDetail(res, "profiles service unavailable"), 503);
  }
  if (!res.ok) {
    throw new ApiError(`POST /api/perfiles failed with ${res.status}`, res.status);
  }
  return (await res.json()) as ProfileDetailResponse;
}

export async function updatePerfil(name: string, body: ProfileUpdateRequest): Promise<ProfileDetailResponse> {
  const res = await authFetch(`${getApiBaseUrl()}/api/perfiles/${encodeURIComponent(name)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

  if (res.status === 404) {
    throw new NotFoundError(await extractDetail(res, "profile not found"));
  }
  if (res.status === 409) {
    throw new ConflictError(await extractDetail(res, "profile already exists"));
  }
  if (res.status === 422) {
    throw new ValidationError(await extractDetail(res, "invalid profile"));
  }
  if (res.status === 503) {
    throw new ApiError(await extractDetail(res, "profiles service unavailable"), 503);
  }
  if (!res.ok) {
    throw new ApiError(`PUT /api/perfiles/${name} failed with ${res.status}`, res.status);
  }
  return (await res.json()) as ProfileDetailResponse;
}

export async function deletePerfil(name: string): Promise<DeleteProfileResponse> {
  const res = await authFetch(`${getApiBaseUrl()}/api/perfiles/${encodeURIComponent(name)}`, { method: "DELETE" });

  if (res.status === 404) {
    throw new NotFoundError(await extractDetail(res, "profile not found"));
  }
  if (res.status === 409) {
    throw new ConflictError(await extractDetail(res, "cannot delete the last profile"));
  }
  if (res.status === 503) {
    throw new ApiError(await extractDetail(res, "profiles service unavailable"), 503);
  }
  if (!res.ok) {
    throw new ApiError(`DELETE /api/perfiles/${name} failed with ${res.status}`, res.status);
  }
  return (await res.json()) as DeleteProfileResponse;
}

export function useProfilesQuery() {
  return useQuery({
    queryKey: PROFILES_QUERY_KEY,
    queryFn: getPerfiles
  });
}

export function useSwitchProfileMutation() {
  const queryClient = useQueryClient();
  const setPending = useSwitchStore((state) => state.setPending);
  const clearPending = useSwitchStore((state) => state.clearPending);

  return useMutation({
    mutationFn: async ({ name }: { name: string }) => {
      // Design D5: Idempotency-Key is stable per switch INTENT (per target),
      // reused across retries. Key lives in client.ts's module-scope
      // registry (not a hook-local ref) so it can be rotated on
      // CONVERGENCE by usePollUntilApplied (see status.ts) — otherwise a
      // later re-switch to an already-converged target would replay the
      // completed command and never re-enqueue (F1).
      const key = getIdempotencyKey(name);
      return switchProfile(name, key);
    },
    // Item A event engine: detail is the profile NAME only — see
    // src/lib/appEvents.ts, the single privacy chokepoint.
    meta: { event: (variables) => ({ source: "profile", action: "switch", detail: (variables as { name: string }).name }) },
    onSuccess: (result, variables) => {
      const currentStatus = queryClient.getQueryData<StatusResponse>(STATUS_QUERY_KEY);
      if (currentStatus?.active_profile === variables.name) {
        // Target is already the active profile (no-op switch, or this
        // response is confirming a state that already converged) — resolve
        // cleanly instead of flashing "applying" with nothing to poll for.
        rotateIdempotencyKey(variables.name);
        clearPending();
        void queryClient.invalidateQueries({ queryKey: STATUS_QUERY_KEY });
        // S5: a profile switch (even this no-op/confirming case) can carry a
        // different active_model than what's cached — keep ModelCard in sync.
        void queryClient.invalidateQueries({ queryKey: MODELS_QUERY_KEY });
        return;
      }

      const pending = useSwitchStore.getState().pendingSwitch;
      if (pending?.name === variables.name && pending.commandId === result.command_id) {
        // R6: idempotent replay of an already-registered pending intent —
        // do not re-trigger a redundant "applying" transition.
        return;
      }

      // No optimistic active_profile write (design D6) — only local
      // queued/applying UI state; the poll in usePollUntilApplied confirms.
      setPending({ name: variables.name, commandId: result.command_id, status: "applying" });
      void queryClient.invalidateQueries({ queryKey: STATUS_QUERY_KEY });
      // S5: a profile switch changes the active model — ModelCard's
      // useModelsQuery must not stay stale (owner symptom: profile switch
      // showing a different model than StatusRail).
      void queryClient.invalidateQueries({ queryKey: MODELS_QUERY_KEY });
    },
    onError: (error, variables) => {
      if (error instanceof NotFoundError) {
        // Unknown profile: whatever was pending is now stale, drop it.
        clearPending();
        rotateIdempotencyKey(variables.name);
      } else if (error instanceof ConflictError) {
        // Regenerate the key so a manual retry is a fresh intent.
        rotateIdempotencyKey(variables.name);
      }
      // QueueFullError (429): keep the same key for manual retry, leave
      // pendingSwitch untouched — never flip to "applying" on error.
    }
  });
}

/** Hydrates ProfileEditor's fields from the real stored prompt/use_system
 * when editing an existing profile. `name: null` (create mode, or dialog
 * closed) disables the query — never fetches for a profile that doesn't
 * exist yet or while there's nothing to hydrate. */
export function useProfileDetailQuery(name: string | null) {
  return useQuery({
    queryKey: [...PROFILES_QUERY_KEY, name],
    queryFn: () => getPerfil(name as string),
    enabled: name !== null
  });
}

/**
 * Hover-preview variant of useProfileDetailQuery: fetches a profile's stored
 * prompt ONCE and caches it forever (`staleTime: Infinity`, generous `gcTime`)
 * keyed per profile name. The Sidebar hover card mounts this with `enabled`
 * true only while a card is open, so the first hover fetches and every later
 * hover of the same profile is a cache-only read — no repeated backend hit per
 * hover (owner constraint). Shares the `[perfiles, name]` key with
 * useProfileDetailQuery so a profile edit (which invalidates PROFILES_QUERY_KEY)
 * still refreshes the preview.
 */
export function usePerfilDetailQuery(name: string, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: [...PROFILES_QUERY_KEY, name],
    queryFn: () => getPerfil(name),
    enabled: options?.enabled ?? true,
    staleTime: Infinity,
    gcTime: 30 * 60 * 1000
  });
}

export function useCreateProfileMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createPerfil,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: PROFILES_QUERY_KEY });
    }
  });
}

export function useUpdateProfileMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ name, body }: { name: string; body: ProfileUpdateRequest }) => updatePerfil(name, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: PROFILES_QUERY_KEY });
    }
  });
}

export function useDeleteProfileMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deletePerfil,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: PROFILES_QUERY_KEY });
    }
  });
}
