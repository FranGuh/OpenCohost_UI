import { useEffect, useRef, useState } from "react";
import { Card } from "../../ui/Card.js";
import { Badge } from "../../ui/Badge.js";
import { Switch } from "../../ui/Switch.js";
import { Button } from "../../ui/Button.js";
import { useObsConfigQuery, useTestObsConnectionMutation, useUpdateObsConfigMutation } from "../../api/obs.js";
import { useUiLocaleStore } from "../../i18n/locale.js";
import { useT } from "../../i18n/t.js";

const inputClass =
  "h-9 w-40 rounded-md border border-border bg-background px-3 text-sm text-foreground placeholder:text-dim focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-60";

function parseObsPort(raw: string): number | null {
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const port = Number(trimmed);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) return null;
  return port;
}

/**
 * OBS card — wired to GET/PUT /api/obs/config + POST /api/obs/test
 * (opencohost/api/main.py ~678-712). Fields hydrate from GET; the top-level
 * enable switch persists immediately via a partial `{ enabled }` PUT, while
 * "Guardar" PUTs host/port/source/enabled (password only when typed — omitted
 * otherwise, per ObsConfigRequest's partial-update contract).
 * "Probar conexión" POSTs the in-progress form values (unsaved edits
 * included) and renders a color-coded ok/fail result.
 *
 * Unsaved connection edits are guarded against background refetches, and
 * `#obs-port` is validated client-side as an integer in 1..65535.
 *
 * Password is WRITE-ONLY: the input never receives the fetched
 * `password_set` flag as a value (there is no real password to echo) and
 * is cleared back to empty after every save, so nothing round-trips.
 */
export function ObsCard() {
  const t = useT();
  const locale = useUiLocaleStore((s) => s.locale);
  const { data, isError: getError } = useObsConfigQuery();
  const updateConfig = useUpdateObsConfigMutation();
  const testConnection = useTestObsConnectionMutation();

  const [enabled, setEnabled] = useState(false);
  const [host, setHost] = useState("");
  const [port, setPort] = useState("");
  const [source, setSource] = useState("");
  const [password, setPassword] = useState("");
  const [portError, setPortError] = useState<string | null>(null);
  const isDirtyRef = useRef(false);

  const portValidationMessage =
    locale === "en" ? "Port must be an integer between 1 and 65535." : "El puerto debe ser un entero entre 1 y 65535.";

  useEffect(() => {
    if (!data) return;
    setEnabled(data.enabled);
    if (!isDirtyRef.current) {
      setHost(data.host);
      setPort(String(data.port));
      setSource(data.source);
      setPortError(null);
    }
  }, [data]);

  function handleToggleEnabled(next: boolean) {
    const prev = enabled;
    setEnabled(next);
    updateConfig.mutate(
      { enabled: next },
      {
        onError: () => setEnabled(prev)
      }
    );
  }

  function save() {
    const parsedPort = parseObsPort(port);
    if (parsedPort === null) {
      setPortError(portValidationMessage);
      return;
    }
    setPortError(null);
    const body: Record<string, unknown> = { enabled, host, port: parsedPort, source };
    if (password) body.password = password;
    updateConfig.mutate(body, {
      onSuccess: (saved) => {
        isDirtyRef.current = false;
        setHost(saved.host);
        setPort(String(saved.port));
        setSource(saved.source);
        setPassword("");
      }
    });
  }

  function runTest() {
    const parsedPort = parseObsPort(port);
    if (parsedPort === null) {
      setPortError(portValidationMessage);
      return;
    }
    setPortError(null);
    const body: Record<string, unknown> = { host, port: parsedPort };
    if (password) body.password = password;
    testConnection.mutate(body);
  }

  return (
    <Card className="flex flex-col p-4">
      <div className="flex items-center justify-between gap-3 border-b border-border-soft pb-3">
        <h2 className="text-sm font-bold text-foreground">OBS</h2>
        {updateConfig.isPending && <Badge tone="info">{t("controles.obs.card.pending")}</Badge>}
      </div>

      <div className="flex flex-col gap-3.5 pt-3.5">
        {getError && (
          <p role="alert" className="text-xs leading-relaxed text-danger">
            {t("controles.obs.error.load")}
          </p>
        )}
        {updateConfig.isError && (
          <p role="alert" className="text-xs leading-relaxed text-danger">
            {updateConfig.error?.message ?? t("controles.obs.error.save")}
          </p>
        )}

        {data && (
          <>
            <div className="grid grid-cols-[1fr_auto] items-center gap-3">
              <span className="text-[13px] text-foreground">{t("controles.obs.enabled")}</span>
              <Switch
                checked={enabled}
                disabled={updateConfig.isPending}
                onChange={handleToggleEnabled}
                aria-label={t("controles.obs.enabled")}
              />
            </div>

            <details className="border-t border-border-soft pt-3.5">
              <summary className="cursor-pointer text-[11px] font-semibold uppercase tracking-[0.09em] text-dim">
                {t("controles.obs.connection.eyebrow")}
              </summary>

              <div className="flex flex-col gap-3.5 pt-3.5">
                <div className="grid grid-cols-[1fr_auto] items-center gap-3">
                  <label htmlFor="obs-host" className="text-[13px] text-foreground">
                    {t("controles.obs.host.label")}
                  </label>
                  <input
                    id="obs-host"
                    type="text"
                    value={host}
                    onChange={(e) => {
                      isDirtyRef.current = true;
                      setHost(e.target.value);
                    }}
                    className={inputClass}
                  />
                </div>

                <div className="grid grid-cols-[1fr_auto] items-center gap-3">
                  <label htmlFor="obs-port" className="text-[13px] text-foreground">
                    {t("controles.obs.port.label")}
                  </label>
                  <input
                    id="obs-port"
                    type="text"
                    inputMode="numeric"
                    value={port}
                    aria-invalid={portError ? true : undefined}
                    onChange={(e) => {
                      isDirtyRef.current = true;
                      setPort(e.target.value);
                      if (portError) setPortError(null);
                    }}
                    className={inputClass}
                  />
                </div>

                {portError && (
                  <p role="alert" className="text-xs leading-relaxed text-danger">
                    {portError}
                  </p>
                )}

                <div className="grid grid-cols-[1fr_auto] items-center gap-3">
                  <label htmlFor="obs-source" className="text-[13px] text-foreground">
                    {t("controles.obs.source.label")}
                  </label>
                  <input
                    id="obs-source"
                    type="text"
                    value={source}
                    onChange={(e) => {
                      isDirtyRef.current = true;
                      setSource(e.target.value);
                    }}
                    className={inputClass}
                  />
                </div>

                <div className="space-y-2">
                  <div className="grid grid-cols-[1fr_auto] items-center gap-3">
                    <label htmlFor="obs-password" className="text-[13px] text-foreground">
                      {t("controles.obs.password.label")}
                    </label>
                    {data.password_set && <Badge tone="neutral">{t("controles.obs.password.setBadge")}</Badge>}
                  </div>
                  <input
                    id="obs-password"
                    type="password"
                    autoComplete="new-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={
                      data.password_set
                        ? t("controles.obs.password.placeholder.change")
                        : t("controles.obs.password.placeholder.new")
                    }
                    className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground placeholder:text-dim focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  />
                </div>

                <div className="grid grid-cols-[1fr_auto] items-center gap-3">
                  <Button type="button" disabled={updateConfig.isPending} onClick={save}>
                    {t("controles.obs.save.action")}
                  </Button>
                  <Button type="button" variant="outline" disabled={testConnection.isPending} onClick={runTest}>
                    {t("controles.obs.test.action")}
                  </Button>
                </div>

                {testConnection.data && (
                  <p role="status" className={`text-xs leading-relaxed ${testConnection.data.ok ? "text-ok" : "text-danger"}`}>
                    {testConnection.data.ok
                      ? t("controles.obs.test.success")
                      : (testConnection.data.error ?? t("controles.obs.test.failure"))}
                  </p>
                )}
              </div>
            </details>
          </>
        )}
      </div>
    </Card>
  );
}
