import { useState } from "react";
import { Card } from "./ui/Card.js";
import { Switch } from "./ui/Switch.js";
import { Button } from "./ui/Button.js";

// P2: wire to backend PTT/LiveAudio config — no endpoint exists yet for the
// PTT toggle or key mapping. Local UI state only, per the spec's P1 scope.
// "Mapear" is an inert stub (B2 judgment-day fix): clicking it surfaces a
// role="status" note instead of silently doing nothing, matching
// MemoryCard's not-wired-yet affordance pattern.
export function PTTCard() {
  const [pttOn, setPttOn] = useState(false);
  const [lastAction, setLastAction] = useState<string | null>(null);

  return (
    <Card className="flex flex-col gap-3 p-4">
      <h2 className="text-sm font-bold text-foreground">PTT · Push-to-Talk</h2>

      <p className="text-xs leading-relaxed text-muted-foreground">
        Mantené la tecla para hablar; soltá para que Kira procese. Con PTT off, escucha continua (LiveAudio).
      </p>

      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-[10px]">
          <Switch checked={pttOn} onChange={setPttOn} aria-label="PTT" />
          <span className="text-[13px] text-foreground">{pttOn ? "PTT on" : "PTT off"}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-[0.09em] text-dim">Tecla</span>
          <kbd className="mono rounded-[6px] border border-border bg-card px-2 py-[3px] text-xs text-foreground">
            F10
          </kbd>
          <Button
            type="button"
            variant="outline"
            className="h-8 px-3 text-[13px]"
            onClick={() => setLastAction("Mapear")}
          >
            Mapear
          </Button>
        </div>
      </div>

      {lastAction && (
        <p role="status" className="text-xs text-muted-foreground">
          {lastAction}: se habilitará cuando el backend lo soporte.
        </p>
      )}
    </Card>
  );
}
