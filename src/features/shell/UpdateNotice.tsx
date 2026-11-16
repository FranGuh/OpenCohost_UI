import { useEffect } from "react";
import { getUpdateStatus } from "../../api/update.js";
import { openExternalUrl } from "../../lib/openUrl.js";
import { useT } from "../../i18n/t.js";
import { useToast } from "../../ui/Toast.js";

// Lowercase on purpose: GitHub returns the repo's canonical casing; compared case-insensitively.
const RELEASE_URL_PREFIX = "https://github.com/plynte-labs/opencohost/";

// One check and at most one notice per launch, even if the component remounts.
let started = false;

export function resetUpdateNoticeForTests(): void {
  started = false;
}

/** Renders nothing. After the backend is ready, asks once whether a newer
 * release exists and, if so, raises a dismissible toast with a link to its
 * GitHub page. Fails silent: no notice on any error. */
export function UpdateNotice() {
  const { toast, dismiss } = useToast();
  const t = useT();

  useEffect(() => {
    if (started) return;
    started = true;
    void getUpdateStatus()
      .then((status) => {
        const url = status.url;
        if (!status.newer || !status.latest || !url || url.slice(0, RELEASE_URL_PREFIX.length).toLowerCase() !== RELEASE_URL_PREFIX) return;
        const id = toast(
          <div className="flex flex-col gap-2">
            <span>{t("shell.update.available", { latest: status.latest })}</span>
            <button
              type="button"
              onClick={() => {
                void openExternalUrl(url);
                dismiss(id);
              }}
              className="self-start rounded-md bg-surface-2 px-2.5 py-1 text-[12px] font-medium text-foreground hover:bg-surface-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
            >
              {t("shell.update.open")}
            </button>
          </div>,
          { tone: "info", duration: 0 }
        );
      })
      .catch(() => {
        // Best-effort: an unreachable backend or GitHub never shows anything.
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per launch by design
  }, []);

  return null;
}
