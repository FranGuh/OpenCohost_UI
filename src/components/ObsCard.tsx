import { useState } from "react";
import { Card } from "./ui/Card.js";
import { Badge } from "./ui/Badge.js";
import { Switch } from "./ui/Switch.js";
import { Button } from "./ui/Button.js";
import { useMockCommand } from "../api/mock/useMockCommand.js";
import { OBS_FIXTURE } from "../api/mock/fixtures.js";

const inputClass =
  "h-9 w-40 rounded-md border border-border bg-background px-3 text-sm text-foreground placeholder:text-dim focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-60";

/**
 * OBS card — parity with opencohost/avatar/obs_client.py +
 * opencohost/ui/obs_lifecycle.py. Enable toggle + connection settings
 * (collapsed by default in a native <details>), both mocked (no /api/obs/*
 * endpoint yet). Host/port/source/password are owner-supplied creds
 * (USER-ASSIST, flagged) — text fields are local-only form state (same
 * pattern as ProfileEditor's name/prompt inputs); only the enable toggle and
 * "Probar conexión" are real mutations, so only those two use
 * useMockCommand.
 *
 * Password is WRITE-ONLY: the input never receives the fixture's actual
 * value (there isn't one — only a password_set flag) and always starts
 * empty, so there is nothing to pre-fill or echo back.
 */
export function ObsCard() {
  const [enabled, setEnabled] = useState(OBS_FIXTURE.enabled);
  const [host, setHost] = useState(OBS_FIXTURE.host);
  const [port, setPort] = useState(String(OBS_FIXTURE.port));
  const [source, setSource] = useState(OBS_FIXTURE.source);
  const [password, setPassword] = useState("");
  const enableCommand = useMockCommand<boolean>();
  const testCommand = useMockCommand<{ host: string; port: string; source: string }>();
  const [tested, setTested] = useState(false);

  function applyEnabled(value: boolean) {
    setEnabled(value);
    void enableCommand.run(value);
  }

  async function runTest() {
    setTested(false);
    await testCommand.run({ host, port, source });
    setTested(true);
  }

  return (
    <Card className="flex flex-col p-4">
      <div className="flex items-center justify-between gap-3 border-b border-border-soft pb-3">
        <h2 className="text-sm font-bold text-foreground">OBS</h2>
        <Badge tone={enableCommand.pending ? "info" : enabled ? "ok" : "neutral"}>
          {enableCommand.pending ? "aplicando…" : enabled ? "habilitado" : "deshabilitado"}
        </Badge>
      </div>

      <div className="flex flex-col gap-3.5 pt-3.5">
        <p role="status" className="text-xs leading-relaxed text-muted-foreground">
          Host, puerto, contraseña y fuente son credenciales que vos configurás — no existe endpoint{" "}
          <span className="mono">/api/obs/config</span> en el backend todavía.
        </p>

        <div className="grid grid-cols-[1fr_auto] items-center gap-3">
          <span className="text-[13px] text-foreground">Habilitar OBS</span>
          <Switch checked={enabled} disabled={enableCommand.pending} onChange={applyEnabled} aria-label="Habilitar OBS" />
        </div>

        <details className="border-t border-border-soft pt-3.5">
          <summary className="cursor-pointer text-[11px] font-semibold uppercase tracking-[0.09em] text-dim">
            Configuración de conexión
          </summary>

          <div className="flex flex-col gap-3.5 pt-3.5">
            <div className="grid grid-cols-[1fr_auto] items-center gap-3">
              <label htmlFor="obs-host" className="text-[13px] text-foreground">
                Host
              </label>
              <input id="obs-host" type="text" value={host} onChange={(e) => setHost(e.target.value)} className={inputClass} />
            </div>

            <div className="grid grid-cols-[1fr_auto] items-center gap-3">
              <label htmlFor="obs-port" className="text-[13px] text-foreground">
                Puerto
              </label>
              <input
                id="obs-port"
                type="text"
                inputMode="numeric"
                value={port}
                onChange={(e) => setPort(e.target.value)}
                className={inputClass}
              />
            </div>

            <div className="grid grid-cols-[1fr_auto] items-center gap-3">
              <label htmlFor="obs-source" className="text-[13px] text-foreground">
                Fuente
              </label>
              <input id="obs-source" type="text" value={source} onChange={(e) => setSource(e.target.value)} className={inputClass} />
            </div>

            <div className="space-y-2">
              <div className="grid grid-cols-[1fr_auto] items-center gap-3">
                <label htmlFor="obs-password" className="text-[13px] text-foreground">
                  Contraseña
                </label>
                {OBS_FIXTURE.password_set && <Badge tone="neutral">configurada</Badge>}
              </div>
              <input
                id="obs-password"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={OBS_FIXTURE.password_set ? "Nueva contraseña (opcional)" : "Contraseña"}
                className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground placeholder:text-dim focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              />
            </div>

            <div className="grid grid-cols-[1fr_auto] items-center gap-3">
              <span className="text-xs text-muted-foreground">Probar la conexión actual (simulado)</span>
              <Button type="button" variant="outline" disabled={testCommand.pending} onClick={() => void runTest()}>
                Probar conexión
              </Button>
            </div>
            {tested && !testCommand.pending && (
              <p role="status" className="text-xs leading-relaxed text-muted-foreground">
                Simulado — no existe endpoint <span className="mono">POST /api/obs/test</span> todavía, la conexión no
                se verificó de verdad.
              </p>
            )}
          </div>
        </details>
      </div>
    </Card>
  );
}
