# Backend API Proposal — React/Tauri parity

**Status: PROPOSAL — owner approval required before building.**

The React/Tauri frontend now has full **UI parity** with the CustomTkinter app.
Every panel is a **functional mock** wired for a drop-in hook swap. The FastAPI
backend (`opencohost/api/`) currently exposes only **profiles + status**. To make
the app truly functional, the endpoints below are proposed. Building them is an
**expansion of the Python app** and is gated on owner approval per the operating
mode ("less expansion, more controlled validation").

## Design principle

Reuse the existing `Dispatcher` + bounded-queue + **accepted≠applied** +
`Idempotency-Key` contract (the same one `POST /api/perfiles/switch` already uses;
clients poll `GET /api/status` until `state_version` / a concrete field converges).
A single generic `POST /api/commands` (whitelisted) covers most mutations; add a few
focused `GET` reads. **Privacy (R8): never echo raw chat / persona / history over
HTTP** — only accepted-acks and counts.

## Endpoints (13)

| # | Endpoint | Purpose | Unlocks (UI) |
|---|----------|---------|--------------|
| 1 | `POST /api/commands` | Whitelisted dispatch: `clear_history`, `set_tts_local_only`, `set_tts_speed`, `set_piper_voice`, `set_motor_tts`, `switch_model`, `switch_llm_tier`. Reuses `Dispatcher.dispatch`. `200 accepted` / `409` / `429`. | ModelCard, VoiceCard, MemoryCard (clear) |
| 2 | `GET /api/models` | `{catalog, discovered, current_model, tiers, active_tier}` from `MODELS_CATALOG` + Ollama discovery + `resolve_llm_tiers()`. Read-only. | ModelCard select + tiers |
| 3 | `GET /api/models/download/status` | `{model, downloaded_bytes, total_bytes, state}`. Poll after a `download_model` command. | ModelCard download |
| 4 | `GET /api/tts/config` | `{piper_voice, local_only, speed, engine, heavy_available}`. Writes go via `POST /api/commands`. | VoiceCard |
| 5 | `POST /api/chat/turn` | `{text}` → `dispatch('process_context', text)`. **Accepted-only; MUST NOT echo text (R8 + `_Drain`).** Kira's reply is observed via avatar/`is_speaking`, never returned. | ConversationPanel composer, PlayerBar "Hablar" |
| 6 | `GET /api/memoria/stats` | **COUNTS ONLY (R8):** `{session_turns, digest_entries, saved_memorias, pinned, editorial_cards_by_status}`. No raw content. | MemoryCard inspector |
| 7 | `GET /api/agenda` + `POST /api/agenda/{topic\|suggestion\|session}` | Agenda state + mutations (add/queue/reorder topic, approve/reject suggestion, session activate/pause/emergency). Write-through `EDITORIAL_CARDS_DB`. **Largest surface.** | AgendaPanel |
| 8 | `GET`/`PUT /api/obs/config` + `POST /api/obs/test` | `{enabled, host, port, password_set, source}` — **password write-only, never returned.** Test via `OBSClient.test_connection`. | ObsCard |
| 9 | `GET`/`PUT /api/avatar/config` + `POST /api/avatar/upload` | Per-state image assignments; persists `AVATAR_CONFIG_FILE`. Upload UX = owner decision. | AvatarCard |
| 10 | `GET /api/stream/chat-live` + `POST .../connect` + `PUT .../limits` | RF3 chat-live: connect (`sanitize_live_url`), `set_activity_limits` / `set_spam_limits` / `set_filter_policy`. | StreamPanel |
| 11 | `POST`/`PUT /api/stream/oauth/*` | RF4 (OAuth/metadata/moderation). **Gated (`STREAM_ADMIN_ENABLED=False`) — owner decision, not built in UI.** | (deferred) |
| 12 | `GET /api/music/library` + `POST .../mood` + `POST .../fade` + `POST .../import` + `DELETE .../track/{id}` | `MusicLibrary` + `AudioBedEngine.request_mood` (single-flight). | MusicPanel |
| 13 | **LiveVoice** — connect React directly to the existing engine WebSocket `WS_URI` | No new REST; confirm browser-origin/auth. **Wiring, not a backend build.** | PlayerBar LiveVoice toggle |

## Suggested build order

Quick wins first — one endpoint (`POST /api/commands`) plus three reads unlock the
entire **Configuración** domain:

1. `POST /api/commands` + `GET /api/models` + `GET /api/tts/config` + `GET /api/memoria/stats` → Model / Voice / Memory become live.
2. `POST /api/chat/turn` → talk to Kira for real.
3. `GET/POST/PUT /api/stream/chat-live` (RF3) → Stream.
4. `GET/POST/DELETE /api/music/*` → Música.
5. `GET/POST /api/agenda/*` (largest) → Agenda.
6. `GET/PUT/POST /api/obs|avatar/*` → OBS + Avatar.
7. LiveVoice WS wiring.

## USER-ASSIST — 6 owner decisions

These block *real* function, **not** the mock UI (all already shipped and disclosed):

1. **OBS creds** — host / port / password / source (write-only).
2. **Stream OAuth Client ID + Secret** (RF4).
3. **PTT hotkey** — a browser tab cannot register a global OS hotkey. Web owns ON/OFF intent only, or PTT stays desktop-exclusive?
4. **Memory raw-content exposure** — R8 forbids raw chat/persona over HTTP. Counts-only (current), or expose editorial-card metadata?
5. **RF4 gated Stream panels** (metadata / moderation) — include in the web app?
6. **Avatar / music upload UX** — browser multipart vs desktop file-path.

## How the swap works

Each panel's `useMockCommand` + fixture (`src/api/mock/`) is replaced with a
`useQuery`/`useMutation` against these endpoints. The contract (accepted≠applied,
`Idempotency-Key`, poll `/api/status`) already matches — **it is a hook rename, not
a reshape.**
