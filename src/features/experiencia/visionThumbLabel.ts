import type { TKey } from "../../i18n/t.js";
import type { VisionMode } from "../../store/visionStore.js";

export interface VisionThumbsProps {
  lookId: string;
  mode?: VisionMode | null;
  framesSent?: number | null;
}

type Translate = (key: TKey, params?: Record<string, string | number>) => string;

/** A clip is ONE mosaic image of several frames, so "Frame 1 of 1" would lie. */
export function frameAltLabel(
  t: Translate,
  { mode, framesSent, n, total }: { mode?: VisionMode | null; framesSent?: number | null; n: number; total: number }
): string {
  if (mode === "clip") {
    return framesSent != null && framesSent > 1
      ? t("experiencia.vision.thumbs.alt.mosaic", { frames: framesSent })
      : t("experiencia.vision.thumbs.alt.mosaic.noCount");
  }
  return t("experiencia.vision.thumbs.alt", { n, total });
}
