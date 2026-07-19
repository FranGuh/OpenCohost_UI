import { selectEvents, useEventStore } from "../../store/eventStore.js";
import { Alert } from "../ui/Alert.js";
import { Badge } from "../ui/Badge.js";

/**
 * Logs tab (D12/R10/R32) — a privacy-safe view over the client `eventStore`
 * ring buffer. It renders ONLY the four typed AppEvent fields: `source`
 * (Badge), `ts` (formatted), `label` (verbatim), toned by `tone` (Alert/Badge
 * styling). It never reads any other field, so no dialogue, request/response
 * bodies, or raw text can ever surface — the source data never carried them.
 */

function formatTs(ts: number): string {
  // Locale-formatted wall-clock time. Metadata only — never a payload value.
  return new Date(ts).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function LogsPanel() {
  const events = useEventStore(selectEvents);

  if (events.length === 0) {
    return <p className="text-[13px] text-dim">Todavía no hay eventos del motor.</p>;
  }

  // Newest first — a "recent activity" feed reads top-down.
  const rows = [...events].reverse();

  return (
    <ul aria-label="Eventos del motor" className="flex flex-col gap-2">
      {rows.map((event) => (
        <li key={event.id}>
          <Alert tone={event.tone} role="status">
            <span className="flex flex-wrap items-center gap-2">
              <Badge tone="neutral" mono>
                {event.source}
              </Badge>
              <span className="mono text-[11px] text-dim">{formatTs(event.ts)}</span>
              <span>{event.label}</span>
            </span>
          </Alert>
        </li>
      ))}
    </ul>
  );
}
