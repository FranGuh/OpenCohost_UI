import type { ChangeEvent } from "react";
import { useProfileSwitchContext } from "../api/useProfileSwitch.js";
import { Card } from "./ui/Card.js";
import { Badge } from "./ui/Badge.js";
import { Select } from "./ui/Select.js";

/**
 * Native <select> profile control (design D9 — no shadcn/radix combobox
 * needed for a flat list). Reads the shared ProfileSwitchProvider context
 * for the list and the queued -> applying -> applied reconcile (accepted !=
 * applied, design D6) — same single poll owner as ProfilePlaylist.
 */
export function ProfileSwitcher() {
  const { profiles, activeProfile, pendingSwitch, profilesLoading, switchError, switchTo } =
    useProfileSwitchContext();
  const selectValue = pendingSwitch?.name ?? activeProfile ?? "";
  const isApplying = pendingSwitch?.status === "applying";

  function handleChange(event: ChangeEvent<HTMLSelectElement>) {
    switchTo(event.target.value);
  }

  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-bold text-foreground">Perfil</h2>
        {isApplying && (
          <span className="inline-flex items-center gap-[7px] text-xs font-semibold text-info">
            <span
              aria-hidden="true"
              className="h-3 w-3 animate-spin rounded-full border-2 border-info-bg border-t-info motion-reduce:animate-none"
            />
            aplicando…
          </span>
        )}
        {pendingSwitch?.status === "timeout" && <Badge tone="warn">tardando más de lo esperado</Badge>}
        {!pendingSwitch && <Badge tone="ok">activo</Badge>}
      </div>

      <Select
        aria-label="Perfil activo"
        value={selectValue}
        disabled={isApplying || profilesLoading}
        onChange={handleChange}
      >
        {profiles.length === 0 && <option value="">Sin perfiles</option>}
        {profiles.map((name) => (
          <option key={name} value={name}>
            {name}
          </option>
        ))}
      </Select>

      {switchError && (
        <p role="alert" className="text-xs text-danger">
          No se pudo cambiar de perfil. Intentá de nuevo.
        </p>
      )}
    </Card>
  );
}
