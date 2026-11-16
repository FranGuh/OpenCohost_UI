import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, authFetch, getApiBaseUrl } from "./client.js";

/**
 * In-app model downloads (model-download-manager T4, ADR-063). Hand-typed 1:1
 * with opencohost/api/models.py::ModelDownloadJob / ModelDownloadsResponse /
 * HfQuantsResponse — same snapshot-lag pattern as llmProvider.ts (no
 * generated type; openapi.snapshot.json predates these routes).
 * ponytail: keep in sync manually if those models change.
 *
 * Progress numbers come from Ollama's pull stream. After a resume they restart
 * from Ollama's own checkpoint, which after a crash can be LOWER than the last
 * value shown (T1 spike: 70% -> 40%). The UI renders what the backend reports
 * and never promises the pre-pause percent.
 */
export type ModelDownloadState =
  | "queued"
  | "downloading"
  | "paused"
  | "retrying"
  | "completed"
  | "failed"
  | "cancelled";

export type ModelDownloadPhase = "manifest" | "pulling" | "verifying" | "writing" | "success";

export type ModelDownloadErrorCategory = "network" | "not_found" | "rejected" | "disk_full" | "pull_error" | "internal";

export interface ModelDownloadJob {
  id: string;
  tag: string;
  state: ModelDownloadState;
  phase: ModelDownloadPhase | string | null;
  total_bytes: number | null;
  completed_bytes: number | null;
  percent: number | null;
  speed_bps: number | null;
  eta_seconds: number | null;
  attempt: number;
  retries_used: number;
  error_category: ModelDownloadErrorCategory | string | null;
  /** Exception class name only — never upstream text. */
  error_type: string | null;
  /** True after an app exit/crash left the job paused; cleared by resume. */
  interrupted: boolean;
  installed: boolean | null;
  created_at: number;
  updated_at: number;
}

export interface ModelDownloadsResponse {
  /** Newest first. */
  jobs: ModelDownloadJob[];
  active_job_id: string | null;
  max_retries: number;
}

export type HfVramFit = "fits" | "tight" | "too_large" | "unknown";

export interface HfQuant {
  quant: string;
  size_bytes: number;
  file_count: number;
  /** Ready-to-pull `hf.co/<owner>/<repo>:<quant>` tag. */
  tag: string;
  vram_fit: HfVramFit;
}

export interface HfQuantsResponse {
  owner: string;
  repo: string;
  vram_mb: number | null;
  quants: HfQuant[];
}

export interface HfRepoRef {
  owner: string;
  repo: string;
}

export type ModelDownloadAction = "pause" | "resume" | "cancel";

export const MODEL_DOWNLOADS_QUERY_KEY = ["modelDownloads"] as const;
export const HF_QUANTS_QUERY_KEY = ["hfQuants"] as const;

/** States in which the backend is actively working a job — the only states that poll. */
export const ACTIVE_DOWNLOAD_STATES: ReadonlySet<ModelDownloadState> = new Set(["queued", "downloading", "retrying"]);

const POLL_INTERVAL_MS = 1000;

/**
 * A backend error with the machine `detail` string (`download_active`,
 * `invalid_tag`, `ollama_unreachable`, `job_not_found`, `invalid_transition`,
 * `hf_repo_not_found`, `hf_unavailable`, `invalid_hf_repo`, ...). The UI maps
 * `detail` to i18n copy; it never renders it raw.
 */
export class ModelDownloadApiError extends ApiError {
  readonly detail: string;
  readonly activeJobId: string | null;

  constructor(detail: string, status: number, activeJobId: string | null = null) {
    super(detail, status);
    this.name = "ModelDownloadApiError";
    this.detail = detail;
    this.activeJobId = activeJobId;
  }
}

async function toApiError(res: Response, fallback: string): Promise<ModelDownloadApiError> {
  try {
    const body = (await res.json()) as { detail?: unknown; active_job_id?: unknown };
    const detail = typeof body.detail === "string" ? body.detail : fallback;
    const active = typeof body.active_job_id === "string" ? body.active_job_id : null;
    return new ModelDownloadApiError(detail, res.status, active);
  } catch {
    // Non-JSON error body — fall back instead of letting res.json() throw.
    return new ModelDownloadApiError(fallback, res.status);
  }
}

const HF_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/**
 * Accepts `owner/repo`, `hf.co/owner/repo[:quant]` or a (http[s]://)huggingface.co
 * URL with any trailing path/query, and returns the owner/repo pair. The
 * backend's 422 `invalid_hf_repo` stays the authority; this only drives the
 * request and an inline hint.
 */
export function normalizeHfRepo(input: string): HfRepoRef | null {
  let value = input.trim();
  if (!value) return null;
  value = value.replace(/^https?:\/\//i, "");
  const hostMatch = /^(?:www\.)?(huggingface\.co|hf\.co)\//i.exec(value);
  if (hostMatch) {
    value = value.slice(hostMatch[0].length);
  } else if (/^[^/]+\.[^/]+\//.test(value) && value.split("/").length > 2) {
    // Some other host (example.com/owner/repo) — not a Hugging Face reference.
    return null;
  }
  value = value.split(/[?#]/)[0];
  const [owner, rawRepo] = value.split("/");
  if (!owner || !rawRepo) return null;
  const repo = rawRepo.split(":")[0];
  if (!HF_NAME.test(owner) || !HF_NAME.test(repo)) return null;
  return { owner, repo };
}

const MIB = 1024 * 1024;
const GIB = 1024 * MIB;

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes)) return "—";
  if (bytes <= 0) return "0 MB";
  if (bytes >= GIB) return `${(bytes / GIB).toFixed(2)} GB`;
  return `${(bytes / MIB).toFixed(1)} MB`;
}

export function formatSpeed(bytesPerSecond: number | null | undefined): string {
  if (bytesPerSecond === null || bytesPerSecond === undefined || !Number.isFinite(bytesPerSecond)) return "—";
  return `${(bytesPerSecond / MIB).toFixed(1)} MB/s`;
}

export function formatEta(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds) || seconds < 0) return "—";
  const total = Math.round(seconds);
  if (total < 60) return `${total}s`;
  const pad = (n: number) => String(n).padStart(2, "0");
  if (total < 3600) return `${Math.floor(total / 60)}m ${pad(total % 60)}s`;
  return `${Math.floor(total / 3600)}h ${pad(Math.floor((total % 3600) / 60))}m`;
}

export function downloadsNeedPolling(data: ModelDownloadsResponse | undefined): boolean {
  return Boolean(data?.jobs.some((job) => ACTIVE_DOWNLOAD_STATES.has(job.state)));
}

/** GET /api/models/downloads — the progress poll target. */
export async function getModelDownloads(): Promise<ModelDownloadsResponse> {
  const res = await fetch(`${getApiBaseUrl()}/api/models/downloads`);
  if (!res.ok) throw await toApiError(res, `GET /api/models/downloads failed with ${res.status}`);
  return (await res.json()) as ModelDownloadsResponse;
}

/** POST /api/models/downloads — 202 job | 409 download_active | 422 invalid_tag | 503 ollama_unreachable. */
export async function startModelDownload(tag: string): Promise<ModelDownloadJob> {
  const res = await authFetch(`${getApiBaseUrl()}/api/models/downloads`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tag })
  });
  if (!res.ok) throw await toApiError(res, "download_start_failed");
  return (await res.json()) as ModelDownloadJob;
}

/** POST /api/models/downloads/{id}/pause|resume|cancel. */
export async function postModelDownloadAction(id: string, action: ModelDownloadAction): Promise<ModelDownloadJob> {
  const res = await authFetch(
    `${getApiBaseUrl()}/api/models/downloads/${encodeURIComponent(id)}/${action}`,
    { method: "POST" }
  );
  if (!res.ok) throw await toApiError(res, `download_${action}_failed`);
  return (await res.json()) as ModelDownloadJob;
}

/** GET /api/models/hf/{owner}/{repo}/quants — 404 hf_repo_not_found | 502 hf_unavailable | 422 invalid_hf_repo. */
export async function getHfQuants({ owner, repo }: HfRepoRef): Promise<HfQuantsResponse> {
  const res = await fetch(
    `${getApiBaseUrl()}/api/models/hf/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/quants`
  );
  if (!res.ok) throw await toApiError(res, "hf_unavailable");
  return (await res.json()) as HfQuantsResponse;
}

/**
 * Polls every ~1s ONLY while some job is queued/downloading/retrying; idle
 * otherwise. Keeps its cadence while the window is backgrounded, like every
 * other live-state poll (see backgroundPolling.test.ts).
 */
export function useModelDownloadsQuery() {
  return useQuery({
    queryKey: MODEL_DOWNLOADS_QUERY_KEY,
    queryFn: getModelDownloads,
    refetchInterval: (query) => (downloadsNeedPolling(query.state.data) ? POLL_INTERVAL_MS : false),
    refetchIntervalInBackground: true
  });
}

/** Starting a job (or hitting 409) refreshes the list so the poll picks it up. */
export function useStartModelDownload() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: startModelDownload,
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: MODEL_DOWNLOADS_QUERY_KEY });
    }
  });
}

export function useModelDownloadAction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, action }: { id: string; action: ModelDownloadAction }) => postModelDownloadAction(id, action),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: MODEL_DOWNLOADS_QUERY_KEY });
    }
  });
}

export function useHfQuantsQuery(ref: HfRepoRef | null) {
  return useQuery({
    queryKey: [...HF_QUANTS_QUERY_KEY, ref?.owner ?? "", ref?.repo ?? ""],
    queryFn: () => getHfQuants(ref as HfRepoRef),
    enabled: ref !== null,
    retry: false,
    staleTime: 5 * 60 * 1000
  });
}
