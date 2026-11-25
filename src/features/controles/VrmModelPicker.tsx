import { useRef, useState } from "react";
import { PersonStanding } from "lucide-react";
import { vrmThumbnailUrl, type VrmModelItem } from "../../api/avatar.js";

export interface VrmModelPickerProps {
  models: VrmModelItem[];
  value: string;
  onChange: (filename: string) => void;
  ariaLabel: string;
  bundledLabel: string;
  disabled?: boolean;
}

/** Picture grid with radio-group semantics (roving tabindex, arrows/Home/End). */
export function VrmModelPicker({ models, value, onChange, ariaLabel, bundledLabel, disabled = false }: VrmModelPickerProps) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  // Thumbnails that 404 or fail to decode fall back to the icon.
  const [failed, setFailed] = useState<ReadonlySet<string>>(new Set());

  const selectedIndex = models.findIndex((m) => m.filename === value);
  const focusIndex = selectedIndex >= 0 ? selectedIndex : 0;

  function move(index: number, key: string) {
    let next = index;
    if (key === "ArrowRight" || key === "ArrowDown") next = (index + 1) % models.length;
    else if (key === "ArrowLeft" || key === "ArrowUp") next = (index - 1 + models.length) % models.length;
    else if (key === "Home") next = 0;
    else if (key === "End") next = models.length - 1;
    else return false;
    onChange(models[next].filename);
    refs.current[next]?.focus();
    return true;
  }

  return (
    <div role="radiogroup" aria-label={ariaLabel} className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {models.map((m, i) => {
        const selected = i === selectedIndex;
        const label = m.filename.replace(/\.vrm$/i, "");
        const showImage = !failed.has(m.filename);
        return (
          <button
            key={m.filename}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={i === focusIndex ? 0 : -1}
            disabled={disabled}
            onClick={() => onChange(m.filename)}
            onKeyDown={(e) => {
              if (move(i, e.key)) e.preventDefault();
            }}
            className={`flex min-w-0 flex-col gap-1.5 rounded-md border bg-card p-1.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-60 ${
              selected ? "border-primary ring-2 ring-primary" : "border-border hover:border-primary/50"
            }`}
          >
            <span className="flex aspect-square w-full items-center justify-center overflow-hidden rounded bg-muted text-muted-foreground">
              {showImage ? (
                <img
                  src={vrmThumbnailUrl(m.filename)}
                  alt=""
                  loading="lazy"
                  className="h-full w-full object-cover"
                  onError={() => setFailed((prev) => new Set(prev).add(m.filename))}
                />
              ) : (
                <PersonStanding aria-hidden="true" className="h-8 w-8" />
              )}
            </span>
            <span className="truncate text-xs font-medium text-foreground" title={label}>
              {label}
            </span>
            <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
              <span>{m.size_mb} MB</span>
              {m.bundled ? <span className="rounded bg-muted px-1 text-foreground">{bundledLabel}</span> : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}
