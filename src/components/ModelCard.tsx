import { useState } from "react";
import { useStatusQuery } from "../api/status.js";
import { useMockCommand } from "../api/mock/useMockCommand.js";
import { MODEL_CATALOG } from "../api/mock/fixtures.js";
import { Card } from "./ui/Card.js";
import { Badge } from "./ui/Badge.js";
import { Select } from "./ui/Select.js";
import { Button } from "./ui/Button.js";
import { cn } from "../lib/cn.js";

type ModelId = (typeof MODEL_CATALOG)[number]["id"];

// P2: wire to backend model registry — no /api/models endpoint exists yet.
// Tier list is local UI state only; current_model below is the one live
// field (useStatusQuery).
const TIERS = [
  { id: "quality", label: "Quality · Gemma 4 (E4B)", tag: "pesado" },
  { id: "balanced", label: "Balanced · LLaMA 3 (8B)", tag: null },
  { id: "fast", label: "Fast · Qwen 3 (1.7B) ⚡", tag: null }
] as const;

type TierId = (typeof TIERS)[number]["id"];

/**
 * Modelo card — model select + manual Tier LLM control, both mocked (no
 * /api/models or tier endpoint yet). `current_model` stays live
 * (useStatusQuery). Model select and tier each own their own useMockCommand
 * instance — same accepted != applied contract as useProfileSwitch (queued
 * -> applying -> applied), just local — so exactly one control disables at a
 * time, mirroring two independent real per-endpoint mutations. Local state
 * updates immediately (so the UI always shows the intended target, mirroring
 * ProfileSwitcher's `selectValue = pendingSwitch?.name ?? activeProfile`);
 * the commands only drive the pending/disable/Badge affordance. A persistent
 * role="status" note discloses selection/tier are local previews only.
 *
 * Download is a separate mock command — a real download needs the backend,
 * so it only ever shows a simulated progress bar + role="status" note.
 *
 * Tier control a11y: toggle-button pattern (`role="group"` + `aria-pressed`,
 * same contract as `ui/Segmented.tsx`), not `role="radiogroup"`.
 */
export function ModelCard() {
  const { data } = useStatusQuery();
  const [selectedModel, setSelectedModel] = useState<ModelId>(MODEL_CATALOG[0].id);
  const [activeTier, setActiveTier] = useState<TierId>("fast");
  const modelCommand = useMockCommand<ModelId>();
  const tierCommand = useMockCommand<TierId>();
  const downloadCommand = useMockCommand(600);

  const model = MODEL_CATALOG.find((m) => m.id === selectedModel) ?? MODEL_CATALOG[0];
  const pending = modelCommand.pending || tierCommand.pending;

  function handleModelChange(id: ModelId) {
    setSelectedModel(id);
    void modelCommand.run(id);
  }

  function handleTierChange(id: TierId) {
    setActiveTier(id);
    void tierCommand.run(id);
  }

  return (
    <Card className="flex flex-col p-4">
      <div className="flex items-center justify-between gap-3 border-b border-border-soft pb-3">
        <h2 className="text-sm font-bold text-foreground">Modelo</h2>
        <Badge tone={pending ? "info" : "ok"}>{pending ? "aplicando…" : "instalado"}</Badge>
      </div>

      <div className="flex flex-col gap-3.5 pt-3.5">
        <p role="status" className="text-xs leading-relaxed text-muted-foreground">
          Selección de modelo y tier son vistas previas locales — no hay endpoint de backend todavía, así que
          "instalado"/"activo" no reflejan un cambio persistido.
        </p>

        <section aria-labelledby="model-select-label" className="space-y-2">
          <p className="text-xs text-muted-foreground">
            Modelo activo ahora: <span className="mono text-foreground">{data?.current_model ?? "—"}</span>
          </p>
          <span id="model-select-label" className="text-[11px] font-semibold uppercase tracking-[0.09em] text-dim">
            Modelo Activo
          </span>
          <Select
            aria-labelledby="model-select-label"
            className="mono"
            value={selectedModel}
            disabled={modelCommand.pending}
            onChange={(event) => handleModelChange(event.target.value as ModelId)}
          >
            {MODEL_CATALOG.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </Select>
          <p className="text-xs leading-relaxed text-muted-foreground">
            {model.vendor} <span className="mono font-semibold text-foreground">{model.size}</span>
          </p>
        </section>

        <section aria-labelledby="tier-label" className="space-y-2">
          <span id="tier-label" className="text-[11px] font-semibold uppercase tracking-[0.09em] text-dim">
            Tier LLM manual
          </span>
          <div role="group" aria-labelledby="tier-label" className="grid gap-[6px]">
            {TIERS.map((tier) => {
              const isActive = tier.id === activeTier;
              return (
                <button
                  key={tier.id}
                  type="button"
                  aria-pressed={isActive}
                  disabled={tierCommand.pending}
                  onClick={() => handleTierChange(tier.id)}
                  className={cn(
                    "flex h-[42px] items-center justify-between gap-[10px] rounded-md border border-border-soft bg-card px-[14px] text-[13.5px] font-semibold text-muted-foreground transition-colors",
                    "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                    "disabled:cursor-not-allowed disabled:opacity-60",
                    isActive && "border-l-[3px] border-l-primary bg-[var(--accent-soft)] text-foreground"
                  )}
                >
                  <span>{tier.label}</span>
                  {tier.tag && <span className="text-[11px] text-dim">{tier.tag}</span>}
                  {isActive && <span className="text-[12px] font-semibold text-info">activo</span>}
                </button>
              );
            })}
          </div>
          <p className="text-xs leading-relaxed text-muted-foreground">
            El tier cambia solo el modelo de próximos pedidos; perfil y memoria se conservan.
          </p>
        </section>

        <section aria-labelledby="download-label" className="space-y-2">
          <span id="download-label" className="text-[11px] font-semibold uppercase tracking-[0.09em] text-dim">
            Descargar modelo
          </span>
          <div className="grid grid-cols-[1fr_auto] items-center gap-3">
            <span className="text-[13px] text-foreground">{model.name}</span>
            <Button
              type="button"
              variant="outline"
              disabled={downloadCommand.pending}
              onClick={() => void downloadCommand.run()}
            >
              Descargar
            </Button>
          </div>
          {downloadCommand.pending && (
            <>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
                <div className="h-full w-1/3 animate-pulse rounded-full bg-primary" />
              </div>
              <p role="status" className="text-xs text-muted-foreground">
                Descargando (simulado)… la descarga real necesita el backend.
              </p>
            </>
          )}
        </section>
      </div>
    </Card>
  );
}
