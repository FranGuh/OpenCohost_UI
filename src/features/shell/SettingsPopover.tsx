import { useContext, useEffect, useRef, useState } from "react";
import { QueryClientContext } from "@tanstack/react-query";
import { Bug, ChevronDown, ExternalLink, HelpCircle, RotateCcw, Settings, X } from "lucide-react";
import { getI18nState, putI18nLocale, type I18nStateResponse } from "../../api/i18n.js";
import { getUpdateStatus, putUpdateConfig } from "../../api/update.js";
import { ThemeSwitcher } from "../../theme/ThemeSwitcher.js";
import { useDensity } from "../../theme/useDensity.js";
import { ALERT_STYLES, useAlertStyle } from "../../theme/useAlertStyle.js";
import { getUnloadModelsOnExit, setUnloadModelsOnExit } from "../../lib/shellPrefs.js";
import { useLogsPref } from "../../store/useLogsPref.js";
import { useT, type TKey } from "../../i18n/t.js";
import { useUiLocale, type UiLocale } from "../../i18n/locale.js";
import { Alert } from "../../ui/Alert.js";
import { Segmented } from "../../ui/Segmented.js";
import { Select } from "../../ui/Select.js";
import { Switch } from "../../ui/Switch.js";
import { openExternalUrl } from "../../lib/openUrl.js";
import { cn } from "../../lib/cn.js";
import { RestartToApply } from "../shared/RestartToApply.js";
import { REPORT_ISSUE_URL } from "./supportUrls.js";

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
  const queryClient = useContext(QueryClientContext);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  // D6 (kira_bilingual_e2e_20260705): locale switching is next-boot only, so
  // this is plain fetch + local state (no query invalidation elsewhere
  // depends on it) rather than react-query, mirroring this component's
  // existing local-state pattern (compact/showLogs above).
  const [i18n, setI18n] = useState<I18nStateResponse | null>(null);
  // Owned by the Tauri shell (readable at exit without the backend); default ON.
  const [unloadOnExit, setUnloadOnExit] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void getUnloadModelsOnExit().then((value) => {
      if (!cancelled) setUnloadOnExit(value);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  function handleUnloadOnExitChange(next: boolean) {
    setUnloadOnExit(next);
    void setUnloadModelsOnExit(next);
  }

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

  // Update check (update-notification-20261111): plain fetch + local state,
  // like the i18n block above. Hidden until the backend answers.
  const [update, setUpdate] = useState<{ version: string; enabled: boolean } | null>(null);

  useEffect(() => {
    let cancelled = false;
    getUpdateStatus()
      .then((data) => {
        if (!cancelled) setUpdate({ version: data.current, enabled: data.enabled });
      })
      .catch(() => {
        // Best-effort: the row stays hidden on a fetch failure.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function handleUpdateCheckChange(next: boolean) {
    const previous = update;
    setUpdate((u) => (u ? { ...u, enabled: next } : u));
    putUpdateConfig(next).catch(() => setUpdate(previous));
  }

  async function handleLocaleChange(locale: string) {
    try {
      const next = await putI18nLocale(locale);
      setI18n(next);
      queryClient?.setQueryData(["i18n"], next);
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
    <div ref={rootRef} className={cn("relative", open && "z-50")}>
      <button
        ref={triggerRef}
        type="button"
        aria-label={t("shell.settings.trigger.aria")}
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls="settings-popover-panel"
        onClick={() => setOpen((value) => !value)}
        style={{ WebkitAppRegion: "no-drag" }}
        className="relative z-20 flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition-colors duration-fast ease-io hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <Settings
          size={16}
          aria-hidden="true"
          className={cn("transition-transform duration-base", open && "rotate-45 text-foreground")}
        />
      </button>

      {open && (
        <div
          id="settings-popover-panel"
          className="absolute right-0 top-11 z-50 w-80 max-w-[calc(100vw-2rem)] rounded-md border border-border-soft bg-card shadow-panel animate-rise-in"
          style={{
            WebkitAppRegion: "no-drag",
            backdropFilter: "var(--surface-blur)",
            WebkitBackdropFilter: "var(--surface-blur)",
          }}
        >
          {/* Scroll container */}
          <div className="flex max-h-[calc(100vh-4rem)] flex-col gap-3 overflow-y-auto overflow-x-hidden p-3.5">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-border-soft pb-2.5">
              <div className="flex items-center gap-2">
                <Settings size={14} className="text-primary" aria-hidden="true" />
                <h2 className="text-xs font-semibold uppercase tracking-[0.1em] text-foreground font-mono">
                  {t("shell.settings.trigger.aria")}
                </h2>
              </div>
              {update && (
                <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[10px] font-mono text-dim">
                  {`v${update.version}`}
                </span>
              )}
            </div>

            {/* Card 1: Apariencia & Vista */}
            <div className="rounded-lg bg-surface-2/60 p-3 space-y-3">
              <section aria-labelledby="settings-theme-label" className="space-y-1.5">
                <span id="settings-theme-label" className="text-[10.5px] font-semibold uppercase tracking-[0.09em] text-dim">
                  {t("shell.settings.theme.eyebrow")}
                </span>
                <ThemeSwitcher />
              </section>

              <section aria-labelledby="settings-view-label" className="space-y-2 border-t border-border-soft/25 pt-2.5">
                <span id="settings-view-label" className="text-[10.5px] font-semibold uppercase tracking-[0.09em] text-dim">
                  {t("shell.settings.view.eyebrow")}
                </span>
                <div className="grid grid-cols-[1fr_auto] items-center gap-3">
                  <span className="text-[12.5px] text-foreground">{t("shell.settings.view.compact")}</span>
                  <Switch checked={compact} onChange={setCompact} aria-label={t("shell.settings.view.compact")} />
                </div>
                <div className="grid grid-cols-[1fr_auto] items-center gap-3">
                  <span className="text-[12.5px] text-foreground">{t("shell.settings.view.showLogs")}</span>
                  <Switch checked={showLogs} onChange={setShowLogs} aria-label={t("shell.settings.view.showLogs")} />
                </div>
              </section>

              <section aria-labelledby="settings-alerts-label" className="space-y-2 border-t border-border-soft/25 pt-2.5">
                <span id="settings-alerts-label" className="text-[10.5px] font-semibold uppercase tracking-[0.09em] text-dim">
                  {t("shell.settings.alerts.eyebrow")}
                </span>
                <Segmented
                  ariaLabel={t("shell.settings.alerts.style.aria")}
                  options={ALERT_STYLE_OPTIONS.map((option) => ({ value: option.value, label: t(option.labelKey) }))}
                  value={alertStyle}
                  onChange={setAlertStyle}
                  className="w-full border-0 bg-surface-2/80 shadow-none"
                />
                <Alert tone="info" title={t("shell.settings.alerts.preview.title")}>
                  {t("shell.settings.alerts.preview.body")}
                </Alert>
              </section>
            </div>

            {/* Card 2: Sistema & Cierre */}
            <div className="rounded-lg bg-surface-2/60 p-3 space-y-2">
              <section aria-labelledby="settings-exit-label" className="space-y-2">
                <span id="settings-exit-label" className="text-[10.5px] font-semibold uppercase tracking-[0.09em] text-dim">
                  {t("shell.settings.exit.eyebrow")}
                </span>
                <div className="grid grid-cols-[1fr_auto] items-center gap-3">
                  <span className="text-[12.5px] text-foreground">{t("shell.settings.exit.unloadModels")}</span>
                  <Switch
                    checked={unloadOnExit}
                    onChange={handleUnloadOnExitChange}
                    aria-label={t("shell.settings.exit.unloadModels")}
                  />
                </div>
                <p className="text-[11px] leading-relaxed text-muted-foreground/80">{t("shell.settings.exit.unloadModels.help")}</p>
              </section>
            </div>

            {/* Update check: running version + opt-out switch */}
            {update && (
              <div className="rounded-lg bg-surface-2/60 p-3 space-y-2">
                <section aria-labelledby="settings-update-label" className="space-y-2">
                  <span id="settings-update-label" className="text-[10.5px] font-semibold uppercase tracking-[0.09em] text-dim">
                    {t("shell.settings.update.version", { version: update.version })}
                  </span>
                  <div className="grid grid-cols-[1fr_auto] items-center gap-3">
                    <span className="text-[12.5px] text-foreground">{t("shell.settings.update.check")}</span>
                    <Switch
                      checked={update.enabled}
                      onChange={handleUpdateCheckChange}
                      aria-label={t("shell.settings.update.check")}
                    />
                  </div>
                  <p className="text-[11px] leading-relaxed text-muted-foreground/80">{t("shell.settings.update.help")}</p>
                </section>
              </div>
            )}

            {/* Card 3: Idioma */}
            <div className="rounded-lg bg-surface-2/60 p-3 space-y-3">
              <section aria-labelledby="settings-language-label" className="space-y-3">
                <span id="settings-language-label" className="text-[10.5px] font-semibold uppercase tracking-[0.09em] text-dim">
                  {t("shell.settings.language.eyebrow")}
                </span>

                <div className="space-y-1.5">
                  <span className="text-[12.5px] text-foreground">{t("shell.settings.language.interface")}</span>
                  <Segmented
                    ariaLabel={t("shell.settings.language.interface.aria")}
                    options={UI_LOCALE_OPTIONS}
                    value={uiLocale}
                    onChange={(code) => setUiLocale(code)}
                    className="w-full border-0 bg-surface-2/80 shadow-none"
                  />
                </div>

                {i18n && (() => {
                  const voiceLocaleOptions = [...i18n.available]
                    .sort((a, b) => {
                      const aPrimary = a.code.split("-")[0].toLowerCase();
                      const bPrimary = b.code.split("-")[0].toLowerCase();
                      if (aPrimary === "es" && bPrimary !== "es") return -1;
                      if (bPrimary === "es" && aPrimary !== "es") return 1;
                      return a.code.localeCompare(b.code);
                    })
                    .map((bundle) => ({ value: bundle.code, label: bundle.display }));

                  return (
                    <div className="space-y-1.5">
                      <span className="text-[12.5px] text-foreground">{t("shell.settings.language.kiraVoice")}</span>
                      {voiceLocaleOptions.length <= 3 ? (
                        <Segmented
                          ariaLabel={t("shell.settings.language.kiraVoice.aria")}
                          options={voiceLocaleOptions}
                          value={i18n.persisted_locale}
                          onChange={(code: string) => void handleLocaleChange(code)}
                          className="w-full border-0 bg-surface-2/80 shadow-none"
                        />
                      ) : (
                        <Select
                          aria-label={t("shell.settings.language.kiraVoice.aria")}
                          options={voiceLocaleOptions}
                          value={i18n.persisted_locale}
                          onChange={(code: string) => void handleLocaleChange(code)}
                        />
                      )}
                      {i18n.pending_restart && (
                        <RestartToApply notice="shell.settings.language.pendingRestart.notice" />
                      )}
                    </div>
                  );
                })()}
              </section>
            </div>

            {/* Card 4: Soporte & Ayuda */}
            <div className="rounded-lg bg-surface-2/60 p-3 space-y-2">
              <section aria-labelledby="settings-support-label" className="space-y-2">
                <span id="settings-support-label" className="text-[10.5px] font-semibold uppercase tracking-[0.09em] text-dim">
                  {t("shell.settings.support.eyebrow")}
                </span>

                {/* Report bug in GitHub button */}
                <button
                  type="button"
                  aria-label={t("shell.settings.support.reportBug.aria")}
                  onClick={() => void openExternalUrl(REPORT_ISSUE_URL)}
                  className="flex w-full items-center justify-between rounded-md bg-surface-2 px-3 py-2 text-left text-[12.5px] font-medium text-foreground transition-colors duration-fast ease-io hover:bg-surface-3 hover:text-amber-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                  <span className="flex items-center gap-2">
                    <Bug size={14} className="text-amber-400 shrink-0" aria-hidden="true" />
                    <span>{t("shell.settings.support.reportBug")}</span>
                  </span>
                  <ExternalLink size={12} className="text-muted-foreground shrink-0" aria-hidden="true" />
                </button>

                {/* Welcome replay button */}
                <button
                  type="button"
                  onClick={handleShowWelcome}
                  className="flex w-full items-center justify-between rounded-md bg-surface-2 px-3 py-2 text-left text-[12.5px] font-medium text-foreground transition-colors duration-fast ease-io hover:bg-surface-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                  <span className="flex items-center gap-2">
                    <RotateCcw size={14} className="text-muted-foreground shrink-0" aria-hidden="true" />
                    <span>{t("shell.settings.welcome.action")}</span>
                  </span>
                </button>

                {/* Help Trigger button */}
                <button
                  type="button"
                  aria-expanded={helpOpen}
                  aria-controls="settings-help-flyout"
                  onClick={() => setHelpOpen((value) => !value)}
                  className="flex w-full items-center justify-between rounded-md bg-surface-2 px-3 py-2 text-left text-[12.5px] font-medium text-foreground transition-colors duration-fast ease-io hover:bg-surface-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                  <span className="flex items-center gap-2">
                    <HelpCircle size={14} className="text-muted-foreground shrink-0" aria-hidden="true" />
                    <span>{t("shell.settings.help.action")}</span>
                  </span>
                  <ChevronDown
                    size={14}
                    aria-hidden="true"
                    className={cn("text-dim transition-transform duration-base ease-io", helpOpen && "rotate-180")}
                  />
                </button>
              </section>
            </div>
          </div>

          {/* Lateral flyout */}
          {helpOpen && (
            <div
              id="settings-help-flyout"
              className="absolute right-full top-0 z-20 mr-2 flex max-h-[calc(100vh-4rem)] w-64 flex-col gap-2 overflow-y-auto overflow-x-hidden break-words rounded-md border border-border-soft bg-card p-3 shadow-panel animate-rise-in max-sm:inset-0 max-sm:mr-0 max-sm:w-auto max-sm:max-h-none"
              style={{
                WebkitAppRegion: "no-drag",
                backdropFilter: "var(--surface-blur)",
                WebkitBackdropFilter: "var(--surface-blur)",
              }}
            >
              <button
                type="button"
                aria-label={t("shell.settings.help.close.aria")}
                onClick={() => setHelpOpen(false)}
                className="self-end rounded-md p-1 text-[13px] text-muted-foreground hover:bg-surface-2 hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring sm:hidden"
              >
                <X size={14} aria-hidden="true" />
              </button>
              {HELP_TOPICS.map((topic) => (
                <details key={topic.titleKey} className="rounded-lg bg-surface-2/60 px-3 py-2 transition-colors hover:bg-surface-2/80">
                  <summary className="cursor-pointer text-[12.5px] font-semibold text-foreground">{t(topic.titleKey)}</summary>
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
