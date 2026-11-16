import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// release-050 D12: the webview ships with a real Content-Security-Policy, not
// `csp: null`. These checks parse the real config so a later edit cannot
// silently reopen the webview to arbitrary origins.
const srcTauriDir = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "src-tauri");
const uiDir = resolve(srcTauriDir, "..");
const tauriConf = JSON.parse(readFileSync(join(srcTauriDir, "tauri.conf.json"), "utf8")) as {
  app?: { security?: { csp?: unknown } };
};
const csp = tauriConf.app?.security?.csp;

type Policy = Record<string, string | string[]>;

function sourcesOf(directive: string | string[]): string[] {
  return (Array.isArray(directive) ? directive.join(" ") : directive).trim().split(/\s+/).filter(Boolean);
}

// Loopback only: the backend, the STT/LiveAudio socket (the backend refuses non-loopback
// URIs in routers/ptt.py) and the Vite dev server. Ports are explicit where the backend
// fixes them (8765/8770) and wildcarded only for the user-configured LiveAudio socket.
const LOOPBACK_ORIGIN = /^(https?|wss?):\/\/(127\.0\.0\.1|localhost|\[::1\])(:(\d{1,5}|\*))?$/;
const TAURI_IPC = new Set(["ipc:", "http://ipc.localhost"]);

// Styles that index.html writes at runtime with document.write. A CSP can only allow
// them by hash, since they are not in the built HTML that Tauri hashes.
function runtimeStyleHashes(): string[] {
  const html = readFileSync(join(uiDir, "index.html"), "utf8");
  const writes = [...html.matchAll(/document\.write\('<style>(.*?)<\/style>'\)/g)].map((m) => m[1]);
  return writes.map((text) => `'sha256-${createHash("sha256").update(text, "utf8").digest("base64")}'`);
}

describe("webview Content-Security-Policy (D12)", () => {
  it("is an explicit policy object, not null", () => {
    expect(csp).not.toBeNull();
    expect(typeof csp).toBe("object");
  });

  it("no directive uses a bare * source", () => {
    const policy = csp as Policy;
    for (const [name, value] of Object.entries(policy)) {
      expect(sourcesOf(value), name).not.toContain("*");
    }
  });

  it("every source is 'self', 'none', a Tauri scheme, data/blob, a loopback origin or a hash", () => {
    const policy = csp as Policy;
    const allowedKeywords = new Set(["'self'", "'none'", "'unsafe-inline'", "data:", "blob:", "customprotocol:"]);
    for (const [name, value] of Object.entries(policy)) {
      for (const source of sourcesOf(value)) {
        const ok =
          allowedKeywords.has(source) ||
          TAURI_IPC.has(source) ||
          LOOPBACK_ORIGIN.test(source) ||
          /^'sha256-[A-Za-z0-9+/=]+'$/.test(source);
        expect(ok, `${name} allows ${source}`).toBe(true);
      }
    }
  });

  it("connect-src only allows 'self', Tauri IPC, loopback hosts and local blob/data URLs", () => {
    const connect = sourcesOf((csp as Policy)["connect-src"] ?? "");
    expect(connect).toContain("'self'");
    expect(connect).toContain("ipc:");
    expect(connect).toContain("http://ipc.localhost");
    // The VRM/GLTF loader fetches embedded textures and buffers through blob:/data: URLs.
    expect(connect).toContain("blob:");
    expect(connect).toContain("data:");
    for (const source of connect) {
      const ok =
        source === "'self'" ||
        source === "blob:" ||
        source === "data:" ||
        TAURI_IPC.has(source) ||
        LOOPBACK_ORIGIN.test(source);
      expect(ok, `connect-src allows ${source}`).toBe(true);
    }
  });

  it("leaves the dev server unrestricted (devCsp null) so Vite's inline HMR preamble runs", () => {
    const security = (tauriConf as { app: { security: Record<string, unknown> } }).app.security;
    expect("devCsp" in security).toBe(true);
    expect(security.devCsp).toBeNull();
  });

  it("script-src allows no eval, no inline-by-keyword and no remote origin", () => {
    const script = sourcesOf((csp as Policy)["script-src"] ?? "");
    expect(script).toEqual(["'self'"]);
  });

  it("style-src-attr allows inline style attributes that React sets", () => {
    expect(sourcesOf((csp as Policy)["style-src-attr"] ?? "")).toContain("'unsafe-inline'");
  });

  it("style-src allows each runtime <style> that index.html writes, by hash", () => {
    const style = sourcesOf((csp as Policy)["style-src"] ?? "");
    const hashes = runtimeStyleHashes();
    expect(hashes).toHaveLength(2);
    for (const hash of hashes) {
      expect(style).toContain(hash);
    }
  });
});
