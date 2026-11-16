import { useId, useState } from "react";
import { ChevronDown } from "lucide-react";
import { useVisionLook } from "../../api/vision.js";
import { useT } from "../../i18n/t.js";
import { cn } from "../../lib/cn.js";

/**
 * "What Kira saw": the vision model's description of ONE look, collapsed by
 * default. It comes with the look's frames (same in-memory lifetime on the
 * backend) so it disappears with them: once the look expires, or the backend
 * withholds it, nothing renders. Never persisted client-side beyond the query
 * cache.
 */
export function VisionSeen({ lookId }: { lookId: string }) {
  const t = useT();
  const { data } = useVisionLook(lookId, true);
  const [open, setOpen] = useState(false);
  const regionId = useId();
  const description = data?.description?.trim();
  if (!description) return null;
  return (
    <div className="flex max-w-prose flex-col items-start gap-1">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={regionId}
        onClick={() => setOpen((v) => !v)}
        className="mono inline-flex items-center gap-1 rounded text-[10px] text-dim hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <ChevronDown size={10} aria-hidden="true" className={cn("transition-transform", open && "rotate-180")} />
        {t("controles.vision.seen.title")}
      </button>
      {open && (
        <p id={regionId} className="whitespace-pre-wrap rounded-md border border-border-soft bg-surface-2 p-2 text-xs text-dim">
          {description}
        </p>
      )}
    </div>
  );
}
