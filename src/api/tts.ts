import { useQuery } from "@tanstack/react-query";
import { getTtsConfig, type TtsConfigResponse } from "./client.js";

export type TtsConfig = TtsConfigResponse;

export const TTS_CONFIG_QUERY_KEY = ["tts-config"] as const;

export function useTtsConfigQuery() {
  return useQuery({
    queryKey: TTS_CONFIG_QUERY_KEY,
    queryFn: getTtsConfig
  });
}
