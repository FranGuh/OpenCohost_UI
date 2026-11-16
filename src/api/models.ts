import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getModels, updateModelContext, updateModelReasoning } from "./client.js";

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
      return queryClient.invalidateQueries({ queryKey: MODELS_QUERY_KEY });
    }
  });
}

export function useUpdateModelContextMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateModelContext,
    onSuccess: () => {
      return queryClient.invalidateQueries({ queryKey: MODELS_QUERY_KEY });
    }
  });
}
