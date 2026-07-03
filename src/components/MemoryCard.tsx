import { Card } from "./ui/Card.js";
import { Badge } from "./ui/Badge.js";
import { Button } from "./ui/Button.js";
import { MEMORY_STATS } from "../api/mock/fixtures.js";

// P2: wire to backend memory-clear endpoint — none exists yet (spec P1
// non-goal). Counts below come from the mock stats fixture; R8 (privacy):
// this card renders counts ONLY, never raw chat/persona content.
//
// "Limpiar memoria" is destructive and irreversible — unlike the other mock
// cards it must NEVER simulate success (no useMockCommand here). Same
// pattern as PTTCard's "Mapear atajo": permanently disabled + a role="status"
// note, no fake completion.
const COUNT_ROWS: Array<[string, number]> = [
  ["Turnos de sesión", MEMORY_STATS.session_turns],
  ["Entradas de digest", MEMORY_STATS.digest_entries],
  ["Memorias guardadas", MEMORY_STATS.saved_memorias],
  ["Fijadas", MEMORY_STATS.pinned],
  ...Object.entries(MEMORY_STATS.editorial_cards_by_status).map(
    ([status, count]) => [`Tarjetas editoriales · ${status}`, count] as [string, number]
  )
];

export function MemoryCard() {
  return (
    <Card className="flex flex-col p-4">
      <div className="flex items-center justify-between gap-3 border-b border-border-soft pb-3">
        <h2 className="text-sm font-bold text-foreground">Memoria</h2>
      </div>

      <div className="flex flex-col gap-3.5 pt-3.5">
        <section aria-labelledby="memory-clear-label" className="space-y-2">
          <span id="memory-clear-label" className="text-[11px] font-semibold uppercase tracking-[0.09em] text-dim">
            Acciones
          </span>
          <div className="grid grid-cols-[1fr_auto] items-center gap-3">
            <p className="text-xs leading-relaxed text-warn">
              Esta acción borra el historial de conversación de Kira; no se puede deshacer.
            </p>
            <Button type="button" variant="outline" disabled title="Requiere el endpoint de backend">
              Limpiar memoria
            </Button>
          </div>
          <p role="status" className="text-xs leading-relaxed text-muted-foreground">
            Limpiar memoria requiere el endpoint de backend — todavía no existe, así que queda deshabilitado en vez
            de simular un borrado que no ocurrió.
          </p>
        </section>

        <section aria-labelledby="memory-counts-label" className="space-y-2">
          <span id="memory-counts-label" className="text-[11px] font-semibold uppercase tracking-[0.09em] text-dim">
            Memoria — solo conteos (sin contenido de chat)
          </span>
          <div className="flex flex-col gap-2">
            {COUNT_ROWS.map(([label, count]) => (
              <div key={label} className="grid grid-cols-[1fr_auto] items-center gap-3">
                <span className="text-[13px] text-foreground">{label}</span>
                <Badge tone="neutral" mono>
                  {count}
                </Badge>
              </div>
            ))}
          </div>
        </section>
      </div>
    </Card>
  );
}
