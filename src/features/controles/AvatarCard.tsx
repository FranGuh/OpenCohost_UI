import { useState } from "react";
import { Card } from "../../ui/Card.js";
import { Badge } from "../../ui/Badge.js";
import { Select } from "../../ui/Select.js";
import { Button } from "../../ui/Button.js";
import { useAvatarConfigQuery, useUpdateAvatarConfigMutation } from "../../api/avatar.js";

const MODE_OPTIONS = [
  { value: "image_states", label: "Imágenes por estado" },
  { value: "static", label: "Estático" }
];

/** Mirrors opencohost/avatar/avatar_config.py::VALID_STATES + the Spanish
 * labels from opencohost/ui/avatar_panel.py's _STATE_LABELS/_STATE_ORDER. */
const STATE_LABELS: Array<[string, string]> = [
  ["idle", "en vivo"],
  ["listening", "escuchando"],
  ["thinking", "pensando"],
  ["speaking", "hablando"],
  ["speaking_alt", "hablando (alt)"],
  ["sleeping", "en espera"],
  ["angry", "enfadada"],
  ["error", "error"]
];

/**
 * Avatar card — wired to GET/PUT /api/avatar/config (opencohost/api/main.py
 * ~705-729). Mode select PUTs on change; per-state rows render whatever
 * `state_images` path the config actually has (missing state -> "sin
 * imagen", honest instead of a fake fixture path).
 *
 * "Cambiar" (per-state image upload) stays permanently disabled — no
 * `POST /api/avatar/upload` endpoint exists (browser multipart vs desktop
 * file picker is an owner decision), a role="status" note discloses why.
 *
 * "Probar" previews a configured state's image locally (swatch) — still
 * never sent to OBS/stream, just reads the real path out of `state_images`.
 */
export function AvatarCard() {
  const { data, isError: getError } = useAvatarConfigQuery();
  const updateConfig = useUpdateAvatarConfigMutation();
  const [previewState, setPreviewState] = useState(STATE_LABELS[0][0]);
  const [previewShown, setPreviewShown] = useState(false);

  function applyMode(value: string) {
    updateConfig.mutate({ mode: value });
  }

  const previewImage = previewShown ? data?.state_images[previewState] : undefined;
  const previewLabel = STATE_LABELS.find(([state]) => state === previewState)?.[1];

  return (
    <Card className="flex flex-col p-4">
      <div className="flex items-center justify-between gap-3 border-b border-border-soft pb-3">
        <h2 className="text-sm font-bold text-foreground">Avatar</h2>
        {updateConfig.isPending && <Badge tone="info">aplicando…</Badge>}
      </div>

      <div className="flex flex-col gap-3.5 pt-3.5">
        {getError && (
          <p role="alert" className="text-xs leading-relaxed text-danger">
            No se pudo leer la configuración del avatar.
          </p>
        )}
        {updateConfig.isError && (
          <p role="alert" className="text-xs leading-relaxed text-danger">
            {updateConfig.error?.message ?? "No se pudo guardar la configuración del avatar."}
          </p>
        )}

        {data && (
          <>
            <section aria-labelledby="avatar-mode-label" className="space-y-2">
              <span id="avatar-mode-label" className="text-[11px] font-semibold uppercase tracking-[0.09em] text-dim">
                Modo
              </span>
              {/* El select no tiene diseño como los demás*/}
              <Select
                aria-label="Modo"
                value={data.mode}
                disabled={updateConfig.isPending}
                onChange={(event) => applyMode(event.target.value)}
              >
                {MODE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </section>

            <section aria-labelledby="avatar-images-label" className="space-y-2">
              <span
                id="avatar-images-label"
                className="text-[11px] font-semibold uppercase tracking-[0.09em] text-dim"
              >
                Imágenes por estado
              </span>
              <div className="flex flex-col gap-2">
                {STATE_LABELS.map(([state, label]) => (
                  <div key={state} className="grid grid-cols-[1fr_auto] items-center gap-3">
                    <div className="flex flex-col">
                      <span className="text-[13px] text-foreground">{label}</span>
                      <span className="mono text-xs text-dim">{data.state_images[state] ?? "sin imagen"}</span>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      disabled
                      aria-label={`Cambiar imagen — ${label}`}
                      title="Requiere selector de archivo (app de escritorio)"
                    >
                      Cambiar
                    </Button>
                  </div>
                ))}
              </div>
              <p role="status" className="text-xs leading-relaxed text-muted-foreground">
                Cambiar imagen requiere selector de archivo — la app de escritorio (Tauri) lo resuelve; un tab de
                navegador necesitaría subida multipart y no existe endpoint{" "}
                <span className="mono">POST /api/avatar/upload</span> todavía.
              </p>
            </section>

            <section aria-labelledby="avatar-preview-label" className="space-y-2">
              <span
                id="avatar-preview-label"
                className="text-[11px] font-semibold uppercase tracking-[0.09em] text-dim"
              >
                Probar
              </span>
              <div className="grid grid-cols-[1fr_auto] items-center gap-3">
                {/* El select no tiene diseño como los demás*/}
                <Select
                  aria-label="Estado a probar"
                  value={previewState}
                  onChange={(event) => setPreviewState(event.target.value)}
                >
                  {STATE_LABELS.map(([state, label]) => (
                    <option key={state} value={state}>
                      {label}
                    </option>
                  ))}
                </Select>
                <Button type="button" variant="outline" onClick={() => setPreviewShown(true)}>
                  Probar
                </Button>
              </div>
              {previewImage && (
                <>
                  <img
                    src={previewImage}
                    alt={`Vista previa — ${previewLabel}`}
                    className="h-16 w-16 rounded-md border border-border-soft object-cover"
                  />
                  <p role="status" className="text-xs leading-relaxed text-muted-foreground">
                    Vista previa local — no se envía a OBS ni al stream todavía.
                  </p>
                </>
              )}
            </section>
          </>
        )}
      </div>
    </Card>
  );
}
