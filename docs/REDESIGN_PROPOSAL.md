# Redesign backlog — deferred from the brand-identity pass

This identity pass re-skinned the default (`cockpit`) theme via `src/styles/tokens.css`
and `tailwind.config.ts` only. Everything below was deliberately left out of scope.
Pick items à la carte.

## A. Identity rollout remainder

The token/theme contract is in place; these surfaces still render the old look
or haven't been re-skinned to the new brand tokens.

| Item | Effort | Backend? |
|---|---|---|
| Re-skin `aurora` theme to brand tokens | M | No |
| Re-skin `studio` theme to brand tokens | M | No |
| `ModelCard` — apply identity pass (colors/type/spacing via tokens) | S | No |
| `VoiceCard` — apply identity pass | S | No |
| `MemoryCard` — apply identity pass | S | No |
| `AvatarCard` — apply identity pass | S | No |
| `ObsCard` — apply identity pass | S | No |
| `AgendaPanel` — apply identity pass | S | No |
| `StreamPanel` — apply identity pass | S | No |
| `MusicPanel` — apply identity pass | S | No |

## B. Real bugs (from prior UX audit)

| Item | Effort | Backend? |
|---|---|---|
| `VoiceCard.tsx` (~182-186): copy is backwards. Switch label is "Solo TTS local (Piper)"; when toggled OFF the copy says "modo nube desactivado" but the `engine` select's "Ligero" option is literally Edge-TTS (cloud) — OFF can route audio to Edge-TTS while the UI claims cloud is unavailable. Fix: copy must reflect actual `engine` value, not just `local_only`. | S | No (copy fix) — but verify `engine`/`local_only` interaction with backend semantics first |
| `PTTCard.tsx` (~44-51): "Mapear atajo" button is hardcoded `disabled` with copy "Requiere la app de escritorio (Tauri)" — but the app **ships as Tauri**, which can register global shortcuts (`tauri-plugin-global-shortcut`). The disabled state is stale/wrong for the actual runtime. | M | Yes — needs Tauri global-shortcut plugin wired + IPC command to persist the mapped key |

## C. Missing controls (ported from CTk audit, currently absent or cosmetic)

| Item | Effort | Backend? |
|---|---|---|
| Ollama runtime status + start/stop control | M | Yes — needs endpoint to query/start Ollama process |
| Memory inspector: RAM-vs-disk breakdown | M | Yes |
| Memory inspector: conversation view | M | Yes |
| Memory inspector: agenda view | S | Yes (agenda endpoint likely exists — verify) |
| Memory inspector: capture on/off switch | S | Yes |
| Memory inspector: pinned-items counter | S | Yes |
| Editorial-cards inspector (view/manage editorial card content) | M | Yes |
| Voice/PTT wiring — `PTTCard` is currently cosmetic (toggle doesn't drive real push-to-talk capture) | L | Yes — audio capture + IPC + backend PTT state |
| Reference-voice capture flow (record/upload a reference clip for heavy TTS voice cloning) | L | Yes — gated behind `EXPERIMENTAL_HEAVY_TTS_ENABLED`, needs upload endpoint |

## Notes

- Effort is rough (S = <1 session, M = 1-2 sessions, L = multi-session/needs design pass).
- Items with "Backend?: Yes" block on API work outside this frontend repo — flag to
  the owner before scheduling.
- B1 (VoiceCard copy) and B2 (PTT hotkey mapping) are the two items most likely to
  surprise a user in production; consider prioritizing those over new panel identity work.
