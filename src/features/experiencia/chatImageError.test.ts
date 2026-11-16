import { describe, expect, it } from "vitest";
import { ApiError, ChatImageError, ConflictError } from "../../api/client.js";
import { EN, ES } from "../../i18n/bundles.js";
import { chatImageErrorKey } from "./chatImageError.js";

describe("chatImageErrorKey", () => {
  it.each([
    ["vision_off", "off"],
    ["vision_disabled", "off"],
    ["vision_model_missing", "off"],
    ["vision_starting", "starting"],
    ["vision_describe_timeout", "timeout"],
    ["vision_failed", "failed"],
    ["vision_describe_http", "failed"],
    ["vision_describe_empty", "failed"],
    ["vision_describe_unavailable", "failed"],
    ["vision_something_new", "failed"]
  ])("maps %s to %s", (code, suffix) => {
    expect(chatImageErrorKey(new ChatImageError(code, 503))).toBe(`experiencia.conversationPanel.composer.image.error.${suffix}`);
  });

  it("maps transport and engine failures", () => {
    expect(chatImageErrorKey(new ConflictError())).toBe("experiencia.conversationPanel.composer.image.error.engine");
    expect(chatImageErrorKey(new ApiError("t", 408))).toBe("experiencia.conversationPanel.composer.image.error.network");
    expect(chatImageErrorKey(new ApiError("t", 413))).toBe("experiencia.conversationPanel.composer.image.error.tooLarge");
    expect(chatImageErrorKey(new Error("x"))).toBe("experiencia.conversationPanel.composer.image.error.generic");
  });

  it("has es and en copy for every key it can return", () => {
    const errors = [
      new ChatImageError("vision_off", 422),
      new ChatImageError("vision_starting", 503),
      new ChatImageError("vision_describe_timeout", 504),
      new ChatImageError("vision_failed", 503),
      new ConflictError(),
      new ApiError("t", 408),
      new ApiError("t", 413),
      new Error("x")
    ];
    for (const error of errors) {
      const key = chatImageErrorKey(error);
      expect(EN[key]).toBeTruthy();
      expect(ES[key]).toBeTruthy();
    }
  });
});
