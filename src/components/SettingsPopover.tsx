import { useEffect, useRef, useState } from "react";
import { getI18nState, putI18nLocale, type I18nStateResponse } from "../api/i18n.js";
import { ThemeSwitcher } from "../theme/ThemeSwitcher.js";
import { useDensity } from "../theme/useDensity.js";
import { ALERT_STYLES, useAlertStyle } from "../theme/useAlertStyle.js";
import { useLogsPref } from "../store/useLogsPref.js";
import { Alert } from "./ui/Alert.js";
import { Segmented } from "./ui/Segmented.js";
import { Select } from "./ui/Select.js";
import { Switch } from "./ui/Switch.js";

const ALERT_STYLE_OPTIONS = [
  { value: "sereno", label: "Sereno" },
  { value: "marcado", label: "Marcado" },
  { value: "contorno", label: "Contorno" }
] as const satisfies ReadonlyArray<{ value: (typeof ALERT_STYLES)[number]; label: string }>;

const HELP_TOPICS: ReadonlyArray<{ title: string; body: string }> = [
  {
    title: "Experiencia",
    body: "Chateá con Kira en texto o por voz (Push-to-Talk). El avatar refleja su estado — idle, escuchando, pensando, hablando."
  },
  {
    title: "Controles",
    body: "Elegí el modelo LLM y el tier de calidad, la voz y el motor TTS, y revisá los conteos de memoria de la sesión."
  },
  {
    title: "Agenda",
    body: "Armá una agenda de temas aprobados para que Kira los desarrolle en vivo — priorizá, encolá y controlá la sesión (activar, pausa suave, emergencia)."
  },
  {
    title: "Stream",
    body: "Conectá tu cuenta de streaming, gestioná metadata del stream (título, categoría, tags) y monitoreá el chat en vivo."
  },
  {
    title: "Música",
    body: "Importá loops de audio agrupados por mood y dejá que Kira haga fade y ducking automático mientras habla."
  }
];

/**
 * TopBar gear popover — Tema (ThemeSwitcher) + Wave 1b additions: a real
 * "Compacto" density preference (useDensity, persisted to localStorage), a
 * "Mostrar logs" preference (useLogsPref, persisted) that gates the Logs
 * column tab, and an Ayuda trigger that opens the 5 CTK help topics in a
 * LATERAL flyout (leftward, so it never grows the popover downward).
 */
export interface SettingsPopoverProps {
  onShowWelcome(): void;
}

export function SettingsPopover({ onShowWelcome }: SettingsPopoverProps) {
  const [open, setOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  // "Mostrar logs" now gates the real Logs column tab (R36), so it lives in a
  // shared persisted store, not component-local state.
  const { showLogs, setShowLogs } = useLogsPref();
  const { compact, setCompact } = useDensity();
  const { alertStyle, setAlertStyle } = useAlertStyle();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  // D6 (kira_bilingual_e2e_20260705): locale switching is next-boot only, so
  // this is plain fetch + local state (no query invalidation elsewhere
  // depends on it) rather than react-query, mirroring this component's
  // existing local-state pattern (compact/showLogs above).
  const [i18n, setI18n] = useState<I18nStateResponse | null>(null);

  useEffect(() => {
    let cancelled = false;
    getI18nState()
      .then((data) => {
        if (!cancelled) setI18n(data);
      })
      .catch(() => {
        // Best-effort: the Idioma card just stays hidden on a fetch failure.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleLocaleChange(locale: string) {
    try {
      const next = await putI18nLocale(locale);
      setI18n(next);
    } catch {
      // Best-effort: keep the previous selection if the write fails.
    }
  }

  function handleShowWelcome() {
    triggerRef.current?.focus();
    setOpen(false);
    onShowWelcome();
  }

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  // Collapse the Ayuda flyout whenever the popover closes, so reopening the
  // gear never starts with a stray flyout. Escape/outside-click close the whole
  // popover (existing handler above), which flows through here.
  useEffect(() => {
    if (!open) setHelpOpen(false);
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-label="Configuración"
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls="settings-popover-panel"
        onClick={() => setOpen((value) => !value)}
        className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition-colors duration-fast ease-io hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <span aria-hidden="true">⚙</span>
      </button>

      {open && (
        <div
          id="settings-popover-panel"
          className="absolute right-0 top-11 z-10 flex w-72 flex-col gap-3.5 rounded-md border border-border-soft bg-card p-4 shadow-panel"
        >
          <section aria-labelledby="settings-theme-label" className="space-y-2">
            <span id="settings-theme-label" className="text-[11px] font-semibold uppercase tracking-[0.09em] text-dim">
              Tema
            </span>
            <ThemeSwitcher />
          </section>

          <section aria-labelledby="settings-alerts-label" className="space-y-2 border-t border-border-soft pt-3.5">
            <span id="settings-alerts-label" className="text-[11px] font-semibold uppercase tracking-[0.09em] text-dim">
              Alertas
            </span>
            <Segmented
              ariaLabel="Estilo de alertas"
              options={ALERT_STYLE_OPTIONS}
              value={alertStyle}
              onChange={setAlertStyle}
            />
            <Alert tone="info" title="Así se ve una alerta">
              Elegí el estilo que más te acomode.
            </Alert>
          </section>

          <section aria-labelledby="settings-view-label" className="space-y-2 border-t border-border-soft pt-3.5">
            <span id="settings-view-label" className="text-[11px] font-semibold uppercase tracking-[0.09em] text-dim">
              Vista
            </span>
            <div className="grid grid-cols-[1fr_auto] items-center gap-3">
              <span className="text-[13px] text-foreground">Compacto</span>
              <Switch checked={compact} onChange={setCompact} aria-label="Compacto" />
            </div>
            <div className="grid grid-cols-[1fr_auto] items-center gap-3">
              <span className="text-[13px] text-foreground">Mostrar logs</span>
              <Switch checked={showLogs} onChange={setShowLogs} aria-label="Mostrar logs" />
            </div>
          </section>

          {i18n && (
            <section aria-labelledby="settings-language-label" className="space-y-2 border-t border-border-soft pt-3.5">
              <span id="settings-language-label" className="text-[11px] font-semibold uppercase tracking-[0.09em] text-dim">
                Idioma
              </span>
              {i18n.available.length <= 3 ? (
                // ≤3 locales (the app ships es+en today): a Segmented row — the
                // SAME control as Alertas right above — so it matches the design
                // and adds zero scroll region inside the popover.
                <Segmented
                  ariaLabel="Idioma"
                  options={i18n.available.map((bundle) => ({ value: bundle.code, label: bundle.display }))}
                  value={i18n.persisted_locale}
                  onChange={(code: string) => void handleLocaleChange(code)}
                  className="w-full"
                />
              ) : (
                // ponytail: dead branch until the backend ships a 4th locale.
                // The app's custom Select opens an absolute/z-50 menu that
                // escapes the popover with no nested scrollbar.
                <Select
                  aria-label="Idioma"
                  options={i18n.available.map((bundle) => ({ value: bundle.code, label: bundle.display }))}
                  value={i18n.persisted_locale}
                  onChange={(code: string) => void handleLocaleChange(code)}
                />
              )}
              {i18n.pending_restart && (
                <p className="text-xs font-semibold text-amber-500">
                  Reinicio requerido — se aplica en el próximo inicio de OpenCohost.
                </p>
              )}
            </section>
          )}

          <section aria-labelledby="settings-welcome-label" className="space-y-2 border-t border-border-soft pt-3.5">
            <span id="settings-welcome-label" className="text-[11px] font-semibold uppercase tracking-[0.09em] text-dim">
              Bienvenida
            </span>
            <button
              type="button"
              onClick={handleShowWelcome}
              className="w-full rounded-md border border-border px-3 py-2 text-left text-[13px] font-semibold text-foreground transition-colors duration-fast ease-io hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              Volver a ver bienvenida
            </button>
          </section>

          <div className="border-t border-border-soft pt-3.5">
            <button
              type="button"
              aria-expanded={helpOpen}
              aria-controls="settings-help-flyout"
              onClick={() => setHelpOpen((value) => !value)}
              className="flex w-full items-center justify-between text-[11px] font-semibold uppercase tracking-[0.09em] text-dim transition-colors duration-fast ease-io hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              Ayuda
              <span
                aria-hidden="true"
                className={`text-dim transition-transform duration-base ease-io ${helpOpen ? "rotate-180" : ""}`}
              >
                ▾
              </span>
            </button>
          </div>

          {/* Lateral flyout — the gear sits at the window's right edge, so the
              help opens LEFTward (right-full) instead of growing the popover
              downward. Anchored to the popover's left edge, top-aligned, with
              its own max-h + internal scroll. */}
          {helpOpen && (
            <div
              id="settings-help-flyout"
              className="absolute right-full top-0 z-20 mr-2 flex max-h-[70vh] w-64 flex-col gap-2 overflow-y-auto rounded-md border border-border-soft bg-card p-3 shadow-panel animate-rise-in"
            >
              {HELP_TOPICS.map((topic) => (
                <details key={topic.title} className="rounded-md border border-border-soft bg-background px-3 py-2">
                  <summary className="cursor-pointer text-[13px] font-semibold text-foreground">{topic.title}</summary>
                  <p className="pt-2 text-xs leading-relaxed text-muted-foreground">{topic.body}</p>
                </details>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
