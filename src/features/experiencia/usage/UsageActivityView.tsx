import { useMemo, useState, type ReactNode } from "react";
import {
  Activity,
  ArrowDownToLine,
  ArrowUpFromLine,
  Boxes,
  Brain,
  CalendarClock,
  Circle,
  Cloud,
  Compass,
  Cpu,
  Database,
  Eye,
  GitBranch,
  Keyboard,
  Layers,
  MessageSquare,
  MessagesSquare,
  Mic,
  Route,
  Search,
  Shapes,
  ShieldAlert,
  Sparkles,
  Timer,
  UserRound,
  type LucideIcon
} from "lucide-react";
import type { UsageSummary } from "../../../api/usage.js";
import { Badge } from "../../../ui/Badge.js";
import { Segmented } from "../../../ui/Segmented.js";
import { cn } from "../../../lib/cn.js";
import { t as translate, useT, type TKey } from "../../../i18n/t.js";
import {
  buildCalendar,
  formatComputeMs,
  formatTokens,
  totalsOf,
  type UsageGranularity
} from "./usageAggregate.js";
import { UsageHeatmap } from "./UsageHeatmap.js";

const GRANULARITIES: readonly UsageGranularity[] = ["day", "week", "month", "year"];

const KIND_ICONS: Record<string, LucideIcon> = {
  turn: MessageSquare,
  guardrail_retry: ShieldAlert,
  vision: Eye,
  web_search: Search,
  topic_scout: Compass,
  memoria_judge: Brain,
  reflection: Sparkles
};

const SOURCE_ICONS: Record<string, LucideIcon> = {
  direct: Keyboard,
  ptt: Mic,
  chat: MessagesSquare,
  agenda: CalendarClock,
  accumulated: Layers,
  other: Circle
};

/** Profile ids are UUIDs; the first block is enough to tell rows apart (full id in the tooltip). */
const PROFILE_ID_PREVIEW = 8;

interface MetricRow {
  calls: number;
  prompt_tokens: number;
  completion_tokens: number;
  compute_ms: number;
}

/** Translates a fixed enum label, falling back to the raw value for unknown future labels. */
function enumLabel(prefix: "kind" | "source" | "provider", value: string): string {
  return translate(`experiencia.usage.${prefix}.${value}` as TKey) || value;
}

function Section({
  title,
  icon: Icon,
  testId,
  className,
  children
}: {
  title: string;
  icon: LucideIcon;
  testId?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section data-testid={testId} className={cn("flex flex-col gap-2 rounded-lg bg-surface-2/50 p-3", className)}>
      <h3 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        <Icon size={13} aria-hidden="true" />
        {title}
      </h3>
      {children}
    </section>
  );
}

function Stat({ label, value, testId, icon: Icon }: { label: string; value: string; testId: string; icon: LucideIcon }) {
  return (
    <div className="flex flex-col rounded-lg bg-surface-2/60 p-2.5">
      <span className="flex items-center gap-1.5 text-[10px] font-medium text-muted-foreground">
        <Icon size={12} aria-hidden="true" />
        {label}
      </span>
      <span data-testid={testId} className="mono mt-1 text-sm font-semibold text-foreground">
        {value}
      </span>
    </div>
  );
}

/** Thin share-of-calls bar: decorative, the exact numbers are in the row text. */
function ShareBar({ share, tone = "accent" }: { share: number; tone?: "accent" | "info" }) {
  const width = Math.max(0, Math.min(100, Math.round(share * 100)));
  return (
    <div aria-hidden="true" className="h-1 w-full overflow-hidden rounded-full bg-surface-2">
      <div
        className={cn("h-full rounded-full", tone === "info" ? "bg-info" : "bg-muted-foreground/60")}
        style={{ width: `${width}%` }}
      />
    </div>
  );
}

function BreakdownList<T extends MetricRow>({
  rows,
  testId,
  title,
  icon,
  className,
  rowIcon,
  rowTone,
  label
}: {
  rows: readonly T[];
  testId: string;
  title: string;
  icon: LucideIcon;
  className?: string;
  rowIcon: (row: T) => LucideIcon;
  rowTone?: (row: T) => "accent" | "info";
  label: (row: T) => ReactNode;
}) {
  const t = useT();
  if (rows.length === 0) return null;
  const totalCalls = rows.reduce((sum, row) => sum + row.calls, 0);
  return (
    <Section title={title} icon={icon} testId={testId} className={className}>
      <ul className="flex flex-col gap-2">
        {rows.map((row, i) => {
          const RowIcon = rowIcon(row);
          return (
            <li key={i} className="flex flex-col gap-1 text-[12px]">
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5">
                <span className="flex min-w-0 items-center gap-1.5 text-foreground">
                  <RowIcon size={13} aria-hidden="true" className="shrink-0 text-muted-foreground" />
                  {label(row)}
                </span>
                <span className="mono text-[11px] text-muted-foreground">
                  {t("experiencia.usage.row.stats", {
                    calls: row.calls,
                    tokens: formatTokens(row.prompt_tokens + row.completion_tokens),
                    compute: formatComputeMs(row.compute_ms)
                  })}
                </span>
              </div>
              <ShareBar share={totalCalls > 0 ? row.calls / totalCalls : 0} tone={rowTone?.(row)} />
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

function CacheSection({ cache }: { cache: UsageSummary["cache"] }) {
  const t = useT();
  const real =
    cache.real_available && cache.real_prompt_tokens != null && cache.real_reused_tokens != null
      ? { prompt: cache.real_prompt_tokens, reused: cache.real_reused_tokens }
      : null;
  return (
    <Section title={t("experiencia.usage.section.cache")} icon={Database} testId="usage-cache">
      <div className="flex flex-wrap items-center gap-2 text-[12px] text-foreground">
        <Badge tone={real ? "ok" : "neutral"}>
          {real ? t("experiencia.usage.cache.realBadge") : t("experiencia.usage.cache.estimatedBadge")}
        </Badge>
        <span>
          {real
            ? t("experiencia.usage.cache.real", {
                reused: formatTokens(real.reused),
                prompt: formatTokens(real.prompt),
                percent: real.prompt > 0 ? Math.round((real.reused / real.prompt) * 100) : 0
              })
            : t("experiencia.usage.cache.estimated", { reused: formatTokens(cache.estimated_reused_tokens) })}
        </span>
      </div>
      {real && <ShareBar share={real.prompt > 0 ? real.reused / real.prompt : 0} tone="info" />}
    </Section>
  );
}

const STATUS_CLASSES: Record<string, string> = {
  ok: "border-ok-bd bg-ok-bg text-ok",
  timeout: "border-warn-bd bg-warn-bg text-warn"
};

function LayaSection({ decisions }: { decisions: UsageSummary["decisions"] }) {
  const t = useT();
  return (
    <Section title={t("experiencia.usage.section.laya")} icon={GitBranch} testId="usage-laya" className="md:col-span-2">
      {decisions.length === 0 ? (
        <p className="text-[12px] text-muted-foreground">{t("experiencia.usage.laya.empty")}</p>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2">
          {decisions.map((d) => (
            <li key={d.decision_id} className="flex flex-col gap-1.5 rounded-md border border-border-soft p-2 text-[12px]">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <span className="flex items-center gap-1.5 font-semibold text-foreground">
                  <Route size={13} aria-hidden="true" className="text-muted-foreground" />
                  {d.decision_id}
                </span>
                <span className="mono text-[11px] text-muted-foreground">
                  {d.asked} {t("experiencia.usage.laya.asked")}
                </span>
              </div>
              <ShareBar share={d.asked > 0 ? d.laya_acted / d.asked : 0} tone="info" />
              <span className="mono flex flex-wrap gap-x-3 text-[11px] text-muted-foreground">
                <span className="text-info">
                  {d.laya_acted} {t("experiencia.usage.laya.layaActed")}
                </span>
                <span>
                  {d.rule_acted} {t("experiencia.usage.laya.ruleActed")}
                </span>
              </span>
              <span className="flex flex-wrap gap-1">
                {Object.entries(d.by_status).map(([status, count]) => (
                  <span
                    key={status}
                    className={cn(
                      "mono rounded border px-1.5 py-0.5 text-[10.5px]",
                      STATUS_CLASSES[status] ?? "border-border bg-surface-2 text-muted-foreground"
                    )}
                  >
                    {status} {count}
                  </span>
                ))}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

export interface UsageActivityViewProps {
  summary: UsageSummary;
}

/** Presentational body of the Activity panel: calendar, totals and breakdowns for a loaded, enabled summary. */
export function UsageActivityView({ summary }: UsageActivityViewProps) {
  const t = useT();
  const [granularity, setGranularity] = useState<UsageGranularity>("day");
  const totals = useMemo(() => totalsOf(summary.days), [summary.days]);
  const calendar = useMemo(
    () => buildCalendar(summary.days, granularity, summary.to),
    [summary.days, summary.to, granularity]
  );
  const options = GRANULARITIES.map((value) => ({
    value,
    label: t(`experiencia.usage.range.${value}` as TKey)
  }));

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2">
        <Segmented
          options={options}
          value={granularity}
          onChange={setGranularity}
          ariaLabel={t("experiencia.usage.range.label")}
        />
        <UsageHeatmap calendar={calendar} />
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat
          icon={Activity}
          label={t("experiencia.usage.totals.calls")}
          value={String(totals.calls)}
          testId="usage-total-calls"
        />
        <Stat
          icon={ArrowDownToLine}
          label={t("experiencia.usage.totals.promptTokens")}
          value={formatTokens(totals.promptTokens)}
          testId="usage-total-prompt"
        />
        <Stat
          icon={ArrowUpFromLine}
          label={t("experiencia.usage.totals.completionTokens")}
          value={formatTokens(totals.completionTokens)}
          testId="usage-total-completion"
        />
        <Stat
          icon={Timer}
          label={t("experiencia.usage.totals.compute")}
          value={formatComputeMs(totals.computeMs)}
          testId="usage-total-compute"
        />
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <BreakdownList
          rows={summary.by_model}
          testId="usage-by-model"
          title={t("experiencia.usage.section.model")}
          icon={Boxes}
          className="md:col-span-2"
          rowIcon={(row) => (row.provider === "cloud" ? Cloud : Cpu)}
          rowTone={(row) => (row.provider === "cloud" ? "info" : "accent")}
          label={(row) => (
            <>
              <span className="mono truncate" title={row.model}>
                {row.model}
              </span>
              <Badge tone={row.provider === "cloud" ? "info" : "neutral"} className="px-1.5 py-0.5 text-[10.5px]">
                {enumLabel("provider", row.provider)}
              </Badge>
            </>
          )}
        />
        <BreakdownList
          rows={summary.by_kind}
          testId="usage-by-kind"
          title={t("experiencia.usage.section.kind")}
          icon={Shapes}
          rowIcon={(row) => KIND_ICONS[row.kind] ?? Circle}
          label={(row) => <span>{enumLabel("kind", row.kind)}</span>}
        />
        <BreakdownList
          rows={summary.by_source}
          testId="usage-by-source"
          title={t("experiencia.usage.section.source")}
          icon={Route}
          rowIcon={(row) => SOURCE_ICONS[row.source] ?? Circle}
          label={(row) => <span>{enumLabel("source", row.source)}</span>}
        />
        <BreakdownList
          rows={summary.by_profile}
          testId="usage-by-profile"
          title={t("experiencia.usage.section.profile")}
          icon={UserRound}
          rowIcon={() => UserRound}
          label={(row) =>
            row.profile_id ? (
              <span className="mono" title={row.profile_id}>
                {row.profile_id.length > PROFILE_ID_PREVIEW * 2
                  ? `${row.profile_id.slice(0, PROFILE_ID_PREVIEW)}…`
                  : row.profile_id}
              </span>
            ) : (
              <span className="text-muted-foreground">{t("experiencia.usage.profile.none")}</span>
            )
          }
        />
        <CacheSection cache={summary.cache} />
        <LayaSection decisions={summary.decisions} />
      </div>
    </div>
  );
}
