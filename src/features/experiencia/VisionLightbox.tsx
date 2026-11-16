import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useT } from "../../i18n/t.js";

/**
 * Full-size view of one frame, at the resolution the UI holds (the frame sent
 * to the vision model; never upscaled, shrunk to fit the viewport). Closes with
 * Escape, the close button or a click on the backdrop. Focus moves to the close
 * button on open, stays inside while open and returns to the opener on close.
 */
export function VisionLightbox({ src, alt, onClose }: { src: string; alt: string; onClose: () => void }) {
  const t = useT();
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    return () => {
      if (opener && opener.isConnected) opener.focus();
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      // The close button is the only focusable element: keep Tab inside the dialog.
      else if (e.key === "Tab") {
        e.preventDefault();
        closeRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("experiencia.vision.thumbs.lightbox")}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4 backdrop-blur-md"
    >
      <button
        ref={closeRef}
        type="button"
        aria-label={t("controles.vision.lightbox.close")}
        onClick={onClose}
        className="absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded-full border border-border bg-card text-muted-foreground transition-colors duration-fast ease-io hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <X size={18} aria-hidden="true" />
      </button>
      <img src={src} alt={alt} draggable={false} className="max-h-full max-w-full rounded-md border border-border-soft object-contain shadow-panel" />
    </div>,
    document.body
  );
}
