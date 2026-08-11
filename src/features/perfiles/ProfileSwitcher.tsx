import { useState } from "react";
import { useProfileSwitchContext } from "../../api/useProfileSwitch.js";
import { Card } from "../../ui/Card.js";
import { Badge } from "../../ui/Badge.js";
import { Select } from "../../ui/Select.js";
import { Button } from "../../ui/Button.js";
import { useT } from "../../i18n/t.js";
import { ProfileEditor } from "./ProfileEditor.js";

/**
 * Themed profile control (design D9 — no shadcn/radix combobox needed for a
 * flat list; uses the shared CustomSelect dropdown). Reads the shared
 * ProfileSwitchProvider context
 * for the list and the queued -> applying -> applied reconcile (accepted !=
 * applied, design D6) — same single poll owner as ProfilePlaylist.
 */
export function ProfileSwitcher() {
  const t = useT();
  const { profiles, activeProfile, pendingSwitch, profilesLoading, switchError, switchTo } =
    useProfileSwitchContext();
  const [editorOpen, setEditorOpen] = useState(false);
  const selectValue = pendingSwitch?.name ?? activeProfile ?? "";
  const isApplying = pendingSwitch?.status === "applying";

  function handleChange(value: string) {
    switchTo(value);
  }

  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-bold text-foreground">{t("perfiles.switcher.title")}</h2>
          <Button type="button" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setEditorOpen(true)}>
            {t("perfiles.switcher.edit.action")}
          </Button>
        </div>
        {isApplying && (
          <span className="inline-flex items-center gap-[7px] text-xs font-semibold text-info">
            <span
              aria-hidden="true"
              className="h-3 w-3 animate-spin rounded-full border-2 border-info-bg border-t-info motion-reduce:animate-none"
            />
            {t("perfiles.switcher.status.applying")}
          </span>
        )}
        {pendingSwitch?.status === "timeout" && <Badge tone="warn">{t("perfiles.switcher.status.timeout")}</Badge>}
        {!pendingSwitch && <Badge tone="ok">{t("perfiles.switcher.status.active")}</Badge>}
      </div>

      <ProfileEditor open={editorOpen} mode="edit" initialName={activeProfile ?? ""} onClose={() => setEditorOpen(false)} />

      <Select
        aria-label={t("perfiles.switcher.select.aria")}
        value={selectValue}
        disabled={isApplying || profilesLoading}
        onChange={handleChange}
        options={
          profiles.length === 0
            ? [{ value: "", label: t("perfiles.switcher.select.empty") }]
            : profiles.map((name) => ({ value: name, label: name }))
        }
      />

      {switchError && (
        <p role="alert" className="text-xs text-danger">
          {t("perfiles.switcher.error")}
        </p>
      )}
    </Card>
  );
}
