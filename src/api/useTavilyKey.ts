import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getTavilySettings, putTavilySettings, type TavilyKeyResponse } from "./webFetch.js";

export const TAVILY_QUERY_KEY = ["web-fetch", "tavily"] as const;

export interface UseTavilyKeyOptions {
  onSaved?(status: TavilyKeyResponse): void;
  onError?(): void;
  /** Reset the mutation once it settles (the Controles card reports through its own message instead). */
  resetOnSettled?: boolean;
}

/**
 * Write-only Tavily key editor state, shared by Controles › Tavily and the
 * setup extras screen. The draft is cleared and the request body scrubbed
 * after every save; the stored key is only ever reported as a boolean.
 */
export function useTavilyKey({ onSaved, onError, resetOnSettled = false }: UseTavilyKeyOptions = {}) {
  const client = useQueryClient();
  const [draft, setDraft] = useState("");
  const query = useQuery({ queryKey: TAVILY_QUERY_KEY, queryFn: getTavilySettings, retry: false });
  const mutation = useMutation({
    mutationFn: putTavilySettings,
    retry: false,
    gcTime: 0,
    onSuccess: (status) => {
      client.setQueryData(TAVILY_QUERY_KEY, status);
      onSaved?.(status);
    },
    onError: () => onError?.(),
    onSettled: (_data, _error, variables) => {
      // Scrub the object retained by the mutation cache, not just the input.
      variables.api_key = "";
      setDraft("");
      if (resetOnSettled) mutation.reset();
    }
  });

  /** Saves `apiKey` (empty removes the stored key). Resolves with the new status; rejects on failure. */
  function save(apiKey: string): Promise<TavilyKeyResponse> {
    return mutation.mutateAsync({ api_key: apiKey });
  }

  return { query, mutation, draft, setDraft, save };
}
