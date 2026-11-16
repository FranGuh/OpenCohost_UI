import { describe, expect, it } from "vitest";
import {
  NOT_HEALTHY_CODE,
  buildFailureDetails,
  failureCauseKey,
  failureCode
} from "./backendFailure.js";

describe("failureCode", () => {
  it("shows a closed code verbatim", () => {
    expect(failureCode("backend_ports_busy")).toBe("backend_ports_busy");
  });

  it("uses the stable placeholder when there is no code", () => {
    expect(failureCode(null)).toBe(NOT_HEALTHY_CODE);
    expect(failureCode("")).toBe(NOT_HEALTHY_CODE);
  });

  it("never echoes a value that is not a plain code (paths, free text)", () => {
    expect(failureCode("C:\\Users\\someone\\x.log")).toBe(NOT_HEALTHY_CODE);
    expect(failureCode("boom: it broke")).toBe(NOT_HEALTHY_CODE);
  });
});

describe("failureCauseKey", () => {
  it.each([
    "backend_launch_failed",
    "backend_ports_busy",
    "backend_foreign_instance",
    "backend_exited",
    "backend_state_unavailable",
    "runtime_not_ready",
    NOT_HEALTHY_CODE
  ])("has a specific sentence for %s", (code) => {
    expect(failureCauseKey(code)).not.toBe("shell.backendGate.cause.unknown");
  });

  it("falls back to a generic sentence for unknown codes", () => {
    expect(failureCauseKey("something_new")).toBe("shell.backendGate.cause.unknown");
  });
});

describe("buildFailureDetails", () => {
  const base = {
    version: "0.5.0",
    code: "backend_exited",
    restarts: 1,
    logPath: "C:/data/logs/backend.log",
    lastLine: "ModuleNotFoundError: boom"
  };

  it("lists app, version, code, restarts, log path and last line as plain text", () => {
    const text = buildFailureDetails(base);
    expect(text).toContain("OpenCohost 0.5.0");
    expect(text).toContain("Error code: backend_exited");
    expect(text).toContain("Restarts: 1");
    expect(text).toContain("Log: C:/data/logs/backend.log");
    expect(text).toContain("Last log line: ModuleNotFoundError: boom");
  });

  it("marks missing values instead of dropping the line", () => {
    const text = buildFailureDetails({ ...base, version: null, logPath: null, lastLine: null });
    expect(text).toContain("OpenCohost (version unknown)");
    expect(text).toContain("Log: (none)");
    expect(text).toContain("Last log line: (none)");
  });

  it("collapses a multi-line last line to one line", () => {
    const text = buildFailureDetails({ ...base, lastLine: "a\nb\r\nc" });
    expect(text).toContain("Last log line: a b c");
  });
});
