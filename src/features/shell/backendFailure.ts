import type { TKey } from "../../i18n/t.js";

/** Shown when the engine started (or no supervisor exists) but never became healthy. */
export const NOT_HEALTHY_CODE = "backend_not_healthy";

/**
 * Every code the front end can receive from the supervisor (`backend_status`
 * and `reload_backend_command`): Rust `backend_diagnostic` codes plus the
 * reload-only ones, plus the local placeholder.
 */
const CAUSE_KEYS: Record<string, TKey> = {
  backend_launch_failed: "shell.firstRun.message.backendLaunch",
  backend_ports_busy: "shell.firstRun.message.backendPortsBusy",
  backend_foreign_instance: "shell.firstRun.message.backendForeign",
  backend_exited: "shell.firstRun.message.backendExited",
  backend_state_unavailable: "shell.backendGate.cause.stateUnavailable",
  runtime_not_ready: "shell.firstRun.message.runtimeNotReady",
  [NOT_HEALTHY_CODE]: "shell.backendGate.cause.notHealthy"
};

const PLAIN_CODE = /^[a-z0-9_]{1,64}$/;

/** The code to display: verbatim when it is a plain enum string, else the placeholder. */
export function failureCode(code: string | null | undefined): string {
  return code && PLAIN_CODE.test(code) ? code : NOT_HEALTHY_CODE;
}

export function failureCauseKey(code: string): TKey {
  return CAUSE_KEYS[code] ?? "shell.backendGate.cause.unknown";
}

export interface FailureDetailsInput {
  version: string | null;
  code: string;
  restarts: number;
  logPath: string | null;
  lastLine: string | null;
}

/** Plain-text block for the clipboard. English on purpose: it is meant for an issue. */
export function buildFailureDetails(input: FailureDetailsInput): string {
  const oneLine = (value: string | null) => (value ? value.replace(/\s*[\r\n]+\s*/g, " ").trim() : "") || "(none)";
  return [
    input.version ? `OpenCohost ${input.version}` : "OpenCohost (version unknown)",
    `Error code: ${input.code}`,
    `Restarts: ${input.restarts}`,
    `Log: ${oneLine(input.logPath)}`,
    `Last log line: ${oneLine(input.lastLine)}`
  ].join("\n");
}
