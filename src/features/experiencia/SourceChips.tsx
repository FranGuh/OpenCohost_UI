import type { MouseEvent } from "react";
import type { WebSource } from "../../api/client.js";
import { useT } from "../../i18n/t.js";
import { openExternalUrl } from "../../lib/openUrl.js";
import { attributedUrl, sourceHost } from "../../lib/sourceLink.js";

/** The backend sends at most 3; the row never shows more, whatever arrives. */
const MAX_CHIPS = 3;

const CHIP_CLASS =
  "mono inline-flex items-center rounded-full border border-border-soft bg-surface-2 px-2 py-0.5 text-[10px] text-dim";

interface Chip {
  host: string;
  /** The URL to open (`utm_source=opencohost` added), or null for plain text. */
  href: string | null;
}

/** One chip per site, in the order given. The label is ALWAYS the host computed
 * from the URL itself, so it can never disagree with where the chip goes. A URL
 * with no host to name is dropped. */
function toChips(sources: ReadonlyArray<WebSource>): Chip[] {
  const seen = new Set<string>();
  const chips: Chip[] = [];
  for (const source of sources) {
    const host = sourceHost(source?.url);
    if (!host || seen.has(host)) continue;
    seen.add(host);
    chips.push({ host, href: attributedUrl(source.url) });
    if (chips.length >= MAX_CHIPS) break;
  }
  return chips;
}

/**
 * Sources of a web answer, built by code and shown under Kira's reply
 * (runtime-fixes-20261110 T5). A click opens the page in the system browser, not
 * the app webview. Held in memory for the session only; nothing is stored.
 */
export function SourceChips({ sources }: { sources?: ReadonlyArray<WebSource> | null }) {
  const t = useT();
  const chips = toChips(sources ?? []);
  if (chips.length === 0) return null;

  function open(event: MouseEvent<HTMLAnchorElement>, href: string) {
    event.preventDefault();
    void openExternalUrl(href);
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="mono text-[10px] font-semibold uppercase tracking-[0.06em] text-dim">
        {t("experiencia.conversationPanel.turn.sources")}
      </span>
      {chips.map((chip) =>
        chip.href ? (
          <a
            key={chip.host}
            href={chip.href}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={t("experiencia.conversationPanel.turn.sourceOpen", { host: chip.host })}
            onClick={(event) => open(event, chip.href as string)}
            className={`${CHIP_CLASS} transition-colors hover:border-border hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring`}
          >
            {chip.host}
          </a>
        ) : (
          <span key={chip.host} className={CHIP_CLASS}>
            {chip.host}
          </span>
        )
      )}
    </div>
  );
}
