import { Card } from "../../ui/Card.js";
import { Badge } from "../../ui/Badge.js";
import { Select } from "../../ui/Select.js";
import { Button } from "../../ui/Button.js";
import { useAvatarConfigQuery, useUpdateAvatarConfigMutation } from "../../api/avatar.js";
import { pickFile } from "../../lib/pickFile.js";
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

/** Extensions offered by the "Cambiar" picker. `state_images` is a plain path
 * map with no server-side extension check (routers/avatar.py only validates
 * the STATE names), so this filter is the only thing steering the owner at an
 * image file — keep it to what OBS/the avatar renderer can actually show. */
const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "gif", "webp", "bmp"];

/**
 * Avatar card — wired to GET/PUT /api/avatar/config (opencohost/api/main.py
 * ~705-729). Mode select PUTs on change; per-state rows render whatever
 * `state_images` path the config actually has (missing state -> "sin
 * imagen", honest instead of a fake fixture path).
 *
 * "Cambiar" opens the native file dialog (Tauri's dialog plugin) and PUTs the
 * chosen absolute path into `state_images`. No upload endpoint is involved and
 * none is needed: `state_images` IS a path map and client and server share a
 * filesystem. The write reaches OBS live — the PUT rebuilds the OBSClient via
 * api/shared.py::apply_config, and obs_client.py resolves the per-state image
 * from the map it was constructed with.
 *
 * There is deliberately NO in-app image preview. One existed and could never
 * paint: the webview cannot read an absolute local path unless Tauri's asset
 * protocol is enabled with a read scope covering arbitrary user paths, which is
 * a real permission widening for a swatch. A control that never works is worse
 * than an absent one, so the resolved path under each row is the confirmation
 * that the change landed, and OBS is where the image is actually verified.
 */
export function AvatarCard() {
  const t = useT();
  const { data, isError: getError } = useAvatarConfigQuery();
  const updateConfig = useUpdateAvatarConfigMutation();

  function applyMode(value: string) {
    updateConfig.mutate({ mode: value });
  }

  async function changeStateImage(state: string) {
    const path = await pickFile({ name: t("controles.avatar.stateImage.filter.name"), extensions: IMAGE_EXTENSIONS });
    // Cancelled (or no native picker) — do nothing, never an error.
    if (path === null) return;
    // Spread the whole current map, not just the touched state: every other
    // state has to survive the write. (The backend merges too, but sending the
    // full map keeps the wire contract self-evident and independent of that.)
    updateConfig.mutate({ state_images: { ...data?.state_images, [state]: path } });
  }

  const modeSelectOptions = MODE_OPTIONS.map((option) => ({ value: option.value, label: t(option.labelKey) }));

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
                      disabled={updateConfig.isPending}
                      aria-label={t("controles.avatar.stateImage.change.aria", { label: t(labelKey) })}
                      title={t("controles.avatar.stateImage.change.hint")}
                      onClick={() => void changeStateImage(state)}
                    >
                      {t("controles.avatar.stateImage.change.action")}
                    </Button>
                  </div>
                ))}
              </div>
              <p role="status" className="text-xs leading-relaxed text-muted-foreground">
                {t("controles.avatar.stateImages.hint")}
              </p>
            </section>
          </>
        )}
      </div>
    </Card>
  );
}
