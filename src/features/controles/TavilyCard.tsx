import { useState } from "react";
import { ExternalLink } from "lucide-react";
import { openExternalUrl } from "../../lib/openUrl.js";
import { useTavilyKey } from "../../api/useTavilyKey.js";
import { useT } from "../../i18n/t.js";
import { Card } from "../../ui/Card.js";
import { Input } from "../../ui/Input.js";
import { Button } from "../../ui/Button.js";
import { Alert } from "../../ui/Alert.js";

/** Write-only credential editor. Saving never runs a search or validation probe. */
export function TavilyCard() {
  const t = useT();
  const [message, setMessage] = useState<"saved" | "removed" | "error" | null>(null);
  const { query, mutation, draft, setDraft, save } = useTavilyKey({
    onSaved: (status) => setMessage(status.stored_key_set ? "saved" : "removed"),
    onError: () => setMessage("error"),
    resetOnSettled: true
  });
  const { data, isError } = query;
  // The outcome is reported through `message`; the rejection itself needs no handling here.
  const submit = (apiKey: string) => void save(apiKey).catch(() => undefined);
  const disabled = !data?.storage_available || mutation.isPending;

  return (
    <Card className="flex flex-col gap-3.5 p-4">
      <h2 className="border-b border-border-soft pb-3 text-sm font-bold text-foreground">
        {t("controles.tavily.title")}
      </h2>
      <p className="text-xs leading-relaxed text-dim">{t("controles.tavily.hint")}</p>
      {isError ? <Alert tone="danger">{t("controles.tavily.loadError")}</Alert> : !data ? (
        <p role="status" className="text-xs text-dim">{t("controles.tavily.loading")}</p>
      ) : (
        <>
          {!data.storage_available && <Alert tone="warn">{t("controles.tavily.unavailable")}</Alert>}
          <p className="text-xs text-muted-foreground">{t(`controles.tavily.source.${data.source}`)}</p>
          {data.stored_key_set && data.source !== "keyring" && (
            <p className="text-xs text-muted-foreground">{t("controles.tavily.source.keyring")}</p>
          )}
          <div className="flex flex-col gap-2">
            <label htmlFor="tavily-api-key" className="text-xs font-semibold text-foreground">
              {t("controles.tavily.key")}
            </label>
            <Input id="tavily-api-key" type="password" value={draft} autoComplete="off"
              spellCheck={false} maxLength={4096} disabled={disabled}
              onChange={(event) => { setDraft(event.target.value); setMessage(null); }} />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button disabled={disabled || !draft.trim()} onClick={() => submit(draft.trim())}>
              {t("controles.tavily.save")}
            </Button>
            <Button disabled={disabled || !data.stored_key_set} onClick={() => submit("")}>
              {t("controles.tavily.remove")}
            </Button>
            <a
              href="https://www.tavily.com/?utm_source=opencohost"
              target="_blank"
              rel="noreferrer"
              onClick={(e) => {
                e.preventDefault();
                void openExternalUrl("https://www.tavily.com/?utm_source=opencohost");
              }}
              className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md border border-border bg-card px-4 text-sm font-semibold text-foreground transition-colors duration-fast ease-io hover:border-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              {t("controles.tavily.openLink")}
              <ExternalLink size={14} aria-hidden="true" />
            </a>
          </div>
        </>
      )}
      {message && <p role="status" className="text-xs text-muted-foreground">{t(`controles.tavily.${message}`)}</p>}
    </Card>
  );
}
