import { Bug, Heart } from "lucide-react";
import { useT } from "../../i18n/t.js";
import { cn } from "../../lib/cn.js";
import { openExternalUrl } from "../../lib/openUrl.js";
import { REPORT_ISSUE_URL, SPONSOR_URL } from "./supportUrls.js";

const ENTRY =
  "inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11.5px] text-muted-foreground transition-colors duration-fast ease-io hover:bg-surface-2 hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

export interface SupportLinksProps {
  showSponsor?: boolean;
  className?: string;
}

/**
 * Compact "Report a problem" and "Sponsor" entry points. Rendered inside the
 * surfaces people see while configuring (first run, engine failure, setup
 * assistant) so they stay reachable whatever the overlay stacking is.
 */
export function SupportLinks({ showSponsor = true, className }: SupportLinksProps) {
  const t = useT();
  return (
    <div role="group" aria-label={t("shell.support.aria")} className={cn("flex flex-wrap items-center gap-1", className)}>
      <button
        type="button"
        aria-label={t("shell.support.report.aria")}
        onClick={() => void openExternalUrl(REPORT_ISSUE_URL)}
        className={ENTRY}
      >
        <Bug size={13} className="shrink-0 text-amber-400" aria-hidden="true" />
        <span>{t("shell.support.report")}</span>
      </button>
      {showSponsor ? (
        <button
          type="button"
          aria-label={t("shell.support.sponsor.aria")}
          onClick={() => void openExternalUrl(SPONSOR_URL)}
          className={ENTRY}
        >
          <Heart size={13} className="shrink-0 text-red-400" aria-hidden="true" />
          <span>{t("shell.support.sponsor")}</span>
        </button>
      ) : null}
    </div>
  );
}
