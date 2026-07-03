import { useState } from "react";
import { Card } from "./ui/Card.js";
import { Button } from "./ui/Button.js";

// P2: wire to backend memory/editorial-cards endpoints — none exist yet
// (spec P1 non-goals: memorias, editorial-cards). These are inert stubs that
// surface a "not wired yet" note instead of fabricating a call.
export function MemoryCard() {
  const [lastAction, setLastAction] = useState<string | null>(null);

  return (
    <Card className="flex flex-col gap-3 p-4">
      <h2 className="text-sm font-bold text-foreground">Memoria</h2>

      <Button type="button" variant="outline" className="w-full justify-center" onClick={() => setLastAction("Limpiar memoria")}>
        Limpiar memoria
      </Button>
      <p className="text-xs leading-relaxed text-warn">
        Esta acción borra el historial de conversación de Kira; no se puede deshacer.
      </p>

      <div className="grid gap-[9px]">
        <Button
          type="button"
          variant="ghost"
          className="w-full justify-center bg-[var(--accent-soft)] text-primary"
          onClick={() => setLastAction("Tarjetas editoriales")}
        >
          Tarjetas editoriales · 1
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="w-full justify-center bg-[var(--accent-soft)] text-primary"
          onClick={() => setLastAction("Memoria de Kira")}
        >
          Memoria de Kira
        </Button>
      </div>

      {lastAction && (
        <p role="status" className="text-xs text-muted-foreground">
          {lastAction}: se habilitará cuando el backend lo soporte.
        </p>
      )}
    </Card>
  );
}
