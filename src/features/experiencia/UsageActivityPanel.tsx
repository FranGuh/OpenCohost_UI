import { useState } from "react";
import { X } from "lucide-react";
import { NotFoundError } from "../../api/client.js";
import { downloadUsageExport, useUsagePurgeMutation, useUsageSummaryQuery, type UsageExportFormat } from "../../api/usage.js";
import { useT } from "../../i18n/t.js";
import { Alert } from "../../ui/Alert.js";
import { Button } from "../../ui/Button.js";
import { Card } from "../../ui/Card.js";
import { ConfirmFooter } from "../../ui/ConfirmFooter.js";
import { Dialog } from "../../ui/Dialog.js";
import { saveBlob } from "./usage/saveBlob.js";
import { UsageActivityView } from "./usage/UsageActivityView.js";

type PendingAction = UsageExportFormat | "delete";

export interface UsageActivityPanelProps {
  open: boolean;
  onClose: () => void;
}

const TITLE_ID = "usage-activity-title";

/**
 * Container for the local usage Activity panel: owns the query, the
 * confirm-before-export / confirm-before-delete flow and the file download.
 * The loaded body is presentational (`UsageActivityView`).
 */
export function UsageActivityPanel({ open, onClose }: UsageActivityPanelProps) {
  const t = useT();
  const query = useUsageSummaryQuery(open);
  const purge = useUsagePurgeMutation();
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<"export" | "delete" | null>(null);

  const summary = query.data;
  const hasData = Boolean(summary && summary.enabled);
  const isEmpty =
    summary != null && summary.days.length === 0 && summary.by_kind.length === 0 && summary.decisions.length === 0;

  function cancel() {
    setPending(null);
  }

  async function confirm() {
    if (pending == null) return;
    setFailure(null);
    setBusy(true);
    try {
      if (pending === "delete") {
        await purge.mutateAsync();
      } else {
        const blob = await downloadUsageExport(pending);
        saveBlob(blob, `opencohost-activity.${pending}`);
      }
      setPending(null);
    } catch {
      setFailure(pending === "delete" ? "delete" : "export");
      setPending(null);
    } finally {
      setBusy(false);
    }
  }

  let body;
  if (query.isPending) {
    body = <p className="text-sm text-muted-foreground">{t("experiencia.usage.state.loading")}</p>;
  } else if (query.error) {
    body = (
      <Alert tone={query.error instanceof NotFoundError ? "info" : "danger"} role="status">
        {query.error instanceof NotFoundError
          ? t("experiencia.usage.state.unavailable")
          : t("experiencia.usage.state.error")}
      </Alert>
    );
  } else if (summary && !summary.enabled) {
    body = (
      <Alert tone="info" role="status">
        {t("experiencia.usage.state.disabled")}
      </Alert>
    );
  } else if (isEmpty) {
    body = <p className="text-sm text-muted-foreground">{t("experiencia.usage.state.empty")}</p>;
  } else if (summary) {
    body = <UsageActivityView summary={summary} />;
  }

  const stages =
    pending === "delete"
      ? [{ message: t("experiencia.usage.delete.confirm"), advanceLabel: t("experiencia.usage.delete.go") }]
      : [{ message: t("experiencia.usage.export.confirm"), advanceLabel: t("experiencia.usage.export.go") }];

  return (
    <Dialog open={open} onClose={onClose} ariaLabelledBy={TITLE_ID} className="w-[52rem]">
      <Card className="flex min-h-0 w-full flex-col gap-3 overflow-y-auto p-4">
        <div className="flex items-start justify-between gap-3 border-b border-border-soft pb-3">
          <div>
            <h2 id={TITLE_ID} className="text-sm font-bold text-foreground">
              {t("experiencia.usage.title")}
            </h2>
            <p className="text-[11px] text-muted-foreground">{t("experiencia.usage.subtitle")}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("experiencia.usage.close")}
            className="rounded-md p-1 text-dim hover:bg-surface-2 hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
          >
            <X size={14} aria-hidden="true" />
          </button>
        </div>

        {body}

        {failure && (
          <Alert tone="danger">
            {failure === "export" ? t("experiencia.usage.export.error") : t("experiencia.usage.delete.error")}
          </Alert>
        )}

        <p className="text-[11px] text-muted-foreground">{t("experiencia.usage.privacy")}</p>

        {summary && (
          <>
            {pending == null && (
              <div className="flex flex-wrap items-center gap-2">
                {hasData && (
                  <>
                    <Button type="button" variant="outline" onClick={() => setPending("json")}>
                      {t("experiencia.usage.export.json")}
                    </Button>
                    <Button type="button" variant="outline" onClick={() => setPending("csv")}>
                      {t("experiencia.usage.export.csv")}
                    </Button>
                  </>
                )}
                {!isEmpty && summary.enabled && (
                  <Button type="button" variant="ghost" onClick={() => setPending("delete")}>
                    {t("experiencia.usage.delete.button")}
                  </Button>
                )}
              </div>
            )}
            <ConfirmFooter
              active={pending != null}
              tone={pending === "delete" ? "danger" : "neutral"}
              stages={stages}
              busy={busy}
              onConfirm={confirm}
              onCancel={cancel}
            />
          </>
        )}
      </Card>
    </Dialog>
  );
}
