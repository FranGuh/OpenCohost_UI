import { useEffect, useState } from "react";
import { Alert } from "../../ui/Alert.js";
import { Button } from "../../ui/Button.js";
import { useT } from "../../i18n/t.js";

export interface PairingCodeProps {
  code: string;
  /** Epoch seconds, as the backend sends it. */
  expiresAt: number;
  /** Full `<base>/#code=<code>` link, or null while no public URL is set. */
  link: string | null;
}

function formatRemaining(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/**
 * Presentational: shows a freshly minted pairing code with a live countdown and
 * the shareable link. Once the deadline passes the code is removed from the DOM
 * (it is dead on the backend anyway). The code is rendered, never logged.
 */
export function PairingCode({ code, expiresAt, link }: PairingCodeProps) {
  const t = useT();
  const [now, setNow] = useState(() => Date.now());
  const [copied, setCopied] = useState(false);
  const remaining = expiresAt * 1000 - now;

  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [expiresAt]);

  async function copy() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      // Clipboard can be blocked; the link stays selectable on screen.
    }
  }

  if (remaining <= 0) {
    return (
      <Alert tone="warn" role="status">
        {t("remote.pair.expired")}
      </Alert>
    );
  }

  return (
    <div className="flex flex-col gap-2.5">
      <div
        aria-label={t("remote.pair.code.aria")}
        className="select-all rounded-md border border-border-soft bg-surface-2 px-4 py-3 text-center font-mono text-3xl font-bold tracking-[0.25em] text-foreground"
      >
        {code}
      </div>
      <span className="text-xs text-muted-foreground">{t("remote.pair.expires", { time: formatRemaining(remaining) })}</span>
      {link && (
        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">{t("remote.pair.link.label")}</span>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 break-all text-xs text-foreground">{link}</code>
            <Button variant="outline" onClick={copy}>
              {copied ? t("remote.pair.link.copied") : t("remote.pair.link.copy")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
