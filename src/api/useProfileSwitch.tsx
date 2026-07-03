import { createContext, useContext } from "react";
import type { ReactNode } from "react";
import { useProfilesQuery, useSwitchProfileMutation } from "./profiles.js";
import { usePollUntilApplied } from "./status.js";
import { useSwitchStore } from "../store/switchStore.js";

/**
 * Extracted profile-switch orchestration (queued -> applying -> applied).
 * Call this ONCE (see ProfileSwitchProvider below) — it owns the single
 * usePollUntilApplied subscription. Consumers (ProfilePlaylist,
 * ProfileSwitcher) read it via useProfileSwitchContext so mounting both at
 * once never double-polls.
 */
function useProfileSwitch() {
  const profilesQuery = useProfilesQuery();
  const switchMutation = useSwitchProfileMutation();
  const pendingSwitch = useSwitchStore((state) => state.pendingSwitch);
  // Target is re-derived from the store every render (mirrors status.test.ts's
  // useDerivedPoll pattern) so it naturally becomes null once convergence
  // clears pendingSwitch.
  const statusQuery = usePollUntilApplied(pendingSwitch?.name ?? null);

  const profiles = profilesQuery.data?.profiles ?? [];
  const activeProfile = statusQuery.data?.active_profile;

  function switchTo(name: string) {
    if (!name || name === activeProfile) {
      return;
    }
    switchMutation.mutate({ name });
  }

  return {
    profiles,
    activeProfile,
    pendingSwitch,
    profilesLoading: profilesQuery.isLoading,
    switchError: switchMutation.isError,
    switchTo
  };
}

type ProfileSwitchValue = ReturnType<typeof useProfileSwitch>;

const ProfileSwitchContext = createContext<ProfileSwitchValue | null>(null);

/** Single poll owner — mount once (in AppLayout) above every consumer. */
export function ProfileSwitchProvider({ children }: { children: ReactNode }) {
  const value = useProfileSwitch();
  return <ProfileSwitchContext.Provider value={value}>{children}</ProfileSwitchContext.Provider>;
}

export function useProfileSwitchContext(): ProfileSwitchValue {
  const value = useContext(ProfileSwitchContext);
  if (!value) {
    throw new Error("useProfileSwitchContext must be used within a ProfileSwitchProvider");
  }
  return value;
}
