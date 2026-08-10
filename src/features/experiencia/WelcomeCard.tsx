import { useEffect, useRef, useState, type SyntheticEvent } from "react";
import { ArrowLeft, ArrowRight, Check, X } from "lucide-react";
import { useT, type TKey } from "../../i18n/t.js";

export interface WelcomeCardProps { onDismiss(): void }

// Holds i18n KEYS, not translated text — resolved via t() in the render
// below. No test imports SLIDES, so this can be fully hot-swappable (§4.6).
const SLIDES: ReadonlyArray<{
  titleKey: TKey;
  copyKey: TKey;
  image: string;
  imageAltKey: TKey;
  bulletKeys: readonly [TKey, TKey, TKey];
}> = [
  {
    titleKey: "experiencia.welcomeCard.slide1.title",
    copyKey: "experiencia.welcomeCard.slide1.copy",
    image: "/welcome/kira-capabilities.png",
    imageAltKey: "experiencia.welcomeCard.slide1.imageAlt",
    bulletKeys: [
      "experiencia.welcomeCard.slide1.bullet1",
      "experiencia.welcomeCard.slide1.bullet2",
      "experiencia.welcomeCard.slide1.bullet3"
    ]
  },
  {
    titleKey: "experiencia.welcomeCard.slide2.title",
    copyKey: "experiencia.welcomeCard.slide2.copy",
    image: "/welcome/kira-agenda.png",
    imageAltKey: "experiencia.welcomeCard.slide2.imageAlt",
    bulletKeys: [
      "experiencia.welcomeCard.slide2.bullet1",
      "experiencia.welcomeCard.slide2.bullet2",
      "experiencia.welcomeCard.slide2.bullet3"
    ]
  },
  {
    titleKey: "experiencia.welcomeCard.slide3.title",
    copyKey: "experiencia.welcomeCard.slide3.copy",
    image: "/welcome/kira-voice.png",
    imageAltKey: "experiencia.welcomeCard.slide3.imageAlt",
    bulletKeys: [
      "experiencia.welcomeCard.slide3.bullet1",
      "experiencia.welcomeCard.slide3.bullet2",
      "experiencia.welcomeCard.slide3.bullet3"
    ]
  },
  {
    titleKey: "experiencia.welcomeCard.slide4.title",
    copyKey: "experiencia.welcomeCard.slide4.copy",
    image: "/welcome/kira-stream.png",
    imageAltKey: "experiencia.welcomeCard.slide4.imageAlt",
    bulletKeys: [
      "experiencia.welcomeCard.slide4.bullet1",
      "experiencia.welcomeCard.slide4.bullet2",
      "experiencia.welcomeCard.slide4.bullet3"
    ]
  },
  {
    titleKey: "experiencia.welcomeCard.slide5.title",
    copyKey: "experiencia.welcomeCard.slide5.copy",
    image: "/welcome/kira-privacy.png",
    imageAltKey: "experiencia.welcomeCard.slide5.imageAlt",
    bulletKeys: [
      "experiencia.welcomeCard.slide5.bullet1",
      "experiencia.welcomeCard.slide5.bullet2",
      "experiencia.welcomeCard.slide5.bullet3"
    ]
  }
] as const;

export function WelcomeCard({ onDismiss }: WelcomeCardProps) {
  const t = useT();
  const [slide, setSlide] = useState(0);
  const [imageVisible, setImageVisible] = useState(true);
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const current = SLIDES[slide];

  useEffect(() => setImageVisible(true), [slide]);

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onDismiss();
      if (event.key === "ArrowLeft") setSlide((value) => Math.max(0, value - 1));
      if (event.key === "ArrowRight") setSlide((value) => Math.min(SLIDES.length - 1, value + 1));
      if (event.key === "Tab") {
        const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>("button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])") ?? []);
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (!dialogRef.current?.contains(document.activeElement)) {
          event.preventDefault();
          (event.shiftKey ? last : first)?.focus();
        } else if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previouslyFocused?.focus();
    };
  }, [onDismiss]);

  function hideBrokenImage(event: SyntheticEvent<HTMLImageElement>) {
    event.currentTarget.removeAttribute("src");
    setImageVisible(false);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[color-mix(in_srgb,var(--background)_80%,transparent)] p-4 backdrop-blur-sm">
      <section ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="welcome-title" className="relative grid h-[min(680px,calc(100dvh-2rem))] w-full max-w-5xl grid-cols-[1.05fr_.95fr] overflow-hidden rounded-2xl border border-border bg-card shadow-2xl">
        <button ref={closeRef} type="button" aria-label={t("experiencia.welcomeCard.dialog.close.aria")} onClick={onDismiss} className="absolute right-4 top-4 z-10 rounded-lg p-2 text-muted-foreground transition duration-fast ease-io hover:bg-surface-2 hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"><X size={18} /></button>
        <div className="flex min-h-0 flex-col p-8 lg:p-10">
          <div className="font-mono text-xs font-semibold uppercase tracking-[.18em] text-primary"><span>{t("experiencia.welcomeCard.progress.counter", { current: slide + 1, total: SLIDES.length })}</span><span className="mx-2 text-border">/</span>{t("experiencia.welcomeCard.header.brand")}</div>
          <div className="my-auto py-5">
            <h2 id="welcome-title" className="max-w-md text-3xl font-bold tracking-tight text-foreground lg:text-4xl">{t(current.titleKey)}</h2>
            <p className="mt-4 max-w-md text-base leading-6 text-muted-foreground">{t(current.copyKey)}</p>
            <ul className="mt-5 space-y-2.5">
              {current.bulletKeys.map((bulletKey) => <li key={bulletKey} className="flex items-center gap-3 text-sm text-foreground"><span className="grid h-6 w-6 place-items-center rounded-full bg-accent-soft text-primary"><Check size={14} /></span>{t(bulletKey)}</li>)}
            </ul>
          </div>
          <div>
            <div className="mb-4 flex gap-1" aria-label={t("experiencia.welcomeCard.progress.aria")}>{SLIDES.map((item, index) => <button key={item.titleKey} type="button" aria-label={t("experiencia.welcomeCard.progress.goto.aria", { n: index + 1, title: t(item.titleKey) })} aria-current={index === slide ? "step" : undefined} onClick={() => setSlide(index)} className="rounded-full p-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"><span className={`block h-1.5 rounded-full transition-all duration-fast ease-io ${index === slide ? "w-8 bg-primary" : "w-2 bg-border"}`} /></button>)}</div>
            <div className="flex items-center justify-between">
              <button type="button" onClick={onDismiss} className="rounded-lg px-2 py-2 text-sm text-muted-foreground hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">{t("experiencia.welcomeCard.nav.skip.action")}</button>
              <div className="flex gap-2">
                {slide > 0 && <button type="button" aria-label={t("experiencia.welcomeCard.nav.prev.aria")} onClick={() => setSlide(slide - 1)} className="rounded-lg border border-border p-2.5 text-foreground hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"><ArrowLeft size={18} /></button>}
                {slide < SLIDES.length - 1 ? <button type="button" onClick={() => setSlide(slide + 1)} className="flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">{t("experiencia.welcomeCard.nav.next.action")} <ArrowRight size={17} /></button> : <button type="button" onClick={onDismiss} className="rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">{t("experiencia.welcomeCard.nav.finish.action")}</button>}
              </div>
            </div>
          </div>
        </div>
        <div className="relative min-h-0 overflow-hidden border-l border-border bg-surface-2">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_35%,var(--accent-soft),transparent_65%)]" />
          <div className="absolute inset-x-8 bottom-8 top-8 rounded-2xl border border-[color-mix(in_srgb,var(--border)_70%,transparent)] bg-[color-mix(in_srgb,var(--background)_30%,transparent)] shadow-panel" />
          {imageVisible && <img key={current.image} src={current.image} onError={hideBrokenImage} alt={t(current.imageAltKey)} className="welcome-slide-image relative h-full w-full object-cover object-center" />}
        </div>
      </section>
    </div>
  );
}
