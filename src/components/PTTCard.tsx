import { useState } from "react";
import { Card } from "./ui/Card.js";
import { Switch } from "./ui/Switch.js";
import { Button } from "./ui/Button.js";
import { emitAppEvent } from "../lib/appEvents.js";

// P2: wire to backend PTT/LiveAudio config — no endpoint exists yet for the
// PTT toggle. Local UI state only.
//
// "Mapear atajo" stays permanently disabled (USER-ASSIST decision, flagged):
// a browser tab cannot register a global hotkey — only the Tauri desktop
// shell can. No fake capture, just a clear role="status" note.
export function PTTCard() {
  const [pttOn, setPttOn] = useState(false);

  // No mutation exists yet for PTT (see the P2 note above) — this is the one
  // legitimate direct emitAppEvent call (item A blueprint §7), going through
  // the identical whitelist/sanitizer as every mutation-driven event. Once
  // PTT grows a real backend mutation, delete this and add meta.event there.
  function handleToggle(next: boolean) {
    setPttOn(next);
    emitAppEvent({ source: "ptt", action: "toggle", detail: next ? "on" : "off", tone: "neutral" });
  }

  return (
    <Card className="flex flex-col p-4">
      <div className="border-b border-border-soft pb-3">
        <h2 className="text-sm font-bold text-foreground">PTT · Push-to-Talk</h2>
      </div>

      <div className="flex flex-col gap-3.5 pt-3.5">
        <p className="text-xs leading-relaxed text-muted-foreground">
          Mantené la tecla para hablar; soltá para que Kira procese. Con PTT off, escucha continua (LiveAudio).
        </p>

        <section aria-labelledby="ptt-toggle-label" className="space-y-2">
          <span id="ptt-toggle-label" className="text-[11px] font-semibold uppercase tracking-[0.09em] text-dim">
            Intent
          </span>
          <div className="grid grid-cols-[1fr_auto] items-center gap-3">
            <span className="text-[13px] text-foreground">{pttOn ? "PTT on" : "PTT off"}</span>
            <Switch checked={pttOn} onChange={handleToggle} aria-label="PTT" />
          </div>
        </section>

        <section aria-labelledby="ptt-hotkey-label" className="space-y-2">
          <span id="ptt-hotkey-label" className="text-[11px] font-semibold uppercase tracking-[0.09em] text-dim">
            Atajo de teclado
          </span>
          <div className="grid grid-cols-[1fr_auto] items-center gap-3">
            <kbd className="mono w-fit rounded-[6px] border border-border bg-card px-2 py-[3px] text-xs text-foreground">
              F10
            </kbd>
            <Button type="button" variant="outline" disabled title="Requiere la app de escritorio">
              Mapear atajo
            </Button>
          </div>
          <p role="status" className="text-xs text-muted-foreground">
            Mapear atajo requiere la app de escritorio (Tauri) — un tab de navegador no puede registrar un atajo
            global.
          </p>
        </section>
      </div>
    </Card>
  );
}
