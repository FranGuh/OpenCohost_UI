import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, ValidationError, authFetch, getApiBaseUrl } from "./client.js";
import { useAvatarImageVersion } from "../store/avatarImageVersion.js";

/** Client-side mirror of the server's MAX_UPLOAD_BYTES (authoritative check
 * stays server-side). Guards BEFORE base64 inflation (~+33%): without this a
 * 1GB pick renamed .png would OOM the webview before the 413 can fire. */
export const MAX_AVATAR_UPLOAD_BYTES = 10 * 1024 * 1024;

/**
 * GET/PUT /api/avatar/config (opencohost/api/main.py ~705-729) predates
 * types.gen.ts's OpenAPI generation, so it has no generated type — hand-typed
 * from opencohost/api/models.py::AvatarConfigResponse/AvatarConfigRequest.
 * `state_images` is a plain path map; raw-byte uploads go through
 * POST /api/avatar/upload (`uploadAvatarImage`).
 * ponytail: keep in sync manually if those models change.
 */
export interface AvatarConfigResponse {
  enabled: boolean;
  mode: string;
  assets_folder: string;
  state_images: Record<string, string>;
}

export interface AvatarUploadBody {
  state: string;
  filename: string;
  content_b64: string;
}

/** Served-image URL for an avatar state (GET /api/avatar/image?state=). The
 * server resolves map → user dir → bundled defaults with ETag revalidation,
 * so this URL is the webview-safe way to paint user-uploaded art. `version`
 * (from useAvatarImageVersion) busts the cache after a re-upload of the same
 * state, which otherwise yields the identical string and never repaints. */
export function avatarImageUrl(state: string, version = 0): string {
  const base = `${getApiBaseUrl()}/api/avatar/image?state=${encodeURIComponent(state)}`;
  return version > 0 ? `${base}&v=${version}` : base;
}

async function fileToBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/** Upload raw image bytes for one avatar state (POST /api/avatar/upload).
 * JSON+base64 on purpose — no multipart endpoint exists server-side. */
export async function uploadAvatarImage(state: string, file: File): Promise<AvatarConfigResponse> {
  if (file.size > MAX_AVATAR_UPLOAD_BYTES) {
    throw new ValidationError(`Image too large (cap ${MAX_AVATAR_UPLOAD_BYTES} bytes)`);
  }
  const body: AvatarUploadBody = { state, filename: file.name, content_b64: await fileToBase64(file) };
  const res = await authFetch(`${getApiBaseUrl()}/api/avatar/upload`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

  if (res.status === 422 || res.status === 413) {
    let detail = "invalid avatar image";
    try {
      const errBody = (await res.json()) as { detail?: string };
      detail = errBody.detail ?? detail;
    } catch {
      // non-JSON error body — fall back to a generic message.
    }
    throw new ValidationError(detail);
  }
  if (!res.ok) {
    throw new ApiError(`POST /api/avatar/upload failed with ${res.status}`, res.status);
  }
  return (await res.json()) as AvatarConfigResponse;
}

export type AvatarConfigRequest = Partial<Omit<AvatarConfigResponse, "assets_folder">>;

export const AVATAR_CONFIG_QUERY_KEY = ["avatar-config"] as const;

export async function getAvatarConfig(): Promise<AvatarConfigResponse> {
  const res = await fetch(`${getApiBaseUrl()}/api/avatar/config`);
  if (!res.ok) {
    throw new ApiError(`GET /api/avatar/config failed with ${res.status}`, res.status);
  }
  return (await res.json()) as AvatarConfigResponse;
}

export async function putAvatarConfig(body: AvatarConfigRequest): Promise<AvatarConfigResponse> {
  const res = await authFetch(`${getApiBaseUrl()}/api/avatar/config`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

  if (res.status === 422) {
    let detail = "invalid avatar config";
    try {
      const errBody = (await res.json()) as { detail?: string };
      detail = errBody.detail ?? detail;
    } catch {
      // non-JSON 422 body — fall back to a generic message.
    }
    throw new ValidationError(detail);
  }
  if (!res.ok) {
    throw new ApiError(`PUT /api/avatar/config failed with ${res.status}`, res.status);
  }
  return (await res.json()) as AvatarConfigResponse;
}

export function useAvatarConfigQuery() {
  return useQuery({
    queryKey: AVATAR_CONFIG_QUERY_KEY,
    queryFn: getAvatarConfig
  });
}

export function useUpdateAvatarConfigMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: putAvatarConfig,
    onSuccess: (data) => {
      queryClient.setQueryData(AVATAR_CONFIG_QUERY_KEY, data);
    }
  });
}

export function useUploadAvatarImageMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ state, file }: { state: string; file: File }) => uploadAvatarImage(state, file),
    onSuccess: (data, { state }) => {
      queryClient.setQueryData(AVATAR_CONFIG_QUERY_KEY, data);
      // Repaint KiraCover even when the served URL string is unchanged
      // (same-state re-upload) — see avatarImageVersion.ts.
      useAvatarImageVersion.getState().bump(state);
    }
  });
}
