import { useEffect, useState } from "react";
import { useModelsQuery } from "../../api/models.js";
import { useLlmReadiness } from "../shared/useLlmReadiness.js";
import { useEngineCommand } from "../../api/engineCommand.js";
import type { StatusResponse } from "../../api/client.js";
import { Card } from "../../ui/Card.js";
import { Badge, type BadgeTone } from "../../ui/Badge.js";
import { Button } from "../../ui/Button.js";
import { Select } from "../../ui/Select.js";
import { LlmReadinessCard } from "../shared/LlmReadinessCard.js";
import { cn } from "../../lib/cn.js";
import { useT, type TKey } from "../../i18n/t.js";

const TIER_LABELS: Record<string, TKey> = {
  quality: "controles.model.tier.quality",
  balanced: "controles.model.tier.balanced",
  fast: "controles.model.tier.fast"
};

function matchesCurrentModel(status: StatusResponse, target: string): boolean {
  return status.current_model === target;
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
  const { readiness } = useLlmReadiness();
  const modelCommand = useEngineCommand<string>(matchesCurrentModel);
  const tierCommand = useEngineCommand<string>();
  const isCloud = data?.active_tier === "cloud";

  const [optimisticModel, setOptimisticModel] = useState<string | null>(null);
  const [optimisticTier, setOptimisticTier] = useState<string | null>(null);
  const [showSetup, setShowSetup] = useState(false);

  useEffect(() => {
    if (!modelCommand.pending) setOptimisticModel(null);
  }, [modelCommand.pending]);

  useEffect(() => {
    if (!tierCommand.pending) setOptimisticTier(null);
  }, [tierCommand.pending]);

  const catalogEntries = Object.entries(data?.catalog ?? {});
  const selectedModelId = optimisticModel ?? data?.current_model ?? catalogEntries[0]?.[0] ?? "";
  const selectedEntry = data?.catalog[selectedModelId];
  const activeTierId = optimisticTier ?? data?.active_tier ?? "";
  const pending = modelCommand.pending || tierCommand.pending;
  const errorMessage = modelCommand.error?.message ?? tierCommand.error?.message;

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
                        "flex h-[42px] items-center justify-between gap-[10px] rounded-md border border-border-soft bg-card px-[14px] text-[13.5px] font-semibold text-muted-foreground transition-colors duration-fast ease-io",
                        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                        "disabled:cursor-not-allowed disabled:opacity-60",
                        isActive && "border-l-[3px] border-l-primary bg-[var(--accent-soft)] text-foreground"
                      )}
                    >
                      <span>
                        {tierLabelKey ? t(tierLabelKey) : tierId} · {tierModelLabel}
                      </span>
                      {isActive && (
                        <span className="text-[12px] font-semibold text-info">{t("controles.model.tier.activeBadge")}</span>
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
