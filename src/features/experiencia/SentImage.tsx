import { useState } from "react";
import { Image as ImageIcon } from "lucide-react";
import { useT, type TKey } from "../../i18n/t.js";
import { VisionLightbox } from "./VisionLightbox.js";

/** Where an image turn stands before the engine has accepted it. Absent once sent. */
export type ImageSendState =
  | { phase: "sending"; waiting: boolean }
  | { phase: "failed"; errorKey: TKey; failedImage?: { index: number; total: number } | null };

/**
 * The images the owner sent, as thumbnails in the owner's bubble (decision
 * 2026-11-10). The preview URLs live in front-end memory only. A turn without
 * any (an image turn restored from elsewhere, or a preview that could not be
 * made) shows the neutral "image" chip instead of a broken image. One image is
 * shown large; several form a compact row, each opening the lightbox.
 */
export function SentImages({ previewUrls }: { previewUrls?: readonly string[] }) {
  const t = useT();
  const [enlarged, setEnlarged] = useState<number | null>(null);
  const urls = previewUrls ?? [];
  if (urls.length === 0) {
    return (
      <p className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold text-dim">
        <ImageIcon size={11} aria-hidden="true" />
        {t("experiencia.conversationPanel.composer.image.attached")}
      </p>
    );
  }
  const total = urls.length;
  const altFor = (index: number) =>
    total === 1
      ? t("experiencia.conversationPanel.composer.image.sentAlt")
      : t("experiencia.conversationPanel.composer.image.sentAltN", { n: index + 1, total });
  return (
    <>
      <div className={total === 1 ? "" : "mt-2 flex flex-wrap gap-2"}>
        {urls.map((url, index) => (
          <button
            key={index}
            type="button"
            aria-label={
              total === 1
                ? t("experiencia.conversationPanel.composer.image.enlarge")
                : t("experiencia.conversationPanel.composer.image.enlargeN", { n: index + 1 })
            }
            onClick={() => setEnlarged(index)}
            className={`${total === 1 ? "mt-2 " : ""}block rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring`}
          >
            <img
              src={url}
              alt={altFor(index)}
              draggable={false}
              className={`${total === 1 ? "max-h-40" : "h-20 w-20 object-cover"} max-w-full rounded-md border border-border-soft object-contain`}
            />
          </button>
        ))}
      </div>
      {enlarged !== null && urls[enlarged] && (
        <VisionLightbox src={urls[enlarged]} alt={altFor(enlarged)} onClose={() => setEnlarged(null)} />
      )}
    </>
  );
}

const ACTION =
  "inline-flex h-6 items-center rounded-md border border-border-soft px-2 text-[11px] font-semibold text-foreground transition-colors hover:bg-surface-2 disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

/** In-progress line and failure line (with Retry and Discard) under an image turn. */
export function ImageSendStatus({
  state,
  onRetry,
  onDiscard
}: {
  state: ImageSendState;
  onRetry: () => void;
  onDiscard: () => void;
}) {
  const t = useT();
  if (state.phase === "sending") {
    return (
      <p role="status" className="mono mt-1 text-[11px] text-dim animate-pulse">
        {t(
          state.waiting
            ? "experiencia.conversationPanel.composer.image.state.waiting"
            : "experiencia.conversationPanel.composer.image.state.sending"
        )}
      </p>
    );
  }
  return (
    <div data-image-send="failed" className="mt-2 flex flex-col gap-1.5">
      <p role="alert" className="text-[12px] font-semibold text-danger">
        <span className="mono mr-1 text-[10px] uppercase">{t("experiencia.conversationPanel.composer.image.state.failed")}</span>
        {t(state.errorKey)}
      </p>
      {state.failedImage && state.failedImage.total > 1 && (
        <p className="text-[11px] text-dim">
          {t("experiencia.conversationPanel.composer.image.error.which", {
            n: state.failedImage.index + 1,
            total: state.failedImage.total
          })}
        </p>
      )}
      <span className="flex items-center gap-2">
        <button type="button" className={ACTION} onClick={onRetry}>
          {t("experiencia.conversationPanel.composer.image.retry")}
        </button>
        <button type="button" className={ACTION} onClick={onDiscard}>
          {t("experiencia.conversationPanel.composer.image.discard")}
        </button>
      </span>
    </div>
  );
}
