import { ModelDownloadApiError, type ModelDownloadJob } from "../../../api/modelDownloads.js";
import type { TKey } from "../../../i18n/t.js";

type Translate = (key: TKey, vars?: Record<string, string | number>) => string;

/**
 * Backend `detail` / `error_category` strings map to fixed i18n keys. Raw
 * backend text (and `error_type`, an exception class name) is never rendered.
 */
const JOB_ERROR_KEYS: Record<string, TKey> = {
  network: "models.download.error.network",
  not_found: "models.download.error.not_found",
  rejected: "models.download.error.rejected",
  disk_full: "models.download.error.disk_full",
  pull_error: "models.download.error.pull_error",
  internal: "models.download.error.internal"
};

const REQUEST_ERROR_KEYS: Record<string, TKey> = {
  download_active: "models.download.error.downloadActive",
  invalid_tag: "models.download.error.invalidTag",
  ollama_unreachable: "models.download.error.ollamaUnreachable",
  job_not_found: "models.download.error.jobNotFound",
  invalid_transition: "models.download.error.invalidTransition"
};

const HF_ERROR_KEYS: Record<string, TKey> = {
  invalid_hf_repo: "models.hf.error.invalid_hf_repo",
  hf_repo_not_found: "models.hf.error.hf_repo_not_found",
  hf_unavailable: "models.hf.error.hf_unavailable"
};

const PHASE_KEYS: Record<string, TKey> = {
  manifest: "models.download.phase.manifest",
  pulling: "models.download.phase.pulling",
  verifying: "models.download.phase.verifying",
  writing: "models.download.phase.writing",
  success: "models.download.phase.success"
};

export function jobErrorMessage(job: ModelDownloadJob, t: Translate): string {
  const key = job.error_category ? JOB_ERROR_KEYS[job.error_category] : undefined;
  return t(key ?? "models.download.error.unknown");
}

export function requestErrorMessage(error: unknown, t: Translate): string {
  const key = error instanceof ModelDownloadApiError ? REQUEST_ERROR_KEYS[error.detail] : undefined;
  return t(key ?? "models.download.error.generic");
}

export function hfErrorMessage(error: unknown, t: Translate): string {
  const key = error instanceof ModelDownloadApiError ? HF_ERROR_KEYS[error.detail] : undefined;
  return t(key ?? "models.hf.error.generic");
}

export function phaseLabel(phase: string | null, t: Translate): string | null {
  const key = phase ? PHASE_KEYS[phase] : undefined;
  return key ? t(key) : null;
}
