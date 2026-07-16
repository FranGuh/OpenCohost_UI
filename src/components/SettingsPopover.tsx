import { useEffect, useRef, useState } from "react";
import { getI18nState, putI18nLocale, type I18nStateResponse } from "../api/i18n.js";
import { ThemeSwitcher } from "../theme/ThemeSwitcher.js";
import { useDensity } from "../theme/useDensity.js";
import { ALERT_STYLES, useAlertStyle } from "../theme/useAlertStyle.js";
import { Alert } from "./ui/Alert.js";
import { Segmented } from "./ui/Segmented.js";
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
 * "Mostrar logs" client-pref stub (no live log data — that needs the
 * backend), and a static Ayuda section (5 CTK help topics ported as
 * <details>/<summary> collapsibles).
 */
export interface SettingsPopoverProps {
  onShowWelcome(): void;
}

export function SettingsPopover({ onShowWelcome }: SettingsPopoverProps) {
  const [open, setOpen] = useState(false);
  const [showLogs, setShowLogs] = useState(false);
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
            <p role="status" className="text-xs leading-relaxed text-muted-foreground">
              Mostrar logs necesita streaming en vivo desde el backend — todavía no existe ese endpoint, así que el
              toggle no trae datos reales.
            </p>
          </section>

          {i18n && (
            <section aria-labelledby="settings-language-label" className="space-y-2 border-t border-border-soft pt-3.5">
              <span id="settings-language-label" className="text-[11px] font-semibold uppercase tracking-[0.09em] text-dim">
                Idioma
              </span>
              <select
                aria-label="Idioma"
                value={i18n.persisted_locale}
                onChange={(event) => void handleLocaleChange(event.target.value)}
                className="w-full rounded-md border border-border-soft bg-background px-2 py-1.5 text-[13px] text-foreground"
              >
                {i18n.available.map((bundle) => (
                  <option key={bundle.code} value={bundle.code}>
                    {bundle.display}
                  </option>
                ))}
              </select>
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

          <details className="border-t border-border-soft pt-3.5">
            <summary className="cursor-pointer text-[11px] font-semibold uppercase tracking-[0.09em] text-dim">
              Ayuda
            </summary>
            <div className="flex flex-col gap-2 pt-2">
              {HELP_TOPICS.map((topic) => (
                <details key={topic.title} className="rounded-md border border-border-soft bg-background px-3 py-2">
                  <summary className="cursor-pointer text-[13px] font-semibold text-foreground">{topic.title}</summary>
                  <p className="pt-2 text-xs leading-relaxed text-muted-foreground">{topic.body}</p>
                </details>
              ))}
            </div>
          </details>
        </div>
      )}
    </div>
  );
}
