import { useEffect, useRef, useState, type SyntheticEvent } from "react";
import { ArrowLeft, ArrowRight, Check, X } from "lucide-react";

export interface WelcomeCardProps { onDismiss(): void }

const SLIDES = [
  { title: "Conocé a Kira", copy: "Tu co-host local para conversaciones naturales durante el stream.", image: "/welcome/kira-capabilities.png", imageAlt: "Kira presentando sus capacidades en OpenCohost", bullets: ["Conversación fluida y contextual", "Presencia central, sin distraerte", "Funciona desde tu propio equipo"] },
  { title: "Tu agenda, siempre presente", copy: "Dale a Kira el contexto que necesita para acompañar cada momento.", image: "/welcome/kira-agenda.png", imageAlt: "Kira organizando la agenda del stream", bullets: ["Agenda y temas prioritarios", "Contexto compacto del chat", "Memoria y personalidad configurables"] },
  { title: "Una voz que se adapta", copy: "Elegí cómo hablar con Kira y cómo querés que suene.", image: "/welcome/kira-voice.png", imageAlt: "Kira conversando por voz con micrófono y Push-to-Talk", bullets: ["Conversación por voz y Push-to-Talk", "Síntesis de voz local", "Modelos, voces y ritmos ajustables"] },
  { title: "Tu cockpit de streaming", copy: "Coordiná el show sin sacar a Kira del centro de la experiencia.", image: "/welcome/kira-stream.png", imageAlt: "Kira controlando el cockpit de streaming", bullets: ["Música y ducking automático", "Integración con OBS", "Perfiles y controles de stream"] },
  { title: "Tu flujo, tus reglas", copy: "OpenCohost prioriza el control local y se adapta a tu manera de trabajar.", image: "/welcome/kira-privacy.png", imageAlt: "Kira configurando privacidad y controles locales", bullets: ["Privacidad local-first", "Flujos y proveedores configurables", "Controles claros para cada sesión"] }
] as const;

export function WelcomeCard({ onDismiss }: WelcomeCardProps) {
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
        <button ref={closeRef} type="button" aria-label="Cerrar bienvenida" onClick={onDismiss} className="absolute right-4 top-4 z-10 rounded-lg p-2 text-muted-foreground transition duration-fast ease-io hover:bg-surface-2 hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"><X size={18} /></button>
        <div className="flex min-h-0 flex-col p-8 lg:p-10">
          <div className="font-mono text-xs font-semibold uppercase tracking-[.18em] text-primary"><span>{slide + 1} de {SLIDES.length}</span><span className="mx-2 text-border">/</span>Bienvenido a OpenCohost</div>
          <div className="my-auto py-5">
            <h2 id="welcome-title" className="max-w-md text-3xl font-bold tracking-tight text-foreground lg:text-4xl">{current.title}</h2>
            <p className="mt-4 max-w-md text-base leading-6 text-muted-foreground">{current.copy}</p>
            <ul className="mt-5 space-y-2.5">
              {current.bullets.map((bullet) => <li key={bullet} className="flex items-center gap-3 text-sm text-foreground"><span className="grid h-6 w-6 place-items-center rounded-full bg-accent-soft text-primary"><Check size={14} /></span>{bullet}</li>)}
            </ul>
          </div>
          <div>
            <div className="mb-4 flex gap-1" aria-label="Progreso de bienvenida">{SLIDES.map((item, index) => <button key={item.title} type="button" aria-label={`Ir a la diapositiva ${index + 1}: ${item.title}`} aria-current={index === slide ? "step" : undefined} onClick={() => setSlide(index)} className="rounded-full p-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"><span className={`block h-1.5 rounded-full transition-all duration-fast ease-io ${index === slide ? "w-8 bg-primary" : "w-2 bg-border"}`} /></button>)}</div>
            <div className="flex items-center justify-between">
              <button type="button" onClick={onDismiss} className="rounded-lg px-2 py-2 text-sm text-muted-foreground hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">Omitir</button>
              <div className="flex gap-2">
                {slide > 0 && <button type="button" aria-label="Anterior" onClick={() => setSlide(slide - 1)} className="rounded-lg border border-border p-2.5 text-foreground hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"><ArrowLeft size={18} /></button>}
                {slide < SLIDES.length - 1 ? <button type="button" onClick={() => setSlide(slide + 1)} className="flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">Siguiente <ArrowRight size={17} /></button> : <button type="button" onClick={onDismiss} className="rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">Empezar con Kira</button>}
              </div>
            </div>
          </div>
        </div>
        <div className="relative min-h-0 overflow-hidden border-l border-border bg-surface-2">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_35%,var(--accent-soft),transparent_65%)]" />
          <div className="absolute inset-x-8 bottom-8 top-8 rounded-2xl border border-[color-mix(in_srgb,var(--border)_70%,transparent)] bg-[color-mix(in_srgb,var(--background)_30%,transparent)] shadow-panel" />
          {imageVisible && <img key={current.image} src={current.image} onError={hideBrokenImage} alt={current.imageAlt} className="welcome-slide-image relative h-full w-full object-cover object-center" />}
        </div>
      </section>
    </div>
  );
}
