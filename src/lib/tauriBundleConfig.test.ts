import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// release-050 D4: the NSIS installer must show a license page. Tauri 2 reads
// `bundle.licenseFile` (relative to src-tauri) and passes it to the custom
// template as `{{license}}`; the template's MUI_PAGE_LICENSE branch depends on it.
const srcTauriDir = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "src-tauri");
const tauriConf = JSON.parse(readFileSync(join(srcTauriDir, "tauri.conf.json"), "utf8")) as {
  bundle?: { licenseFile?: unknown };
};

describe("NSIS installer license page (D4)", () => {
  it("bundle.licenseFile is set", () => {
    expect(typeof tauriConf.bundle?.licenseFile).toBe("string");
  });

  it("licenseFile resolves to an existing, non-empty text file", () => {
    const licensePath = resolve(srcTauriDir, String(tauriConf.bundle?.licenseFile ?? ""));
    expect(existsSync(licensePath)).toBe(true);
    expect(statSync(licensePath).size).toBeGreaterThan(0);
    expect(readFileSync(licensePath, "utf8")).toMatch(/License/);
  });

  it("the custom NSIS template still renders the license page from {{license}}", () => {
    const template = readFileSync(join(srcTauriDir, "custom-installer.nsi"), "utf8");
    expect(template).toContain('!define LICENSE "{{license}}"');
    expect(template).toContain('!insertmacro MUI_PAGE_LICENSE "${LICENSE}"');
  });
});
