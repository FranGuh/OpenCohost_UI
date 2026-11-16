import { useEffect, useRef, useState } from "react";
import { useQueryClient, type QueryKey } from "@tanstack/react-query";
import {
  ACTIVE_DOWNLOAD_STATES,
  useModelDownloadAction,
  useModelDownloadsQuery,
  type ModelDownloadAction,
  type ModelDownloadJob
} from "../../../api/modelDownloads.js";
import { MODELS_QUERY_KEY, useModelsQuery } from "../../../api/models.js";
import { useEngineCommand } from "../../../api/engineCommand.js";
import type { StatusResponse } from "../../../api/client.js";
import { LLM_READINESS_QUERY_KEY } from "../../shared/useLlmReadiness.js";
import { Alert } from "../../../ui/Alert.js";
import { useT } from "../../../i18n/t.js";
import { DownloadProgress } from "./DownloadProgress.js";
import { requestErrorMessage } from "./downloadCopy.js";

export interface ModelDownloadsPanelProps {
  /** Switch to a freshly downloaded model. Defaults to this panel's own switch_model command. */
  onUseModel?: (tag: string) => void;
  /** Model currently in use by the surface hosting this panel (default: the LLM's current model). */
  currentModel?: string;
  /** Extra query keys invalidated when a download completes (besides the LLM models + readiness keys). */
  invalidateKeys?: readonly QueryKey[];
  /** Keep only the jobs this surface owns (e.g. vision models). Default: every relevant job. */
  jobFilter?: (job: ModelDownloadJob) => boolean;
  /** External tag currently activating when the parent owns switch_model (e.g. ModelCard). */
  activatingTag?: string | null;
}

function matchesCurrentModel(status: StatusResponse, target: string): boolean {
  return status.current_model === target;
}

/** Jobs worth showing: anything in flight or resumable, plus the newest job when it just completed. */
function visibleJobs(jobs: ModelDownloadJob[]): ModelDownloadJob[] {
  return jobs.filter(
    (job, index) =>
      ACTIVE_DOWNLOAD_STATES.has(job.state) ||
      job.state === "paused" ||
      job.state === "failed" ||
      (index === 0 && job.state === "completed")
  );
}

/**
 * Container for in-app model downloads (ADR-063): polls GET
 * /api/models/downloads (only while a job is active — see
 * useModelDownloadsQuery), renders one DownloadProgress row per relevant job,
 * a "Download interrupted — Resume" prompt for jobs an app exit left paused,
 * and wires pause/resume/cancel.
 *
 * On completion the backend does NOT activate the model: this panel refreshes
 * the models + readiness queries so the model becomes selectable, and offers
 * "Use this model" through the existing switch_model engine command.
 */
export function ModelDownloadsPanel({
  onUseModel,
  currentModel,
  invalidateKeys,
  jobFilter,
  activatingTag = null
}: ModelDownloadsPanelProps = {}) {
  const t = useT();
  const queryClient = useQueryClient();
  const { data } = useModelDownloadsQuery();
  const { data: models } = useModelsQuery();
  const action = useModelDownloadAction();
  const switchCommand = useEngineCommand<string>(matchesCurrentModel);

  const lastStates = useRef(new Map<string, string>());
  const maxPercent = useRef(new Map<string, number>());
  const [resumedIds, setResumedIds] = useState<ReadonlySet<string>>(new Set());
  const [localSwitchingTag, setLocalSwitchingTag] = useState<string | null>(null);

  useEffect(() => {
    if (!switchCommand.pending) setLocalSwitchingTag(null);
  }, [switchCommand.pending]);

  const jobs = data?.jobs ?? [];

  useEffect(() => {
    if (!data) return;
    let completedNow = false;
    const dropped: string[] = [];
    for (const job of data.jobs) {
      const previous = lastStates.current.get(job.id);
      if (job.state === "completed" && previous !== undefined && previous !== "completed") completedNow = true;
      lastStates.current.set(job.id, job.state);

      if (job.percent !== null) {
        const seen = maxPercent.current.get(job.id);
        // Ollama resumes from its last persisted checkpoint, which can be
        // lower than what was on screen (T1: 70% -> 40% after a crash).
        if (seen !== undefined && job.percent < seen && ACTIVE_DOWNLOAD_STATES.has(job.state)) dropped.push(job.id);
        maxPercent.current.set(job.id, Math.max(seen ?? 0, job.percent));
      }
    }
    if (dropped.length > 0) {
      setResumedIds((current) => {
        if (dropped.every((id) => current.has(id))) return current;
        return new Set([...current, ...dropped]);
      });
    }
    if (completedNow) {
      void queryClient.invalidateQueries({ queryKey: MODELS_QUERY_KEY });
      void queryClient.invalidateQueries({ queryKey: LLM_READINESS_QUERY_KEY });
      for (const queryKey of invalidateKeys ?? []) void queryClient.invalidateQueries({ queryKey });
    }
  }, [data, queryClient, invalidateKeys]);

  function runAction(job: ModelDownloadJob, kind: ModelDownloadAction) {
    if (kind === "resume" && job.interrupted) {
      setResumedIds((current) => new Set([...current, job.id]));
    }
    action.mutate({ id: job.id, action: kind });
  }

  function useModel(tag: string) {
    if (onUseModel) onUseModel(tag);
    else {
      setLocalSwitchingTag(tag);
      void switchCommand.run("switch_model", tag);
    }
  }

  const activeModel = currentModel ?? models?.current_model;
  const effectiveActivatingTag = activatingTag ?? (switchCommand.pending ? localSwitchingTag : null);
  // Filter after visibleJobs so "newest job just completed" still means newest overall.
  const relevant = visibleJobs(jobs);
  const shown = jobFilter ? relevant.filter(jobFilter) : relevant;
  if (shown.length === 0 && !action.error) return null;

  return (
    <section aria-label={t("models.download.title")} className="flex flex-col gap-2">
      {action.error && (
        <p role="alert" className="text-xs leading-relaxed text-danger">
          {requestErrorMessage(action.error, t)}
        </p>
      )}
      {shown.map((job) => {
        const byId = (id: string) => jobs.find((candidate) => candidate.id === id) ?? job;
        const row = (
          <DownloadProgress
            key={job.id}
            job={job}
            maxRetries={data?.max_retries ?? 0}
            showResumedNote={resumedIds.has(job.id)}
            busy={action.isPending && action.variables?.id === job.id}
            onPause={(id) => runAction(byId(id), "pause")}
            onResume={(id) => runAction(byId(id), "resume")}
            onCancel={(id) => runAction(byId(id), "cancel")}
            activating={effectiveActivatingTag === job.tag}
            onUseModel={
              job.installed !== false && activeModel !== job.tag && !switchCommand.pending && !activatingTag
                ? useModel
                : undefined
            }
          />
        );
        if (job.state === "paused" && job.interrupted) {
          return (
            <div key={job.id} className="flex flex-col gap-2">
              <Alert tone="warn" title={t("models.download.interrupted.title")}>
                {t("models.download.interrupted.body", { tag: job.tag })}
              </Alert>
              {row}
            </div>
          );
        }
        return row;
      })}
    </section>
  );
}
