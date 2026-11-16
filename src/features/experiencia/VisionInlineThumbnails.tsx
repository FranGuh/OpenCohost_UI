import { useState } from "react";
import { useVisionThumbnails } from "../../api/vision.js";
import { useT } from "../../i18n/t.js";
import { VisionLightbox } from "./VisionLightbox.js";
import { frameAltLabel, type VisionThumbsProps } from "./visionThumbLabel.js";

/**
 * Frames Kira saw for ONE look, shown inline under her reply (no expanding).
 * Bound to the look id captured into the turn's badge, so older replies keep
 * their own frames. Images live only in the in-memory query cache. An expired
 * look (404) shows a quiet hint, never an error.
 */
export function VisionInlineThumbnails({ lookId, mode, framesSent }: VisionThumbsProps) {
  const t = useT();
  const { data, error, isPending } = useVisionThumbnails(lookId, true);
  const [enlarged, setEnlarged] = useState<number | null>(null);

  if (isPending) return null;
  if (error || !data || data.length === 0) {
    return <p className="mono text-[10px] text-dim">{t("experiencia.vision.thumbs.expired")}</p>;
  }
  const total = data.length;
  return (
    <>
      <div className="flex max-w-full flex-wrap items-start gap-1.5">
        {data.map((src, i) => (
          <button
            key={i}
            type="button"
            onClick={() => setEnlarged(i)}
            className="rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <img
              src={src}
              alt={frameAltLabel(t, { mode, framesSent, n: i + 1, total })}
              draggable={false}
              className="h-28 w-auto rounded-md border border-border-soft object-cover"
            />
          </button>
        ))}
      </div>
      {enlarged !== null && data[enlarged] && (
        <VisionLightbox src={data[enlarged] as string} alt={frameAltLabel(t, { mode, framesSent, n: enlarged + 1, total })} onClose={() => setEnlarged(null)} />
      )}
    </>
  );
}
