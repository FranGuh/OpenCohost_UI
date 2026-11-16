import { useEffect, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Download, Loader2 } from "lucide-react";
import {
  useModelDownloadAction,
  useModelDownloadsQuery,
  useStartModelDownload
} from "../../api/modelDownloads.js";
import { MODELS_QUERY_KEY } from "../../api/models.js";
import { DownloadProgress } from "../models/downloads/DownloadProgress.js";
import { requestErrorMessage } from "../models/downloads/downloadCopy.js";
import { LLM_READINESS_QUERY_KEY } from "../shared/useLlmReadiness.js";
import { Alert } from "../../ui/Alert.js";
import type { BadgeTone } from "../../ui/Badge.js";
import { Button } from "../../ui/Button.js";
import { useT, type TKey } from "../../i18n/t.js";
import { ChoiceCard, type StepProps } from "./SetupSteps.js";
import type { LocalOllamaAvailability } from "./SetupSteps.js";
import {
  modelGroups,
  pickDefaultModel,
  type CatalogEntryLike,
  type EligibleModel,
  type HardwareFacts
} from "./setupMachine.js";

export interface ModelStepProps extends StepProps {
  catalog: Record<string, CatalogEntryLike>;
  catalogLoaded: boolean;
  hardware: HardwareFacts | null;
  recommended: string | null;
  installed: readonly string[];
  ollamaAvailability: LocalOllamaAvailability;
  activating?: boolean;
}

function badgeFor(model: EligibleModel): { key: TKey; tone: BadgeTone } | null {
  if (model.recommended) return { key: "setup.model.badge.recommended", tone: "info" };
  if (model.slowOnCpu) return { key: "setup.model.badge.slowCpu", tone: "warn" };
  if (!model.fits) return { key: "setup.model.badge.tooBig", tone: "warn" };
  return null;
}

/**
 * Local model picker in two groups: "Instalados" (every model Ollama has, in
 * the catalog or not, so the user can simply pick one) and "Para descargar"
 * (catalog models that fit this machine and are missing). Installs go through
 * the existing in-app downloads API, whose query polls only while a job is active.
 */
export function ModelStep({
  state,
  dispatch,
  catalog,
  catalogLoaded,
  hardware,
  recommended,
  installed,
  ollamaAvailability,
  activating = false
}: ModelStepProps) {
  const t = useT();
  const queryClient = useQueryClient();
  const engine = state.engine === "gpu" ? "gpu" : "cpu";
  const groups = useMemo(
    () => modelGroups(catalog, { engine, vramGb: hardware?.vramGb ?? 0, recommended, installed }),
    [catalog, engine, hardware?.vramGb, recommended, installed]
  );
  const all = useMemo(() => [...groups.installed, ...groups.downloadable], [groups]);

  const { data: downloads } = useModelDownloadsQuery();
  const startDownload = useStartModelDownload();
  const downloadAction = useModelDownloadAction();

  // Preselect once the lists are known; never override a pick that is still listed.
  useEffect(() => {
    if (state.model && all.some((model) => model.tag === state.model)) return;
    const pick = pickDefaultModel(groups);
    if (pick) dispatch({ type: "chooseModel", tag: pick.tag, installed: pick.installed });
  }, [all, groups, state.model, dispatch]);

  const selected = all.find((model) => model.tag === state.model) ?? null;
  const job = state.model ? downloads?.jobs.find((item) => item.tag === state.model) ?? null : null;
  const localOllamaUnavailable = ollamaAvailability === "missing" || ollamaAvailability === "offline";

  // A finished download makes the pick usable; refresh what "installed" means elsewhere too.
  useEffect(() => {
    if (job?.state === "completed" && job.installed !== false && !state.modelReady) {
      dispatch({ type: "modelInstalled", tag: job.tag });
      void queryClient.invalidateQueries({ queryKey: MODELS_QUERY_KEY });
      void queryClient.invalidateQueries({ queryKey: LLM_READINESS_QUERY_KEY });
    }
  }, [job, state.modelReady, dispatch, queryClient]);

  if (!catalogLoaded) {
    return <p className="text-sm text-muted-foreground">{t("setup.model.loading")}</p>;
  }

  function renderGroup(id: string, title: TKey, models: EligibleModel[]) {
    const headingId = `setup-model-group-${id}`;
    return (
      <section className="flex flex-col gap-2">
        <h3 id={headingId} className="text-[11px] font-semibold uppercase tracking-[0.09em] text-dim">
          {t(title)}
        </h3>
        <div role="group" aria-labelledby={headingId} className="flex flex-col gap-2">
          {models.map((model) => {
            const badge = badgeFor(model);
            return (
              <ChoiceCard
                key={model.tag}
                pressed={state.model === model.tag}
                pending={activating && state.model === model.tag}
                disabled={activating}
                onSelect={() => dispatch({ type: "chooseModel", tag: model.tag, installed: model.installed })}
                title={model.display}
                badge={badge ? t(badge.key) : null}
                badgeTone={badge?.tone}
              >
                {(model.desc || model.sizeGb !== null) && (
                  <span className="flex w-full flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                    <span>{model.desc}</span>
                    {model.sizeGb !== null && <span className="mono text-dim">{t("setup.model.size", { size: model.sizeGb })}</span>}
                  </span>
                )}
              </ChoiceCard>
            );
          })}
        </div>
      </section>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {ollamaAvailability === "missing" && (
        <Alert role="status" tone="warn">
          <span className="flex flex-col gap-2">
            <span>{t("setup.model.ollamaMissing")}</span>
            <span>{t("setup.engine.ollama.what")}</span>
          </span>
        </Alert>
      )}
      {ollamaAvailability === "offline" && (
        <Alert role="status" tone="warn">{t("setup.model.ollamaOffline")}</Alert>
      )}
      {ollamaAvailability === "unknown" && (
        <Alert role="status" tone="info">{t("setup.model.ollamaUnknown")}</Alert>
      )}

      {all.length === 0 && <Alert tone="info" role="status">{t("setup.model.empty")}</Alert>}
      {groups.installed.length > 0 && renderGroup("installed", "setup.model.group.installed", groups.installed)}
      {groups.downloadable.length > 0 && (
        <div className="flex flex-col gap-2">
          {renderGroup("download", "setup.model.group.download", groups.downloadable)}
          <p className="text-xs text-muted-foreground">
            {engine === "cpu" ? t("setup.model.hint.cpu") : t("setup.model.hint.gpu", { vram: hardware?.vramGb ?? 0 })}
          </p>
        </div>
      )}

      {selected && (
        <div aria-live="polite" className="flex flex-col gap-2.5">
          {activating ? (
            <p role="status" className="inline-flex items-center gap-2 text-sm font-medium text-info">
              <Loader2 size={14} className="shrink-0 animate-spin motion-reduce:animate-none" aria-hidden="true" />
              <span>{t("setup.model.activatingModel", { model: selected.display })}</span>
            </p>
          ) : state.modelReady ? (
            <p className="text-sm font-medium text-ok">{t("setup.model.ready", { model: selected.display })}</p>
          ) : (
            <div className="flex flex-col gap-2.5 rounded-md border border-border-soft bg-card p-3.5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-foreground">{t("setup.model.notInstalled", { model: selected.display })}</p>
                {(!job || job.state === "cancelled") && (
                  <Button
                    type="button"
                    variant="primary"
                    disabled={localOllamaUnavailable || startDownload.isPending}
                    onClick={() => startDownload.mutate(selected.tag)}
                  >
                    {startDownload.isPending ? (
                      <Loader2 size={14} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />
                    ) : (
                      <Download size={14} aria-hidden="true" />
                    )}
                    {startDownload.isPending ? t("setup.model.downloadStarting") : t("setup.model.download")}
                  </Button>
                )}
              </div>
              {startDownload.error && (
                <p role="alert" className="text-xs text-danger">
                  {requestErrorMessage(startDownload.error, t)}
                </p>
              )}
              {job && (
                <DownloadProgress
                  job={job}
                  maxRetries={downloads?.max_retries ?? 3}
                  showResumedNote={false}
                  busy={downloadAction.isPending}
                  onPause={(id) => downloadAction.mutate({ id, action: "pause" })}
                  onResume={(id) => downloadAction.mutate({ id, action: "resume" })}
                  onCancel={(id) => downloadAction.mutate({ id, action: "cancel" })}
                />
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
