import { useEffect, useState } from "react";
import { CircleCheck } from "lucide-react";
import { useModelsQuery, useUpdateModelReasoningMutation } from "../../api/models.js";
import { useLlmReadiness } from "../shared/useLlmReadiness.js";
import { useEngineCommand } from "../../api/engineCommand.js";
import type { StatusResponse } from "../../api/client.js";
import { Card } from "../../ui/Card.js";
import { Badge, type BadgeTone } from "../../ui/Badge.js";
import { Button } from "../../ui/Button.js";
import { Select } from "../../ui/Select.js";
import { Switch } from "../../ui/Switch.js";
import { Segmented, type SegmentedOption } from "../../ui/Segmented.js";
import { LlmReadinessCard } from "../shared/LlmReadinessCard.js";
import { cn } from "../../lib/cn.js";
import { useT, type TKey } from "../../i18n/t.js";

const TIER_LABELS: Record<string, TKey> = {
  quality: "controles.model.tier.quality",
  balanced: "controles.model.tier.balanced",
  fast: "controles.model.tier.fast"
};

const BUDGET_OPTIONS: readonly SegmentedOption<string>[] = [
  { value: "256", label: "256" },
  { value: "512", label: "512" },
  { value: "1024", label: "1024" },
  { value: "2048", label: "2048" }
] as const;

function matchesCurrentModel(status: StatusResponse, target: string): boolean {
  return status.current_model === target;
}

function getBudgetHint(budget: number, t: (key: TKey) => string): string {
  switch (budget) {
    case 256:
      return t("controles.model.reasoning.budget256");
    case 512:
      return t("controles.model.reasoning.budget512");
    case 1024:
      return t("controles.model.reasoning.budget1024");
    case 2048:
      return t("controles.model.reasoning.budget2048");
    default:
      return t("controles.model.reasoning.budgetHint");
  }
}

/**
 * Modelo card — model select + manual Tier LLM control, both wired to the
 * real backend (GET /api/models; POST /api/commands switch_model /
 * switch_llm_tier via useEngineCommand). Model select and tier each own
 * their own useEngineCommand instance so exactly one control disables at a
 * time, mirroring two independent real per-endpoint mutations.
 *
 * Select/tier value = optimistic local pick while its command is pending,
 * falling back to the live server value once it clears — same
 * `pending ?? serverValue` pattern as ProfileSwitcher's
 * `selectValue = pendingSwitch?.name ?? activeProfile`.
 *
 * OpenCohost does not download models — Ollama does (owner decision).
 * Curated catalog entries are metadata only: an uninstalled model is marked
 * disabled and not selectable. When Ollama is offline or uninstalled,
 * no local model can be run, and clear connection warnings are surfaced.
 */
export function ModelCard() {
  const t = useT();
  const { data, isError: modelsError } = useModelsQuery();
  const updateReasoningMutation = useUpdateModelReasoningMutation();
  const { readiness } = useLlmReadiness();
  const modelCommand = useEngineCommand<string>(matchesCurrentModel);
  const tierCommand = useEngineCommand<string>();
  const isCloud = data?.active_tier === "cloud";

  const [optimisticModel, setOptimisticModel] = useState<string | null>(null);
  const [optimisticTier, setOptimisticTier] = useState<string | null>(null);
  const [optimisticReasoningEnabled, setOptimisticReasoningEnabled] = useState<boolean | null>(null);
  const [optimisticReasoningBudget, setOptimisticReasoningBudget] = useState<number | null>(null);
  const [showSetup, setShowSetup] = useState(false);

  useEffect(() => {
    if (!modelCommand.pending) setOptimisticModel(null);
  }, [modelCommand.pending]);

  useEffect(() => {
    if (!tierCommand.pending) setOptimisticTier(null);
  }, [tierCommand.pending]);

  useEffect(() => {
    if (!updateReasoningMutation.isPending) {
      setOptimisticReasoningEnabled(null);
      setOptimisticReasoningBudget(null);
    }
  }, [updateReasoningMutation.isPending]);

  const catalogEntries = Object.entries(data?.catalog ?? {});
  const selectedModelId = optimisticModel ?? data?.current_model ?? catalogEntries[0]?.[0] ?? "";
  const selectedEntry = data?.catalog[selectedModelId];
  const activeTierId = optimisticTier ?? data?.active_tier ?? "";
  const pending = modelCommand.pending || tierCommand.pending;
  const isReasoningActive = Boolean(
    data?.is_reasoning_active || /qwen3|e4b|e2b|think/i.test(selectedModelId)
  );
  const reasoningConfig = data?.reasoning_config ?? { enabled: false, budget_tokens: 512 };
  const reasoningEnabled = optimisticReasoningEnabled ?? reasoningConfig.enabled;
  const reasoningBudget = optimisticReasoningBudget ?? reasoningConfig.budget_tokens;
  const errorMessage =
    modelCommand.error?.message ??
    tierCommand.error?.message ??
    (updateReasoningMutation.error ? String(updateReasoningMutation.error) : null);

  const ollamaOffline = !isCloud && Boolean(readiness && !readiness.ollama?.reachable);
  const installed = new Set(
    data?.discovered ?? readiness?.ollama?.installed_models ?? []
  );
  const hasNoModels = !isCloud && !ollamaOffline && installed.size === 0;

  const canVerify = !ollamaOffline;
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

  function handleTierChange(id: string) {
    setOptimisticTier(id);
    void tierCommand.run("switch_llm_tier", id);
  }

  function handleToggleReasoning(checked: boolean) {
    setOptimisticReasoningEnabled(checked);
    updateReasoningMutation.mutate({
      model: selectedModelId,
      enabled: checked,
      budget_tokens: reasoningBudget
    });
  }

  function handleBudgetChange(val: string) {
    const budget = Number(val);
    setOptimisticReasoningBudget(budget);
    updateReasoningMutation.mutate({
      model: selectedModelId,
      enabled: reasoningEnabled,
      budget_tokens: budget
    });
  }

  return (
    <Card className="flex flex-col p-4">
      <div className="flex items-center justify-between gap-3 border-b border-border-soft pb-3">
        <h2 className="text-sm font-bold text-foreground">{t("controles.model.card.title")}</h2>
        <Badge tone={badgeTone}>
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
            <LlmReadinessCard onClose={() => setShowSetup(false)} showDismiss />
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
                onChange={handleModelChange}
              />
              {selectedEntry && (
                <p className="text-xs leading-relaxed text-muted-foreground">
                  {selectedEntry.desc} <span className="mono font-semibold text-foreground">{selectedEntry.size_gb} GB</span>
                </p>
              )}
              <p className="text-xs leading-relaxed text-muted-foreground">{t("controles.model.manage.hint")}</p>
            </section>

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
                    <div className="flex flex-col gap-1.5">
                      <span className="text-[11px] font-semibold uppercase tracking-[0.09em] text-dim">
                        {t("controles.model.reasoning.budgetEyebrow")}
                      </span>
                      <p className="text-xs leading-relaxed text-muted-foreground">
                        {t("controles.model.reasoning.budgetHint")}
                      </p>
                    </div>

                    <div className="flex flex-wrap sm:flex-nowrap items-center gap-3 pt-0.5">
                      <div className="shrink-0">
                        <Segmented
                          options={BUDGET_OPTIONS}
                          value={String(reasoningBudget)}
                          onChange={handleBudgetChange}
                          ariaLabel={t("controles.model.reasoning.budgetEyebrow")}
                          disabled={updateReasoningMutation.isPending}
                        />
                      </div>
                      <span className="text-[11.5px] leading-snug text-muted-foreground min-w-0 flex-1">
                        {getBudgetHint(reasoningBudget, t)}
                      </span>
                    </div>
                  </div>
                )}
              </section>
            )}

            <section aria-labelledby="tier-label" className="space-y-2">
              <span id="tier-label" className="text-[11px] font-semibold uppercase tracking-[0.09em] text-dim">
                {t("controles.model.tier.eyebrow")}
              </span>
              {/* Deliberately NOT a Segmented: each row carries `{tier} · {model}`
                  plus an active badge, not a one-word pill row — do not re-file
                  this divergence as a missed D9 upgrade. */}
              <div role="group" aria-labelledby="tier-label" className="grid gap-[6px]">
                {Object.entries(data?.tiers ?? {}).map(([tierId, modelId]) => {
                  const isActive = tierId === activeTierId;
                  const tierModelLabel = data?.catalog[modelId]?.display ?? modelId;
                  const tierLabelKey = TIER_LABELS[tierId];
                  return (
                    <button
                      key={tierId}
                      type="button"
                      aria-pressed={isActive}
                      disabled={tierCommand.pending}
                      onClick={() => handleTierChange(tierId)}
                      className={cn(
                        "flex h-[40px] items-center justify-between gap-[10px] rounded-md border border-border-soft px-3 text-[13px] font-semibold transition-colors duration-fast ease-io",
                        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                        "disabled:cursor-not-allowed disabled:opacity-60",
                        isActive
                          ? "border-border-soft bg-surface-2 text-foreground shadow-xs"
                          : "bg-card text-muted-foreground hover:bg-surface-1 hover:text-foreground"
                      )}
                    >
                      <span className="flex items-center gap-2.5">
                        <CircleCheck
                          size={14}
                          className={isActive ? "text-ok shrink-0" : "text-dim/30 shrink-0"}
                        />
                        <span>
                          {tierLabelKey ? t(tierLabelKey) : tierId} · {tierModelLabel}
                        </span>
                      </span>
                      {isActive && (
                        <span className="text-[12px] font-semibold text-ok">{t("controles.model.tier.activeBadge")}</span>
                      )}
                    </button>
                  );
                })}
              </div>
              <p className="text-xs leading-relaxed text-muted-foreground">{t("controles.model.tier.hint")}</p>
            </section>
          </>
        )}
      </div>
    </Card>
  );
}
