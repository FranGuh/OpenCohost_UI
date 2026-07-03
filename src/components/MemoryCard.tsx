import { useState } from "react";
import { Card } from "./ui/Card.js";
import { Badge } from "./ui/Badge.js";
import { Button } from "./ui/Button.js";
import { useMemoriaStatsQuery } from "../api/memoria.js";
import { useEngineCommand } from "../api/engineCommand.js";

// R8 (privacy): this card renders counts ONLY, never raw chat/persona content.
function countRows(stats: {
  session_turns: number;
  digest_entries: number;
  saved_memorias: number;
  pinned: number;
  editorial_cards_by_status: Record<string, number>;
}): Array<[string, number]> {
  return [
    ["Turnos de sesión", stats.session_turns],
    ["Entradas de digest", stats.digest_entries],
    ["Memorias guardadas", stats.saved_memorias],
    ["Fijadas", stats.pinned],
    ...Object.entries(stats.editorial_cards_by_status).map(
      ([status, count]) => [`Tarjetas editoriales · ${status}`, count] as [string, number]
    )
  ];
}

/**
 * Memoria card — counts inspector wired to GET /api/memoria/stats.
 * "Limpiar memoria" is destructive and irreversible, so it keeps a two-step
 * confirm (same pattern as ProfileEditor's delete-profile confirm) before
 * dispatching `clear_history` via useEngineCommand — no confirm dialog
 * component, just a local confirm/cancel row.
 */
export function MemoryCard() {
  const { data, isError: statsError } = useMemoriaStatsQuery();
  const clearCommand = useEngineCommand<void>();
  const [confirming, setConfirming] = useState(false);

  function handleConfirmClear() {
    setConfirming(false);
    void clearCommand.run("clear_history");
  }

  return (
    <Card className="flex flex-col p-4">
      <div className="flex items-center justify-between gap-3 border-b border-border-soft pb-3">
        <h2 className="text-sm font-bold text-foreground">Memoria</h2>
        {clearCommand.pending && <Badge tone="info">aplicando…</Badge>}
      </div>

      <div className="flex flex-col gap-3.5 pt-3.5">
        {clearCommand.isError && (
          <p role="alert" className="text-xs leading-relaxed text-danger">
            {clearCommand.error?.message ?? "No se pudo limpiar la memoria."}
          </p>
        )}

        <section aria-labelledby="memory-clear-label" className="space-y-2">
          <span id="memory-clear-label" className="text-[11px] font-semibold uppercase tracking-[0.09em] text-dim">
            Acciones
          </span>
          {confirming ? (
            <div className="flex flex-col gap-2">
              <p role="alert" className="text-xs text-danger">
                ¿Limpiar memoria de Kira? No se puede deshacer.
              </p>
              <div className="flex gap-2">
                <Button type="button" variant="ghost" onClick={() => setConfirming(false)}>
                  Cancelar
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  autoFocus
                  disabled={clearCommand.pending}
                  onClick={handleConfirmClear}
                >
                  Confirmar
                </Button>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-[1fr_auto] items-center gap-3">
              <p className="text-xs leading-relaxed text-warn">
                Esta acción borra el historial de conversación de Kira; no se puede deshacer.
              </p>
              <Button type="button" variant="outline" disabled={clearCommand.pending} onClick={() => setConfirming(true)}>
                Limpiar memoria
              </Button>
            </div>
          )}
        </section>

        <section aria-labelledby="memory-counts-label" className="space-y-2">
          <span id="memory-counts-label" className="text-[11px] font-semibold uppercase tracking-[0.09em] text-dim">
            Memoria — solo conteos (sin contenido de chat)
          </span>
          {statsError && (
            <p role="alert" className="text-xs leading-relaxed text-danger">
              No se pudieron leer los conteos de memoria.
            </p>
          )}
          {data && (
            <div className="flex flex-col gap-2">
              {countRows(data).map(([label, count]) => (
                <div key={label} className="grid grid-cols-[1fr_auto] items-center gap-3">
                  <span className="text-[13px] text-foreground">{label}</span>
                  <Badge tone="neutral" mono>
                    {count}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </Card>
  );
}
