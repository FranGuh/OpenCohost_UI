import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useVisionThumbnails } from "../../api/vision.js";
import { useT } from "../../i18n/t.js";
import { VisionLightbox } from "./VisionLightbox.js";
import { frameAltLabel, type VisionThumbsProps } from "./visionThumbLabel.js";

/**
 * Frames Kira saw for one look. Mounted only while the badge is expanded, so
 * nothing is fetched until the owner asks and the query (in-memory only, short
 * gcTime) is dropped soon after collapsing. No download link, no persistence.
 */
export function VisionThumbnails({ lookId, mode, framesSent }: VisionThumbsProps) {
  const t = useT();
  const { data, error, isPending } = useVisionThumbnails(lookId, true);
  const [index, setIndex] = useState(0);
  const [enlarged, setEnlarged] = useState(false);

  if (isPending) return <p className="mono text-[10px] text-dim">{t("experiencia.vision.thumbs.loading")}</p>;
  if (error || !data || data.length === 0) {
    // 404 (expired / thumbnails off) and any other failure read the same way.
    return <p className="mono text-[10px] text-dim">{t("experiencia.vision.thumbs.unavailable")}</p>;
  }

  const total = data.length;
  const current = Math.min(index, total - 1);
  const alt = frameAltLabel(t, { mode, framesSent, n: current + 1, total });
  return (
    <div className="flex flex-col items-start gap-1">
      <button
        type="button"
        onClick={() => setEnlarged(true)}
        className="rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <img
          src={data[current]}
          alt={alt}
          draggable={false}
          className="max-h-24 w-40 rounded-md border border-border-soft object-cover"
        />
      </button>
      {enlarged && <VisionLightbox src={data[current] as string} alt={alt} onClose={() => setEnlarged(false)} />}
      {total > 1 && (
        <div className="mono flex items-center gap-1 text-[10px] text-dim">
          <button
            type="button"
            aria-label={t("experiencia.vision.thumbs.prev")}
            disabled={current === 0}
            onClick={() => setIndex(current - 1)}
            className="rounded p-0.5 hover:text-foreground disabled:opacity-40"
          >
            <ChevronLeft size={12} aria-hidden="true" />
          </button>
          <span>{t("experiencia.vision.thumbs.counter", { n: current + 1, total })}</span>
          <button
            type="button"
            aria-label={t("experiencia.vision.thumbs.next")}
            disabled={current === total - 1}
            onClick={() => setIndex(current + 1)}
            className="rounded p-0.5 hover:text-foreground disabled:opacity-40"
          >
            <ChevronRight size={12} aria-hidden="true" />
          </button>
        </div>
      )}
    </div>
  );
}
