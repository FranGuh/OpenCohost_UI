import React, { useEffect, useState } from "react";
import { Monitor, AlertCircle } from "lucide-react";
import { getVrmModels } from "../../api/avatar.js";
import { useAvatarPresentationStore } from "../../store/avatarPresentationStore.js";
import {
  getDesktopState,
  setDesktopMode,
  onDesktopState,
  type DesktopSnapshot,
} from "./desktopClient.js";
import { useT } from "../../i18n/t.js";

export interface DesktopModeButtonProps {
  /** Title-bar variant: pill styled like the status chips, label collapses to
   * the icon below 2xl, and the error floats under the bar instead of growing it. */
  compact?: boolean;
}

/** Maps the host's closed set of companion error codes to localized copy. */
function snapshotErrorMessage(code: string | null, t: ReturnType<typeof useT>): string | null {
  if (code === "companion_load_failed") return t("experiencia.desktop.error.loadFailed");
  if (code === "companion_build_failed") return t("experiencia.desktop.error.buildFailed");
  return null;
}

export function DesktopModeButton({ compact = false }: DesktopModeButtonProps = {}) {
  const t = useT();
  const [snapshot, setSnapshot] = useState<DesktopSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isTauriEnv, setIsTauriEnv] = useState<boolean>(true);
  const selectedModel = useAvatarPresentationStore((s) => s.selectedModel);
  const setSelectedModel = useAvatarPresentationStore((s) => s.setSelectedModel);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;
    onDesktopState((state) => {
      setSnapshot(state);
    })
      .then((fn) => {
        // The subscription can resolve after unmount; release it right away.
        if (disposed) fn();
        else unlisten = fn;
      })
      .catch(() => {
        setIsTauriEnv(false);
      });

    getDesktopState()
      .then((state) => {
        setSnapshot(state);
        setIsTauriEnv(true);
      })
      .catch(() => {
        setIsTauriEnv(false);
      });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  // Subscribe to model changes while enabled
  useEffect(() => {
    if (snapshot?.enabled && selectedModel && snapshot.model !== selectedModel) {
      setDesktopMode(true, selectedModel).then(setSnapshot).catch(() => {});
    }
  }, [selectedModel, snapshot?.enabled, snapshot?.model]);

  const handleToggle = async () => {
    setError(null);
    if (!snapshot?.enabled) {
      let modelToUse = selectedModel;
      if (!modelToUse) {
        try {
          const models = await getVrmModels();
          const fallback = models.find((m) => m.bundled) ?? models[0];
          if (fallback?.filename) {
            modelToUse = fallback.filename;
            setSelectedModel(modelToUse);
          }
        } catch {
          // Handled below by showing the no-model error.
        }
      }
      if (!modelToUse) {
        setError(t("experiencia.desktop.toggle.noModel"));
        return;
      }
      try {
        const next = await setDesktopMode(true, modelToUse);
        setSnapshot(next);
      } catch (err) {
        setError(String(err));
      }
    } else {
      try {
        const next = await setDesktopMode(false, selectedModel ?? "");
        setSnapshot(next);
      } catch (err) {
        setError(String(err));
      }
    }
  };

  if (!isTauriEnv) {
    return null;
  }

  const isEnabled = snapshot?.enabled ?? false;
  const snapshotError = snapshotErrorMessage(snapshot?.error ?? null, t);
  const shownError = error ?? snapshotError;

  return (
    <div className={compact ? "relative shrink-0" : "flex flex-col items-end gap-1"}>
      <button
        type="button"
        onClick={handleToggle}
        title={isEnabled ? t("experiencia.desktop.toggle.disable") : t("experiencia.desktop.toggle.enable")}
        aria-label={t("experiencia.desktop.toggle.aria")}
        aria-pressed={isEnabled}
        style={compact ? { WebkitAppRegion: "no-drag" } : undefined}
        className={
          compact
            ? `relative z-20 inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold transition-colors ${
                isEnabled
                  ? "border-transparent bg-primary text-primary-foreground hover:bg-primary/90"
                  : "border-border bg-surface-2 text-muted-foreground hover:bg-surface-3 hover:text-foreground"
              }`
            : `inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold shadow-md transition-colors ${
                isEnabled
                  ? "bg-primary text-primary-foreground hover:bg-primary/90"
                  : "bg-surface-2 text-foreground hover:bg-surface-3"
              }`
        }
      >
        <Monitor size={14} aria-hidden="true" />
        <span className={compact ? "hidden 2xl:inline" : undefined}>{isEnabled ? t("experiencia.desktop.toggle.disable") : t("experiencia.desktop.toggle.enable")}</span>
      </button>
      {shownError && (
        <span
          role="alert"
          className={`flex items-center gap-1 rounded bg-danger-bg px-2 py-0.5 text-[11px] text-danger ${
            compact ? "absolute right-0 top-full z-50 mt-1 w-max max-w-xs shadow-md" : ""
          }`}
        >
          <AlertCircle size={12} />
          <span>{shownError}</span>
        </span>
      )}
    </div>
  );
}
