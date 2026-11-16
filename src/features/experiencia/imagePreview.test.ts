import { afterEach, describe, expect, it, vi } from "vitest";
import { createPreviewUrl, revokePreviewUrl } from "./imagePreview.js";

describe("imagePreview", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("makes an object URL when the platform can, and revokes only those", () => {
    const create = vi.fn(() => "blob:abc");
    const revoke = vi.fn();
    vi.stubGlobal("URL", { createObjectURL: create, revokeObjectURL: revoke });
    const url = createPreviewUrl(new Blob(["x"]), "data:image/png;base64,QQ==");
    expect(url).toBe("blob:abc");
    revokePreviewUrl(url);
    expect(revoke).toHaveBeenCalledWith("blob:abc");
  });

  it("falls back to the data URL and never 'revokes' it", () => {
    const revoke = vi.fn();
    vi.stubGlobal("URL", { revokeObjectURL: revoke });
    const url = createPreviewUrl(new Blob(["x"]), "data:image/png;base64,QQ==");
    expect(url).toBe("data:image/png;base64,QQ==");
    revokePreviewUrl(url);
    expect(revoke).not.toHaveBeenCalled();
  });
});
