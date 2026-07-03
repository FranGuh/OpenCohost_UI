import { useQuery } from "@tanstack/react-query";
import { getModels } from "./client.js";

export const MODELS_QUERY_KEY = ["models"] as const;

export function useModelsQuery() {
  return useQuery({
    queryKey: MODELS_QUERY_KEY,
    queryFn: getModels
  });
}
