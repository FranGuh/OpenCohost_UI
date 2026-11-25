import { useState } from "react";
import { FolderOpen } from "lucide-react";
import { Button } from "../../ui/Button.js";
import {
  PiperFolderError,
  usePiperFolderQuery,
  useResetPiperFolderMutation,
  useSetPiperFolderMutation
} from "../../api/tts.js";
import { inTauri } from "../../lib/backendControl.js";
import { middleTruncate } from "../../lib/middleTruncate.js";
import { pickFolder } from "../../lib/pickFolder.js";
import { useT, type TKey } from "../../i18n/t.js";

const PATH_MAX_CHARS = 48;

const ERROR_KEYS = {
  path_empty: "controles.voice.piper.folderError.path_empty",
  path_invalid: "controles.voice.piper.folderError.path_invalid",
  path_not_absolute: "controles.voice.piper.folderError.path_not_absolute",
  path_network_or_device: "controles.voice.piper.folderError.path_network_or_device",
  path_not_found: "controles.voice.piper.folderError.path_not_found",
  path_not_directory: "controles.voice.piper.folderError.path_not_directory",
  path_unreadable: "controles.voice.piper.folderError.path_unreadable",
  config_unreadable: "controles.voice.piper.folderError.config_unreadable",
  config_write_failed: "controles.voice.piper.folderError.config_write_failed"
} as const satisfies Record<string, TKey>;

function errorKey(error: unknown): TKey {
  if (error instanceof PiperFolderError && error.code in ERROR_KEYS) {
    return ERROR_KEYS[error.code as keyof typeof ERROR_KEYS];
  }
  return "controles.voice.piper.folderError.unknown";
}

/** Where the Piper voices are read from, with a native folder picker to change it
 * (same behavior as VrmFolderRow). `disabled` locks it while a voice switch is
 * applying, so the catalog cannot change under a pending switch. */
export function PiperFolderRow({ disabled = false }: { disabled?: boolean }) {
  const t = useT();
  const { data: folder } = usePiperFolderQuery();
  const setFolder = useSetPiperFolderMutation();
  const resetFolder = useResetPiperFolderMutation();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const desktop = inTauri();
  const busy = disabled || setFolder.isPending || resetFolder.isPending;

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
      <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.09em] text-dim">
        <FolderOpen size={14} className="text-muted-foreground" aria-hidden="true" />
        {t("controles.voice.piper.folderLabel")}
      </span>
      {folder ? (
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span
            data-testid="piper-folder-path"
            title={folder.path}
            className="min-w-0 select-text break-all font-mono text-xs text-foreground"
          >
            {middleTruncate(folder.path, PATH_MAX_CHARS)}
          </span>
          <span className="text-xs text-muted-foreground">
            {t(`controles.voice.piper.folder.${folder.source}` as TKey)}
          </span>
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" disabled={busy || !desktop} onClick={() => void change()}>
          {t("controles.voice.piper.folderChange")}
        </Button>
        {folder?.source === "saved" ? (
          <Button type="button" variant="ghost" disabled={busy} onClick={reset}>
            {t("controles.voice.piper.folderReset")}
          </Button>
        ) : null}
      </div>
      {!desktop ? (
        <p className="text-xs leading-relaxed text-muted-foreground">
          {t("controles.voice.piper.folderPickerUnavailable")}
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
