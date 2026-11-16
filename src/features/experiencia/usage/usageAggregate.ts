/** Pure helpers for the Activity panel: formatting and client-side calendar aggregation. */

export type UsageGranularity = "day" | "week" | "month" | "year";

export interface UsageDay {
  date: string;
  calls: number;
  prompt_tokens: number;
  completion_tokens: number;
  compute_ms: number;
}

export interface UsageTotals {
  calls: number;
  promptTokens: number;
  completionTokens: number;
  computeMs: number;
}

export interface CalendarCell {
  /** Bucket id: `YYYY-MM-DD` (day, and the Monday of a week), `YYYY-MM` (month) or `YYYY` (year). */
  key: string;
  col: number;
  row: number;
  calls: number;
  tokens: number;
  computeMs: number;
  /** 0 = no activity, 1..4 = relative intensity by total tokens. */
  level: number;
}

export interface Calendar {
  granularity: UsageGranularity;
  cells: CalendarCell[];
  columns: number;
  rows: number;
}

const DAY_MS = 86_400_000;
const WINDOW_DAYS = 365;
const WEEK_BUCKETS = 53;
const MONTH_BUCKETS = 12;

export function formatComputeMs(ms: number): string {
  const total = Math.round(Math.max(0, ms) / 1000);
  if (total < 60) return `${total}s`;
  if (total < 3600) return `${Math.floor(total / 60)}m ${total % 60}s`;
  return `${Math.floor(total / 3600)}h ${Math.floor((total % 3600) / 60)}m`;
}

export function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

export function intensityLevel(value: number, max: number): number {
  if (value <= 0 || max <= 0) return 0;
  return Math.min(4, Math.max(1, Math.ceil((4 * value) / max)));
}

export function totalsOf(rows: ReadonlyArray<{ calls: number; prompt_tokens: number; completion_tokens: number; compute_ms: number }>): UsageTotals {
  return rows.reduce<UsageTotals>(
    (acc, r) => ({
      calls: acc.calls + r.calls,
      promptTokens: acc.promptTokens + r.prompt_tokens,
      completionTokens: acc.completionTokens + r.completion_tokens,
      computeMs: acc.computeMs + r.compute_ms
    }),
    { calls: 0, promptTokens: 0, completionTokens: 0, computeMs: 0 }
  );
}

// --- date helpers (UTC, so the viewer's time zone never shifts a bucket) ---

function parseDate(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Row index with Monday = 0. */
function weekday(ms: number): number {
  return (new Date(ms).getUTCDay() + 6) % 7;
}

function mondayOf(ms: number): number {
  return ms - weekday(ms) * DAY_MS;
}

interface Bucket {
  key: string;
  calls: number;
  tokens: number;
  computeMs: number;
}

function emptyBucket(key: string): Bucket {
  return { key, calls: 0, tokens: 0, computeMs: 0 };
}

function finish(
  granularity: UsageGranularity,
  buckets: Bucket[],
  place: (index: number, bucket: Bucket) => { col: number; row: number },
  rows: number
): Calendar {
  const max = Math.max(0, ...buckets.map((b) => b.tokens));
  const cells = buckets.map<CalendarCell>((b, i) => ({
    key: b.key,
    ...place(i, b),
    calls: b.calls,
    tokens: b.tokens,
    computeMs: b.computeMs,
    level: intensityLevel(b.tokens, max)
  }));
  const columns = cells.reduce((m, c) => Math.max(m, c.col + 1), 0);
  return { granularity, cells, columns, rows };
}

export function buildCalendar(days: ReadonlyArray<UsageDay>, granularity: UsageGranularity, to: string): Calendar {
  const end = parseDate(to);
  const index = new Map<string, Bucket>();
  const order: Bucket[] = [];

  const add = (key: string) => {
    const b = emptyBucket(key);
    index.set(key, b);
    order.push(b);
  };

  let keyOf: (ms: number) => string;
  if (granularity === "day") {
    for (let i = WINDOW_DAYS - 1; i >= 0; i--) add(isoDate(end - i * DAY_MS));
    keyOf = isoDate;
  } else if (granularity === "week") {
    const lastMonday = mondayOf(end);
    for (let i = WEEK_BUCKETS - 1; i >= 0; i--) add(isoDate(lastMonday - i * 7 * DAY_MS));
    keyOf = (ms) => isoDate(mondayOf(ms));
  } else if (granularity === "month") {
    const e = new Date(end);
    for (let i = MONTH_BUCKETS - 1; i >= 0; i--) {
      add(new Date(Date.UTC(e.getUTCFullYear(), e.getUTCMonth() - i, 1)).toISOString().slice(0, 7));
    }
    keyOf = (ms) => isoDate(ms).slice(0, 7);
  } else {
    const first = new Date(end - (WINDOW_DAYS - 1) * DAY_MS).getUTCFullYear();
    for (let y = first; y <= new Date(end).getUTCFullYear(); y++) add(String(y));
    keyOf = (ms) => isoDate(ms).slice(0, 4);
  }

  for (const d of days) {
    const bucket = index.get(keyOf(parseDate(d.date)));
    if (!bucket) continue;
    bucket.calls += d.calls;
    bucket.tokens += d.prompt_tokens + d.completion_tokens;
    bucket.computeMs += d.compute_ms;
  }

  if (granularity === "day") {
    const startWeekday = weekday(parseDate(order[0].key));
    return finish("day", order, (i) => ({ col: Math.floor((i + startWeekday) / 7), row: (i + startWeekday) % 7 }), 7);
  }
  return finish(granularity, order, (i) => ({ col: i, row: 0 }), 1);
}
