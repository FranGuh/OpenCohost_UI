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

export interface VrmModelItem {
  filename: string;
  size_mb: number;
  modified_at: number;
  /** Additive: the bundled Kira v3 (always listed, whatever the folder). */
  bundled?: boolean;
}

/** Embedded author thumbnail of a VRM (404 when the file has none). Plain
 * `<img src>` is enough: /api/avatar/vrm/model and /list are fetched without
 * an auth header too. */
export function vrmThumbnailUrl(name: string): string {
  return `${getApiBaseUrl()}/api/avatar/vrm/thumbnail?name=${encodeURIComponent(name)}`;
}

export const VRM_MODELS_QUERY_KEY = ["avatar", "vrm", "models"] as const;

export async function getVrmModels(): Promise<VrmModelItem[]> {
  const res = await fetch(`${getApiBaseUrl()}/api/avatar/vrm/list`);
  if (!res.ok) {
    throw new ApiError(`GET /api/avatar/vrm/list failed with ${res.status}`, res.status);
  }
  return (await res.json()) as VrmModelItem[];
}

export function useVrmModelsQuery(options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: VRM_MODELS_QUERY_KEY,
    queryFn: getVrmModels,
    staleTime: 10_000,
    enabled: options.enabled ?? true
  });
}


export type VrmFolderSource = "saved" | "env" | "default";

export interface VrmFolderInfo {
  path: string;
  source: VrmFolderSource;
  exists: boolean;
  model_count: number;
}

/** A refused folder choice; `code` is the server's stable enum (422/503 `detail`). */
export class VrmFolderError extends ApiError {
  readonly code: string;
  constructor(code: string, status: number) {
    super(code, status);
    this.name = "VrmFolderError";
    this.code = code;
  }
}

export const VRM_FOLDER_QUERY_KEY = ["avatar", "vrm", "folder"] as const;

async function readFolderResponse(res: Response, what: string): Promise<VrmFolderInfo> {
  if (res.ok) return (await res.json()) as VrmFolderInfo;
  let code = "";
  try {
    const body = (await res.json()) as { detail?: unknown };
    if (typeof body.detail === "string") code = body.detail;
  } catch {
    // non-JSON error body: fall through to the generic error.
  }
  if (code) throw new VrmFolderError(code, res.status);
  throw new ApiError(`${what} failed with ${res.status}`, res.status);
}

export async function getVrmFolder(): Promise<VrmFolderInfo> {
  return readFolderResponse(await authFetch(`${getApiBaseUrl()}/api/avatar/vrm/folder`), "GET /api/avatar/vrm/folder");
}

export async function putVrmFolder(path: string): Promise<VrmFolderInfo> {
  const res = await authFetch(`${getApiBaseUrl()}/api/avatar/vrm/folder`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path })
  });
  return readFolderResponse(res, "PUT /api/avatar/vrm/folder");
}

export async function deleteVrmFolder(): Promise<VrmFolderInfo> {
  const res = await authFetch(`${getApiBaseUrl()}/api/avatar/vrm/folder`, { method: "DELETE" });
  return readFolderResponse(res, "DELETE /api/avatar/vrm/folder");
}

export function useVrmFolderQuery(options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: VRM_FOLDER_QUERY_KEY,
    queryFn: getVrmFolder,
    staleTime: 10_000,
    enabled: options.enabled ?? true
  });
}

/** Set or reset the folder. The model list is refetched at once: the server
 * resolves the folder per request, so no restart is involved. */
function useFolderMutation<V>(fn: (v: V) => Promise<VrmFolderInfo>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (data) => {
      queryClient.setQueryData(VRM_FOLDER_QUERY_KEY, data);
      void queryClient.invalidateQueries({ queryKey: VRM_MODELS_QUERY_KEY });
    }
  });
}

export function useSetVrmFolderMutation() {
  return useFolderMutation<string>(putVrmFolder);
}

export function useResetVrmFolderMutation() {
  return useFolderMutation<void>(() => deleteVrmFolder());
}
