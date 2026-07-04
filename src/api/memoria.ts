import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getMemoriaList, getMemoriaStats, postMemoriaPurge } from "./client.js";

export const MEMORIA_STATS_QUERY_KEY = ["memoria-stats"] as const;

export function useMemoriaStatsQuery() {
  return useQuery({
    queryKey: MEMORIA_STATS_QUERY_KEY,
    queryFn: getMemoriaStats
  });
}

export function memoriaListQueryKey(profileId: string) {
  return ["memoria-list", profileId] as const;
}

export function useMemoriaListQuery(profileId: string) {
  return useQuery({
    queryKey: memoriaListQueryKey(profileId),
    queryFn: () => getMemoriaList(profileId),
    enabled: Boolean(profileId)
  });
}

/** Purge is destructive — invalidate the list so the row list reflects the empty store. */
export function useMemoriaPurgeMutation(profileId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => postMemoriaPurge(profileId),
    onSuccess: () => {
      queryClient.setQueryData(memoriaListQueryKey(profileId), { items: [] });
    }
  });
}
