import { useQuery } from "@tanstack/react-query";
import { getMemoriaStats } from "./client.js";

export const MEMORIA_STATS_QUERY_KEY = ["memoria-stats"] as const;

export function useMemoriaStatsQuery() {
  return useQuery({
    queryKey: MEMORIA_STATS_QUERY_KEY,
    queryFn: getMemoriaStats
  });
}
