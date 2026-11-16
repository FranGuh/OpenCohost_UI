import type { BadgeTone } from "../../ui/Badge.js";
import type { TKey } from "../../i18n/t.js";

/** Status filter of the editorial card list. */
export type CardStatusFilter = "active" | "disabled" | "all";

/** Lifecycle statuses that can still be armed/activated/disabled
 * (`EditorialCardStatus` in opencohost/core/editorial/editorial_cards.py).
 * `used` and `expired` (also what disable produces) are terminal; anything
 * unknown is treated as terminal too, so no action is offered blindly. */
const LIVE_STATUSES: ReadonlySet<string> = new Set(["draft", "armed", "active"]);

export function isTerminalStatus(status: string): boolean {
  return !LIVE_STATUSES.has(status);
}

export function matchesFilter(status: string, filter: CardStatusFilter): boolean {
  if (filter === "all") return true;
  return filter === "active" ? !isTerminalStatus(status) : isTerminalStatus(status);
}

interface StatusPresentation {
  tone: BadgeTone;
  labelKey: TKey;
}

const PRESENTATION: Record<string, StatusPresentation> = {
  draft: { tone: "neutral", labelKey: "controles.editorialCards.status.draft" },
  armed: { tone: "info", labelKey: "controles.editorialCards.status.armed" },
  active: { tone: "ok", labelKey: "controles.editorialCards.status.active" },
  used: { tone: "warn", labelKey: "controles.editorialCards.status.used" },
  expired: { tone: "danger", labelKey: "controles.editorialCards.status.expired" },
  // Legacy rows may still carry "disabled"; it means the same as expired.
  disabled: { tone: "danger", labelKey: "controles.editorialCards.status.expired" }
};

const UNKNOWN: StatusPresentation = { tone: "neutral", labelKey: "controles.editorialCards.status.unknown" };

export function statusPresentation(status: string): StatusPresentation {
  return PRESENTATION[status] ?? UNKNOWN;
}
