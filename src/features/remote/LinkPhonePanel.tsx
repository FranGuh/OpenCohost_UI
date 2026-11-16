import { useState } from "react";
import { Alert } from "../../ui/Alert.js";
import { Button } from "../../ui/Button.js";
import { Card } from "../../ui/Card.js";
import { Input } from "../../ui/Input.js";
import { useT } from "../../i18n/t.js";
import { isGatewayDisabled, usePairCodeMutation, useRemoteDevicesQuery, useRevokeDeviceMutation } from "../../api/remote.js";
import { DeviceList } from "./DeviceList.js";
import { PairingCode } from "./PairingCode.js";

// Per-viewer UI preference (this machine only). shellPrefs.ts is Tauri-owned
// state read at exit, which this is not, so plain localStorage, guarded.
const GATEWAY_URL_KEY = "oc-remote-gateway-url";

function readStoredUrl(): string {
  try {
    return window.localStorage.getItem(GATEWAY_URL_KEY) ?? "";
  } catch {
    return "";
  }
}

function storeUrl(value: string): void {
  try {
    window.localStorage.setItem(GATEWAY_URL_KEY, value);
  } catch {
    // Storage can be blocked; the in-memory value still works this session.
  }
}

function buildLink(base: string, code: string): string | null {
  const trimmed = base.trim().replace(/\/+$/, "");
  return trimmed ? `${trimmed}/#code=${code}` : null;
}

/**
 * Desktop "Link phone" panel (container). Owns the queries/mutations and the
 * public-URL preference; PairingCode and DeviceList are presentational. A 409
 * gateway_disabled renders the how-to-enable note instead of the controls.
 */
export function LinkPhonePanel() {
  const t = useT();
  const devices = useRemoteDevicesQuery();
  const pair = usePairCodeMutation();
  const revoke = useRevokeDeviceMutation();
  const [baseUrl, setBaseUrl] = useState(readStoredUrl);

  const disabled = devices.isError && isGatewayDisabled(devices.error);
  const loadFailed = devices.isError && !disabled;

  return (
    <Card className="flex flex-col p-4">
      <div className="border-b border-border-soft pb-3">
        <h2 className="text-sm font-bold text-foreground">{t("remote.title")}</h2>
      </div>
      <div className="flex flex-col gap-3 pt-3.5">
        {disabled ? (
          <Alert tone="info" title={t("remote.disabled.title")} role="status">
            {t("remote.disabled.body")}
          </Alert>
        ) : (
          <>
            <p className="text-xs leading-relaxed text-muted-foreground">{t("remote.hint")}</p>
            <Alert tone="info" role="status">
              {t("remote.disclaimer")}
            </Alert>
            {loadFailed && (
              <p role="alert" className="text-xs leading-relaxed text-danger">
                {t("remote.error.load")}
              </p>
            )}
            <div className="flex flex-col gap-1">
              <label htmlFor="remote-gateway-url" className="text-xs text-muted-foreground">
                {t("remote.url.label")}
              </label>
              <Input
                id="remote-gateway-url"
                value={baseUrl}
                placeholder={t("remote.url.placeholder")}
                onChange={(e) => {
                  setBaseUrl(e.target.value);
                  storeUrl(e.target.value);
                }}
              />
              <span className="text-[11px] leading-tight text-dim">{t("remote.url.hint")}</span>
            </div>
            <div className="flex flex-col gap-2.5">
              <p className="text-xs leading-relaxed text-muted-foreground">{t("remote.pair.warning")}</p>
              <div>
                <Button variant="primary" disabled={pair.isPending} onClick={() => pair.mutate()}>
                  {pair.isPending ? t("remote.pair.generating") : t("remote.pair.generate")}
                </Button>
              </div>
              {pair.isError && (
                <p role="alert" className="text-xs leading-relaxed text-danger">
                  {t("remote.pair.error")}
                </p>
              )}
              {pair.data && (
                <PairingCode
                  key={pair.data.expires_at}
                  code={pair.data.code}
                  expiresAt={pair.data.expires_at}
                  link={buildLink(baseUrl, pair.data.code)}
                />
              )}
            </div>
            <div className="flex flex-col gap-2.5 border-t border-border-soft pt-3">
              <span className="text-sm font-medium text-foreground">{t("remote.devices.title")}</span>
              {revoke.isError && (
                <p role="alert" className="text-xs leading-relaxed text-danger">
                  {t("remote.devices.revoke.error")}
                </p>
              )}
              <DeviceList devices={devices.data?.devices ?? []} busy={revoke.isPending} onRevoke={(id) => revoke.mutate(id)} />
            </div>
          </>
        )}
      </div>
    </Card>
  );
}
