import { useQuery } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useMemo } from "react";
import type { ReactNode } from "react";
import { useProfilesQuery, useSwitchProfileMutation } from "./profiles.js";
import { usePollUntilApplied } from "./status.js";
import { useSwitchStore } from "../store/switchStore.js";
import { getI18nState } from "./i18n.js";
import { useUiLocale } from "../i18n/locale.js";

/**
 * Extracted profile-switch orchestration (queued -> applying -> applied).
 * Call this ONCE (see ProfileSwitchProvider below) — it owns the single
 * usePollUntilApplied subscription. Consumers (ProfilePlaylist,
 * ProfileSwitcher) read it via useProfileSwitchContext so mounting both at
 * once never double-polls.
 */
/** Stable empty list — `?? []` minted a fresh array on every render while
 * profiles were still loading, which alone would defeat the memo below. */
const NO_PROFILES: string[] = [];

function useProfileSwitch() {
  const { locale: uiLocale } = useUiLocale();
  // Profiles follow the backend (TTS/app) language, not the UI-only locale.
  // While GET /api/i18n is loading the profile fetch is held (no unfiltered
  // flash); if it fails we fall back to the UI locale rather than hide profiles.
  const i18nQuery = useQuery({ queryKey: ["i18n"], queryFn: getI18nState, staleTime: 60_000 });
  const i18nSettled = !i18nQuery.isPending;
  const profileLocale = i18nQuery.data?.active_locale ?? uiLocale;
  const profilesQuery = useProfilesQuery(profileLocale, { enabled: i18nSettled });
  // `mutate` is referentially stable across renders (unlike the mutation object
  // itself), so it can be a dependency without defeating the memo.
  const { mutate: switchMutate, isError: switchError } = useSwitchProfileMutation();
  const pendingSwitch = useSwitchStore((state) => state.pendingSwitch);
  // Target is re-derived from the store every render (mirrors status.test.ts's
  // useDerivedPoll pattern) so it naturally becomes null once convergence
  // clears pendingSwitch.
  const statusQuery = usePollUntilApplied(pendingSwitch?.name ?? null);

  const activeProfile = statusQuery.data?.active_profile;
  const fetchedProfiles = profilesQuery.data?.profiles ?? NO_PROFILES;
  // Active profile first, the rest in backend order — done once here so every
  // consumer (playlist, switcher) shares it.
  const profiles = useMemo(
    () =>
      activeProfile && fetchedProfiles.includes(activeProfile)
        ? [activeProfile, ...fetchedProfiles.filter((n) => n !== activeProfile)]
        : fetchedProfiles,
    [fetchedProfiles, activeProfile]
  );
  const profilesLoading = !i18nSettled || profilesQuery.isLoading;

  const switchTo = useCallback(
    (name: string) => {
      if (!name || name === activeProfile) {
        return;
      }
      switchMutate({ name });
    },
    [activeProfile, switchMutate]
  );

  // This provider consumes useStatusQuery, so it re-renders every 2s for the
  // whole session — is_speaking/state_version change on essentially every poll
  // while Kira is live. Minting a fresh value object here pushed a new context
  // to EVERY consumer below (ProfilePlaylist, ProfileSwitcher, Sidebar,
  // ControlsPanel) twice a second, forever, for state none of them had seen
  // change. Memoized on the values consumers actually read.
  return useMemo(
    () => ({
      profiles,
      activeProfile,
      pendingSwitch,
      profilesLoading,
      switchError,
      switchTo
    }),
    [profiles, activeProfile, pendingSwitch, profilesLoading, switchError, switchTo]
  );
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
