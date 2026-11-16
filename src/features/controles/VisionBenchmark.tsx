import { AlertTriangle, Check, Zap, type LucideIcon } from "lucide-react";
import type { VisionBenchVerdict, VisionBenchmark } from "../../api/vision.js";
import { useUiLocaleStore } from "../../i18n/locale.js";
import { useT, type TKey } from "../../i18n/t.js";
import { catalogNote } from "./visionCatalog.js";

const VERDICT: Record<VisionBenchVerdict, { icon: LucideIcon; glyph: string; label: TKey; tone: string }> = {
  recommended: { icon: Check, glyph: "✓", label: "controles.vision.bench.recommended", tone: "text-ok" },
  light: { icon: Zap, glyph: "⚡", label: "controles.vision.bench.light", tone: "text-muted-foreground" },
  broken: { icon: AlertTriangle, glyph: "⚠", label: "controles.vision.bench.broken", tone: "text-danger" }
};

/** Short marker appended to a Select option label (the Select renders text only). */
export function benchmarkGlyph(b: VisionBenchmark | undefined): string {
  return b && VERDICT[b.verdict] ? ` ${VERDICT[b.verdict].glyph}` : "";
}

interface VisionBenchmarkInfoProps {
  benchmark: VisionBenchmark | undefined;
  /** Model tag, used to localize the backend's English note. */
  tag: string;
  testId: string;
}

/** Compact badge + detail line for one model; renders nothing without a benchmark. */
export function VisionBenchmarkInfo({ benchmark, tag, testId }: VisionBenchmarkInfoProps) {
  const t = useT();
  const locale = useUiLocaleStore((s) => s.locale);
  const verdict = benchmark ? VERDICT[benchmark.verdict] : undefined;
  if (!benchmark || !verdict) return null;
  const Icon = verdict.icon;
  const num = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
  const spanish =
    benchmark.spanish === null
      ? "controles.vision.bench.unknown"
      : benchmark.spanish
        ? "controles.vision.bench.yes"
        : "controles.vision.bench.no";
  const parts = [
    benchmark.vram_gib !== null ? t("controles.vision.bench.vram", { value: num.format(benchmark.vram_gib) }) : null,
    benchmark.describe_s !== null ? t("controles.vision.bench.describe", { value: num.format(benchmark.describe_s) }) : null,
    t("controles.vision.bench.spanish", { answer: t(spanish) }),
    catalogNote(tag, benchmark.note, t) || null,
    t("controles.vision.bench.measured", { date: benchmark.measured_on })
  ].filter(Boolean);
  return (
    <span data-testid={testId} className="flex flex-col gap-0.5 text-[11px] leading-tight">
      <span className={`inline-flex items-center gap-1 font-semibold ${verdict.tone}`}>
        <Icon aria-hidden className="h-3 w-3" />
        {t(verdict.label)}
      </span>
      <span className="text-dim">{parts.join(" · ")}</span>
    </span>
  );
}
