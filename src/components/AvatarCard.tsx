import { useState } from "react";
import { Card } from "./ui/Card.js";
import { Badge } from "./ui/Badge.js";
import { Select } from "./ui/Select.js";
import { Button } from "./ui/Button.js";
import { useMockCommand } from "../api/mock/useMockCommand.js";
import { AVATAR_FIXTURE, type AvatarMode } from "../api/mock/fixtures.js";

const MODE_OPTIONS: Array<{ value: AvatarMode; label: string }> = [
  { value: "por_estado", label: "Imágenes por estado" },
  { value: "estatico", label: "Estático" }
];

/**
 * Avatar card — parity with opencohost/ui/avatar_panel.py. Mode select and
 * per-state image rows, both mocked (no /api/avatar/config endpoint yet).
 * Mode owns its own useMockCommand instance (same accepted != applied
 * contract as the other Controles cards).
 *
 * "Cambiar" stays permanently disabled (USER-ASSIST decision, flagged): the
 * upload UX (browser multipart vs desktop file picker) is an owner decision,
 * so no fake upload — a role="status" note discloses why.
 *
 * "Probar" previews a state locally (image swatch) — mocked, never sent to
 * OBS/stream (no /api/avatar/* endpoint to send it through).
 */
export function AvatarCard() {
  const [mode, setMode] = useState<AvatarMode>(AVATAR_FIXTURE.mode);
  const [previewState, setPreviewState] = useState(AVATAR_FIXTURE.images[0].state);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const modeCommand = useMockCommand<AvatarMode>();
  const previewCommand = useMockCommand<string>();

  function applyMode(value: AvatarMode) {
    setMode(value);
    void modeCommand.run(value);
  }

  async function runPreview() {
    await previewCommand.run(previewState);
    setPreviewImage(previewState);
  }

  const previewEntry = AVATAR_FIXTURE.images.find((entry) => entry.state === previewImage);

  return (
    <Card className="flex flex-col p-4">
      <div className="flex items-center justify-between gap-3 border-b border-border-soft pb-3">
        <h2 className="text-sm font-bold text-foreground">Avatar</h2>
        {modeCommand.pending && <Badge tone="info">aplicando…</Badge>}
      </div>

      <div className="flex flex-col gap-3.5 pt-3.5">
        <p role="status" className="text-xs leading-relaxed text-muted-foreground">
          Estos cambios no se guardan todavía — no existe endpoint <span className="mono">/api/avatar/config</span>{" "}
          en el backend.
        </p>

        <section aria-labelledby="avatar-mode-label" className="space-y-2">
          <span id="avatar-mode-label" className="text-[11px] font-semibold uppercase tracking-[0.09em] text-dim">
            Modo
          </span>
          <Select
            aria-label="Modo"
            value={mode}
            disabled={modeCommand.pending}
            onChange={(event) => applyMode(event.target.value as AvatarMode)}
          >
            {MODE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </section>

        <section aria-labelledby="avatar-images-label" className="space-y-2">
          <span id="avatar-images-label" className="text-[11px] font-semibold uppercase tracking-[0.09em] text-dim">
            Imágenes por estado
          </span>
          <div className="flex flex-col gap-2">
            {AVATAR_FIXTURE.images.map((entry) => (
              <div key={entry.state} className="grid grid-cols-[1fr_auto] items-center gap-3">
                <div className="flex flex-col">
                  <span className="text-[13px] text-foreground">{entry.label}</span>
                  <span className="mono text-xs text-dim">{entry.image}</span>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  disabled
                  aria-label={`Cambiar imagen — ${entry.label}`}
                  title="Requiere selector de archivo (app de escritorio)"
                >
                  Cambiar
                </Button>
              </div>
            ))}
          </div>
          <p role="status" className="text-xs leading-relaxed text-muted-foreground">
            Cambiar imagen requiere selector de archivo — la app de escritorio (Tauri) lo resuelve; un tab de
            navegador necesitaría subida multipart y no existe endpoint <span className="mono">POST /api/avatar/upload</span>{" "}
            todavía.
          </p>
        </section>

        <section aria-labelledby="avatar-preview-label" className="space-y-2">
          <span id="avatar-preview-label" className="text-[11px] font-semibold uppercase tracking-[0.09em] text-dim">
            Probar
          </span>
          <div className="grid grid-cols-[1fr_auto] items-center gap-3">
            <Select
              aria-label="Estado a probar"
              value={previewState}
              disabled={previewCommand.pending}
              onChange={(event) => setPreviewState(event.target.value)}
            >
              {AVATAR_FIXTURE.images.map((entry) => (
                <option key={entry.state} value={entry.state}>
                  {entry.label}
                </option>
              ))}
            </Select>
            <Button type="button" variant="outline" disabled={previewCommand.pending} onClick={() => void runPreview()}>
              Probar
            </Button>
          </div>
          {previewEntry && (
            <>
              <img
                src={previewEntry.image}
                alt={`Vista previa — ${previewEntry.label}`}
                className="h-16 w-16 rounded-md border border-border-soft object-cover"
              />
              <p role="status" className="text-xs leading-relaxed text-muted-foreground">
                Vista previa local — no se envía a OBS ni al stream todavía.
              </p>
            </>
          )}
        </section>
      </div>
    </Card>
  );
}
