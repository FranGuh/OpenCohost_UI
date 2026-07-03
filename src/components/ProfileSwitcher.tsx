import type { ChangeEvent } from "react";
import { useProfilesQuery, useSwitchProfileMutation } from "../api/profiles.js";
import { usePollUntilApplied } from "../api/status.js";
import { useSwitchStore } from "../store/switchStore.js";
import { Card } from "./ui/Card.js";
import { Badge } from "./ui/Badge.js";
import { Select } from "./ui/Select.js";

/**
 * Native <select> profile control (design D9 — no shadcn/radix combobox
 * needed for a flat list). Wired to useProfilesQuery for the list and
 * useSwitchProfileMutation + usePollUntilApplied for the queued -> applying
 * -> applied reconcile (accepted != applied, design D6).
 */
export function ProfileSwitcher() {
  const profilesQuery = useProfilesQuery();
  const switchMutation = useSwitchProfileMutation();
  const pendingSwitch = useSwitchStore((state) => state.pendingSwitch);
  // Target is re-derived from the store every render (mirrors status.test.ts's
  // useDerivedPoll pattern) so it naturally becomes null once convergence
  // clears pendingSwitch.
  const statusQuery = usePollUntilApplied(pendingSwitch?.name ?? null);

  const profiles = profilesQuery.data?.profiles ?? [];
  const activeProfile = statusQuery.data?.active_profile;
  const selectValue = pendingSwitch?.name ?? activeProfile ?? "";
  const isApplying = pendingSwitch?.status === "applying";

  function handleChange(event: ChangeEvent<HTMLSelectElement>) {
    const name = event.target.value;
    if (!name || name === activeProfile) {
      return;
    }
    switchMutation.mutate({ name });
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
        disabled={isApplying || profilesQuery.isLoading}
        onChange={handleChange}
      >
        {profiles.length === 0 && <option value="">Sin perfiles</option>}
        {profiles.map((name) => (
          <option key={name} value={name}>
            {name}
          </option>
        ))}
      </Select>

      {switchMutation.isError && (
        <p role="alert" className="text-xs text-danger">
          No se pudo cambiar de perfil. Intentá de nuevo.
        </p>
      )}
    </Card>
  );
}
