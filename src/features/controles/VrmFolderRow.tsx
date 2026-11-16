import { useState } from "react";
import { Button } from "../../ui/Button.js";
import {
  VrmFolderError,
  useResetVrmFolderMutation,
  useSetVrmFolderMutation,
  useVrmFolderQuery
} from "../../api/avatar.js";
import { inTauri } from "../../lib/backendControl.js";
import { middleTruncate } from "../../lib/middleTruncate.js";
import { pickFolder } from "../../lib/pickFolder.js";
import { useT, type TKey } from "../../i18n/t.js";

const PATH_MAX_CHARS = 48;

const ERROR_KEYS = {
  path_empty: "controles.avatar.vrm.error.path_empty",
  path_invalid: "controles.avatar.vrm.error.path_invalid",
  path_not_absolute: "controles.avatar.vrm.error.path_not_absolute",
  path_network_or_device: "controles.avatar.vrm.error.path_network_or_device",
  path_not_found: "controles.avatar.vrm.error.path_not_found",
  path_not_directory: "controles.avatar.vrm.error.path_not_directory",
  path_unreadable: "controles.avatar.vrm.error.path_unreadable",
  config_unreadable: "controles.avatar.vrm.error.config_unreadable",
  config_write_failed: "controles.avatar.vrm.error.config_write_failed"
} as const satisfies Record<string, TKey>;

function errorKey(error: unknown): TKey {
  if (error instanceof VrmFolderError && error.code in ERROR_KEYS) {
    return ERROR_KEYS[error.code as keyof typeof ERROR_KEYS];
  }
  return "controles.avatar.vrm.error.unknown";
}

/** Where the VRM models are read from, with a native folder picker to change it.
 * The server resolves the folder per request: a change needs no restart. */
export function VrmFolderRow() {
  const t = useT();
  const { data: folder } = useVrmFolderQuery();
  const setFolder = useSetVrmFolderMutation();
  const resetFolder = useResetVrmFolderMutation();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const desktop = inTauri();
  const busy = setFolder.isPending || resetFolder.isPending;

  async function change() {
    setErrorMessage(null);
    const picked = await pickFolder(folder?.path);
    if (!picked) return; // cancelled: nothing to do, never an error
    setFolder.mutate(picked, { onError: (error) => setErrorMessage(t(errorKey(error))) });
  }

  function reset() {
    setErrorMessage(null);
    resetFolder.mutate(undefined, { onError: (error) => setErrorMessage(t(errorKey(error))) });
  }

  return (
    <div className="space-y-1.5">
      <span className="text-[11px] font-semibold uppercase tracking-[0.09em] text-dim">
        {t("controles.avatar.vrm.folderLabel")}
      </span>
      {folder ? (
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span
            data-testid="vrm-folder-path"
            title={folder.path}
            className="min-w-0 select-text break-all font-mono text-xs text-foreground"
          >
            {middleTruncate(folder.path, PATH_MAX_CHARS)}
          </span>
          <span className="text-xs text-muted-foreground">
            {t(`controles.avatar.vrm.folder.${folder.source}` as TKey)}
          </span>
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" disabled={busy || !desktop} onClick={() => void change()}>
          {t("controles.avatar.vrm.folderChange")}
        </Button>
        {folder?.source === "saved" ? (
          <Button type="button" variant="ghost" disabled={busy} onClick={reset}>
            {t("controles.avatar.vrm.folderReset")}
          </Button>
        ) : null}
      </div>
      {!desktop ? (
        <p className="text-xs leading-relaxed text-muted-foreground">
          {t("controles.avatar.vrm.folderPickerUnavailable")}
        </p>
      ) : null}
      {errorMessage ? (
        <p role="alert" className="text-xs leading-relaxed text-danger">
          {errorMessage}
        </p>
      ) : null}
    </div>
  );
}
