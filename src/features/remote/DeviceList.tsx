import { useState } from "react";
import { Button } from "../../ui/Button.js";
import { ConfirmFooter } from "../../ui/ConfirmFooter.js";
import { useT } from "../../i18n/t.js";
import { useUiLocaleStore } from "../../i18n/locale.js";
import type { RemoteDevice } from "../../api/remote.js";

export interface DeviceListProps {
  devices: RemoteDevice[];
  busy: boolean;
  onRevoke: (deviceId: string) => void;
}

/** Presentational: paired phones, each revocable behind a confirm step. */
export function DeviceList({ devices, busy, onRevoke }: DeviceListProps) {
  const t = useT();
  const locale = useUiLocaleStore((s) => s.locale);
  const [confirming, setConfirming] = useState<string | null>(null);
  const when = (epochSeconds: number) => new Date(epochSeconds * 1000).toLocaleString(locale);

  if (devices.length === 0) {
    return <p className="text-xs leading-relaxed text-muted-foreground">{t("remote.devices.empty")}</p>;
  }

  return (
    <ul className="flex flex-col gap-2.5">
      {devices.map((d) => (
        <li key={d.device_id} className="flex flex-col gap-2 rounded-md border border-border-soft p-2.5">
          <div className="grid grid-cols-[1fr_auto] items-center gap-3">
            <div className="flex flex-col gap-0.5">
              <span className="text-[13px] font-medium text-foreground">{d.name}</span>
              <span className="text-[11px] leading-tight text-dim">{t("remote.devices.created", { when: when(d.created_at) })}</span>
              <span className="text-[11px] leading-tight text-dim">
                {d.last_used_at != null ? t("remote.devices.lastUsed", { when: when(d.last_used_at) }) : t("remote.devices.neverUsed")}
              </span>
            </div>
            {d.revoked ? (
              <span className="text-xs text-muted-foreground">{t("remote.devices.revoked")}</span>
            ) : (
              <Button
                variant="outline"
                aria-label={t("remote.devices.revoke.aria", { name: d.name })}
                onClick={() => setConfirming(d.device_id)}
              >
                {t("remote.devices.revoke")}
              </Button>
            )}
          </div>
          <ConfirmFooter
            active={confirming === d.device_id}
            busy={busy}
            stages={[{ message: t("remote.devices.revoke.confirm", { name: d.name }), advanceLabel: t("remote.devices.revoke.advance") }]}
            onCancel={() => setConfirming(null)}
            onConfirm={() => {
              setConfirming(null);
              onRevoke(d.device_id);
            }}
          />
        </li>
      ))}
    </ul>
  );
}
