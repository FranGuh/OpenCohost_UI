import { useEffect, useRef, useState } from "react";
import { getI18nState, putI18nLocale, type I18nStateResponse } from "../../api/i18n.js";
import { ThemeSwitcher } from "../../theme/ThemeSwitcher.js";
import { useDensity } from "../../theme/useDensity.js";
import { ALERT_STYLES, useAlertStyle } from "../../theme/useAlertStyle.js";
import { useLogsPref } from "../../store/useLogsPref.js";
import { useT, type TKey } from "../../i18n/t.js";
import { useUiLocale, type UiLocale } from "../../i18n/locale.js";
import { Alert } from "../../ui/Alert.js";
import { Segmented } from "../../ui/Segmented.js";
import { Select } from "../../ui/Select.js";
import { Switch } from "../../ui/Switch.js";

const ALERT_STYLE_OPTIONS = [
  { value: "sereno", labelKey: "shell.settings.alertStyle.sereno" },
  { value: "marcado", labelKey: "shell.settings.alertStyle.marcado" },
  { value: "contorno", labelKey: "shell.settings.alertStyle.contorno" }
] as const satisfies ReadonlyArray<{ value: (typeof ALERT_STYLES)[number]; labelKey: TKey }>;

// Locale codes, not translated content — kept distinct from the "Voz de Kira"
// control's "Español"/"English" endonyms below so the two controls' option
// buttons never share an accessible name (see SettingsPopover.test.tsx).
const UI_LOCALE_OPTIONS: ReadonlyArray<{ value: UiLocale; label: string }> = [
  { value: "es", label: "ES" },
  { value: "en", label: "EN" }
];

const HELP_TOPICS: ReadonlyArray<{ titleKey: TKey; bodyKey: TKey }> = [
  { titleKey: "shell.settings.help.experiencia.title", bodyKey: "shell.settings.help.experiencia.body" },
  { titleKey: "shell.settings.help.controles.title", bodyKey: "shell.settings.help.controles.body" },
  { titleKey: "shell.settings.help.agenda.title", bodyKey: "shell.settings.help.agenda.body" },
  { titleKey: "shell.settings.help.stream.title", bodyKey: "shell.settings.help.stream.body" },
  { titleKey: "shell.settings.help.musica.title", bodyKey: "shell.settings.help.musica.body" }
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
  const t = useT();
  const { locale: uiLocale, setLocale: setUiLocale } = useUiLocale();
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
        // Best-effort: only the "Voz de Kira" row stays hidden on a fetch
        // failure. The interface-locale row above it is local-only and must
        // survive an unreachable/erroring backend.
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
        aria-label={t("shell.settings.trigger.aria")}
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
              {t("shell.settings.theme.eyebrow")}
            </span>
            <ThemeSwitcher />
          </section>

          <section aria-labelledby="settings-alerts-label" className="space-y-2 border-t border-border-soft pt-3.5">
            <span id="settings-alerts-label" className="text-[11px] font-semibold uppercase tracking-[0.09em] text-dim">
              {t("shell.settings.alerts.eyebrow")}
            </span>
            <Segmented
              ariaLabel={t("shell.settings.alerts.style.aria")}
              options={ALERT_STYLE_OPTIONS.map((option) => ({ value: option.value, label: t(option.labelKey) }))}
              value={alertStyle}
              onChange={setAlertStyle}
            />
            <Alert tone="info" title={t("shell.settings.alerts.preview.title")}>
              {t("shell.settings.alerts.preview.body")}
            </Alert>
          </section>

          <section aria-labelledby="settings-view-label" className="space-y-2 border-t border-border-soft pt-3.5">
            <span id="settings-view-label" className="text-[11px] font-semibold uppercase tracking-[0.09em] text-dim">
              {t("shell.settings.view.eyebrow")}
            </span>
            <div className="grid grid-cols-[1fr_auto] items-center gap-3">
              <span className="text-[13px] text-foreground">{t("shell.settings.view.compact")}</span>
              <Switch checked={compact} onChange={setCompact} aria-label={t("shell.settings.view.compact")} />
            </div>
            <div className="grid grid-cols-[1fr_auto] items-center gap-3">
              <span className="text-[13px] text-foreground">{t("shell.settings.view.showLogs")}</span>
              <Switch checked={showLogs} onChange={setShowLogs} aria-label={t("shell.settings.view.showLogs")} />
            </div>
          </section>

          <section aria-labelledby="settings-language-label" className="space-y-3 border-t border-border-soft pt-3.5">
            <span id="settings-language-label" className="text-[11px] font-semibold uppercase tracking-[0.09em] text-dim">
              {t("shell.settings.language.eyebrow")}
            </span>

            {/* Two controls, one card (§4.8): the UI locale flips instantly and
                never touches the backend; Kira's speech locale below is
                restart-scoped, exactly as before. Distinct control names
                (ariaLabel) keep both accessible and keep the existing Idioma
                tests locating the backend control unambiguously.

                The section itself is NOT gated on `i18n`: the interface control
                is local-only, so a failed/slow GET /api/i18n must not take it
                down with the backend row. Only the "Voz de Kira" block waits. */}
            <div className="space-y-1.5">
              <span className="text-[13px] text-foreground">{t("shell.settings.language.interface")}</span>
              <Segmented
                ariaLabel={t("shell.settings.language.interface.aria")}
                options={UI_LOCALE_OPTIONS}
                value={uiLocale}
                onChange={(code) => setUiLocale(code)}
                className="w-full"
              />
            </div>

            {i18n && (
              <div className="space-y-1.5">
                <span className="text-[13px] text-foreground">{t("shell.settings.language.kiraVoice")}</span>
                {i18n.available.length <= 3 ? (
                  // ≤3 locales (the app ships es+en today): a Segmented row — the
                  // SAME control as Alertas right above — so it matches the design
                  // and adds zero scroll region inside the popover.
                  <Segmented
                    ariaLabel={t("shell.settings.language.kiraVoice.aria")}
                    options={i18n.available.map((bundle) => ({ value: bundle.code, label: bundle.display }))}
                    value={i18n.persisted_locale}
                    onChange={(code: string) => void handleLocaleChange(code)}
                    className="w-full"
                  />
                ) : (
                  // ponytail: dead branch until the backend ships a 4th locale.
                  // It used to carry a warning that Select's menu escaped this
                  // popover with no nested scrollbar; both are fixed — the list
                  // portals to <body> and positions itself off the trigger
                  // (40f7537), and it scrolls inside a measured max-height
                  // (6f7194b). The branch is dead on option count alone now.
                  <Select
                    aria-label={t("shell.settings.language.kiraVoice.aria")}
                    options={i18n.available.map((bundle) => ({ value: bundle.code, label: bundle.display }))}
                    value={i18n.persisted_locale}
                    onChange={(code: string) => void handleLocaleChange(code)}
                  />
                )}
                {i18n.pending_restart && (
                  <p className="text-xs font-semibold text-amber-500">
                    {t("shell.settings.language.pendingRestart.notice")}
                  </p>
                )}
              </div>
            )}
          </section>

          <section aria-labelledby="settings-welcome-label" className="space-y-2 border-t border-border-soft pt-3.5">
            <span id="settings-welcome-label" className="text-[11px] font-semibold uppercase tracking-[0.09em] text-dim">
              {t("shell.settings.welcome.eyebrow")}
            </span>
            <button
              type="button"
              onClick={handleShowWelcome}
              className="w-full rounded-md border border-border px-3 py-2 text-left text-[13px] font-semibold text-foreground transition-colors duration-fast ease-io hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              {t("shell.settings.welcome.action")}
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
              {t("shell.settings.help.action")}
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
                <details key={topic.titleKey} className="rounded-md border border-border-soft bg-background px-3 py-2">
                  <summary className="cursor-pointer text-[13px] font-semibold text-foreground">{t(topic.titleKey)}</summary>
                  <p className="pt-2 text-xs leading-relaxed text-muted-foreground">{t(topic.bodyKey)}</p>
                </details>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
