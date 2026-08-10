import { useEffect, useState } from "react";
import { useModelsQuery } from "../../api/models.js";
import { useEngineCommand } from "../../api/engineCommand.js";
import { useMockCommand } from "../../api/mock/useMockCommand.js";
import type { StatusResponse } from "../../api/client.js";
import { Card } from "../../ui/Card.js";
import { Badge } from "../../ui/Badge.js";
import { Select } from "../../ui/Select.js";
import { Button } from "../../ui/Button.js";
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
 * Download stays mock (no backend download endpoint exists) — the last
 * useMockCommand user in this card.
 */
export function ModelCard() {
  const t = useT();
  const { data, isError: modelsError } = useModelsQuery();
  const modelCommand = useEngineCommand<string>(matchesCurrentModel);
  const tierCommand = useEngineCommand<string>();
  const downloadCommand = useMockCommand(600);

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
        <Badge tone={pending ? "info" : "ok"}>
          {pending ? t("controles.model.card.pending") : t("controles.model.card.installed")}
        </Badge>
      </div>

      <div className="flex flex-col gap-3.5 pt-3.5">
        {(errorMessage || modelsError) && (
          <p role="alert" className="text-xs leading-relaxed text-danger">
            {errorMessage ?? t("controles.model.error.load")}
          </p>
        )}

        <section aria-labelledby="model-select-label" className="space-y-2">
          <p className="text-xs text-muted-foreground mb-2">
            {t("controles.model.current.label")}
            <span className="mono text-foreground">{data?.current_model ?? "—"}</span>
          </p>
          <span id="model-select-label" className="text-[11px] font-semibold uppercase tracking-[0.09em] text-dim">
            {t("controles.model.select.eyebrow")}
          </span>
          {/* Cuando el modelo es cloud no lo muestra,se ve vacio, el select no tiene diseño como los posteriores */}
          <Select
            aria-labelledby="model-select-label"
            className="mono"
            value={selectedModelId}
            disabled={modelCommand.pending}
            onChange={(event) => handleModelChange(event.target.value)}
          >
            {catalogEntries.map(([id, entry]) => (
              <option key={id} value={id}>
                {entry.display}
              </option>
            ))}
          </Select>
          {selectedEntry && (
            <p className="text-xs leading-relaxed text-muted-foreground">
              {selectedEntry.desc} <span className="mono font-semibold text-foreground">{selectedEntry.size_gb} GB</span>
            </p>
          )}
        </section>

        <section aria-labelledby="tier-label" className="space-y-2">
          <span id="tier-label" className="text-[11px] font-semibold uppercase tracking-[0.09em] text-dim">
            {t("controles.model.tier.eyebrow")}
          </span>
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

        <section aria-labelledby="download-label" className="space-y-2">
          <span id="download-label" className="text-[11px] font-semibold uppercase tracking-[0.09em] text-dim">
            {t("controles.model.download.eyebrow")}
          </span>
          <div className="grid grid-cols-[1fr_auto] items-center gap-3">
            <span className="text-[13px] text-foreground">{selectedEntry?.display ?? selectedModelId ?? "—"}</span>
            <Button
              type="button"
              variant="outline"
              disabled={downloadCommand.pending}
              onClick={() => void downloadCommand.run()}
            >
              {t("controles.model.download.action")}
            </Button>
          </div>
          {downloadCommand.pending && (
            <>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
                <div className="h-full w-1/3 animate-pulse rounded-full bg-primary" />
              </div>
              <p role="status" className="text-xs text-muted-foreground">{t("controles.model.download.pending")}</p>
            </>
          )}
        </section>
      </div>
    </Card>
  );
}
