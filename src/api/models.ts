import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getModels, updateModelReasoning } from "./client.js";

export const MODELS_QUERY_KEY = ["models"] as const;

export function useModelsQuery() {
  return useQuery({
    queryKey: MODELS_QUERY_KEY,
    queryFn: getModels
  });
}

export function useUpdateModelReasoningMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateModelReasoning,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: MODELS_QUERY_KEY });
    }
  });
}
