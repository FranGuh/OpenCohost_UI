import { useState } from "react";
import { useStatusQuery } from "../api/status.js";
import { Card } from "./ui/Card.js";
import { Badge } from "./ui/Badge.js";
import { cn } from "../lib/cn.js";

// P2: wire to backend model registry — no /api/models endpoint exists yet.
// This catalog + tier list are local UI state only, per the spec's P1 scope
// (model switch has no endpoint). current_model below is the one live field.
const MODEL_OPTIONS = [
  { id: "gemma-2b", label: "Gemma 4 (E2B) ⚡", vendor: "Google — optimizada para dispositivos y baja latencia.", size: "1.4 GB" },
  { id: "gemma-4b", label: "Gemma 4 (E4B)", vendor: "Google — más calidad, mayor uso de VRAM.", size: "2.6 GB" },
  { id: "llama3-8b", label: "LLaMA 3 (8B)", vendor: "Meta — balance entre calidad y velocidad.", size: "4.8 GB" },
  { id: "qwen3-1.7b", label: "Qwen 3 (1.7B)", vendor: "Alibaba — la más rápida del set.", size: "1.1 GB" }
] as const;

type ModelId = (typeof MODEL_OPTIONS)[number]["id"];

const TIERS = [
  { id: "quality", label: "Quality · Gemma 4 (E4B)", tag: "pesado" },
  { id: "balanced", label: "Balanced · LLaMA 3 (8B)", tag: null },
  { id: "fast", label: "Fast · Qwen 3 (1.7B) ⚡", tag: null }
] as const;

type TierId = (typeof TIERS)[number]["id"];

/**
 * Modelo card — model selector + manual Tier LLM control. Design system
 * treatment ported from scratchpad/kira-redesign.html's `.tiers`/`.tier`
 * pattern. Only `current_model` is live (useStatusQuery); the select and
 * tier control are local UI state, P2: wire to backend.
 */
export function ModelCard() {
  const { data } = useStatusQuery();
  const [selectedModel, setSelectedModel] = useState<ModelId>("gemma-2b");
  const [activeTier, setActiveTier] = useState<TierId>("fast");

  const model = MODEL_OPTIONS.find((m) => m.id === selectedModel) ?? MODEL_OPTIONS[0];

  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-bold text-foreground">Modelo</h2>
        <Badge tone="ok">instalado</Badge>
      </div>

      <p className="text-xs text-muted-foreground">
        Modelo activo ahora: <span className="mono text-foreground">{data?.current_model ?? "—"}</span>
      </p>

      <div className="grid gap-2">
        <label htmlFor="model-select" className="label text-[11px] font-semibold uppercase tracking-[0.09em] text-dim">
          Modelo Activo
        </label>
        <select
          id="model-select"
          className="mono h-11 rounded-md border border-border bg-background px-3 text-sm font-semibold text-foreground"
          value={selectedModel}
          onChange={(event) => setSelectedModel(event.target.value as ModelId)}
        >
          {MODEL_OPTIONS.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
        <p className="text-xs leading-relaxed text-muted-foreground">
          {model.vendor} <span className="mono font-semibold text-foreground">{model.size}</span>
        </p>
      </div>

      <div className="mt-2">
        <div className="mb-[6px] text-[11px] font-semibold uppercase tracking-[0.09em] text-dim">Tier LLM manual</div>
        <div role="radiogroup" aria-label="Tier LLM manual" className="grid gap-[6px]">
          {TIERS.map((tier) => {
            const isActive = tier.id === activeTier;
            return (
              <button
                key={tier.id}
                type="button"
                role="radio"
                aria-checked={isActive}
                onClick={() => setActiveTier(tier.id)}
                className={cn(
                  "flex h-[42px] items-center justify-between gap-[10px] rounded-md border border-border-soft bg-card px-[14px] text-[13.5px] font-semibold text-muted-foreground transition-colors",
                  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
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
        <p className="mt-[9px] text-xs leading-relaxed text-muted-foreground">
          El tier cambia solo el modelo de próximos pedidos; perfil y memoria se conservan.
        </p>
      </div>
    </Card>
  );
}
