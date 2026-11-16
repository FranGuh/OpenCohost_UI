import { useT } from "../../../i18n/t.js";
import { formatComputeMs, formatTokens, type Calendar } from "./usageAggregate.js";

const CELL_SIZE: Record<Calendar["granularity"], number> = { day: 11, week: 11, month: 30, year: 44 };
const GAP = 3;
const LEVEL_OPACITY = [0, 0.3, 0.5, 0.75, 1] as const;

function cellFill(level: number) {
  return level === 0
    ? { fill: "var(--border)", fillOpacity: 0.6 }
    : { fill: "var(--primary)", fillOpacity: LEVEL_OPACITY[level] };
}

export interface UsageHeatmapProps {
  calendar: Calendar;
}

/** GitHub-style calendar drawn with plain SVG (no chart dependency). Intensity is by total tokens. */
export function UsageHeatmap({ calendar }: UsageHeatmapProps) {
  const t = useT();
  const size = CELL_SIZE[calendar.granularity];
  const step = size + GAP;
  const width = calendar.columns * step - GAP;
  const height = calendar.rows * step - GAP;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="overflow-x-auto pb-1">
        <svg
          data-testid="usage-heatmap"
          data-granularity={calendar.granularity}
          role="group"
          aria-label={t("experiencia.usage.heatmap.title")}
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
        >
          {calendar.cells.map((cell) => {
            const label =
              cell.calls === 0 && cell.tokens === 0
                ? t("experiencia.usage.heatmap.cellEmpty", { date: cell.key })
                : t("experiencia.usage.heatmap.cell", {
                    date: cell.key,
                    calls: cell.calls,
                    tokens: formatTokens(cell.tokens),
                    compute: formatComputeMs(cell.computeMs)
                  });
            return (
              <rect
                key={cell.key}
                x={cell.col * step}
                y={cell.row * step}
                width={size}
                height={size}
                rx={2}
                aria-label={label}
                data-level={cell.level}
                style={cellFill(cell.level)}
              >
                <title>{label}</title>
              </rect>
            );
          })}
        </svg>
      </div>
      <div className="flex items-center justify-end gap-1" aria-hidden="true">
        {LEVEL_OPACITY.map((_, level) => (
          <svg key={level} width={10} height={10}>
            <rect width={10} height={10} rx={2} style={cellFill(level)} />
          </svg>
        ))}
      </div>
    </div>
  );
}
