import { useEffect, useRef } from "react";
import { cn } from "../../lib/cn.js";
import { useT } from "../../i18n/t.js";
import { selectEvents, useEventStore, type AppEventTone } from "../../store/eventStore.js";

/**
 * Logs tab (D12/R10/R32) — a privacy-safe view over the client `eventStore`
 * ring buffer. It renders ONLY the four typed AppEvent fields: `ts` (formatted),
 * `source`, `label` (verbatim), toned by `tone` (a subtle label tint only). It
 * never reads any other field, so no dialogue, request/response bodies, or raw
 * text can ever surface — the source data never carried them.
 *
 * Rows are plain mono text (`hh:mm:ss · source — label`) in chronological order
 * (oldest top, newest bottom), and the scroll container follows the newest row
 * when the operator is near the bottom (Item 3/4 — same follow semantics as the
 * conversation timeline).
 */

// Match the conversation timeline's follow distance: an append while the
// operator sits within this many px of the bottom follows the stream; further
// up, we leave the scroll alone (no yank).
const NEAR_BOTTOM_PX = 80;

// Tone → a quiet label tint only (no pill, no icon). Everything else reads
// neutral so the feed stays calm at a glance.
const TONE_TINT: Record<AppEventTone, string> = {
  ok: "text-ok",
  warn: "text-warn",
  danger: "text-danger",
  info: "text-foreground",
  neutral: "text-foreground"
};

// ONE formatter for the whole module. `Date#toLocaleTimeString(locale, opts)`
// builds a fresh locale formatter on every call — it was the most expensive
// thing in a row, paid once per row for up to EVENT_CAP (200) rows on EVERY
// parent render. And because Tabs keeps inactive panels MOUNTED by design
// (src/ui/Tabs.tsx), that cost was being paid while the Logs tab was
// hidden and nobody was even looking at it. Identical output, built once.
const TS_FORMAT = new Intl.DateTimeFormat("es-AR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

function formatTs(ts: number): string {
  // Locale-formatted wall-clock time. Metadata only — never a payload value.
  return TS_FORMAT.format(ts);
}

export function LogsPanel() {
  const t = useT();
  const events = useEventStore(selectEvents);
  const scrollRef = useRef<HTMLDivElement>(null);
  const prevCountRef = useRef(0);

  // Follow the bottom on a genuine new event IF the operator is near it — same
  // pure scrollTop math the conversation timeline uses (jsdom-testable).
  useEffect(() => {
    const el = scrollRef.current;
    const grew = events.length > prevCountRef.current;
    prevCountRef.current = events.length;
    if (!el || !grew) return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight <= NEAR_BOTTOM_PX) {
      el.scrollTop = el.scrollHeight;
    }
  }, [events.length]);

  if (events.length === 0) {
    return <p className="text-[13px] text-dim">{t("experiencia.logsPanel.empty")}</p>;
  }

  // Chronological ascending — oldest at the top, newest at the bottom, so the
  // feed grows downward and the autoscroll follows the newest row.
  return (
    <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
      <ul aria-label={t("experiencia.logsPanel.list.aria")} className="flex flex-col gap-0.5">
        {events.map((event) => (
          <li key={event.id} className="mono text-[11px] leading-relaxed text-muted-foreground">
            <span className="text-dim">{formatTs(event.ts)}</span>
            {" · "}
            <span className="text-dim">{event.source}</span>
            {" — "}
            <span className={cn(TONE_TINT[event.tone] ?? "text-foreground")}>{event.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
