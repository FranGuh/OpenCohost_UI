import { useRef, useState } from "react";
import { Card } from "../../ui/Card.js";
import { Badge } from "../../ui/Badge.js";
import { Select } from "../../ui/Select.js";
import { Button } from "../../ui/Button.js";
import {
  avatarImageUrl,
  useAvatarConfigQuery,
  useUpdateAvatarConfigMutation,
  useUploadAvatarImageMutation
} from "../../api/avatar.js";
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

/** Must stay in sync with UPLOAD_EXTENSIONS server-side
 * (opencohost/avatar/avatar_config.py) — the picker filter is UX only, the
 * server re-validates extension + magic bytes and 422s anything else. */
const ACCEPT = ".png,.jpg,.jpeg,.gif,.webp,.bmp";

/** Local preview URL for a just-picked file. Null where `createObjectURL`
 * is unavailable (jsdom) — the upload still proceeds, only the instant
 * preview is skipped. */
function previewUrlFor(file: File): string | null {
  try {
    return typeof URL.createObjectURL === "function" ? URL.createObjectURL(file) : null;
  } catch {
    return null;
  }
}

/**
 * Avatar card — wired to GET/PUT /api/avatar/config plus
 * POST /api/avatar/upload (opencohost/api/routers/avatar.py).
 * Mode select PUTs on change; per-state rows render the served image
 * (GET /api/avatar/image?state=) as a thumbnail next to the stored path.
 *
 * "Cambiar" opens a plain `<input type=file>` and POSTs the raw bytes: the
 * server validates and COPIES them into the user avatar dir, so the source
 * file can be moved or deleted afterwards (this replaces the old
 * path-reference behavior, where moving the file silently emptied the
 * state). No Tauri dialog plugin is involved — the webview file input works
 * without extra capabilities, and the served URL (not an absolute local
 * path) is what makes the in-app preview possible at all.
 */
export function AvatarCard() {
  const t = useT();
  const { data, isError: getError } = useAvatarConfigQuery();
  const updateConfig = useUpdateAvatarConfigMutation();
  const uploadImage = useUploadAvatarImageMutation();

  const [uploadingState, setUploadingState] = useState<string | null>(null);
  // Just-picked local preview per state (object URL, replaced by the served
  // URL once the upload lands and the config query refreshes).
  const [previews, setPreviews] = useState<Record<string, string>>({});
  // Served thumbnails that 404d (stale map entry) — hidden so the row falls
  // back to the honest "sin imagen" copy instead of a broken icon.
  const [broken, setBroken] = useState<Record<string, boolean>>({});
  const fileInput = useRef<HTMLInputElement>(null);
  const pendingState = useRef<string | null>(null);

  function applyMode(value: string) {
    updateConfig.mutate({ mode: value });
  }

  function requestFile(state: string) {
    pendingState.current = state;
    fileInput.current?.click();
  }

  async function onFileChosen(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // Reset so picking the same file twice still fires onChange.
    event.target.value = "";
    const state = pendingState.current;
    pendingState.current = null;
    // Cancelled picker — a no-op, never an error.
    if (!file || !state) return;
    const previewUrl = previewUrlFor(file);
    if (previewUrl) setPreviews((current) => ({ ...current, [state]: previewUrl }));
    setBroken((current) => ({ ...current, [state]: false }));
    setUploadingState(state);
    try {
      await uploadImage.mutateAsync({ state, file });
      // Upload landed: drop the blob preview (revoking its object URL) so the
      // served URL actually takes over instead of lingering forever.
      setPreviews((current) => {
        const prev = current[state];
        if (!prev) return current;
        try {
          if (typeof URL.revokeObjectURL === "function") URL.revokeObjectURL(prev);
        } catch {
          // Preview cleanup must never break a successful upload.
        }
        const next = { ...current };
        delete next[state];
        return next;
      });
    } catch {
      // Surfaced via uploadImage.isError → alert below; swallowing here keeps
      // a rejected upload from becoming an unhandled promise rejection.
    } finally {
      setUploadingState(null);
    }
  }

  const busy = updateConfig.isPending || uploadImage.isPending;
  const modeSelectOptions = MODE_OPTIONS.map((option) => ({ value: option.value, label: t(option.labelKey) }));

  return (
    <Card className="flex flex-col p-4">
      <div className="flex items-center justify-between gap-3 border-b border-border-soft pb-3">
        <h2 className="text-sm font-bold text-foreground">{t("controles.avatar.card.title")}</h2>
        {busy && <Badge tone="info">{t("controles.avatar.card.pending")}</Badge>}
      </div>

      <div className="flex flex-col gap-3.5 pt-3.5">
        {getError && (
          <p role="alert" className="text-xs leading-relaxed text-danger">
            {t("controles.avatar.error.load")}
          </p>
        )}
        {(updateConfig.isError || uploadImage.isError) && (
          <p role="alert" className="text-xs leading-relaxed text-danger">
            {updateConfig.error?.message ?? uploadImage.error?.message ?? t("controles.avatar.error.save")}
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
                disabled={busy}
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
                  <div key={state} className="grid grid-cols-[auto_1fr_auto] items-center gap-3">
                    {(previews[state] ?? (data.state_images[state] && !broken[state] ? avatarImageUrl(state) : null)) ? (
                      <img
                        src={previews[state] ?? avatarImageUrl(state)}
                        alt={t("controles.avatar.stateImage.preview.alt", { label: t(labelKey) })}
                        onError={() => setBroken((current) => ({ ...current, [state]: true }))}
                        className="h-10 w-10 rounded-md border border-border-soft object-cover"
                      />
                    ) : (
                      <span aria-hidden="true" className="h-10 w-10 rounded-md border border-border-soft bg-background" />
                    )}
                    <div className="flex min-w-0 flex-col">
                      <span className="text-[13px] text-foreground">{t(labelKey)}</span>
                      <span className="mono truncate text-xs text-dim">
                        {uploadingState === state
                          ? t("controles.avatar.stateImage.uploading")
                          : (data.state_images[state] ?? t("controles.avatar.stateImage.unset"))}
                      </span>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={busy}
                      aria-label={t("controles.avatar.stateImage.change.aria", { label: t(labelKey) })}
                      title={t("controles.avatar.stateImage.change.hint")}
                      onClick={() => void requestFile(state)}
                    >
                      {t("controles.avatar.stateImage.change.action")}
                    </Button>
                  </div>
                ))}
              </div>
              <input
                ref={fileInput}
                type="file"
                accept={ACCEPT}
                className="hidden"
                aria-hidden="true"
                tabIndex={-1}
                onChange={(event) => void onFileChosen(event)}
              />
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
