import { useQuery } from "@tanstack/react-query";
import { getLlmReadiness, type LlmReadinessResponse, type LlmReadinessState } from "../../api/client.js";

export const LLM_READINESS_QUERY_KEY = ["llmReadiness"] as const;

export interface UseLlmReadinessOptions {
  enabled?: boolean;
  activePolling?: boolean;
}

export function useLlmReadiness(options: UseLlmReadinessOptions = {}) {
  const { enabled = true, activePolling = false } = options;

  const query = useQuery({
    queryKey: LLM_READINESS_QUERY_KEY,
    queryFn: getLlmReadiness,
    enabled,
    refetchInterval: (queryState) => {
      const data = queryState.state.data;
      // Active polling requested by caller (e.g. setup modal open or pending send)
      if (activePolling) return 1500;
      // Fast polling if unready so status updates automatically once daemon starts
      if (!data || !data.can_chat) return 1500;
      // Slower polling when already steady and ready
      return 10000;
    },
    staleTime: 1000
  });

  const readiness = query.data;
  const state: LlmReadinessState | string = readiness?.state ?? "LOCAL_OLLAMA_MISSING";
  const canChat: boolean = Boolean(readiness?.can_chat);
  const isReady: boolean = canChat && (state === "LOCAL_READY" || state === "CLOUD_READY");
  const isOllamaReachable: boolean = Boolean(readiness?.ollama?.reachable);
  const isOllamaInstalled: boolean = Boolean(readiness?.ollama?.reachable || readiness?.ollama?.binary_found);
  const isModelInstalled: boolean = Boolean(readiness?.ollama?.model_installed);
  const recommendedModel: string = readiness?.hardware?.recommended_model ?? "gemma4:e4b";

  let missingReason: string | null = null;
  if (!canChat) {
    if (state === "LOCAL_OLLAMA_MISSING") {
      missingReason = "Ollama no responde o no se encontró en el sistema.";
    } else if (state === "LOCAL_OLLAMA_OFFLINE") {
      missingReason = "Ollama está instalado pero el servicio no responde.";
    } else if (state === "LOCAL_NO_MODELS") {
      missingReason = "Ollama está activo pero no hay modelos descargados.";
    } else if (state === "LOCAL_MODEL_MISSING") {
      missingReason = `El modelo seleccionado (${readiness?.selected_model ?? "desconocido"}) no está instalado.`;
    } else if (state === "CLOUD_UNCONFIGURED") {
      missingReason = "El proveedor en la nube no está configurado (falta API key).";
    } else if (state === "CLOUD_INVALID_CREDENTIALS") {
      missingReason = "Las credenciales del proveedor en la nube son inválidas.";
    } else if (state === "CLOUD_UNREACHABLE") {
      missingReason = "No se puede conectar con el proveedor en la nube.";
    } else {
      missingReason = "El motor LLM no está listo para chatear.";
    }
  }

  return {
    ...query,
    readiness,
    state,
    canChat,
    isReady,
    isOllamaReachable,
    isOllamaInstalled,
    isModelInstalled,
    recommendedModel,
    missingReason
  };
}
