import { ApiError, ChatImageError, ConflictError } from "../../api/client.js";
import type { TKey } from "../../i18n/t.js";

const PREFIX = "experiencia.conversationPanel.composer.image.error.";

/** Message key for a failed image turn. Backend `vision_*` codes are stable
 * enums; anything unknown reads as a generic vision failure, never raw text. */
export function chatImageErrorKey(error: unknown): TKey {
  if (error instanceof ChatImageError) {
    switch (error.code) {
      case "vision_off":
      case "vision_disabled":
      case "vision_model_missing":
        return `${PREFIX}off` as TKey;
      case "vision_starting":
        return `${PREFIX}starting` as TKey;
      case "vision_describe_timeout":
        return `${PREFIX}timeout` as TKey;
      default:
        return `${PREFIX}failed` as TKey;
    }
  }
  if (error instanceof ConflictError) return `${PREFIX}engine` as TKey;
  if (error instanceof ApiError) {
    if (error.status === 408) return `${PREFIX}network` as TKey;
    if (error.status === 413) return `${PREFIX}tooLarge` as TKey;
  }
  return `${PREFIX}generic` as TKey;
}
