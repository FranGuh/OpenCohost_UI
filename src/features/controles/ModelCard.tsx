import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { useModelsQuery, useUpdateModelContextMutation, useUpdateModelReasoningMutation } from "../../api/models.js";
import { useStatusQuery } from "../../api/status.js";
import { useLlmReadiness } from "../shared/useLlmReadiness.js";
import { useEngineCommand } from "../../api/engineCommand.js";
import type { StatusResponse } from "../../api/client.js";
import { Card } from "../../ui/Card.js";
import { Badge, type BadgeTone } from "../../ui/Badge.js";
import { Button } from "../../ui/Button.js";
import { Input } from "../../ui/Input.js";
import { Select } from "../../ui/Select.js";
import { Switch } from "../../ui/Switch.js";
import { LlmReadinessCard } from "../shared/LlmReadinessCard.js";
import { useStartModelDownload } from "../../api/modelDownloads.js";
import { ModelDownloadsPanel } from "../models/downloads/ModelDownloadsPanel.js";
import { HfModelPicker } from "../models/downloads/HfModelPicker.js";
import { requestErrorMessage } from "../models/downloads/downloadCopy.js";
import { useT } from "../../i18n/t.js";

// Owner decision (model-context-auto-config-20260928): manual override range.
// Matches the backend's silent-clamp range (T2, PUT /api/models/context).
const CONTEXT_MIN_TOKENS = 2048;
const CONTEXT_MAX_TOKENS = 131072;

// T2 (controls-cleanup-adaptive-reasoning-20260928): manual reasoning cap
// range. Matches the backend's silent-clamp range (MIN_BUDGET_TOKENS/
// MAX_BUDGET_TOKENS in opencohost/config/model_parameters.py).
const REASONING_BUDGET_MIN_TOKENS = 32;
const REASONING_BUDGET_MAX_TOKENS = 8192;
// Neutral starting suggestion when opening "Personalizar" from Auto for the
// first time -- NOT a claim about what Auto would actually pick (that is
// genuinely unknown ahead of a live, calibrated turn; see
// ModelReasoningConfig's docstring in opencohost/api/models.py).
const REASONING_BUDGET_SUGGESTED_START = 512;

function matchesCurrentModel(status: StatusResponse, target: string): boolean {
  return status.current_model === target;
}

/**
 * Modelo card — model select wired to the real backend (GET /api/models;
 * POST /api/commands switch_model via useEngineCommand). The legacy manual
 * "Tier LLM" selector (Quality/Balanced/Fast) was removed from this surface
 * (controls-cleanup-adaptive-reasoning-20260928 T1): it duplicated the model
 * selector and its label could show a tier that did not match the actually
 * active model (`_infer_active_tier` falls back to the first available tier
 * when the current model is in no tier slot). The backend tier API
 * (`switch_llm_tier`, `GET /api/models` `tiers`/`active_tier`) is untouched
 * and still used to detect cloud mode (`isCloud`); only the manual UI
 * control is gone.
 *
 * Select value = optimistic local pick while its command is pending, falling
 * back to the live server value once it clears — same `pending ?? serverValue`
 * pattern as ProfileSwitcher's `selectValue = pendingSwitch?.name ?? activeProfile`.
 *
 * In-app downloads (ADR-063, superseding the earlier "OpenCohost does not
 * download models — Ollama does" decision): an uninstalled curated catalog
 * entry stays disabled in the select, but gets a "Download" button that
 * starts a backend pull (POST /api/models/downloads). Progress, pause/resume/
 * cancel and "Use this model" live in ModelDownloadsPanel; a Hugging Face
 * GGUF can be pulled via HfModelPicker. When Ollama is offline or
 * uninstalled, no local model can be run or downloaded, and clear connection
 * warnings are surfaced instead.
 */
export function ModelCard() {
  const t = useT();
  const { data, isError: modelsError } = useModelsQuery();
  const updateReasoningMutation = useUpdateModelReasoningMutation();
  const updateContextMutation = useUpdateModelContextMutation();
  const { data: statusData } = useStatusQuery();
  const { readiness } = useLlmReadiness();
  const modelCommand = useEngineCommand<string>(matchesCurrentModel);
  const startDownload = useStartModelDownload();
  const isCloud = data?.active_tier === "cloud";

  const [optimisticModel, setOptimisticModel] = useState<string | null>(null);
  const [optimisticReasoningEnabled, setOptimisticReasoningEnabled] = useState<boolean | null>(null);
  // T2/T3: three states, same convention as `optimisticContextTokens` below
  // -- `undefined` = no pending override (fall back to the server value),
  // `null` = an explicit "clear to Auto" is in flight, a number = a manual
  // cap save is in flight. A plain `?? ` fallback cannot distinguish "no
  // override" from "the override IS Auto (null)".
  const [optimisticReasoningBudget, setOptimisticReasoningBudget] = useState<number | null | undefined>(undefined);
  const [showSetup, setShowSetup] = useState(false);
  const [showReasoningBudgetCustomize, setShowReasoningBudgetCustomize] = useState(false);
  const [reasoningBudgetInputValue, setReasoningBudgetInputValue] = useState("");
  const [optimisticContextTokens, setOptimisticContextTokens] = useState<number | null | undefined>(undefined);
  const [showContextCustomize, setShowContextCustomize] = useState(false);
  const [contextInputValue, setContextInputValue] = useState("");

  useEffect(() => {
    if (!modelCommand.pending) setOptimisticModel(null);
  }, [modelCommand.pending]);

  useEffect(() => {
    if (!updateReasoningMutation.isPending) {
      setOptimisticReasoningEnabled(null);
      setOptimisticReasoningBudget(undefined);
    }
  }, [updateReasoningMutation.isPending]);

  useEffect(() => {
    if (!updateContextMutation.isPending) setOptimisticContextTokens(undefined);
  }, [updateContextMutation.isPending]);

  const catalogEntries = Object.entries(data?.catalog ?? {});
  const selectedModelId = optimisticModel ?? data?.current_model ?? catalogEntries[0]?.[0] ?? "";
  const selectedEntry = data?.catalog[selectedModelId];
  const pending = modelCommand.pending;
  const isReasoningActive = Boolean(
    data?.is_reasoning_active || /qwen3|e4b|e2b|think/i.test(selectedModelId)
  );
  const reasoningConfig = data?.reasoning_config ?? { enabled: false, budget_tokens: null };
  const reasoningEnabled = optimisticReasoningEnabled ?? reasoningConfig.enabled;
  const reasoningBudget =
    optimisticReasoningBudget !== undefined ? optimisticReasoningBudget : reasoningConfig.budget_tokens;
  const isReasoningBudgetCustomized = reasoningBudget !== null;

  // Owner decision: context_config describes the ACTIVE model only (T2
  // contract). Only show the section when it matches what's on screen, so a
  // pending model switch never shows another model's context numbers.
  const contextConfig = data?.context_config;
  const showContextSection = !isCloud && Boolean(contextConfig) && contextConfig?.model === selectedModelId;
  const contextTokens = optimisticContextTokens !== undefined ? optimisticContextTokens : contextConfig?.context_tokens ?? null;
  const isContextCustomized = contextTokens !== null;
  const autoContextDisplay = contextConfig?.effective_context ?? contextConfig?.auto_context_tokens ?? 0;

  const errorMessage =
    modelCommand.error?.message ??
    (modelCommand.isFailed ? t("controles.model.error.switchFailed") : null) ??
    (updateReasoningMutation.error ? String(updateReasoningMutation.error) : null);

  const ollamaOffline = !isCloud && Boolean(readiness && !readiness.ollama?.reachable);
  const installed = new Set(
    data?.discovered ?? readiness?.ollama?.installed_models ?? []
  );
  const hasNoModels = !isCloud && !ollamaOffline && installed.size === 0;

  const canVerify = !ollamaOffline;
  const canDownload = !isCloud && !ollamaOffline && Boolean(data);
  const downloadableEntries = canDownload ? catalogEntries.filter(([id]) => !installed.has(id)) : [];
  const modelOptions = [
    ...catalogEntries.map(([id, entry]) => {
      const missing = ollamaOffline || (canVerify && !installed.has(id));
      return {
        value: id,
        label: missing ? `${entry.display} — ${t("controles.model.select.notInstalled")}` : entry.display,
        disabled: missing
      };
    }),
    ...(!ollamaOffline
      ? (data?.discovered ?? [])
          .filter((tag) => !(tag in (data?.catalog ?? {})))
          .map((tag) => ({ value: tag, label: tag }))
      : [])
  ];

  let badgeTone: BadgeTone = "ok";
  let badgeLabel = t("controles.model.card.installed");

  if (pending) {
    badgeTone = "info";
    badgeLabel = t("controles.model.card.pending");
  } else if (isCloud) {
    badgeTone = "info";
    badgeLabel = t("controles.model.card.cloudBadge");
  } else if (ollamaOffline) {
    badgeTone = "danger";
    badgeLabel = t("controles.model.card.offline");
  } else if (installed.size === 0) {
    badgeTone = "warn";
    badgeLabel = t("controles.model.card.noModels");
  } else if (!installed.has(selectedModelId)) {
    badgeTone = "warn";
    badgeLabel = t("controles.model.card.notInstalled");
  }

  function handleModelChange(id: string) {
    setOptimisticModel(id);
    void modelCommand.run("switch_model", id);
  }

  function handleToggleReasoning(checked: boolean) {
    setOptimisticReasoningEnabled(checked);
    updateReasoningMutation.mutate({
      model: selectedModelId,
      enabled: checked,
      budget_tokens: reasoningBudget
    });
  }

  function openReasoningBudgetCustomize() {
    setReasoningBudgetInputValue(String(reasoningBudget ?? REASONING_BUDGET_SUGGESTED_START));
    setShowReasoningBudgetCustomize(true);
  }

  function handleSaveReasoningBudget() {
    const trimmed = reasoningBudgetInputValue.trim();
    if (trimmed === "") return;
    const parsed = Math.round(Number(trimmed));
    if (!Number.isFinite(parsed)) return;
    setOptimisticReasoningBudget(parsed);
    updateReasoningMutation.mutate(
      { model: selectedModelId, enabled: reasoningEnabled, budget_tokens: parsed },
      { onSuccess: () => setShowReasoningBudgetCustomize(false) }
    );
  }

  function handleResetReasoningBudgetToAuto() {
    setOptimisticReasoningBudget(null);
    setShowReasoningBudgetCustomize(false);
    updateReasoningMutation.mutate({ model: selectedModelId, enabled: reasoningEnabled, budget_tokens: null });
  }

  function openContextCustomize() {
    setContextInputValue(String(contextTokens ?? autoContextDisplay));
    setShowContextCustomize(true);
  }

  function handleSaveContext() {
    const trimmed = contextInputValue.trim();
    if (trimmed === "") return;
    const parsed = Math.round(Number(trimmed));
    if (!Number.isFinite(parsed)) return;
    setOptimisticContextTokens(parsed);
    updateContextMutation.mutate(
      { model: selectedModelId, context_tokens: parsed },
      { onSuccess: () => setShowContextCustomize(false) }
    );
  }

  function handleResetContextToAuto() {
    setOptimisticContextTokens(null);
    setShowContextCustomize(false);
    updateContextMutation.mutate({ model: selectedModelId, context_tokens: null });
  }

  return (
    <Card className="flex flex-col p-4">
      <div className="flex items-center justify-between gap-3 border-b border-border-soft pb-3">
        <h2 className="text-sm font-bold text-foreground">{t("controles.model.card.title")}</h2>
        <Badge tone={badgeTone}>
          {pending && (
            <Loader2 size={12} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />
          )}
          {badgeLabel}
        </Badge>
      </div>

      <div className="flex flex-col gap-3.5 pt-3.5">
        {(errorMessage || modelsError) && (
          <p role="alert" className="text-xs leading-relaxed text-danger">
            {errorMessage ?? t("controles.model.error.load")}
          </p>
        )}

        {ollamaOffline && (
          <p role="alert" className="text-xs leading-relaxed text-danger bg-danger-bg border border-danger-bd rounded p-2.5">
            {t("controles.model.warning.ollamaOffline")}
          </p>
        )}

        {hasNoModels && (
          <p role="alert" className="text-xs leading-relaxed text-warn bg-warn-bg border border-warn-bd rounded p-2.5">
            {t("controles.model.warning.noModels")}
          </p>
        )}

        {(ollamaOffline || hasNoModels) && (
          <div className="flex justify-end">
            <Button
              type="button"
              variant="outline"
              className="h-7 px-2.5 text-xs"
              onClick={() => setShowSetup((prev) => !prev)}
            >
              {showSetup ? t("controles.readiness.hideSetup") : t("controles.readiness.openSetup")}
            </Button>
          </div>
        )}

        {showSetup && (
          <div className="mt-1">
            <LlmReadinessCard onClose={() => setShowSetup(false)} showDismiss hideDownloads />
          </div>
        )}

        <p className="text-xs text-muted-foreground mb-2">
          {t("controles.model.current.label")}
          <span className="mono text-foreground">{data?.current_model ?? "—"}</span>
        </p>

        {isCloud ? (
          <p className="text-xs leading-relaxed text-muted-foreground">{t("controles.model.cloud.hint")}</p>
        ) : (
          <>
            <section aria-labelledby="model-select-label" className="space-y-2">
              <span id="model-select-label" className="text-[11px] font-semibold uppercase tracking-[0.09em] text-dim">
                {t("controles.model.select.eyebrow")}
              </span>
              <Select
                options={modelOptions}
                aria-labelledby="model-select-label"
                className="mono"
                value={selectedModelId}
                disabled={modelCommand.pending}
                loading={modelCommand.pending}
                onChange={handleModelChange}
              />
              {modelCommand.pending && (
                <p role="status" className="inline-flex items-center gap-1.5 text-xs text-info">
                  <Loader2 size={12} className="shrink-0 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                  <span>{t("controles.model.activating", { model: selectedEntry?.display ?? selectedModelId })}</span>
                </p>
              )}
              {selectedEntry && (
                <p className="text-xs leading-relaxed text-muted-foreground">
                  {selectedEntry.desc} <span className="mono font-semibold text-foreground">{selectedEntry.size_gb} GB</span>
                </p>
              )}
              <p className="text-xs leading-relaxed text-muted-foreground">{t("controles.model.manage.hint")}</p>
            </section>

            {canDownload && (
              <section aria-labelledby="model-download-label" className="space-y-2">
                {downloadableEntries.length > 0 && (
                  <>
                    <span
                      id="model-download-label"
                      className="text-[11px] font-semibold uppercase tracking-[0.09em] text-dim"
                    >
                      {t("models.download.available.eyebrow")}
                    </span>
                    <ul className="flex flex-col gap-1.5">
                      {downloadableEntries.map(([id, entry]) => (
                        <li
                          key={id}
                          className="flex items-center justify-between gap-2 rounded-md border border-border-soft bg-surface-2 px-2.5 py-2 text-xs"
                        >
                          <span className="min-w-0 truncate text-foreground">
                            {entry.display}{" "}
                            <span className="mono text-muted-foreground">{entry.size_gb} GB</span>
                          </span>
                          <Button
                            type="button"
                            variant="outline"
                            className="h-7 shrink-0 px-2.5 text-xs"
                            disabled={startDownload.isPending}
                            aria-label={t("models.download.buttonAria", { model: entry.display })}
                            onClick={() => startDownload.mutate(id)}
                          >
                            {startDownload.isPending && startDownload.variables === id && (
                              <Loader2 size={12} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />
                            )}
                            {startDownload.isPending && startDownload.variables === id
                              ? t("models.download.starting")
                              : t("models.download.button")}
                          </Button>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
                {startDownload.error && (
                  <p role="alert" className="text-xs leading-relaxed text-danger">
                    {requestErrorMessage(startDownload.error, t)}
                  </p>
                )}
                <ModelDownloadsPanel
                  onUseModel={handleModelChange}
                  activatingTag={modelCommand.pending ? selectedModelId : null}
                />
                <HfModelPicker />
              </section>
            )}

            {isReasoningActive && (
              <section aria-labelledby="reasoning-mode-label" className="space-y-4 rounded-md border border-border-soft bg-card p-3.5">
                <div className="flex flex-col gap-1.5">
                  <span id="reasoning-mode-label" className="text-[11px] font-semibold uppercase tracking-[0.09em] text-dim">
                    {t("controles.model.reasoning.eyebrow")}
                  </span>
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    {t("controles.model.reasoning.description")}
                  </p>
                </div>

                <div className="flex items-center justify-between gap-3 rounded-md border border-border-soft bg-surface-2 px-3.5 py-3">
                  <div className="flex flex-col gap-1 min-w-0 pr-2">
                    <span className="text-xs font-semibold text-foreground">
                      {t("controles.model.reasoning.toggleLabel")}
                    </span>
                    <span className="text-[11px] leading-relaxed text-muted-foreground">
                      {reasoningEnabled
                        ? t("controles.model.reasoning.enabledHint")
                        : t("controles.model.reasoning.fastHint")}
                    </span>
                  </div>
                  <Switch
                    checked={reasoningEnabled}
                    onChange={handleToggleReasoning}
                    aria-label={t("controles.model.reasoning.toggleLabel")}
                    disabled={updateReasoningMutation.isPending}
                  />
                </div>

                {reasoningEnabled && (
                  <div className="space-y-3 pt-3.5" style={{ borderTop: "1px solid rgba(23, 227, 154, 0.15)" }}>
                    <span className="text-[11px] font-semibold uppercase tracking-[0.09em] text-dim">
                      {t("controles.model.reasoning.budgetEyebrow")}
                    </span>

                    {!showReasoningBudgetCustomize && (
                      <div className="flex flex-wrap items-center justify-between gap-2.5 rounded-md border border-border-soft bg-surface-2 px-3.5 py-3">
                        <div className="flex min-w-0 flex-col gap-1 pr-2">
                          <span className="text-xs font-semibold text-foreground">
                            {isReasoningBudgetCustomized
                              ? t("controles.model.reasoning.budgetManualLabel", { tokens: reasoningBudget as number })
                              : t("controles.model.reasoning.budgetAutoLabel")}
                          </span>
                          <span className="text-[11px] leading-relaxed text-muted-foreground">
                            {t("controles.model.reasoning.budgetAutoDescription")}
                          </span>
                        </div>
                        <div className="flex shrink-0 gap-2">
                          {isReasoningBudgetCustomized && (
                            <Button
                              type="button"
                              variant="ghost"
                              className="h-7 px-2.5 text-xs"
                              disabled={updateReasoningMutation.isPending}
                              onClick={handleResetReasoningBudgetToAuto}
                            >
                              {t("controles.model.reasoning.budgetResetButton")}
                            </Button>
                          )}
                          <Button
                            type="button"
                            variant="outline"
                            className="h-7 px-2.5 text-xs"
                            disabled={updateReasoningMutation.isPending}
                            onClick={openReasoningBudgetCustomize}
                          >
                            {t("controles.model.reasoning.budgetCustomizeButton")}
                          </Button>
                        </div>
                      </div>
                    )}

                    {showReasoningBudgetCustomize && (
                      <div className="space-y-2.5 rounded-md border border-border-soft bg-surface-2 px-3.5 py-3">
                        <label htmlFor="reasoning-budget-input" className="text-xs font-semibold text-foreground">
                          {t("controles.model.reasoning.budgetInputLabel")}
                        </label>
                        <Input
                          id="reasoning-budget-input"
                          type="number"
                          min={REASONING_BUDGET_MIN_TOKENS}
                          max={REASONING_BUDGET_MAX_TOKENS}
                          value={reasoningBudgetInputValue}
                          disabled={updateReasoningMutation.isPending}
                          onChange={(event) => setReasoningBudgetInputValue(event.target.value)}
                        />
                        <p className="text-[11.5px] leading-snug text-muted-foreground">
                          {t("controles.model.reasoning.budgetCapHint")}
                        </p>
                        <div className="flex justify-end gap-2 pt-0.5">
                          <Button
                            type="button"
                            variant="ghost"
                            className="h-7 px-2.5 text-xs"
                            disabled={updateReasoningMutation.isPending}
                            onClick={() => setShowReasoningBudgetCustomize(false)}
                          >
                            {t("controles.model.reasoning.budgetCancelButton")}
                          </Button>
                          <Button
                            type="button"
                            variant="primary"
                            className="h-7 px-2.5 text-xs"
                            disabled={updateReasoningMutation.isPending}
                            onClick={handleSaveReasoningBudget}
                          >
                            {updateReasoningMutation.isPending && (
                              <Loader2 size={12} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />
                            )}
                            {t("controles.model.reasoning.budgetSaveButton")}
                          </Button>
                        </div>
                      </div>
                    )}
                    {updateReasoningMutation.isPending && (
                      <p role="status" className="inline-flex items-center gap-1.5 text-xs text-info">
                        <Loader2 size={12} className="shrink-0 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                        <span>{t("controles.model.reasoning.saving")}</span>
                      </p>
                    )}
                  </div>
                )}
              </section>
            )}

            {showContextSection && (
              <section aria-labelledby="context-mode-label" className="space-y-3 rounded-md border border-border-soft bg-card p-3.5">
                <span id="context-mode-label" className="text-[11px] font-semibold uppercase tracking-[0.09em] text-dim">
                  {t("controles.model.context.eyebrow")}
                </span>

                {!showContextCustomize && (
                  <div className="flex flex-wrap items-center justify-between gap-2.5 rounded-md border border-border-soft bg-surface-2 px-3.5 py-3">
                    <span className="text-xs font-semibold text-foreground">
                      {isContextCustomized
                        ? t("controles.model.context.customLabel", { tokens: contextTokens as number })
                        : t("controles.model.context.autoLabel", { tokens: autoContextDisplay })}
                    </span>
                    <div className="flex shrink-0 gap-2">
                      {isContextCustomized && (
                        <Button
                          type="button"
                          variant="ghost"
                          className="h-7 px-2.5 text-xs"
                          disabled={updateContextMutation.isPending}
                          onClick={handleResetContextToAuto}
                        >
                          {t("controles.model.context.resetButton")}
                        </Button>
                      )}
                      <Button
                        type="button"
                        variant="outline"
                        className="h-7 px-2.5 text-xs"
                        disabled={updateContextMutation.isPending}
                        onClick={openContextCustomize}
                      >
                        {t("controles.model.context.customizeButton")}
                      </Button>
                    </div>
                  </div>
                )}

                {showContextCustomize && (
                  <div className="space-y-2.5 rounded-md border border-border-soft bg-surface-2 px-3.5 py-3">
                    <label htmlFor="context-tokens-input" className="text-xs font-semibold text-foreground">
                      {t("controles.model.context.inputLabel")}
                    </label>
                    <Input
                      id="context-tokens-input"
                      type="number"
                      min={CONTEXT_MIN_TOKENS}
                      max={CONTEXT_MAX_TOKENS}
                      value={contextInputValue}
                      disabled={updateContextMutation.isPending}
                      onChange={(event) => setContextInputValue(event.target.value)}
                    />
                    <p className="text-[11.5px] leading-snug text-muted-foreground">
                      {t("controles.model.context.autoHint", { auto: contextConfig?.auto_context_tokens ?? 0 })}
                      {contextConfig?.native_context
                        ? ` ${t("controles.model.context.nativeHint", { native: contextConfig.native_context })}`
                        : ""}
                    </p>
                    <p className="text-xs leading-relaxed text-warn bg-warn-bg border border-warn-bd rounded p-2.5">
                      {t("controles.model.context.vramWarning", {
                        free: statusData?.health.free_vram_mb != null ? Math.round(statusData.health.free_vram_mb) : "—",
                        total: statusData?.health.total_vram_mb != null ? Math.round(statusData.health.total_vram_mb) : "—"
                      })}
                    </p>
                    <p className="text-[11px] leading-relaxed text-muted-foreground">
                      {t("controles.model.context.reloadHint")}
                    </p>
                    <div className="flex justify-end gap-2 pt-0.5">
                      <Button
                        type="button"
                        variant="ghost"
                        className="h-7 px-2.5 text-xs"
                        disabled={updateContextMutation.isPending}
                        onClick={() => setShowContextCustomize(false)}
                      >
                        {t("controles.model.context.cancelButton")}
                      </Button>
                      <Button
                        type="button"
                        variant="primary"
                        className="h-7 px-2.5 text-xs"
                        disabled={updateContextMutation.isPending}
                        onClick={handleSaveContext}
                      >
                        {updateContextMutation.isPending && (
                          <Loader2 size={12} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />
                        )}
                        {t("controles.model.context.saveButton")}
                      </Button>
                    </div>
                  </div>
                )}

                {updateContextMutation.isPending && (
                  <p role="status" className="inline-flex items-center gap-1.5 text-xs text-info">
                    <Loader2 size={12} className="shrink-0 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                    <span>{t("controles.model.context.saving")}</span>
                  </p>
                )}

                {updateContextMutation.error && (
                  <p role="alert" className="text-xs leading-relaxed text-danger">
                    {t("controles.model.context.error")}
                  </p>
                )}
              </section>
            )}
          </>
        )}
      </div>
    </Card>
  );
}
