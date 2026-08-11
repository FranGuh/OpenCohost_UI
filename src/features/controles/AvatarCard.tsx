import { useState } from "react";
import { Card } from "../../ui/Card.js";
import { Badge } from "../../ui/Badge.js";
import { Select } from "../../ui/Select.js";
import { Button } from "../../ui/Button.js";
import { useAvatarConfigQuery, useUpdateAvatarConfigMutation } from "../../api/avatar.js";
import { useT, type TKey } from "../../i18n/t.js";

const MODE_OPTIONS = [
  { value: "image_states", labelKey: "controles.avatar.mode.imageStates" },
  { value: "static", labelKey: "controles.avatar.mode.static" }
] as const satisfies ReadonlyArray<{ value: string; labelKey: TKey }>;

/** Mirrors opencohost/avatar/avatar_config.py::VALID_STATES + the Spanish
 * labels from opencohost/ui/avatar_panel.py's _STATE_LABELS/_STATE_ORDER. */
const STATE_LABELS = [
  ["idle", "controles.avatar.state.idle"],
  ["listening", "controles.avatar.state.listening"],
  ["thinking", "controles.avatar.state.thinking"],
  ["speaking", "controles.avatar.state.speaking"],
  ["speaking_alt", "controles.avatar.state.speakingAlt"],
  ["sleeping", "controles.avatar.state.sleeping"],
  ["angry", "controles.avatar.state.angry"],
  ["error", "controles.avatar.state.error"]
] as const satisfies ReadonlyArray<readonly [string, TKey]>;

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
  const t = useT();
  const { data, isError: getError } = useAvatarConfigQuery();
  const updateConfig = useUpdateAvatarConfigMutation();
  const [previewState, setPreviewState] = useState<string>(STATE_LABELS[0][0]);
  const [previewShown, setPreviewShown] = useState(false);

  function applyMode(value: string) {
    updateConfig.mutate({ mode: value });
  }

  const previewImage = previewShown ? data?.state_images[previewState] : undefined;
  const previewLabelKey = STATE_LABELS.find(([state]) => state === previewState)?.[1];
  const previewLabel = previewLabelKey ? t(previewLabelKey) : undefined;

  const modeSelectOptions = MODE_OPTIONS.map((option) => ({ value: option.value, label: t(option.labelKey) }));
  const stateSelectOptions = STATE_LABELS.map(([state, labelKey]) => ({ value: state, label: t(labelKey) }));

  return (
    <Card className="flex flex-col p-4">
      <div className="flex items-center justify-between gap-3 border-b border-border-soft pb-3">
        <h2 className="text-sm font-bold text-foreground">{t("controles.avatar.card.title")}</h2>
        {updateConfig.isPending && <Badge tone="info">{t("controles.avatar.card.pending")}</Badge>}
      </div>

      <div className="flex flex-col gap-3.5 pt-3.5">
        {getError && (
          <p role="alert" className="text-xs leading-relaxed text-danger">
            {t("controles.avatar.error.load")}
          </p>
        )}
        {updateConfig.isError && (
          <p role="alert" className="text-xs leading-relaxed text-danger">
            {updateConfig.error?.message ?? t("controles.avatar.error.save")}
          </p>
        )}

        {data && (
          <>
            <section aria-labelledby="avatar-mode-label" className="space-y-2">
              <span id="avatar-mode-label" className="text-[11px] font-semibold uppercase tracking-[0.09em] text-dim">
                {t("controles.avatar.modeSelect")}
              </span>
              <Select
                aria-label={t("controles.avatar.modeSelect")}
                value={data.mode}
                disabled={updateConfig.isPending}
                onChange={applyMode}
                options={modeSelectOptions}
              />
            </section>

            <section aria-labelledby="avatar-images-label" className="space-y-2">
              <span
                id="avatar-images-label"
                className="text-[11px] font-semibold uppercase tracking-[0.09em] text-dim"
              >
                {t("controles.avatar.stateImages.eyebrow")}
              </span>
              <div className="flex flex-col gap-2">
                {STATE_LABELS.map(([state, labelKey]) => (
                  <div key={state} className="grid grid-cols-[1fr_auto] items-center gap-3">
                    <div className="flex flex-col">
                      <span className="text-[13px] text-foreground">{t(labelKey)}</span>
                      <span className="mono text-xs text-dim">
                        {data.state_images[state] ?? t("controles.avatar.stateImage.unset")}
                      </span>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      disabled
                      aria-label={t("controles.avatar.stateImage.change.aria", { label: t(labelKey) })}
                      title={t("controles.avatar.stateImage.change.hint")}
                    >
                      {t("controles.avatar.stateImage.change.action")}
                    </Button>
                  </div>
                ))}
              </div>
              <p role="status" className="text-xs leading-relaxed text-muted-foreground">
                {t("controles.avatar.stateImages.hint.prefix")}{" "}
                <span className="mono">POST /api/avatar/upload</span>
                {t("controles.avatar.stateImages.hint.suffix")}
              </p>
            </section>

            <section aria-labelledby="avatar-preview-label" className="space-y-2">
              <span
                id="avatar-preview-label"
                className="text-[11px] font-semibold uppercase tracking-[0.09em] text-dim"
              >
                {t("controles.avatar.preview.eyebrow")}
              </span>
              <div className="grid grid-cols-[1fr_auto] items-center gap-3">
                <Select
                  aria-label={t("controles.avatar.preview.stateSelect.aria")}
                  value={previewState}
                  onChange={setPreviewState}
                  options={stateSelectOptions}
                />
                <Button type="button" variant="outline" onClick={() => setPreviewShown(true)}>
                  {t("controles.avatar.preview.action")}
                </Button>
              </div>
              {previewImage && (
                <>
                  <img
                    src={previewImage}
                    alt={t("controles.avatar.preview.image.alt", { label: previewLabel ?? "" })}
                    className="h-16 w-16 rounded-md border border-border-soft object-cover"
                  />
                  <p role="status" className="text-xs leading-relaxed text-muted-foreground">
                    {t("controles.avatar.preview.hint")}
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
