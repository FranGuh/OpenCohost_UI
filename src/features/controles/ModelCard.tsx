import { useEffect, useState } from "react";
import { useModelsQuery } from "../../api/models.js";
import { useEngineCommand } from "../../api/engineCommand.js";
import type { StatusResponse } from "../../api/client.js";
import { Card } from "../../ui/Card.js";
import { Badge } from "../../ui/Badge.js";
import { Select } from "../../ui/Select.js";
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
 * OpenCohost does not download models — Ollama does (owner decision). Local
 * mode is discovery + selection only: `discovered` (the tags Ollama actually
 * reports) marks catalog entries as not-installed, it never removes them
 * from the list. An EMPTY `discovered` means "cannot verify" (Ollama
 * discovery timed out/errored), never "nothing installed" — mirrors the
 * backend's own fail-open rule (settings.py::resolve_startup_model, ~:799)
 * — so nothing is marked missing in that case. Cloud mode
 * (`active_tier === "cloud"`) has no catalog/tiers to pick from; the card
 * becomes a read-only pointer to the ProviderCard.
 */
export function ModelCard() {
  const t = useT();
  const { data, isError: modelsError } = useModelsQuery();
  const modelCommand = useEngineCommand<string>(matchesCurrentModel);
  const tierCommand = useEngineCommand<string>();
  const isCloud = data?.active_tier === "cloud";

  const [optimisticModel, setOptimisticModel] = useState<string | null>(null);
  const [optimisticTier, setOptimisticTier] = useState<string | null>(null);

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

  const installed = new Set(data?.discovered ?? []);
  // Empty discovery = "cannot verify", NOT "nothing installed" — mirrors
  // settings.py's own rule (resolve_startup_model, ~:799).
  const canVerify = installed.size > 0;
  const modelOptions = [
    ...catalogEntries.map(([id, entry]) => {
      const missing = canVerify && !installed.has(id);
      return {
        value: id,
        label: missing ? `${entry.display} — ${t("controles.model.select.notInstalled")}` : entry.display,
        disabled: missing
      };
    }),
    // Owner-pulled tags outside the curated catalog are selectable too; the
    // backend already accepts them ("saved_runtime", settings.py:803).
    ...(data?.discovered ?? [])
      .filter((tag) => !(tag in (data?.catalog ?? {})))
      .map((tag) => ({ value: tag, label: tag }))
  ];

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
        <Badge tone={pending || isCloud ? "info" : "ok"}>
          {pending
            ? t("controles.model.card.pending")
            : isCloud
              ? t("controles.model.card.cloudBadge")
              : t("controles.model.card.installed")}
        </Badge>
      </div>

      <div className="flex flex-col gap-3.5 pt-3.5">
        {(errorMessage || modelsError) && (
          <p role="alert" className="text-xs leading-relaxed text-danger">
            {errorMessage ?? t("controles.model.error.load")}
          </p>
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
