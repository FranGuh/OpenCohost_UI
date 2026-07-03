# Backend Endpoints — Architecture Design (ADR-008)

**Status: DESIGN — owner approval + 8 open-question answers required before implementation.**
Scope: how to add the 13 proposed endpoints (see `BACKEND_API_PROPOSAL.md`) to the
OpenCohost FastAPI backend, reusing the existing `main.py` / `dispatch.py` /
`engine_host.py` pattern. Answers: feasibility, concurrency, idempotency, resilience,
and single-thread-blocking vs parallelism.

## Feasibility — YES, split into 4 execution tiers

Forcing all 13 through the LLM command-queue would be **wrong**: it would serialize an
OBS network probe or a music fade behind a 180 s Ollama inference on the one engine
thread that has no business doing network/file/audio I/O.

| Tier | What | Endpoints | Execution path |
|---|---|---|---|
| **A** | Engine-state mutations | `POST /api/commands` (whitelisted verbs), `POST /api/chat/turn`, agenda session activate/pause/emergency | Existing **Dispatcher → command_queue**, globally serialized, `accepted≠applied` poll |
| **B** | Concurrent reads | GET models, download-status, tts/config, memoria/stats, agenda, + GET halves of obs/avatar/stream/music | **sync-def direct read** in FastAPI's threadpool (like `/api/perfiles`), timeout+cache for external I/O |
| **C** | Resource mutations (not engine work) | obs/test, stream connect+limits, music mood/fade/import/delete, avatar config/upload, agenda CRUD | **Own per-resource `threading.Lock`** (non-blocking try-acquire → 409-if-busy), work in the request threadpool thread — **NOT** the LLM queue |
| **D** | Streaming / progress | model download progress, LiveVoice | Download = **background-task + poll**; LiveVoice = **async WS** with `run_in_executor` bridge |

**Recommendation:** ONE generic `POST /api/commands` with a **server-side verb
whitelist** for Tier-A engine verbs (one idempotency story, one 429 gate), + ONE typed
wrapper for `chat/turn` (needs the hard R8 no-echo + text validation), + per-resource
handlers with their own locks. `#11 OAuth` stays a gated **501 stub** until
`STREAM_ADMIN_ENABLED` flips. Hybrid, not a monolith.

## Concurrency — two independent serialization domains (do not collapse)

- **Domain 1 — engine mutations (Tier A):** all funnel into the ONE Dispatcher →
  ONE core `command_queue` → single `MotorVocalIA` worker thread (consumes one at a
  time). The queue **is** the lock. Backpressure = the existing bounded gate
  (`qsize ≥ 16 → queue_full → 429`), shared across all engine verbs. Reused key +
  different intent → **409**. `accepted≠applied` preserved (enqueue bumps
  `state_version`; engine thread flips status fields; client polls `/api/status`).
- **Domain 2 — resource mutations (Tier C):** each resource gets its **own
  non-reentrant `threading.Lock`** with `acquire(blocking=False)` → **409 busy**.
  Blocking work (OBS connect, file write, audio fade) runs in the request's threadpool
  thread. Separate locks ⇒ an OBS probe, a music fade, and an avatar upload run
  **concurrently**; only self-concurrency (two OBS probes) blocks.
- **Reads (Tier B)** run concurrently off the event loop because handlers stay
  `sync def` (FastAPI threadpool). Safe reads: GIL-atomic single-ref engine flags,
  lock-copied `HealthMonitor.state` snapshots, isolation-safe sqlite aggregations,
  immutable catalog/tiers.
- **`run_in_executor` is needed in exactly ONE place:** the LiveVoice async WS handler.
  Everywhere else `sync def` already offloads to the threadpool.

## Idempotency — reuse the registry, but fix one latent bug first

Reuse the existing in-memory registry (OrderedDict on the single Dispatcher, 120 s TTL
prune-on-dispatch, 1024-cap FIFO). **MANDATORY PREREQUISITE (verified bug):**

> `dispatch.py:76-78` hashes **only the payload**; the replay decision (`:52`) compares
> only that hash — the **command verb is excluded**. Latent today (only `switch_profile`
> is dispatched). The moment `POST /api/commands` adds a second verb, the **same
> Idempotency-Key + a coincidentally-identical payload under a different verb
> false-replays the wrong `command_id`.** Fix (~2 lines, backward-compatible): fold the
> verb into the hashed content, e.g. `_hash_payload({"_cmd": command, **payload})`, or
> store+compare the verb in the cache tuple. Keep the cache **key** the raw
> Idempotency-Key string.

- Wiring: the generic endpoint + chat/turn read `Idempotency-Key` (header, body
  fallback) and pass it as `dispatch()`'s `key`. No new storage.
- Composes with `accepted≠applied`: the registry stores only `(hash, command_id,
  expires_at)` — **never the applied result**, which is exactly what keeps replay
  R8-safe (a replayed chat/turn can't echo dialogue the registry never held). A replay
  returns the same `command_id`; the client re-attaches by polling `/api/status`.
- **TTL edge:** a `chat/turn` can outlive the 120 s TTL; a retry after expiry would
  re-enqueue → **double turn**. Keep 120 s; add a per-verb TTL (~300 s for
  `process_context`) only if observed. → open question.
- Tier-C actions bypass the Dispatcher; their **single-flight lock is the dedup**
  (duplicate submit → 409 busy). PUT config is idempotent by nature. Add a per-resource
  key registry only if true replay is ever needed (YAGNI).

## Resilience

- **Timeouts:** Tier-A needs none (`put_nowait` returns instantly). Tier-B external
  reads (Ollama discovery, OBS) get short (2-3 s) client timeouts + short cache →
  degrade, don't pin threadpool threads. Tier-C blocking work gets timeouts inside its
  single-flight critical section.
- **Engine stall / heavy-model recovery:** **no new API logic** — it lives inline on
  the engine thread (`_ollama_chat_with_watchdog → _recover_from_stalled_inference`).
  The API observes it via `/api/status`. The `heavy_model_inference_recovery` gate is
  untouched.
- **Engine-busy vs engine-dead (new primitive):** busy = queue ≥ 16 → 429 (retry).
  **Dead** = worker thread not alive → today `put_nowait` piles into an *unbounded*
  core queue with no consumer and returns a false `200 accepted`. **Add a liveness
  gate:** `host.motor.is_alive()` → **503 engine_unavailable**. The one new resilience
  primitive worth adding.
- **Health gates:** reuse `HealthMonitor.state` (lock-copied snapshot). Don't pre-gate
  every mutation on health — let the engine's own Vibe/health/TTS-fallback gates decide,
  except the engine-dead 503.
- **Partial failure:** models → catalog-only if discovery times out; download → idle if
  none active; Tier-C → structured 4xx/503, never a 500.
- **R8 / `_Drain` — non-negotiable everywhere:** chat/turn + clear_history return
  **ack only**; memoria/stats is **COUNT(\*) only** via the `_DIGEST_CAPTURE_SOURCES`
  provenance gate (reused verbatim, never SELECTing text); agenda cards carry no
  transcript excerpts; LiveVoice does zero stream logging + origin/auth gate. The
  registry stores no result body → no replay can leak dialogue.

## Threading model — decisive

Keep **`workers=1` forever**, the single-owner `command_queue` + single `MotorVocalIA`
thread as the **only** path that mutates engine state, and REST handlers **`sync def`**.
Do NOT add engine threads. Do NOT call an engine method inline in a handler. This is the
invariant that makes double-VRAM / double-audio-grab impossible (msvcrt lockfile +
`_host_active` + `WEB_CONCURRENCY` check retained).

Mutations split **by owner, not convenience:**
- **Engine-owned** (LLM/TTS/model/history/live-session) → the single queue, serialized,
  429/409/503 gated. Serialized *because* Ollama has one runner slot — parallelism here
  fights the hardware.
- **Resource-owned** (OBS/avatar/music/stream/agenda-DB) → per-resource single-flight
  lock, work in the request threadpool thread. Routing these through the engine queue is
  a category error.

Because handlers stay `sync def`, FastAPI already runs them in its ~40-thread threadpool
**off the event loop** — blocking reads/writes are non-blocking-to-the-loop with **zero
manual `run_in_executor`** (matches the current `/api/perfiles` read). Manual executor
bridging enters in exactly one place: the LiveVoice async WS. Net: **one blocking engine
thread, many short-lived threadpool request threads, per-resource locks, one async WS.
No new long-lived threads.**

## Build order

1. **Prerequisites (~2 lines each):** idempotency verb-fix in `dispatch.py`; engine-dead
   **503** liveness gate.
2. **Generic `POST /api/commands`** (server-side verb whitelist) — unblocks all Tier-A.
3. **Direct-read endpoints:** tts/config, models (catalog+tiers, then discovery with
   timeout+cache+degrade), memoria/stats (counts-only COUNT(\*) via the provenance gate).
4. **`POST /api/chat/turn`** (typed, hard R8 no-echo) + download-status poll (atomically
   rebound progress snapshot).
5. **Resource subsystems** (each own lock, parallel-shippable): OBS, avatar (atomic file
   write), music (audio-bed + index locks), stream connect/limits, agenda GET/CRUD +
   session verbs via the queue.
6. **LiveVoice WS** (async, single-active-connection guard, executor bridge, R8 audit) —
   highest complexity, last.
7. **`#11` OAuth** — gated **501 stub** until scoped.

## Risks

- Cross-verb false replay (idempotency hash excludes verb) — **must fix before #2 ships.**
- Engine-dead silent enqueue into the unbounded core queue — **needs the 503 gate.**
- Pre-existing `current_model` / download-progress off-thread write race — reads stay
  stale-but-safe; real fix = route download-completion through the queue.
- Threadpool exhaustion from external-I/O reads without short timeouts + caching.
- `chat/turn` outliving the 120 s idempotency TTL → double turn.
- Tier-C single-flight locks must return 409/429 when busy, or concurrent submits pile
  ungated.
- LiveVoice WS bypasses Dispatcher **and** browser-CORS → biggest R8 hole (raw voice) +
  unauthorized-tab attach vector without its own origin/auth guard.
- Any GET echoing a password, or any ack leaking a count/preview/transcript, breaks R8 —
  per-field write-only / counts-only review per endpoint.

## Open questions (owner decisions — needed before implementation)

1. **`POST /api/commands`**: confirm one generic endpoint + server-side verb allowlist
   (recommended), with `chat/turn` the only typed exception?
2. **Idempotency**: confirm folding the verb into the hash (same key across different
   verbs → 409 conflict, not false replay)? (recommended)
3. **Engine-dead**: `503 engine_unavailable` reject (recommended) vs accept-and-queue?
4. **chat/turn TTL**: keep 120 s (post-TTL retry = double turn) or bump `process_context`
   to ~300 s?
5. **Tier-C idempotency**: single-flight lock as the only dedup (recommended, lazy) vs a
   per-resource key registry?
6. **LiveVoice WS auth**: there is NO auth today (loopback-only). What origin/token gate
   before a browser tab may attach to the raw voice channel?
7. **`#11` OAuth / `STREAM_ADMIN_ENABLED`**: keep the 501 stub, or is the
   moderation/credential slice in scope?
8. **Download-completion race**: route it through the queue now (fixes the off-thread
   `current_model` write) or defer as pre-existing debt?

## ADR-008 (summary)

**Context.** The Phase-1 API exposes 3 endpoints over a proven pattern: one uvicorn
worker owns one engine thread; sync-def handlers run in the threadpool; engine mutations
are produced onto a bounded `command_queue` and consumed serially; `accepted≠applied` is
polled via `/api/status`; an in-memory Idempotency-Key registry gives replay/conflict;
R8 is enforced by the `_Drain` sink. We add 13 endpoints spanning mutations, reads,
resource actions, a poll-based download, and a streaming WS — reusing this pattern.

**Decision.** (1) Four tiers (A engine-queue / B direct-read / C per-resource lock / D
stream+poll). (2) One generic `POST /api/commands` (verb whitelist) + typed `chat/turn`;
Tier C never touches the queue. (3) Keep `workers=1`, sync-def handlers, single engine
thread; `run_in_executor` only in the LiveVoice WS. (4) Fix two gaps first — fold the
verb into the idempotency hash, and add an engine-dead 503 gate. (5) Preserve R8
everywhere (ack-only mutations, counts-only stats, no transcript in cards, no stream
logging + auth on LiveVoice).

**Consequences.** *Positive:* one idempotency + one backpressure story for engine
mutations; the event loop is never blocked; resource actions run concurrently instead of
serializing behind inference; the single-owner hardware invariant and `_Drain`/R8 carry
forward unchanged. *Cost:* two serialization domains is more moving parts than one queue
— but collapsing them would be actively wrong; the two prerequisite fixes are mandatory,
not optional; pre-existing off-thread races become observable (stale-but-safe reads,
deferrable proper fix); LiveVoice WS is the one genuinely new concurrency surface and
carries the strongest R8 burden — sequenced last, behind its own auth decision.

## Owner refinements (post-review)

**Availability model — supersedes the "engine-dead 503" framing.** The failure to guard
is the **API process not being up** (front can't reach back at all → "doom"), not just a
dead worker thread. Model for a LOCAL app: the front pings a small fast endpoint
(`GET /api/health`, or reuse the lightweight `/api/status`) on startup / periodically; on
connection-refused it prompts to — or auto-does — **launch the compiled backend** (Tauri
**sidecar** spawns the bundled binary; local + compiled = safe). The same `/api/health`
also reports **engine liveness** (not just HTTP up), covering the worker-dead case in one
place; the mutation-time 503 becomes a secondary safety net. **Local security posture:**
bind `127.0.0.1` + CORS allowlist + R8 (no raw chat over the wire) — no TLS/auth (a
*server* concern, out of scope). **Scope note:** the auto-launch is a Tauri
sidecar/packaging mini-design (touches the packaging track), separate from the API.

**Q4 — the TTL is NOT latency; don't raise it.** The 120 s TTL is only the idempotency
dedup window and has ZERO effect on response latency (observed via `/api/status`
polling). Instead of raising it, the client holds the **`command_id`** from `accepted`
and polls status — with the id in hand it never blind-retries, so a double-turn cannot
happen and the TTL is irrelevant to slow turns (it can even be lowered). The TTL only
covers the seconds-long "sent but no ack" gap.

**Q5 — Tier-C has no Q4-style problem.** It is synchronous request/response, and the ops
are naturally idempotent / harmless to repeat (OBS probe, set-mood, full-replace config);
the lock only prevents a *concurrent* double-fire. The one exception is a non-idempotent
create like `music/import` → dedup by a **natural key** (filename) when built.

**LiveAudio (was "LiveVoice"):** `#13` is the owner's **LiveAudio** program (Whisper
transcriptions → OBS), likely a separate program — NOT a raw-voice channel to a browser
tab. The "auth" concern was overstated; **note + defer**, confirm the WS payload before
wiring. Not a concern for this pass.
