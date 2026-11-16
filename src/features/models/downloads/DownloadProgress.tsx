import { Loader2, Pause, Play, X } from "lucide-react";
import {
  ACTIVE_DOWNLOAD_STATES,
  formatBytes,
  formatEta,
  formatSpeed,
  type ModelDownloadJob,
  type ModelDownloadState
} from "../../../api/modelDownloads.js";
import { Badge, type BadgeTone } from "../../../ui/Badge.js";
import { Button } from "../../../ui/Button.js";
import { useT, type TKey } from "../../../i18n/t.js";
import { jobErrorMessage, phaseLabel } from "./downloadCopy.js";

export interface DownloadProgressProps {
  job: ModelDownloadJob;
  maxRetries: number;
  /** The backend resumed from Ollama's last checkpoint (percent dropped or the job was interrupted). */
  showResumedNote: boolean;
  /** An action for this job is in flight. */
  busy: boolean;
  onPause: (id: string) => void;
  onResume: (id: string) => void;
  onCancel: (id: string) => void;
  /** Offered on a completed job; omitted when the model is already active. */
  onUseModel?: (tag: string) => void;
  /** True while this downloaded model is being activated via switch_model. */
  activating?: boolean;
}

const STATE_KEYS: Record<ModelDownloadState, TKey> = {
  queued: "models.download.state.queued",
  downloading: "models.download.state.downloading",
  paused: "models.download.state.paused",
  retrying: "models.download.state.retrying",
  completed: "models.download.state.completed",
  failed: "models.download.state.failed",
  cancelled: "models.download.state.cancelled"
};

const STATE_TONES: Record<ModelDownloadState, BadgeTone> = {
  queued: "info",
  downloading: "info",
  paused: "neutral",
  retrying: "warn",
  completed: "ok",
  failed: "danger",
  cancelled: "neutral"
};

const RESUMABLE: ReadonlySet<ModelDownloadState> = new Set(["paused", "failed"]);

/**
 * Presentational progress row for one download job. Renders exactly what the
 * backend reports — including a percent LOWER than before after a resume
 * (Ollama restarts from its last persisted checkpoint).
 */
export function DownloadProgress({
  job,
  maxRetries,
  showResumedNote,
  busy,
  onPause,
  onResume,
  onCancel,
  onUseModel,
  activating = false
}: DownloadProgressProps) {
  const t = useT();
  const isActive = ACTIVE_DOWNLOAD_STATES.has(job.state);
  const canResume = RESUMABLE.has(job.state);
  const canCancel = isActive || canResume;
  const canUse = job.state === "completed" && (Boolean(onUseModel) || activating);
  const percent = job.percent === null ? null : Math.max(0, Math.min(100, Math.floor(job.percent)));
  const phase = isActive ? phaseLabel(job.phase, t) : null;

  return (
    <div className="flex flex-col gap-2 rounded-md border border-border-soft bg-surface-2 p-3 text-xs">
      <div className="flex items-center justify-between gap-2">
        <span className="mono truncate font-semibold text-foreground">{job.tag}</span>
        <Badge tone={STATE_TONES[job.state]}>{t(STATE_KEYS[job.state])}</Badge>
      </div>

      {job.state !== "cancelled" && (
        <div className="flex flex-col gap-1">
          <div
            role="progressbar"
            aria-label={t("models.download.progressAria", { tag: job.tag })}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent ?? undefined}
            className="h-1.5 w-full overflow-hidden rounded-full bg-card"
          >
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-fast ease-io"
              style={{ width: `${percent ?? 0}%` }}
            />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-muted-foreground">
            <span className="flex items-center gap-2">
              {percent !== null && <span className="font-semibold text-foreground">{`${percent}%`}</span>}
              {phase && <span>{phase}</span>}
            </span>
            {job.total_bytes !== null && (
              <span className="mono">
                {t("models.download.bytes", {
                  done: formatBytes(job.completed_bytes ?? 0),
                  total: formatBytes(job.total_bytes)
                })}
              </span>
            )}
          </div>
          {isActive && (job.speed_bps !== null || job.eta_seconds !== null) && (
            <div className="flex items-center justify-between gap-3 text-muted-foreground">
              <span className="mono">{formatSpeed(job.speed_bps)}</span>
              {job.eta_seconds !== null && <span>{t("models.download.eta", { eta: formatEta(job.eta_seconds) })}</span>}
            </div>
          )}
        </div>
      )}

      {job.state === "retrying" && (
        <p className="font-medium text-warn">{t("models.download.retrying", { n: job.retries_used, max: maxRetries })}</p>
      )}

      {showResumedNote && isActive && <p className="text-muted-foreground">{t("models.download.resumedNote")}</p>}

      {job.state === "failed" && (
        <p role="alert" className="text-danger">
          {jobErrorMessage(job, t)}
        </p>
      )}

      {job.state === "completed" && <p className="text-ok">{t("models.download.installed", { tag: job.tag })}</p>}

      {(canCancel || canUse) && (
        <div className="flex flex-wrap items-center justify-end gap-2">
          {isActive && (
            <Button variant="outline" className="h-7 px-2.5 text-xs" disabled={busy} onClick={() => onPause(job.id)}>
              <Pause size={12} aria-hidden="true" />
              {t("models.download.pause")}
            </Button>
          )}
          {canResume && (
            <Button variant="primary" className="h-7 px-2.5 text-xs" disabled={busy} onClick={() => onResume(job.id)}>
              <Play size={12} aria-hidden="true" />
              {t("models.download.resume")}
            </Button>
          )}
          {canCancel && (
            <Button variant="ghost" className="h-7 px-2.5 text-xs" disabled={busy} onClick={() => onCancel(job.id)}>
              <X size={12} aria-hidden="true" />
              {t("models.download.cancel")}
            </Button>
          )}
          {canUse && (onUseModel || activating) && (
            <Button
              variant="primary"
              className="h-7 px-2.5 text-xs disabled:cursor-not-allowed disabled:opacity-70"
              disabled={activating}
              onClick={() => onUseModel?.(job.tag)}
            >
              {activating && (
                <Loader2 size={12} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />
              )}
              {activating ? t("models.download.activating") : t("models.download.useModel")}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
