import type { paths } from "./types.gen.js";

export type StatusResponse = paths["/api/status"]["get"]["responses"][200]["content"]["application/json"];
export type ProfilesResponse = paths["/api/perfiles"]["get"]["responses"][200]["content"]["application/json"];

/**
 * `POST /api/perfiles/switch` has no `response_model` on the backend route
 * (opencohost/api/main.py), so openapi-typescript can't infer its 200 shape.
 * Hand-typed from opencohost/api/models.py::SwitchProfileResponse.
 * ponytail: keep this in sync manually if that model changes.
 */
export interface SwitchAccepted {
  accepted: true;
  command_id: string;
  status: string;
}

export class ApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export class ConflictError extends ApiError {
  constructor() {
    super("profile switch conflict", 409);
    this.name = "ConflictError";
  }
}

export class QueueFullError extends ApiError {
  constructor() {
    super("command queue full", 429);
    this.name = "QueueFullError";
  }
}

export class NotFoundError extends ApiError {
  constructor(detail: string) {
    super(detail, 404);
    this.name = "NotFoundError";
  }
}

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:8000";

export async function getStatus(): Promise<StatusResponse> {
  const res = await fetch(`${BASE_URL}/api/status`);
  if (!res.ok) {
    throw new ApiError(`GET /api/status failed with ${res.status}`, res.status);
  }
  return (await res.json()) as StatusResponse;
}

export async function getPerfiles(): Promise<ProfilesResponse> {
  const res = await fetch(`${BASE_URL}/api/perfiles`);
  if (!res.ok) {
    throw new ApiError(`GET /api/perfiles failed with ${res.status}`, res.status);
  }
  return (await res.json()) as ProfilesResponse;
}

export async function switchProfile(name: string, idempotencyKey: string): Promise<SwitchAccepted> {
  const res = await fetch(`${BASE_URL}/api/perfiles/switch`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey
    },
    body: JSON.stringify({ name })
  });

  if (res.status === 409) {
    throw new ConflictError();
  }
  if (res.status === 429) {
    throw new QueueFullError();
  }
  if (res.status === 404) {
    const body = (await res.json()) as { detail: string };
    throw new NotFoundError(body.detail);
  }
  if (!res.ok) {
    throw new ApiError(`POST /api/perfiles/switch failed with ${res.status}`, res.status);
  }
  return (await res.json()) as SwitchAccepted;
}
