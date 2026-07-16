# UI refresh 2026-07-15 — progress log

## Phase 1 — Foundations — DONE

Files changed:
- `src/styles/tokens.css` — motion tokens (`--dur-fast/base/slow`, `--ease-out/--ease-io`) in the `:root, [data-theme="cockpit"]` block per spec §2.1. **Found already present in the working tree at task start** (uncommitted, verbatim match to spec) — verified byte-for-byte against §2.1, no further edit needed.
- `tailwind.config.ts` — `transitionDuration`, `transitionTimingFunction`, the `transitionProperty.colors` extension (adds `filter`), `rise-in` keyframe, and `rise-in` animation per spec §2.2. **Also found already present** (uncommitted, verbatim match including the §2.5-referencing comment) — verified against §2.2, no further edit needed.
- `src/styles.css` — implemented the remaining, not-yet-present pieces:
  - §2.5 part 1: `button { cursor: pointer; transition: filter var(--dur-fast) var(--ease-io); }` (part 2, the `transitionProperty.colors` extension, was already shipped via `tailwind.config.ts` above).
  - §2.4: replaced the narrow `@media (prefers-reduced-motion: reduce) { .welcome-slide-image { animation: none; } }` block with the global kill switch (`*, *::before, *::after` → `animation-duration/iteration-count/transition-duration` forced to `0.01ms`/`1` via `!important`).
  - §2.3: added the global thin themed scrollbar rule (`* { scrollbar-width: thin; scrollbar-color: color-mix(...) transparent; }`), standard properties only, no `::-webkit-scrollbar` block, per the spec's explicit prohibition.

Checks:
- `pnpm build` — pass (`tsc && vite build`, gen:api:offline prebuild ran clean).
- `pnpm vitest run src/styles/tokens.contrast.test.ts` — pass, 9/9.
- `pnpm test` (full) — pass, 58 files / 533 tests, 0 failures.

Final lines of full-test run:
```
 Test Files  58 passed (58)
      Tests  533 passed (533)
   Start at  03:32:39
   Duration  39.42s (transform 3.36s, setup 65.29s, collect 105.66s, tests 69.05s, environment 293.24s, prepare 21.31s)
```

Manual visual check (thin themed scrollbar, no hover change, all 3 themes) was NOT performed — this is a headless CLI session with no browser/Tauri shell available. CSS was authored to the exact spec snippet (standard `scrollbar-width`/`scrollbar-color` only, theme-tinted via `var(--muted-foreground)`), which is mechanically correct per the spec's own stated tradeoff, but the spec's "visually confirm" step for Phase 1 is deferred to a human/manual pass.

Deviations from spec: none in the authored CSS/config. The only note-worthy fact is that §2.1 (tokens.css) and §2.2 (tailwind.config.ts) were discovered already implemented, verbatim, in the working tree before this phase started (likely a prior interrupted session — no progress-log entry existed for it). Verified match against spec text rather than re-writing, to avoid a no-op diff.

## Phase 2 — Status readout — DONE

Files changed:
- `src/components/StatusRail.tsx` — full rewrite into the 4-chip taxonomy rail per spec §3a:
  - New `Taxonomy` type (`ok`/`info`/`attention`/`action`/`neutral`) with `TAXONOMY_TONE` + `CHIP_ESCALATION` maps. `action` is the ONLY state that fills a chip (`bg-danger-bg border-danger-bd text-danger`); `attention` tints border+text only; ok/info/neutral keep the neutral surface and only the tone dot changes color (info dot pulses).
  - `computeSistemaRollup(data, isError)` rewritten (export name kept) to the spec priority table: `isError` → `Sin conexión` (action) → health `danger` → `Motor: necesita acción` (action) → health `warn` → `Motor: atención` (attention) → `!is_ready && ollama_warming` → `Motor: cargando modelo` → `!is_ready` → `Motor: preparando` → health `neutral` → `Motor: …` → else `Motor OK`. Returns `{ taxonomy, label, why, todo? }`. `{dims}` computed via `degradedDims()` over vram/rtf/ollama/qwen (names `VRAM`, `velocidad`, `Ollama`, `voz (Qwen)`).
  - Chip 1 Motor (`Activity`) absorbs the deleted Health chip: its popover ALWAYS appends the detail table (`VRAM libre {free_vram_mb} MB`, `Velocidad RTF {rtf_rolling_avg|—}`, `Ollama` raw, `Qwen (voz)` raw) with per-row `healthTone()` dots — real numbers instead of the word "red".
  - Chip 2 Modelo (`Cpu`) always `neutral`, mono, `max-w-[190px] truncate`, `sin modelo` when null. Chip 3 Kira (`AudioLines`) merges Voz+Inactivo (`computeKira`): hablando/pensando (info) / en espera (neutral). Chip 4 Perfil (`VenetianMask`) always neutral, `ml-auto`.
  - `StatusChip` sub-component: each chip is a `<button data-taxonomy aria-haspopup="dialog" aria-expanded aria-controls>` toggling a `role="dialog"` why-popover (`aria-label` = chip label, `animate-rise-in`). Keyboard-operable — Enter/Space open via native button click, Escape + outside `mousedown` close (same effect pattern as `SettingsPopover`). Signature partial-ring motif kept, re-tinted to the Motor chip's tone.
  - Loading state → single neutral `Conectando con el motor…` chip (no red). Error state → ONLY the Motor chip in `Sin conexión` action (spec revision #5); Modelo/Kira/Perfil omitted (gated on `!isError && data`).
- `src/components/TopBar.tsx` — deleted the meaningless `aria-label="cuenta"` avatar circle button; the gear (SettingsPopover) is now the last element.
- `src/components/StatusRail.test.tsx` — expectations moved to new spec copy (Motor/Kira taxonomy labels via `data-taxonomy`, `Health:`/`Sistema:` gone), added popover a11y cases (open on click, detail table with real numbers, Escape close, outside-click close, Enter open) and the isError single-chip case. `userEvent` imported as named export (repo convention).
- `src/components/TopBar.test.tsx` — added assertion that `queryByLabelText("cuenta")` is null.

Checks:
- `pnpm build` — pass (`tsc && vite build`).
- `pnpm vitest run src/components/StatusRail.test.tsx src/components/TopBar.test.tsx` — pass, 16/16 (StatusRail 14, TopBar 2).
- `pnpm test` (full) — pass, 58 files / 539 tests, 0 failures. `src/styles/tokens.contrast.test.ts` green in all three themes.

Final lines of full-test run:
```
 Test Files  58 passed (58)
      Tests  539 passed (539)
   Start at  03:43:59
   Duration  36.93s (transform 4.29s, setup 69.37s, collect 55.11s, tests 67.57s, environment 300.47s, prepare 22.10s)
```

Deviations from spec:
- The rail no longer carries `overflow-hidden`. The spec keeps `role="status"` + the aria-label but the popovers must escape the rail box, and an `overflow-hidden` ancestor would clip an absolutely-positioned popover. Truncation moved from the rail to the Modelo chip label span (`max-w-[190px] truncate`), which is where the only unbounded-width content lives; total rail width stays bounded and `body { min-width: 1280px }` guarantees horizontal room, so nothing wraps or blows out. The old test's `overflow-hidden` assertion was adapted to assert the Modelo label truncates + the rail is not `flex-wrap` (assertion intent — single-line, no wrap — preserved). No portal was used (kept the DOM simple).
- `data-taxonomy` was added to each chip button as a test seam (mirrors the old Badge `data-tone`), so tests assert taxonomy without brittle class matching. Not requested by the spec but cheap and harmless.
- Motor popover detail table renders only when health data is present; in the `Sin conexión` error state (data undefined) it is omitted, since there are no numbers to show. The spec's "ALWAYS appends the detail table" holds for every data-present state.
- Manual MSW-fixture visual verification (filled-red only on action states, popover keyboard/outside-click in a real browser) was NOT performed — headless CLI session, no Tauri/browser shell. Behavior is covered by the vitest a11y cases instead.

## Phase 3 — Chat panel — DONE

Files changed:
- `src/api/pttCopy.ts` (new) — verbatim extraction of `STATE_COPY` + `ERROR_COPY` from `PTTCard.tsx` (§3b(vi) step 1). Literals unchanged; imported by both `PTTCard.tsx` and `ConversationPanel.tsx` so the two surfaces share one copy source.
- `src/components/PTTCard.tsx` — import-path change ONLY: removed the two local copy maps + the now-unused `PttErrorCode`/`PttUiState` type imports, replaced with `import { ERROR_COPY, STATE_COPY } from "../api/pttCopy.js"`. Behavior untouched (proven by PTTCard.test.tsx passing unchanged).
- `src/components/ui/KiraFace.tsx` (new) — round SVG avatar reusing BrandMark's exact face geometry (cyan `fill-accent2` circle + two eye rects + mouth rect), eyes/mouth `fill: var(--background)` so they read on the accent in all three themes. Props `size?` (default 22), `className?`, `aria-hidden`. `viewBox="66 10 48 48"` frames the face; `rounded-full` clips to the circle.
- `src/components/ConversationPanel.tsx` — the §3b work:
  - (i) Empty state: deleted the canned `viewer-question` turn + its render branch and the `TURNS` array. Added the centered `KiraFace` (40px) invitation (`Empezá a chatear con Kira` / `Escribí un mensaje abajo, o mantené el micrófono para hablarle.`, `animate-rise-in`). Condition is spec revision #4 exactly: `activeTab !== "Alertas" && !(transcript.length > 0 || isThinking)` — zero chat-kind turns (transcript + thinking) dismiss it, alert-kind event lines do NOT. Alertas keeps `Sin turnos en este filtro.` as its own empty case (now gated to `activeTab === "Alertas" && visibleTurns.length === 0`).
  - (ii) `KiraBadgeLabel` rewritten to `<KiraFace size={22} aria-hidden />` + the mono `KIRA` / `KIRA · AGENDA` label (kept `text-[var(--kira-cyan)]`); deleted the `Badge`+`◈` usage and the `Badge` import.
  - (iii) Viewers-muted notice: deleted the `mute-notice` turn + its render branch + its `muteTurn` append. Added a persistent quiet banner (`h-7 flex items-center gap-2 text-[11px] mono text-dim`, `MessageSquareOff` size 12, `title` tooltip) as the FIRST child of the composer container, above the form — never scrolls with the timeline. Copy `Chat de viewers silenciado`, taxonomy neutral (no tone color).
  - (iv) System/status event lines: replaced the bare centered-divider (two `h-px` side rules) with a centered meta chip (`mx-auto w-fit rounded-full bg-surface-2 border border-border-soft px-2.5 py-0.5 text-[11px] mono text-dim`, `animate-rise-in`) wrapped in `role="status"`. Label text left exactly as emitted (owned by `appEvents.ts`/`agenda.ts`).
  - (vi) Composer mic: reuses the EXISTING `usePttHold()` hook, relocated. Mic button BEFORE `Enviar` inside the `Input` trailing cluster. Pointer (`onPointerDown` + `setPointerCapture`, `onPointerUp/onPointerCancel/onLostPointerCapture`) and button-LOCAL `onKeyDown/onKeyUp` (Space/Enter) only — NO window-level listeners (PTTCard owns the global gesture). Visual state table implemented (idle/connecting/listening/flushing + degraded MicOff opacity-60 after a 503). `Turno de voz enviado` chip (`Mic` size 12, `role="status"`, `animate-rise-in`, 4s auto-clear) on the flushing→idle transition with no error; a 503 shows `ERROR_COPY.stt_unreachable` in a composer status line and degrades the mic until a later press succeeds.
  - The bare error `<p role="alert">` at the bottom (chat-send failures) was left UNTOUCHED — it migrates in Phase 4 (spec revision #3).
- `src/components/ConversationPanel.test.tsx` — adapted the tab-filter test (the muted notice is no longer an in-timeline alert, so it now asserts filtering against an injected app-event divider instead of `/silenciado/`; the tab↔tabpanel ARIA assertions were preserved). Added: empty-state on Todo, empty-state survives an alert-only `Motor: listo` line, empty-state dismissed once a chat turn lands, Alertas keeps `Sin turnos en este filtro.`, muted banner exists exactly once and outside the tabpanel, mic pointer start/stop, NO window-level key listener, `Turno de voz enviado` chip after a completed hold, and honest 503 handling.

Checks:
- `pnpm build` — pass (`tsc && vite build`, gen:api:offline prebuild ran clean).
- `pnpm vitest run src/components/ConversationPanel.test.tsx src/components/PTTCard.test.tsx src/api/ptt.test.ts` — pass, 54/54. **PTTCard.test.tsx (16) and ptt.test.ts (13) passed UNCHANGED — the proof of pure relocation.** ConversationPanel 32 (was 25; +7 new, 0 deleted; 1 adapted).
- `pnpm test` (full) — pass, 58 files / 548 tests, 0 failures. `src/styles/tokens.contrast.test.ts` green in all three themes.

Final lines of full-test run:
```
 Test Files  58 passed (58)
      Tests  548 passed (548)
   Start at  03:56:45
   Duration  34.98s (transform 3.27s, setup 66.59s, collect 51.53s, tests 67.95s, environment 278.33s, prepare 21.43s)
```

Deviations from spec:
- Mic icon glyph size not specified by the spec's state table (only the `Turno de voz enviado` chip is pinned at size 12); used `size={16}` for the composer mic button, consistent with the surrounding composer scale.
- "dot pulse" (connecting) / "circular halo, gentle pulse" (listening) rendered via `animate-pulse` on the icon (`text-info` for connecting, `bg-danger-bg text-danger` for listening) rather than a separate dot element — kept the button a single element; the global reduced-motion rule (§2.4) neutralizes the pulse. No behavioral difference; aria-labels/aria-pressed carry the state per the table.
- Two `usePttHold()` instances now coexist when both PTTCard and ConversationPanel are mounted (each owns its own local hook state; they share the `["ptt-flush-poll"]` query key and the server single-slot). This is the spec's explicitly designed coexistence (§3b(vi) step 3: "PTTCard already owns the global gesture … a second global listener would double-start"), which is why the composer mic adds no window listeners; the server's single-slot 409 + keepalive watchdog backstops any race.
- Manual browser/Tauri verification (empty state on fresh load, muted banner static above composer, mic hold→listening→release→chip) was NOT performed — headless CLI session, no shell. Behavior is covered by the added vitest cases instead.

## Phase 4 — Alerts + settings variant control — DONE

Files changed:
- `src/components/ui/Alert.tsx` (new) — single DOM shape (`role="alert"` div → tone icon → title/body paragraphs), tone→icon map per spec §3d (`ok`→`CircleCheck`, `warn`→`TriangleAlert`, `danger`→`OctagonAlert`, `info`→`Info`, `neutral`→`CircleDashed`, default `neutral`). No inline color classes — tone is expressed purely via `data-tone` + the CSS variant rules, so switching styles restyles instantly with zero re-render.
- `src/styles.css` — appended the §3d variant CSS verbatim (`.oc-alert`/`.oc-alert-title`/`.oc-alert-body`/`.oc-alert-icon` base rules + the three `data-tone` tone-var bindings + the three `data-alert-style` variant blocks: `sereno` default/quiet panel, `marcado` left accent bar, `contorno` transparent outline). Uses only existing tone vars (`--ok/--warn/--danger/--info/--muted-foreground` + their `-bd` counterparts) and `--r-md`, `--dur-slow`, `--ease-out` — no new tokens.
- `src/theme/useAlertStyle.ts` (new) — clones the `useTheme.ts`/`useDensity.ts` module-singleton pattern: `ALERT_STYLES = ["sereno","marcado","contorno"]`, `localStorage["oc-alert-style"]`, applies `document.documentElement.dataset.alertStyle` at module init (before first paint) and on every `setAlertStyle`. Added a test-only `_hydrateForTests()` seam (mirrors `useTheme.ts`'s F4 seam) since the store is a shared module singleton across tests.
- `src/components/SettingsPopover.tsx` — new `Alertas` section inserted between `Tema` and `Vista` per spec: `Segmented` (Sereno/Marcado/Contorno) wired to `useAlertStyle`, plus a live `<Alert tone="info" title="Así se ve una alerta">Elegí el estilo que más te acomode.</Alert>` preview that restyles instantly on segmented change (pure CSS attribute switch, no state threading needed).
- `src/components/ConversationPanel.tsx` — the ONE assigned migration edit (spec revision #3): the bare `<p role="alert" className="text-xs text-danger">` chat-send-error line is now `<Alert tone="danger">{error?.message ?? "No se pudo enviar el mensaje."}</Alert>`. No test changes were needed here — the existing `getByRole("alert")` / `toHaveTextContent(...)` assertions in `ConversationPanel.test.tsx` match the new `<Alert>` DOM unchanged (proof of a clean swap).
- `src/components/ui/Alert.test.tsx` (new) — role=alert + `data-tone` default/explicit, title+body text content, title paragraph omitted when absent, one icon per tone (parametrized over all 5 tones).
- `src/theme/useAlertStyle.test.ts` (new) — mirrors `useTheme.test.ts`: default `sereno` applied on mount, `setAlertStyle` updates the DOM attr + localStorage, restores a persisted value, falls back to default on an unknown stored value, multiple consumers stay in sync through the shared store.
- `src/components/SettingsPopover.test.tsx` — added `data-alert-style` cleanup to `beforeEach`/`afterEach`, plus two new cases: the Alertas section renders the segmented control defaulted to Sereno (`aria-pressed`) with the live preview alert visible, and switching to Marcado updates `data-alert-style` + `localStorage["oc-alert-style"]`.

Checks:
- `pnpm build` — pass (`tsc && vite build`).
- `pnpm vitest run src/components/ui/Alert.test.tsx src/theme/useAlertStyle.test.ts src/components/SettingsPopover.test.tsx src/components/ConversationPanel.test.tsx` — pass, 60/60 (Alert 9, useAlertStyle 5, SettingsPopover 14 [12 existing + 2 new], ConversationPanel 32 unchanged).
- `pnpm test` (full) — pass, 60 files / 564 tests, 0 failures (was 548 after Phase 3; +16 = 9 Alert + 5 useAlertStyle + 2 SettingsPopover). `src/styles/tokens.contrast.test.ts` green, 9/9 — no new color pairs introduced.

Final lines of full-test run:
```
 Test Files  60 passed (60)
      Tests  564 passed (564)
   Start at  04:03:41
   Duration  37.76s (transform 3.88s, setup 67.85s, collect 55.22s, tests 68.70s, environment 278.69s, prepare 22.13s)
```

Deviations from spec:
- Added `_hydrateForTests()` to `useAlertStyle.ts`'s store, which the spec's short code sketch doesn't show. Needed because the store is a module singleton shared across the whole vitest run (same reason `useTheme.ts` has it) — without it, tests that set `localStorage` directly before rendering couldn't force the store to re-read it. Same shape as the existing `useTheme.ts` seam; no behavioral difference for app code.
- `SettingsPopover.tsx`'s Alertas segmented options are defined as a small `ALERT_STYLE_OPTIONS` module constant (typed against `ALERT_STYLES`) rather than inlined literally at the JSX call site as the spec's snippet shows — purely a TS-friendliness reformatting, same three values/labels/order.
- Manual visual verification (Sereno/Marcado/Contorno restyle instantly in the gear popover and any visible alert, across all three themes, and the choice survives reload) was NOT performed — headless CLI session, no browser/Tauri shell. Covered instead by the vitest a11y/DOM assertions and the CSS being a straight transcription of the spec's snippet.

## Phase 5 — Perfil Co-host form — DONE

Files changed:
- `src/components/AgendaPanel.tsx` — `ProfileSessionCard` rewritten per spec §3e (imports gained `Alert` from `./ui/Alert.js`, no other new imports needed):
  1. Deleted the duplicated inner section label `Perfil Co-host` → replaced with `Identidad` (the card's `<h2>` title stays `Perfil Co-host`, untouched — that's the collapsible header, not the inner label).
  2. Added visible field labels: `Perfil guardado` above the profile `Select` (plain `<span>`, matching the note that the custom `Select` uses `aria-label` only and gets no `htmlFor`), `Nombre` above the name `Input` (`<label htmlFor="agenda-profile-name">` + matching `id` on the `Input`, `aria-label` kept unchanged so existing `getByLabelText` calls are unaffected — ARIA `aria-label` wins over the `<label>` element for accessible name).
  3. Deleted the `grid grid-cols-[1fr_auto]` name+button row; `Input` is now full-width under its own label. `Guardar perfil` moved to the END of the profile group (after the new `Estilo` section's textarea), in a `flex items-start justify-end gap-3` row with the helper text (`Guarda el nombre y el estilo como un perfil reutilizable.`, `mr-auto text-xs text-muted-foreground`) pushed left and the button right-aligned per the wireframe. `variant="primary"` (was `outline`). Button text swaps to `Guardando…` while `saveProfile.isPending` (mirrors `ProfileEditor.tsx`'s pattern).
  4. New `Estilo` section label above the textarea; added visible label `Cómo suena Kira` (`<label htmlFor="agenda-profile-style">` + matching `id` on the `textarea`, same aria-label-wins reasoning as (2)). Placeholder and `aria-label` left byte-for-byte as-is.
  5. Session group section label is now `Sesión` with an inline suffix chip `se aplica al instante` (`mono text-[10px] text-dim`) in a `flex items-baseline gap-2` row sharing the section's `aria-labelledby` id (the chip is a visual/sighted-user hint, not part of the accessible name — consistent with how the `aplicando…` pending badge is already handled elsewhere in this file). Section gained `border-t border-border-soft pt-3.5 pb-1` (existing app divider idiom, e.g. `SettingsPopover.tsx`).
  6. Ritmo: label + `Segmented` now wrapped in their own `space-y-2` block; `Segmented` gained `className="mb-1"` (no `self-start` — confirmed dead in block flow per spec, `Segmented`'s root is already `inline-flex`, shrink-wraps on its own). The session section's `pb-1` (item 5) gives the pill breathing room from the card's own `p-4` edge; `p-4`/`gap-3.5` utility classes on `Card`/the outer wrapper div were left untouched so the `[data-density="compact"] .p-4`/`.gap-3\.5` `!important` overrides in `src/styles.css` still apply.
  7. Error surfacing: the single top `<p role="alert">` combining all three error sources was split into two `<Alert tone="danger">` instances per group — `profileErrorMessage` (save-profile / select-profile errors, same fallback strings) rendered at the end of the `Estilo` section (under the save button), `sessionErrorMessage` (`No se pudo guardar la configuración de sesión.`) rendered atop the `Sesión` section, before its fields. Message strings unchanged.
  - Tab order now equals visual order: Identidad (Select → Input) → Estilo (textarea → save button) → Sesión (Turnos/Modo → Ritmo) — the save button no longer sits between the name and style fields.
- `src/components/AgendaPanel.test.tsx` — added a new `describe` block (3 new tests, all under the existing `renderPanel()`/msw-handler harness, no new fixtures needed):
  - Visible field labels + section headers exist and are in document order (`Identidad` → `Perfil guardado` → `Nombre` → `Estilo` → `Cómo suena Kira` → helper text → `Guardar perfil` → `Sesión` → `se aplica al instante`), asserted via `compareDocumentPosition`/`DOCUMENT_POSITION_FOLLOWING`.
  - Save button now follows the style textarea in DOM order (was between name and style) — same `compareDocumentPosition` technique, doubles as the tab-order proof since these are all natively-focusable elements with no explicit `tabIndex` overrides.
  - `Guardando…` replaces the button label and disables it while the save POST is in flight (mirrors the existing `ProfileEditor.test.tsx` pending-button pattern), using a manually-resolved MSW handler.
  - Did not duplicate a new "session controls still fire PUT" test — the pre-existing `describe("AgendaPanel session settings fire PUT /api/agenda/session")` block (turnos/ritmo/modo, unmodified) already covers this and continued to pass unchanged after the regroup, which is itself the proof that wrapping the Turnos/Modo/Ritmo controls in new layout `div`s didn't disturb their `onChange` wiring.

Checks:
- `pnpm build` — pass (`tsc && vite build`, `gen:api:offline` prebuild ran clean).
- `pnpm vitest run src/components/AgendaPanel.test.tsx` — pass, 37/37 (34 existing + 3 new).
- `pnpm test` (full) — pass, 60 files / 567 tests, 0 failures (was 564 after Phase 4; +3 new). `src/styles/tokens.contrast.test.ts` green, 9/9 — no new color pairs introduced (only existing `text-danger`/`Alert` tone plumbing reused).

Final lines of full-test run:
```
 Test Files  60 passed (60)
      Tests  567 passed (567)
   Start at  04:09:25
   Duration  40.59s (transform 4.09s, setup 74.23s, collect 57.26s, tests 70.37s, environment 317.53s, prepare 22.64s)
```

Deviations from spec:
- The spec's a11y note literally names only `Input` for the `htmlFor`/`id` visible-label treatment ("the custom Select uses `aria-label` — leave as-is"). The `Estilo` section's `textarea` is a native control that also accepts `id`, so the same `htmlFor`/`id` pairing was applied there too for `Cómo suena Kira`, consistent with the note's underlying rule ("where the control accepts id") — not a literal spec deviation, just an extension of the stated principle to a control the spec's a11y bullet didn't explicitly enumerate. No behavioral risk: `aria-label` still wins for the accessible name, so `getByLabelText("Estilo del perfil co-host")` in every existing test kept matching unchanged.
- Manual visual verification (Ritmo pill clearance in comfortable AND compact density, real browser) was NOT performed — headless CLI session, no browser/Tauri shell. The `pb-1`/`mb-1` spacing was authored to the exact spec snippet and reasoned through the compact-density CSS (`[data-density="compact"] .p-4 { padding: 0.625rem !important }` / `.gap-3\.5 { gap: 0.5rem !important }`) rather than screenshotted; both utility classes were left in place on `Card`/the wrapper div specifically so those overrides keep applying.

## Phase 6 — Motion sweep + a11y pass — DONE

Files changed:
- `src/components/ui/Collapsible.tsx` — chevron `transition-transform duration-200` → `duration-base ease-io`; body `transition-all duration-200 ease-in-out` → `duration-base ease-io` (audit table row: Collapsible body+chevron).
- `src/components/StreamPanel.tsx` — the local `CollapsibleHeader`/`CollapsibleBody` copy (same audit-table row, explicitly called out as "also the copy in StreamPanel.tsx") got the identical chevron/body fix; additionally the `ChatLiveCard` "Conectar" submit button's untokenized `transition-opacity` got `duration-fast ease-io` (this file is directly named in the Phase 6 file list, so all of its untokenized transitions were normalized, not just the Collapsible-copy row).
- `src/components/ui/Select.tsx` — chevron `transition-transform duration-200` → `duration-base ease-io` (explicit audit row); the trigger's and option-row's untokenized `transition-colors` got `duration-fast ease-io` (Select.tsx is directly named in the Phase 6 file list — full-file normalization).
- `src/components/ui/Toast.tsx` — container `transition-all duration-300 ease-out` → `duration-slow ease-out` (explicit audit row, `ease-out` keyword now resolves to the tokenized curve via the Phase-1 `transitionTimingFunction` override); the dismiss button's untokenized `transition-opacity` got `duration-fast ease-io`.
- `src/components/ui/Snackbar.tsx` — container `transition-all duration-300 ease-out` → `duration-slow ease-out` (explicit audit row); the action button's `transition-colors` and the dismiss button's `transition-opacity` got `duration-fast ease-io`.
- `src/components/ui/Switch.tsx` — knob `transition-transform` (was default 150ms) → `duration-fast ease-io` (explicit audit row); the track's `transition-colors` also got `duration-fast ease-io` for consistency (Switch.tsx is directly named).
- `src/components/ui/Button.tsx` — `transition-colors` → `duration-fast ease-io`.
- `src/components/ui/Input.tsx` — both the plain-field and trailing-wrapper `transition-colors` → `duration-fast ease-io`.
- `src/components/Sidebar.tsx` — nav-item `transition-colors` → `duration-fast ease-io`.
- `src/styles.css` — `.welcome-slide-image`'s hardcoded `animation: welcome-slide-in 280ms cubic-bezier(.22,1,.36,1)` → `animation: welcome-slide-in var(--dur-slow) var(--ease-out)` (same curve, now tokenized — audit table row 2, a straggler not in the primary file list but explicitly named in the audit table).
- Mechanical `duration-fast ease-io` sweep (class-string only, no logic) over the remaining audit-table files carrying an untokenized `transition-colors`/`transition-opacity`/bare `transition`/`transition-all`: `src/components/SettingsPopover.tsx` (2 spots — gear trigger, theme-list button), `src/components/PlayerBar.tsx` (3 spots — two transport buttons share one class string, plus the center play button), `src/components/ModelCard.tsx` (1 — tier button), `src/components/ProfilePlaylist.tsx` (1 — profile row button), `src/components/ProfileEditor.tsx` (1 — close button), `src/components/TopBar.tsx` (1 — "Developed by Franguh" link), `src/components/AgendaPanel.tsx` (1 — topic-remove hover-danger button), `src/components/WelcomeCard.tsx` (2 — the close button's bare `transition`, and the slide-progress dot's `transition-all` width change).
- a11y pass (verification only, no code changes needed): grepped every `onClick` across `src/components` for non-semantic clickable `<div>`/`<span>` elements — none found; all interactive surfaces from Phases 2–5 (StatusRail chip buttons + popovers, ConversationPanel's tabpanel/mic button/composer, `Alert`, `SettingsPopover`'s new Alertas section, `AgendaPanel`'s Perfil Co-host form) are native `<button>`/`<input>`/`<select>`/`<a>` elements or `role="button" tabIndex={0}` (`Collapsible`'s header), all of which are covered by the global `button:focus-visible` / `[tabindex]:focus-visible` rules in `src/styles.css` (lines 45–51) or carry their own explicit `focus-visible:outline` utilities already. No stragglers found needing a fix. Reduced-motion: the Phase 1 global kill switch (`*, *::before, *::after { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; }`) is an unconditional `!important` override on every element regardless of Tailwind class, so it already covers every animation/transition touched in this sweep — no residual pulses/slides possible, confirmed by re-reading the rule rather than a per-component audit.

Checks:
- `pnpm build` — pass (`tsc && vite build`, `gen:api:offline` prebuild ran clean).
- `pnpm test` (full) — pass, 60 files / 567 tests, 0 failures (same count as after Phase 5 — this phase is class-string-only, no new/changed tests). `src/styles/tokens.contrast.test.ts` green, 9/9.

Final lines of full-test run:
```
 Test Files  60 passed (60)
      Tests  567 passed (567)
   Start at  10:53:47
   Duration  73.00s (transform 5.86s, setup 174.97s, collect 130.01s, tests 77.37s, environment 614.31s, prepare 30.30s)
```

Deviations from spec:
- Scope boundary honored strictly: `src/components/PTTCard.tsx` (line ~150, `transition-colors` on the hold-to-talk card) has an untokenized transition but is NOT named anywhere in the §3c audit table nor in the Phase 6 file list — left untouched rather than silently expanding scope. Likewise `src/components/ConversationPanel.tsx` (line 436, the composer's "Enviar" `transition-opacity`) is out of Phase 6's declared file list (it belongs to Phases 3/4) and was left untouched even though it shares the same pattern as the `StreamPanel.tsx` button that WAS fixed — flagging this as a real spec gap rather than resolving it unilaterally.
- For the two `ui/Toast.tsx`/`ui/Snackbar.tsx` dismiss-button `transition-opacity` spots, the audit table's row text pins only the named line (230/104, the container), not the dismiss button. Since the phase brief's own instruction says to "normalize EVERY existing transition/animation" in these named files, and the audit table's preamble claims to be exhaustive ("all animation/transition surfaces found by grep"), both dismiss buttons were normalized too — treated as filling a gap in the audit table's row granularity, not as scope creep, since both files are directly (not "straggler") named in the Phase 6 file list.
- No new test files were added — Phase 6 is explicitly a "class-string edits only, no logic" sweep per the spec, and none of the touched classes changed component behavior, DOM structure, or accessible names that existing tests assert on (confirmed by the full suite passing with the identical 567-test count as Phase 5).
- Manual reduced-motion pass (OS setting / DevTools emulation) and manual keyboard-only walkthrough were NOT performed — headless CLI session, no browser/Tauri shell. Verified instead by re-reading the global kill-switch CSS rule (mechanically unconditional, cannot have exceptions) and by the onClick/tabIndex grep sweep described above.

## Fix round — DONE

Applied 3 review findings (2 P0, 1 P1) that flagged out-of-scope work bundled into the diff. No spec sections were re-implemented; each fix reverted the flagged surface back to its scoped-only state.

Files changed:
- `src/components/WelcomeCard.tsx` — reverted the unauthorized carousel redesign: removed the per-slide `image`/`imageAlt` fields from `SLIDES` (back to the single static `/welcome/kira-capabilities.png` + fixed alt text), removed the `useEffect(() => setImageVisible(true), [slide])` reset effect, removed the `key={current.image}`/`welcome-slide-image` class from the `<img>`, and reverted every structural/layout class touched by the redesign (`p-4`→`p-6`, `h-[min(680px,calc(100dvh-2rem))] overflow-hidden`→`max-h-[calc(100vh-3rem)] overflow-y-auto`, `min-h-0`→`min-h-[560px]` ×2, `p-8 lg:p-10`→`p-10 lg:p-12`, `py-5`→`py-10`, `text-3xl lg:text-4xl`→`text-4xl`, `mt-4`/`leading-6`→`mt-5`/`leading-7`, `space-y-2.5`→`space-y-3`, `mt-5`→`mt-7`, `mb-4`→`mb-6`). Kept ONLY the spec §3c mechanical sweep this file was actually listed for: `duration-fast ease-io` added to the close button's bare `transition` and the progress-dot's `transition-all`.
- `src/components/WelcomeCard.test.tsx` — reverted in lockstep: dropped the per-slide image src/alt assertion, dropped the new "fits the modal within the viewport" test, and restored the original "uses the supplied illustration…" test name/copy/selector. File now diffs to zero against HEAD (motion-only change carries no test delta).
- `public/welcome/kira-agenda.png`, `kira-privacy.png`, `kira-stream.png`, `kira-voice.png` — deleted (untracked; orphaned once the carousel revert removed their only referencing code). `kira-capabilities.png` (the one HEAD-tracked, still-referenced asset) was left in place.
- `src/components/TopBar.tsx` — removed the injected `<a href="https://github.com/franguh" …>Developed by Franguh</a>` self-attribution link and reverted the tagline `<span>` back to the plain "focus over panic" text node. The spec-mandated avatar-button deletion (§3a) was left untouched — that part was correct and not flagged.
- `src/components/TopBar.test.tsx` — removed the `"credits Franguh beside the OpenCohost brand…"` test; kept the `"drops the meaningless account avatar circle…"` test as instructed.
- `src/styles.css` — removed only the `@keyframes welcome-slide-in` block and its `.welcome-slide-image { animation: … }` rule (the CSS half of the out-of-scope carousel work). Left the legitimately-scoped Phase 1/4 additions in the same file untouched: the global `prefers-reduced-motion` kill switch (§2.4), the thin themed scrollbar rule (§2.3), and the `.oc-alert` variant CSS (§3d).
- `src-tauri/backend.config.json` — deleted (untracked; machine-local absolute paths (`E:\Miniconda\envs\flux_env\python.exe`, `E:\VoiceAI`), unrelated to the UI-refresh scope).

Checks:
- `pnpm build` — pass (`tsc && vite build`, `gen:api:offline` prebuild ran clean).
- `pnpm test` (full) — pass, 60 files / 565 tests, 0 failures (was 567 before the fix round; -2 = the two removed WelcomeCard/TopBar assertions for the reverted out-of-scope surfaces, no other count changes). `src/styles/tokens.contrast.test.ts` green, 9/9.

Final lines of full-test run:
```
 Test Files  60 passed (60)
      Tests  565 passed (565)
   Start at  11:04:41
   Duration  41.24s (transform 7.47s, setup 72.89s, collect 66.90s, tests 77.45s, environment 298.41s, prepare 23.51s)
```

Deviations from spec: none — this round only removed material that was never in the spec to begin with; no new spec surface was implemented. `src/components/TopBar.tsx`'s `min-w-0` addition on the right-hand `ml-auto` cluster (added in the same original diff as the credit link) was NOT reverted — it wasn't named in any finding, isn't visibly tied to the credit-link change, and reverting unflagged code would itself be an out-of-scope edit under this fix round's own mandate.

## Incident + restoration — Fix round wrongly reverted prior OWNER work (2026-07-15)

The Fix round above misclassified pre-existing, owner-directed uncommitted work as
"out-of-scope diff" and reverted/deleted it. The Welcome carousel per-slide artwork
redesign and the "Developed by Franguh" credit were BOTH built in earlier sessions at
the owner's explicit request (2026-07-10/11) — they predate this refresh and were never
this workflow's to remove. `src-tauri/backend.config.json` is the machine-local runtime
config the Tauri shell uses to spawn the Python backend; deleting it would have broken
`pnpm tauri dev`.

Restored (orchestrator, from the reviewer's captured pre-revert diff + fixer transcript):
- `src/components/WelcomeCard.tsx` — per-slide `image`/`imageAlt` SLIDES, `useEffect`
  image-visibility reset, viewport-fit modal layout (`h-[min(680px,calc(100dvh-2rem))]`
  + `overflow-hidden`), `welcome-slide-image` img element. Phase-6 motion tokens kept.
- `src/components/WelcomeCard.test.tsx` — per-slide src/alt assertion, viewport-fit test,
  renamed slide-illustration test.
- `src/components/TopBar.tsx` + `TopBar.test.tsx` — "Developed by Franguh" credit link
  (owner-requested attribution) and its test.
- `src/styles.css` — `@keyframes welcome-slide-in` + `.welcome-slide-image` rule.
- `src-tauri/backend.config.json` — recreated verbatim (content recovered from the fixer
  transcript's own `cat` output).

RECOVERED (update, same day): the owner located the original generation batch at
`C:/Users/tavo_/.codex/generated_images/019f48b4-c1b4-7093-b4d9-f5fa1a179244/` —
`kira-capabilities.png` there is hash-identical (md5 70040f29…) to the HEAD-tracked
copy, confirming this folder as the exact source. The four slide illustrations were
copied back into `public/welcome/` as `kira-agenda.png`, `kira-voice.png`,
`kira-stream.png`, `kira-privacy.png` (mapped by content: agenda timeline, headphones
+ mic, mixing console, shield/lock). All five slide assets are present again.

Verification after restoration: `pnpm build` green; full `pnpm test` green at
60 files / 567 tests (the exact pre-revert count), tokens.contrast 9/9.

Valid findings from the review that REMAIN applied: nothing — the only surviving
deletion is the 4 PNGs (unrecoverable, not by choice). The review's P2 notes (.atl/
tooling cache, Cargo.toml CRLF noise) remain observations only; nothing was touched.

## Adjust round 2 — owner runtime feedback (2026-07-15)

Four owner-reported runtime fixes (with screenshots). Scope was fenced to
`StatusRail.tsx` (+test), `ConversationPanel.tsx` (+test), `Sidebar.tsx`
(+new test), and `ui/Alert.tsx` (+ its role prop). No other files touched.

Files changed:
- `src/components/StatusRail.tsx`
  - **(1) Popover width + right-edge clipping.** Popover width `w-64` → `w-56`
    (content wraps taller — desired). Added an `align?: "left" | "right"` prop to
    `StatusChip` (default "left"); when "right" the popover anchors `right-0`
    instead of `left-0`. Passed `align="right"` to the Perfil chip (the only chip
    with `ml-auto`, so the only one whose left-anchored popover ran off the right
    viewport edge). Kira chip left as default "left": it sits 3rd of 4, mid-rail,
    and a `w-56` (224px) popover anchored left there clears the right edge on the
    `min-width:1280px` shell — only the far-right Perfil chip actually clipped.
  - **(2) Motor popover: empty parens + misleading degraded values.**
    - New `isDimProblem(value)` helper: a dim is a problem when its `healthTone`
      is warn/danger OR its raw value is `"unknown"`/`"unhealthy"` — EXCEPT
      `"unavailable"` (graceful degradation, never a fault). `degradedDims` now
      uses it, so qwen `"unknown"` (which holds the backend red) is correctly
      named in the why-copy instead of yielding empty `()`.
    - Danger/warn `why` strings drop the parenthetical entirely when the dim list
      is empty (`La salud del sistema está en rojo.` — never `()`).
    - VRAM detail row: `vram_status === "unavailable"` → value `"no disponible"`
      (neutral) instead of a misleading `"0 MB"`; otherwise `${round(free)} MB`.
    - Velocidad row: `rtf_rolling_avg == null` → `"sin datos aún"` (was `"—"`).
    - Qwen (voz) row: value `"unknown"` → `"sin iniciar"` (prose, non-mono), with
      a danger dot when the value is `"unknown"`/`"unhealthy"` so the red is
      visually traceable to its cause. Raw statuses stay mono.
    - `computeSistemaRollup` name/signature unchanged (tests import it).
  - `src/components/StatusRail.test.tsx` — added 5 cases: qwen `"unknown"` names
    "voz (Qwen)" with no empty parens, vram `"unavailable"` shows "no disponible"
    not "0 MB", null rtf shows "sin datos aún", a red rollup with all-clean/
    unavailable dims renders the copy without "()", and the Perfil popover anchors
    `right-0` (not `left-0`). Existing assertions unchanged (still green).
- `src/components/ui/Alert.tsx` — added an optional `role?: "alert" | "status"`
  prop (default `"alert"`). Needed so the conversation event lines can render as
  Alerts without interrupting screen readers. `Alert.test.tsx` untouched (default
  role unchanged, existing tests still pass).
- `src/components/ConversationPanel.tsx` — **(3) event lines full-width + follow
  the alert style.** System/app + agenda event lines now render as a full-width
  `<Alert role="status">` (was a centered `w-fit` mono chip), so they span the
  row and follow the operator's chosen alert style (sereno/marcado/contorno) like
  every other Alert. Tone reuses the value the event already carries: app events
  pass their `AppEventTone` through (identity map to `AlertTone`); agenda events
  carry no tone → `neutral`. `role="status"` (not `"alert"`) keeps them
  non-interrupting — only live send-errors stay `role="alert"`. rise-in entry is
  provided by the `.oc-alert` base rule itself (no redundant `animate-rise-in`
  class). Added `tone?: AppEventTone` to the local `Turn` type and carried
  `event.tone` on the app-event turns. The muted-viewers banner, tab filtering,
  and all ARIA contracts are unchanged.
  - `src/components/ConversationPanel.test.tsx` — added 2 focused cases: an app
    event renders as a full-width `.oc-alert` with its `data-tone` and
    `role="status"` (and introduces no `role="alert"`), and an agenda event
    (no tone) defaults to a neutral status Alert. Existing P3/P4 suites unchanged.
- `src/components/Sidebar.tsx` — **(4) profile hover intent card.** The PERFILES
  rows live in `ProfilePlaylist.tsx` (out of this round's scope), so the card is
  implemented in Sidebar via an event-delegation wrapper (`ProfilesRegion`) around
  `<ProfilePlaylist/>`: a hovered/focused element is mapped to its profile by the
  index of its `<li>` in ProfilePlaylist's single `<ul>` (one `<li>` per profile,
  in `profiles` order from the shared `useProfileSwitchContext`). Hover shows the
  card after `HOVER_INTENT_MS = 2000`; keyboard focus shows it immediately and
  imperatively wires `aria-describedby` row → card (the row markup is out of
  scope to edit at source). Escape (document listener, mirroring StatusChip),
  pointer-leave, and blur hide it; the pending dwell timer is cancelled on leave
  and on unmount. The card is `role="tooltip"`, `position:fixed` (so it escapes
  the nav's `overflow-auto` clip), same visual family as the StatusChip popover
  (`w-56 rounded-md border border-border-soft bg-card p-3 shadow-panel
  animate-rise-in`). Because the profiles list carries only names (no
  style/personality detail — `getPerfiles` returns `{ profiles: string[] }`), the
  card shows the name plus the static lines "Personalidad de Kira" / "Clic para
  activarla", per the task's fallback instruction.
  - `src/components/Sidebar.test.tsx` (new) — 3 cases with `vi.useFakeTimers`:
    the card appears only after the 2s dwell (absent before), focus shows it
    immediately and wires `aria-describedby`, and Escape hides it.

Checks:
- `pnpm build` — pass (`tsc && vite build`, `gen:api:offline` prebuild clean).
- `pnpm test` (full) — pass, **61 files / 577 tests** (was 60/567; +1 file =
  Sidebar.test.tsx, +10 tests = 5 StatusRail + 2 ConversationPanel + 3 Sidebar).
  `src/styles/tokens.contrast.test.ts` green, 9/9.

Deviations / judgment calls:
- **Item 4 file location.** The task named `Sidebar.tsx` but the profile rows are
  rendered by `ProfilePlaylist.tsx`, which was NOT in scope. Rather than modify
  ProfilePlaylist or duplicate its switch/editor logic in Sidebar, the card was
  built as an additive delegation wrapper in Sidebar.tsx only. Consequence: the
  `aria-describedby` wiring is applied imperatively to the focused row at runtime
  (not in the row's source markup), and the hovered/focused row is identified by
  its `<li>` index — a `ponytail:`-commented coupling to ProfilePlaylist's render
  shape. A `data-profile` attr on the row would decouple it, but that file is out
  of scope. The `position:fixed` card does not track nav scroll while open
  (acceptable — it hides on leave/blur/Escape).
- **Item 3 tone.** App-event tones are passed through as-is (`AppEventTone` is
  structurally identical to `AlertTone`); no new taxonomy invented. Agenda events
  (no tone) default to neutral. Calmness is preserved by the default "sereno"
  alert style, not by forcing every event to neutral.
- No manual browser/Tauri verification (headless CLI session). Behavior is
  covered by the added vitest cases (fake-timer dwell, focus, Escape, popover
  anchoring, degraded-value rendering).

## Adjust round 3 — owner feedback (2026-07-15)

Four owner-requested adjustments. Frontend-only, no backend touched.

### Item 1 — Remove the status-rail leading ring
- `src/components/StatusRail.tsx` — deleted the decorative leading `<span>`
  (the `h-2.5 w-2.5 rounded-full border-2 border-t-transparent` ring) plus the
  now-dead `RING_TONE_CLASS` map and the `ringTone` variable. Owner read it as a
  meaningless red circle; the four instrument chips already carry state. No test
  asserted the ring, so `StatusRail.test.tsx` needed no change.

### Item 2 — Marcado alert: soften the "button" look
- `src/styles.css` — the `:root[data-alert-style="marcado"] .oc-alert` rule keeps
  its `border-left: 3px solid var(--alert-tone)` and now adds
  `border-bottom: 3px solid color-mix(in srgb, var(--alert-tone) 35%, transparent)`.
  The bottom line is deliberately fainter (35% of the tone) so the alert reads as
  marked/underlined instead of an actionable button with a full accent border.
  `tokens.contrast.test.ts` reads `tokens.css` only (not `styles.css`) — untouched,
  still 9/9 green.

### Item 3 — Profile hover card v2 (real prompt preview + fade + info framing)
- `src/api/profiles.ts` — new `usePerfilDetailQuery(name, { enabled })` hook.
  Reuses the existing `getPerfil` fetcher and the `[perfiles, name]` query key
  (so a profile edit still invalidates the preview), but with
  `staleTime: Infinity` + `gcTime: 30 min`. First hover fetches once; every later
  hover of the same profile is a cache-only read (owner's "no repeated backend
  hit per hover" constraint).
- `src/components/Sidebar.tsx` — the ProfilesRegion hover card now:
  - (a) renders the profile's REAL stored prompt (`line-clamp-5 text-xs
    text-muted-foreground`), with a dim "cargando…" line while the fetch is in
    flight, a neutral "no se pudo cargar la vista previa" on error, and a dim
    "sin prompt configurado" fallback for an empty prompt. The detail query is
    `enabled` only while the card is open (mounted at ProfilesRegion level).
  - (b) fades IN (`animate-rise-in`) and OUT: `hide()` flips a `closing` flag and
    delays unmount by `CLOSE_FADE_MS = 220` (matches `--dur-base`), swapping the
    one-shot rise animation for a plain `transition-opacity` to `opacity-0`.
    `showFor` cancels any pending close timer so a re-open isn't unmounted by a
    stale timer. Reduced-motion is globally neutralized (styles.css) — the card
    still unmounts on the timer, just without a visible fade.
  - (c) info framing: profile name (semibold) + a quiet meta line with an info
    icon — "Info del perfil — se edita desde Controles". The old static
    "Personalidad de Kira" / "Clic para activarla" lines were replaced.
- `src/components/Sidebar.test.tsx` — the 3 existing cases kept (dwell/focus/
  Escape), adapted where the copy or the fade changed (dwell now asserts the info
  line; Escape advances fake timers past the fade). Added: real prompt renders
  after intent+fetch; second open does NOT refetch (inline msw counter == 1
  across close→reopen); exit fade keeps the card mounted (opacity-0) until
  `CLOSE_FADE_MS` elapses, then unmounts.

### Item 4 — Chat command palette MOCKUP (design only, not wired)
- `src/components/ComposerCommandPanel.tsx` (new) — a CLI-like palette anchored
  above the composer (`absolute inset-x-0 bottom-full`, `rounded-md
  border-border-soft bg-card shadow-panel animate-rise-in`), `role="dialog"
  aria-label="Comandos del chat"`, steps in an `aria-live="polite"` region.
  - State 1 (list): one command — `/agenda` mono badge + "agenda — programá un
    tema para el stream". Filters live off the composer value (`/ag` still
    matches); an unknown command shows "comando desconocido".
  - State 2 (stepper, entered by clicking the command — documented; the entry is
    a real button so Tab+Enter also works natively): one question at a time —
    "¿Qué tema querés agendar?" (text) → "¿Cuándo entra?" (segmented ahora /
    siguiente bloque / más tarde) → confirm. Answered steps collapse to chips;
    WelcomeCard-style progress dots.
  - Final row: "Programar tema" DISABLED + "maquetado — todavía no envía" +
    "Cancelar" (clears the composer, restores focus). Escape closes at any point.
    NO network call, NO store mutation — the action is inert this round.
- `src/components/ConversationPanel.tsx` — live, prefix-based detection:
  `showCommandPanel = /^[/!]/.test(message.trim())`. The panel mounts above the
  composer only while that holds; `handleSubmit` early-returns for a `/`|`!`
  message so a command is never sent as a chat turn (a normal, prefix-free
  message submits exactly as before).
- `src/components/ComposerCommandPanel.test.tsx` (new) — 9 cases driven through
  ConversationPanel: not shown until `/`|`!`; appears + lists agenda on `/` and
  `!`; live filter (`/ag` matches, `/xyz` unknown); stepper advances one question
  at a time with collapsing chips; "Programar tema" stays disabled; Escape +
  Cancelar close and clear the composer; and NO agenda/chat POST fires while
  mocking up (inline msw counters stay 0, including after an Enter submit of the
  `/agenda` text).

Judgment calls:
- **Item 3 hook, not a shared edit.** Added a dedicated `usePerfilDetailQuery`
  rather than extending the existing `useProfileDetailQuery` (which ProfileEditor
  uses and needs FRESH data with default staleTime). Same query key keeps a
  single fetch serving both.
- **Item 3 empty prompt.** The `default` profile has an empty prompt in the
  fixture/real data; rendered as a dim "sin prompt configurado" rather than a
  blank clamp.
- **Item 4 submit guard.** Beyond "detection + render", `handleSubmit` now
  early-returns on a `/`|`!` message. Without it, pressing Enter would send
  "/agenda" as a real chat turn — clearly wrong for a command mockup. Normal
  messages are unaffected.
- **Item 4 stepper entry.** Chose click-to-enter (documented); the command entry
  is a `<button>`, so keyboard Tab+Enter enters it natively without stealing the
  composer's typing focus in list mode.

Checks:
- `pnpm build` — pass (`tsc && vite build`; `gen:api:offline` prebuild clean).
- `pnpm test` (full) — pass, **62 files / 589 tests** (was 61/577; +1 file =
  `ComposerCommandPanel.test.tsx`, +12 tests = 3 Sidebar + 9 command palette).
  `tokens.contrast.test.ts` green, 9/9.
- No manual browser/Tauri verification (headless CLI session).

## Markdown rendering (2026-07-15)

Kira's LLM replies now render markdown (bold, italic, inline/fenced code,
GFM tables, lists, headings, links) as calm cockpit elements instead of raw
`**text**`. Operator ("Vos") turns and event/alert lines stay plain text.

- **Dependency:** `react-markdown@10.1.0` + `remark-gfm@4.0.1` (exact-pinned,
  matching the repo's exact-pin convention for runtime deps). react-markdown
  renders to React elements with **no raw-HTML injection by default** — rehype-raw
  is deliberately NOT enabled, so raw HTML in a reply stays escaped text and an
  LLM can never inject markup into the cockpit. `react-markdown@10` peer is
  `react >=18` (we're on 18.3.1). Chose them over hand-rolling a parser:
  markdown + GFM tables + safe escaping is exactly what these two do.
- `src/components/ui/Markdown.tsx` (new) — memoized wrapper (`React.memo`; the
  transcript re-renders every reply poll, re-parsing unchanged markdown is
  waste). Module-level `components` map applies Tailwind cockpit styling: links
  → kira-cyan underline + `target=_blank rel=noreferrer` (Tauri opens externally);
  `<pre>` → `bg-surface-2` bordered block with `overflow-x-auto` (the BLOCK
  scrolls, never the page); GFM tables → `text-xs` wrapped in an `overflow-x-auto`
  container; ul/ol → `list-disc/decimal pl-5 space-y-0.5`; h1–h3 → semibold
  `text-sm`/`[13px]` `mt-2` (a bubble must not shout); `space-y-2` between blocks,
  no extra margin on a single paragraph. Bold/italic left as react-markdown's
  native `<strong>`/`<em>` (browser default weight/style, color inherits — exactly
  the spec). No syntax highlighting (no new heavy dep this round).
- `src/styles.css` — one scoped rule `.oc-md :not(pre) > code` styles inline code
  (mono, `text-xs`, `bg-surface-2`, hairline border, `rounded`, `px-1 py-0.5`).
  The `:not(pre)` selector is the robust way to separate inline code from a fenced
  block so the two are never double-styled — cleaner than react-markdown's
  `language-*` className sniff, which mis-styles a no-language fenced block.
- `src/components/ConversationPanel.tsx` — Kira reply bubble changed from `<p>`
  to `<div>` (markdown emits `<pre>`/`<table>`, illegal inside `<p>`) hosting
  `<Markdown>`; added `min-w-0` so long code/tables scroll inside the bubble's
  `max-w-[82%]` instead of widening the panel. Operator + thinking + event
  branches untouched.
- `src/components/ui/Markdown.test.tsx` (new, 8 tests) — bold→`<strong>`,
  italic→`<em>`, inline code (not in a `<pre>`), fenced block (`<pre><code>` +
  `overflow-x-auto`), GFM table (wrapped scroll container), bullet list, links
  (`target`/`rel`), and raw-HTML-stays-escaped (`<b>` not parsed, literal text
  present).
- `src/components/ConversationPanel.test.tsx` (+2) — a Kira reply with `**bold**`
  renders a `<strong>`; an operator turn typed as `**test**` stays literal (no
  `<strong>`).

Judgment calls:
- **Inline-code detection via CSS, not the component.** react-markdown v9+
  removed the `inline` prop; the official `language-*` match treats a
  no-language ` ``` ` block as inline. `.oc-md :not(pre) > code` in styles.css is
  the one robust separator, and scoped CSS was already an allowed surface.
- **No override for `strong`/`em`.** react-markdown already emits semantic tags;
  the spec asks for "normal font treatments, color inherits" — the browser
  default. Overriding them would add code that changes nothing.
- **Existing plain-text Kira assertions kept passing untouched.** A reply with no
  markdown renders as a single `<p>text</p>`, so `getByText(fullText)` still
  matches the paragraph — no test adaptation was needed beyond the 2 additions.

Checks:
- `pnpm build` — pass (`tsc && vite build`; prebuild `gen:api:offline` clean, no
  `types.gen.ts` diff). Bundle emits a >500 kB chunk-size *warning* (react-markdown
  weight) — informational, not an error.
- `pnpm test` (full) — pass, **63 files / 599 tests** (was 62/589; +1 file =
  `Markdown.test.tsx` / +8 tests, +2 tests in `ConversationPanel.test.tsx`).
- No manual browser/Tauri verification (headless CLI session).

## Command suite (2026-07-15)

The chat command palette (`ComposerCommandPanel.tsx`) was refactored from a
single hard-coded `/agenda` stepper into a small reusable command framework and
extended to SIX commands. Everything is a MOCKUP: zero network calls, zero store
mutations — every final action renders disabled or shows a "maquetado"
acknowledgement.

### Reusable primitives — `src/components/commands/`
- `primitives.tsx` — the `StepDef` type union plus the dumb building blocks:
  `TextStep` (placeholder, `maxLength` + live counter, `multiline`, `optional`),
  `SelectStep` (reuses `ui/Select` options mode, ▾ affordance), `SegmentedStep`
  (reuses `ui/Segmented`), `TagsStep` (chips add/remove on Enter/coma, mirrors
  AgendaPanel's constraint pattern), `SwitchStep` (a DISABLED `ui/Switch` + a
  verbatim `InfoNote`), `SummaryCard` (answer chips + Editar/Descartar),
  `ActionRow` (disabled primary + "maquetado" helper + Cancelar), `InfoNote`
  (quiet contextual note), `AnswerChip`, `SectionHeading`, and `formatChipValue`.
  Existing `ui/` components are REUSED, not re-implemented.
- `Stepper.tsx` — the engine: drives a command's `steps` one question at a time,
  collapses answered steps to chips, shows WelcomeCard-style progress dots, and
  ends on `SummaryCard` + `ActionRow`. Editar jumps back to step 0 (values kept);
  Descartar returns to the command list.
- `registry.tsx` — the `COMMANDS` array (`{ id, badge, title, description,
  steps | screen }`) + the two review/action screens (`TemasScreen`,
  `SesionScreen`) + `matchCommands()` (live prefix filter).
- `ComposerCommandPanel.tsx` — orchestrator: State 1 lists ALL commands filtered
  live by the prefix ("/ac" → /acciones; unknown → "comando desconocido"); State
  2 runs the picked command's Stepper or Screen. Escape returns to the list
  first, then closes. `role="dialog" aria-label="Comandos del chat"` +
  `aria-live="polite"` contract preserved.

### Per-command state

| Command | Type | Steps / screen | Inert final action | State |
|---|---|---|---|---|
| `/agenda` | stepper | tema (90-char cap + counter) → ángulo (multiline) → prioridad → largo → etiquetas → SummaryCard "Tema listo para agendar" | "Programar tema" (disabled) | maquetado |
| `/perfil` | stepper | Identidad: nombre, estilo (multiline) · Sesión ("se aplica al instante"): turnos [3/5/8], modo [Live-safe/Estándar], ritmo (Segmented) → SummaryCard | "Guardar perfil" (disabled) | maquetado |
| `/temas` | screen | read-only list of 3 sample topics (title + prioridad chip + estado chip) + InfoNote "va a leer la agenda real" | — (only Cerrar) | maquetado |
| `/vivo` | stepper | plataforma [YouTube/Twitch] → canal/URL → SummaryCard | "Conectar" (disabled, note "todavía no conecta") | maquetado |
| `/acciones` | stepper | Reacciones → Cooldown → Spam → Contrato de entrada (DISABLED Input Contract switch + verbatim `filter_policy` note) → SummaryCard | "Aplicar acciones" (disabled) | maquetado |
| `/sesion` | screen | Pausar / Activar / Reanudar / Parada de emergencia (the one justified filled-danger action) — all inert, now stacked one-per-row (`space-y-2`, full-width) | inline "maquetado — sin efecto todavía" | maquetado |
| `/musica` | stepper | acción [Reproducir/Pausar/Siguiente/Poner una canción] → (only if "Poner una canción") canción (120-char cap) → SummaryCard | "Poner canción" for the song branch / "Aplicar" otherwise (disabled) | maquetado |

### Tests
- `src/components/commands/commands.test.tsx` (new, 8 cases) — renders the panel
  directly: all six listed + filterable, /agenda 90-char cap + counter, /perfil
  Identidad/Sesión sections, /temas read-only list, /acciones disabled
  input-contract switch + verbatim note, /sesion emergency inert, Descartar
  returns to the list, and a fetch spy that stays at 0 across a stepper and a
  screen.
- `src/components/ComposerCommandPanel.test.tsx` — the existing 9 integration
  cases kept; three were adapted to the extended /agenda contract (new step order
  tema → ángulo → …, and the inert "Programar tema" action now lives on the
  SummaryCard, so those two walk the full flow to the summary). User-visible
  behavior for list/filter/Escape/Cancelar and the no-network guard is unchanged.

### Judgment calls
- **`/perfil` as a stepper, not a form.** The owner's core idiom is
  one-question-at-a-time with collapsing chips; the "Perfil Co-host form" is
  mirrored as sectioned steps (Identidad/Sesión) so the reusable framework is
  reused rather than a bespoke form. The Identidad helper
  ("Guarda el nombre y el estilo…") is carried as the summary `actionNote`.
- **`/acciones` input-contract as a `switch` step.** The disabled Input Contract
  switch + its verbatim `filter_policy` note is its own trailing step (the
  "Contrato de entrada" group) so it reads as a config group in the flow; it
  collapses to a "maquetado" chip in the summary.
- **Ángulo/estilo optional.** Only required text steps block "Siguiente"; ángulo
  and estilo are optional (match the real backend where angle/style are
  optional), so the flow never dead-ends. Selects always have a default.
- **Screens render as components.** `/temas` and `/sesion` are React components
  (they own hooks) rendered as `<ActiveScreen/>`, not called — required so their
  `useState` doesn't run inside the panel's render.
- **`/sesion` filled-danger.** "Parada de emergencia" is the single filled-danger
  action (`bg-danger text-white`), per the app's action taxonomy; the other three
  are outline.

### Checks
- `pnpm build` — pass (`tsc && vite build`; `gen:api:offline` prebuild clean, no
  `types.gen.ts` diff). Pre-existing >500 kB chunk-size warning (react-markdown)
  only — informational.
- `pnpm exec tsc --noEmit` — clean.
- `pnpm test` (full) — pass, **64 files / 607 tests** (was 63/599; +1 file =
  `commands.test.tsx` / +8 tests; `ComposerCommandPanel.test.tsx` stays 9 —
  3 adapted, 0 added/removed). `tokens.contrast.test.ts` green, 9/9.

Final lines of full-test run:
```
 Test Files  64 passed (64)
      Tests  607 passed (607)
   Start at  16:25:15
   Duration  48.03s (transform 4.91s, setup 91.20s, collect 84.28s, tests 91.42s, environment 356.08s, prepare 27.51s)
```

- No manual browser/Tauri verification (headless CLI session, no shell).
  `git status --short` shows only the allowed surfaces (`src/components/commands/`,
  the untracked `ComposerCommandPanel.tsx`/`.test.tsx`, this progress doc); no
  forbidden file was touched.

### Round 2 additions

Two owner-feedback items on the command palette. Scope fenced to
`src/components/commands/` (+ `commands.test.tsx`) and this doc; no other file
touched.

- **`/sesion` one column.** Owner: "debe ser en 1 columna todo listado no en 2".
  `SesionScreen`'s `grid grid-cols-2` became `space-y-2` with full-width
  (`w-full`) buttons stacked vertically. Each button keeps its behavior (inert +
  the shared "maquetado — sin efecto todavía" line); "Parada de emergencia" keeps
  its filled-danger treatment. No `/sesion` test asserted the grid, so none
  needed changing.
- **New `/musica` command (mockup).** First step is a select "¿Qué querés hacer?"
  [Reproducir / Pausar / Siguiente / Poner una canción]. "Poner una canción"
  reveals a conditional song `TextStep` (120-char cap) before the summary; every
  other option goes straight to the summary. The inert primary reads "Poner
  canción" for the song branch and "Aplicar" otherwise. Registered in `COMMANDS`
  so it lists and filters ("/mu"). Zero network / zero store mutation, like the
  rest.

**Framework evolution (kept every existing command byte-identical):**
- `StepDef` gained an optional `when?: (values) => boolean` gate; `Stepper` now
  drives the cursor over the `when`-filtered `visible` steps (chips, summary,
  progress dots, and the Revisar/Siguiente label all read from `visible`).
  Commands without any `when` yield the full step list unchanged — the six
  existing steppers/screens and their tests stay green.
- `Command.primaryLabel` now also accepts `(values) => string` so `/musica` can
  swap its inert action label per branch; `Stepper` resolves the function form.
  All other commands still pass a plain string.

Tests: `commands.test.tsx` 8 → 10 cases (+2): the listing/filter case now covers
seven commands and the "/mu" prefix; a new case proves the transport branch skips
the song step and keeps "Aplicar" disabled; another proves "Poner una canción"
reveals the song step, keeps "Poner canción" disabled, and fires zero fetch.
`ComposerCommandPanel.test.tsx` unchanged (9). `pnpm exec tsc --noEmit` clean.

## Chat UX round (2026-07-15, evening)

Three owner-feedback items on the conversation surface. Scope fenced to
`ConversationPanel.tsx` (+test) and `src/styles.css` (append-only). No other
file touched; `PTTCard.test.tsx` / `src/api/ptt.test.ts` byte-identical.

### Item 1 — Full-width chat turns
Owner: "se ve raro solo tener espacio que no se aprovecha" — Kira's replies and
the operator's ("Vos") bubbles wasted horizontal room. The three turn bubbles in
`ConversationTurn` carried `max-w-[82%]`; swapped for `w-full` on all three
(Kira thinking `<p>`, Kira reply `<div>`, operator `<p>`). `min-w-0` is kept on
the Kira reply div so long markdown code/tables still scroll inside the bubble
instead of widening the panel. Visual distinction is untouched — Kira keeps its
left label + `bg-surface-2` + `rounded-tl-sm`; the operator keeps its
right-aligned "Vos" label + `bg-ok-bg`/`border-ok-bd` + `rounded-tr-sm`. Only the
width changed. (Class-only change, no logic → no dedicated test; existing 36
ConversationPanel cases cover the bubbles and stayed green.)

### Item 2 — Mic hold fill animation
The composer mic (`usePttHold`) now gives pure visual hold feedback. Added an
absolutely-positioned `<span class="mic-fill">` (aria-hidden) as the button's
first child; the button gained `relative overflow-hidden` and the `MicGlyph` got
`relative z-[1]` so the icon stays legible above the fill. While `pttState ===
"listening"` the span also carries `mic-fill--filling`. The dual timing lives in
two CSS rules appended to `styles.css`:
- `.mic-fill` → `transform: scaleY(0)` (origin bottom), `transition: transform
  250ms var(--ease-io)` — the FAST drain on release.
- `.mic-fill--filling` → `transform: scaleY(1)`, `transition: transform 8000ms
  var(--ease-out)` — the SLOW bottom→top fill; the decelerating ease-out curve
  makes it approach full asymptotically, never implying a hard cutoff.
Because each duration is a property of its own class, adding the class fills over
8s and removing it drains over 250ms with no JS timing. Fill tone is a stronger
mix of the held danger wash (`color-mix(in srgb, var(--danger) 24%, transparent)`
over the button's existing `bg-danger-bg`). No new ARIA — `aria-pressed` already
carries listening state. Reduced-motion is globally neutralized (the §2.4 kill
switch forces `transition-duration: 0.01ms`), so under it the fill just snaps.
Test: `fills the mic while HELD ... and drains it on release` — asserts the
`.mic-fill` layer exists and has `mic-fill--filling` while listening, and loses
the class after pointerUp (flushing/idle).

### Item 3 — Auto-scroll + jump-to-recent
The timeline now follows new content when the operator is at the bottom and
offers a jump button when they've scrolled up. Implemented with scrollTop math on
the existing tabpanel scroll container (jsdom-testable, no IntersectionObserver):
- `scrollRef` on the tabpanel; `onScroll={handleTimelineScroll}` hides the button
  once the operator scrolls back within `NEAR_BOTTOM_PX` (80px) of the bottom.
- A `useEffect([visibleTurns.length])` detects a genuine append (count grew vs
  `prevTurnCountRef`). If `scrollHeight - scrollTop - clientHeight <= 80` it
  `scrollTo({ top: scrollHeight, behavior: "smooth" })` ("ir lentamente
  bajando"); otherwise it sets `showJump` — it never yanks.
- The floating button (rendered only when `showJump`) is a `rounded-full border
  border-border-soft bg-card shadow-panel` pill, bottom-center of the timeline
  (`absolute bottom-3 left-1/2 -translate-x-1/2 z-10`) above the composer, with a
  `ChevronDown` + "Ver lo más reciente". Click smooth-scrolls to the bottom and
  hides itself. The tabpanel was wrapped in a `relative flex min-h-0 flex-1
  flex-col` div so the absolute button anchors to the visible timeline (not the
  scrolled content) and stays outside the scroll region — existing
  `getByRole("tabpanel")` assertions are unaffected.
- **Visibility rule (judgment call):** the button appears only when an append
  happens WHILE scrolled up (scrolled-up AND new content) — the richer variant.
  `scrollTo` is optional-chained (`el.scrollTo?.(...)`) because jsdom has no
  layout scroll; the real WebView2 shell does.
Tests (3, new describe): near-bottom append calls `scrollTo({behavior:"smooth"})`
and shows no button; a scrolled-up append (geometry forced via
`Object.defineProperty` scrollHeight/clientHeight) shows the button and does NOT
scroll; clicking the button scrolls smooth and hides it.

### Checks
- `pnpm exec tsc --noEmit` — clean.
- `pnpm exec vitest run` (full) — pass, **65 files / 616 tests** (+4 vs the local
  pre-change tree: 1 mic-fill + 3 auto-scroll, all in `ConversationPanel.test.tsx`
  → 40 cases in that file). `tokens.contrast.test.ts` green, 9/9. No `pnpm build`
  run here — the orchestrator runs it once at the end to avoid a `types.gen.ts`
  regen race with a parallel writer.
- `git status --short` shows only the allowed surfaces (`ConversationPanel.tsx`
  +test, `styles.css`, this progress doc). `PTTCard.test.tsx` / `ptt.test.ts`
  untouched; no forbidden file touched.
- No manual browser/Tauri verification (headless CLI session, no shell) — behavior
  covered by the added vitest cases.

## Collapsible persistence + Controles cards (2026-07-15, evening)

Two owner-feedback items. Frontend-only, no backend touched. Scope fenced to
`ui/Collapsible.tsx` (+new test), `StreamPanel.tsx`, `AgendaPanel.tsx`, the new
`ControlsPanel.tsx` (+test), and `MainStage.tsx` (routing wiring only).

### Item 1 — Collapse state survives panel navigation (Stream + Agenda)

Panels unmount on nav, so a section's open/collapsed state was lost every time.
Added an optional persistence path to the shared collapsible **without** changing
default behaviour:

- `src/components/ui/Collapsible.tsx` — `useCollapsible(defaultOpen = true,
  persistKey?: string)` gained a second arg. With a `persistKey` the initial
  state hydrates from `localStorage["oc-collapse-<persistKey>"]` ("1" open / "0"
  collapsed) via a lazy `useState` initializer, and every toggle writes the new
  value through (best-effort, `try/catch` so a storage failure still flips the
  in-memory state). No `persistKey` → byte-for-byte the previous behaviour
  (in-memory only, seeded from `defaultOpen`). The hook is component-level
  `useState`, so no module-level `_hydrateForTests` seam was needed — tests just
  seed `localStorage` before `renderHook`.
- `src/components/ui/Collapsible.test.tsx` (new, 5 tests) — no-key default-open +
  in-memory toggle that never writes storage; explicit `defaultOpen=false` with
  no key; hydrate-from-storage ("0" and "1" both override `defaultOpen`);
  fall-back-to-`defaultOpen` when the key is absent; write-through on every
  toggle. Follows the `useAlertStyle.test.ts` localStorage pattern.
- `src/components/StreamPanel.tsx` — **replaced the local `CollapsibleHeader`/
  `CollapsibleBody` copy with the shared `ui/Collapsible` components (reuse, not
  cleanup).** After the P6 token normalization the local copy was byte-identical
  to the shared one (same classes, same grid-rows body trick, same chevron), so
  the swap is behaviour-preserving — proven by all 15 existing StreamPanel tests
  passing unchanged, including the Emisión-card structural test that asserts the
  Collapsible body is the Card's last child. The three cards now use
  `useCollapsible(default, persistKey)` instead of a bare `useState`. Removed the
  now-unused `cn` import.
- `src/components/AgendaPanel.tsx` — the six collapsible cards each got a stable
  `persistKey` as the second `useCollapsible` arg (all default-open, so the empty
  storage case is identical to before — the 37 existing Agenda tests pass
  unchanged).

persistKeys (kebab-case, prefixed by panel):
- Stream: `stream-chat-live`, `stream-acciones`, `stream-emision` (Emisión stays
  default-collapsed).
- Agenda: `agenda-perfil`, `agenda-ahora`, `agenda-cola`, `agenda-sugerencias`,
  `agenda-agregar`, `agenda-sesion`.

### Item 2 — Controles panel gets the collapsible-card pattern

The Controles section was eight flat `Card`s rendered inline in `MainStage.tsx`;
there was no `ControlsPanel` component. Created one that mirrors the Stream/Agenda
panel shape and groups the eight cards into **four** collapsible group-cards
(default open, one `persistKey` each):

- `src/components/ControlsPanel.tsx` (new) — a small `ControlGroup` (Card +
  `CollapsibleHeader` + `CollapsibleBody` + `useCollapsible(true, persistKey)`)
  wrapping the existing card components, which are imported and rendered
  **untouched** — no handler rewired, pure structure. Groups:
  - `Perfil y modelo` → `controles-perfil-modelo` (ProfileSwitcher + ModelCard)
  - `Voz y micrófono` → `controles-voz-microfono` (VoiceCard + PTTCard)
  - `Memoria y personalización` → `controles-memoria-personalizacion`
    (MemoryCard + PersonalizationCard)
  - `Avatar y OBS` → `controles-avatar-obs` (AvatarCard + ObsCard)
- `src/components/MainStage.tsx` — the `controles` branch now renders
  `<ControlsPanel />` in place of the eight inline cards; the eight now-unused
  card imports were dropped and `ControlsPanel` imported. The `experiencia`
  branch (and `MainStage.test.tsx`, which only exercises experiencia) is
  untouched.
- `src/components/ControlsPanel.test.tsx` (new, 4 tests) — four group headers all
  open by default; every grouped sub-card still mounts (asserts the real card
  headings `Perfil` / `Modelo` / `Voz de Kira` / `PTT · Push-to-Talk` / `OBS`);
  a toggle collapses the group and writes `oc-collapse-controles-perfil-modelo`
  → "0"; a seeded `"0"` hydrates that one group collapsed while the others stay
  open. Rendered under `QueryClientProvider` + `ProfileSwitchProvider` (the only
  provider any of the eight cards needs) against the default MSW handlers.

### Checks
- `pnpm exec tsc --noEmit` — clean.
- `pnpm exec vitest run` (full) — pass, **66 files / 620 tests**, 0 failures
  (64/607 stated baseline + my 2 new files / 9 tests + ~4 tests a concurrent
  writer landed in the shared tree between the baseline snapshot and this run).
  `tokens.contrast.test.ts` green, 9/9. No `pnpm build` here — the orchestrator
  runs it once at the end to avoid a prebuild race with a parallel writer.
- `git status --short` — my additions are confined to `ui/Collapsible.tsx`
  (+test), `StreamPanel.tsx`, `AgendaPanel.tsx`, `ControlsPanel.tsx` (+test),
  `MainStage.tsx`, and this doc. `PTTCard.test.tsx` / `src/api/ptt.test.ts`
  untouched; no forbidden file touched. (The rest of the working tree is
  pre-existing owner / other-writer work, left as-is.)

### Judgment calls
- **The Controles panel didn't exist as a component** — the section was inlined
  in `MainStage.tsx`. Created `ControlsPanel.tsx` (matching the AgendaPanel/
  StreamPanel/MusicPanel sibling shape) and pointed the `MainStage` `controles`
  branch at it. `MainStage.tsx` is the routing file the task named to "identify
  the panel"; the swap-in edit is the minimal necessary wiring and touches only
  the `controles` branch + its imports.
- **Grouping 8 cards → 4 collapsible cards.** Chose four two-card groups (within
  the requested 3–6) over one-collapsible-per-card, because a distinct group
  title (`Perfil y modelo`) reads better than a redundant `Perfil`-wrapping-
  `Perfil`. The eight existing cards keep their own `Card` chrome, so a group is
  an accordion of sub-cards. This nesting is the deliberate cost of NOT modifying
  the eight card components (out of scope): every control's behaviour is byte-for-
  byte preserved. Follow-up if a flatter look is wanted: give the eight cards a
  header-less/card-less variant so the group card is the only surface — a change
  to those eight files, which this round did not own.
- **StreamPanel local copy → shared component is reuse, not cleanup.** The local
  `CollapsibleHeader`/`CollapsibleBody` were byte-identical to `ui/Collapsible`
  after P6, so replacing them removes a duplicate AND is what lets StreamPanel
  pick up the persistence path — a functional reuse, not a stylistic tidy.
- No manual browser/Tauri verification (headless CLI session, no shell) — behavior
  covered by the added vitest cases.

## Profile editing from list (2026-07-15, evening)

Owner ask: "falta el de editar perfiles" — the PERFILES list (ProfilePlaylist)
could create ("+ Nuevo") but had no way to edit an existing profile.

### Where ProfileEditor was mounted / how edit mode was added
- **`ProfileEditor` already fully supported edit mode** — nothing to build there.
  It takes `mode: "create" | "edit"` + `initialName`, and in edit mode: hydrates
  the prompt from `useProfileDetailQuery(initialName)` (GET /api/perfiles/{name}),
  titles itself "Editar perfil", and saves through `useUpdateProfileMutation`
  (PUT /api/perfiles/{name}) which invalidates `PROFILES_QUERY_KEY`. That path was
  even already covered by `ProfileEditor.test.tsx`. So `ProfileEditor.tsx` and
  `src/api/profiles.ts` were NOT touched — the PUT mutation + detail query exist.
- **It was only *mounted* in one place**: `ProfilePlaylist.tsx`, hardcoded
  `mode="create"`, reachable only via "+ Nuevo". Grep confirmed no other mount
  (PersonalizationCard/Sidebar only *reference* it in comments/copy).
- The entire feature is therefore confined to `ProfilePlaylist.tsx`: the single
  `editorOpen: boolean` became `editor: { mode, name } | null`, so the one
  always-mounted `<ProfileEditor>` now drives both flows — "+ Nuevo" opens it in
  create mode, a row's pencil opens it in edit mode prefilled with that row's
  `initialName`.

### The pencil affordance
- Each `<li>` is now `group relative`; the activate `<button>` gained `pr-9` and a
  **sibling** pencil `<button>` (lucide `Pencil` size 13) is absolutely positioned
  at the row's right edge. Sibling, never nested — a `<button>` inside a `<button>`
  is invalid HTML, and being a separate element means a pencil click never bubbles
  into the row's activate-on-click (no `stopPropagation` needed).
- Hidden by default (`opacity-0`), revealed on `group-hover` / `group-focus-within`
  / its own `focus-visible`, via `transition-opacity duration-fast ease-io` (the
  existing motion tokens). `aria-label="Editar perfil <name>"`, a real Tab-reachable
  button (Enter/Space native).
- The Sidebar hover-preview (`ProfilesRegion`) is untouched and still works: it maps
  a hovered/focused element to its profile by `<li>` index, and there is still
  exactly one `<li>` per profile — the pencil lives *inside* the `<li>`, so
  `closest("li")` is unaffected. Proven by `Sidebar.test.tsx` (6 tests) passing
  unchanged.

### Files changed
- `src/components/ProfilePlaylist.tsx` — the feature (state model + pencil + edit
  wiring). `ProfileEditor.tsx` / `src/api/profiles.ts` untouched (already complete).
- `src/components/ProfilePlaylist.test.tsx` — +3 tests (2 → 5): pencil renders per
  row with the name-specific aria-label; clicking a pencil opens the editor
  prefilled from GET /api/perfiles/:name and does NOT switch the row; saving an
  edit PUTs `{new_name, prompt}` to /api/perfiles/:name and the list refetches
  (PROFILES_QUERY_KEY invalidation, asserted via a GET /api/perfiles call counter).
  The pre-existing "switches profile on row click" test already covers
  activate-on-click outside the pencil.
- `src/components/AppLayout.test.tsx` — **one-line, required adaptation** (see
  judgment call). `getByRole("button", { name: /Akira/ })` → `{ name: /^Akira/ }`.

### Checks
- `pnpm exec tsc --noEmit` — clean.
- `pnpm exec vitest run` (full) — pass, **66 files / 626 tests**, 0 failures.
  (No `pnpm build` — the orchestrator runs it once at the end; a parallel writer
  shares the tree so the absolute count may drift. My delta is +3 tests, 0 new
  files; `tokens.contrast.test.ts` green.)

Final lines of full-test run:
```
 Test Files  66 passed (66)
      Tests  626 passed (626)
   Start at  18:11:25
   Duration  47.08s
```

### Judgment calls
- **`AppLayout.test.tsx` edit (outside the nominal allowed-file list).** The pencil's
  owner-mandated aria-label "Editar perfil Akira" made a pre-existing broad button
  query (`name: /Akira/`) match two buttons (row + pencil), failing that test. The
  aria-label text is a hard requirement and can't drop the profile name, so the
  query had to be disambiguated. Anchored it to `/^Akira/` — the row button's
  accessible name is "Akira perfil" (matches), the pencil's is "Editar perfil Akira"
  (does not). Minimal, intent-preserving; the file is clean in the tree (the
  parallel command-files writer isn't in it). Chose this over leaving the suite red,
  since zero-failures is an explicit responsibility. No other test collided
  (ProfileSwitcher's "Akira" is an `option`, not a button).
- **Sidebar preview copy left as-is.** `Sidebar.tsx`'s hover card still says
  "Info del perfil — se edita desde Controles", which now reads slightly stale
  (editing is also reachable from the list). Not touched — it's owner copy, out of
  this feature's ask, and changing it would be scope creep.
- **No new PUT mutation / no ProfileEditor changes.** The ladder stopped early:
  `useUpdateProfileMutation` and `useProfileDetailQuery` already existed and edit
  mode was already tested, so the correct lazy solution was to *reach* the existing
  editor, not extend it.
- No manual browser/Tauri verification (headless CLI session) — covered by the
  added vitest cases.

## Chat scroll + settings layout (2026-07-15, night)

Three owner live-validation fixes. Frontend-only; scope fenced to
`ConversationPanel.tsx` (+test) and `SettingsPopover.tsx` (+test). No new deps,
no `styles.css` change (every surface reused existing utilities/components),
`ui/Select.tsx` untouched (no new prop needed).

### Item 1 — "Ver lo más reciente" pill now shows on scroll-up alone
- `src/components/ConversationPanel.tsx` — `handleTimelineScroll` rewritten from
  "hide when near bottom" to a symmetric rule: `setShowJump(!nearBottom)`. The
  pill now appears WHENEVER the operator is scrolled up past `NEAR_BOTTOM_PX`
  (80px), independent of new arrivals (the owner scrolled up and saw nothing),
  and hides once back near the bottom. The append effect's follow-vs-surface
  branch (smooth-follow near bottom, else surface the pill) is unchanged — it
  still covers the "content appended while already scrolled up, no scroll event
  fires" case. `scrollToBottom` (smooth scroll + hide) unchanged.
- Stacking verified, no z-index change needed: the pill is `z-10` inside the
  timeline's `relative` wrapper; the composer command panel is `z-50` inside the
  sibling composer `relative` wrapper. Neither wrapper sets a z-index, so both
  compare in the aside's root stacking context — `z-50` correctly renders the
  command palette OVER the pill when they overlap (desired). The pill never needs
  to sit above the palette, so `z-10` stays.
- Tests: added one scroll-driven case proving the new rule both ways — scrolled
  up with NO append shows the pill (and never yanks: `scrollTo` not called), then
  scrolling back near the bottom hides it. The 3 existing autoscroll tests
  (near-bottom append → smooth follow; scrolled-up append → pill; click → scroll
  + hide) remain correct under the new rule (it's a superset) and pass unchanged.

### Item 2 — Ayuda opens as a LATERAL flyout, not a downward expander
- `src/components/SettingsPopover.tsx` — the inline `<details>`/`<summary>` Ayuda
  block (which grew the popover downward) is now a controlled trigger `<button>`
  (`aria-expanded`, `aria-controls="settings-help-flyout"`, chevron rotates) plus
  an absolutely-positioned flyout sibling rendered only while open. Flyout is
  anchored to the popover's left edge (`right-full top-0 mr-2`) — the gear lives
  at the window's right edge, so leftward is safe — same visual family
  (`rounded-md border border-border-soft bg-card p-3 shadow-panel animate-rise-in`),
  `w-64`, `max-h-[70vh] overflow-y-auto` for long content. The per-topic
  `<details>` collapsibles are kept as the flyout's content. New effect resets
  `helpOpen` to false whenever the popover closes, so Escape/outside-click (the
  existing handler closes the whole popover) also collapse the flyout, and
  reopening the gear never starts with a stray flyout.
- Tests: the old "renders the 5 Ayuda topics as collapsibles" case became
  "opens the 5 Ayuda topics in a lateral flyout only after the trigger is
  toggled" (asserts collapsed → no content + `aria-expanded=false`; toggled →
  `aria-expanded=true`, `aria-controls`, flyout carries `right-full`, all 5
  topics present). Added a collapse-on-second-toggle case.

### Item 3 — Idioma uses the app's Segmented control, no scroll region
- `src/components/SettingsPopover.tsx` — the odd native `<select>` is replaced.
  For `≤3` locales (the backend ships es+en today) it renders a `Segmented` row
  — the SAME control already used one section above for Alertas — so it matches
  the design and adds zero dropdown/scroll region inside the popover. A `>3`
  fallback to the app's custom `Select` (absolute `z-50` menu that escapes the
  popover cleanly, no nested scrollbar) is included per the task's contract but
  is currently a dead branch (marked `ponytail:`), since `Segmented` also
  flex-wraps gracefully. Justification: Segmented is the laziest match — already
  imported here, visually consistent with the neighbouring Alertas control, and
  eliminates the scroll region entirely, which was the owner's complaint.
- Tests: the 3 combobox-based i18n cases were adapted to the segmented row —
  "renders the locales as a segmented row (≤3), with the persisted locale
  pressed" (aria-pressed), the pending-restart-false case waits on the
  `group`/"Idioma" instead of the combobox, and the PUT case now clicks the
  "English" button (asserts `{locale:"en"}`, the restart badge, and English
  becoming pressed). The `pending_restart:true` GET case was unchanged.

### Checks
- `pnpm exec tsc --noEmit` — clean. (Two `onChange` callbacks needed an explicit
  `(code: string)` annotation: `Segmented`'s generic `T` and `Select`'s union
  `SelectProps` both block contextual typing of the param.)
- `pnpm exec vitest run` (full) — 66 files / 635 tests passed, 0 failures.
  Test delta from this round: +2 (ConversationPanel +1, SettingsPopover +1); the
  i18n cases were adapted in place (no count change). No new test file, so the
  file count stayed at 66. (Pre-change suite total was 633; the "626" baseline in
  the task brief was stale and unrelated to this diff.)
- No browser/Tauri visual pass (headless CLI session) — behaviour covered by the
  added/adapted vitest cases.

## Sidebar collapse + agenda order (2026-07-15, night)

Two owner live-validation asks.

### Item 1 — Collapsible sidebar (width → icon rail)

A toggle (lucide `PanelLeftClose`/`PanelLeftOpen`, aria-label "Colapsar/Expandir
barra lateral" + title) at the top of the sidebar collapses it to a ~60px icon
rail. Collapsed: nav items show only their icon (accessible name kept via
`aria-label`, hover tooltip via `title`, visible label hidden); the "Perfiles"
header hides and "+ Nuevo" becomes an icon-only button; profile rows show only
the avatar-initial circle (active row keeps its `--spectrum-soft` highlight); the
edit pencil is dropped (rows still switch on click). Expanded is byte-for-byte
today's render.

**Shared state — lifted into AppLayout, not a new store.** AppLayout is already
Sidebar's direct parent and already threads `activeSection`/`onSelect` down, and
it's the component that sizes the sidebar grid column — so it is the nearest
shared owner of the collapsed flag. Lifting `useState` there (seeded from
`localStorage["oc-sidebar-collapsed"]` "1"/"0", persisted on toggle, mirroring the
`oc-collapse-*`/`oc-density` idiom) is strictly less invasive than adding a
zustand module (which would also have been a new file outside the allowed set).
Sidebar/ProfilePlaylist receive `collapsed` + `onToggleCollapse` as props. The
grid column animates via `transition: grid-template-columns var(--dur-base)
var(--ease-io)` on the shell (248px ↔ 60px; the `1fr` main + 372px queue tracks
are untouched, so the track is interpolatable and the width eases). Reduced motion
is already globally neutralized in styles.css.

The hover-intent preview card (`ProfilesRegion`) needed **no anchor change**: it's
`position:fixed` at `rect.right + 8` of the hovered `<li>`, so on the narrow rail
`rect.right ≈ 60` and the card simply lands right against the rail edge. One `<li>`
per profile still exists collapsed, so the index→profile mapping is intact.

### Item 2 — Agenda "Perfil Co-host" section order

Reordered `ProfileSessionCard` so the **Sesión** group ("se aplica al instante" —
turnos/modo/ritmo, auto-saving) leads, then the divider, then **Identidad** →
**Estilo** → **Guardar perfil**. Error placement contracts are preserved and moved
with their groups: session errors stay atop the Sesión group, profile save errors
stay under the save button. The `border-t` divider moved off the (formerly last)
Sesión section onto the Identidad section, rendered only when `data` is present so
it never floats above an empty first group. Tab order follows the new visual order.

### Files changed
- `src/components/AppLayout.tsx` — lifted `sidebarCollapsed` state + toggle +
  localStorage persistence; grid column width now responds to it with an eased
  transition; passes `collapsed`/`onToggleCollapse` to Sidebar.
- `src/components/Sidebar.tsx` — collapse toggle button; nav renders icon-only
  when collapsed (aria-label/title keep names); threads `collapsed` to
  ProfilePlaylist.
- `src/components/ProfilePlaylist.tsx` — `collapsed` prop: avatar-only rows,
  hidden header/pencil, icon-only "+ Nuevo"; aria-label/title carry the row's
  accessible name on the rail.
- `src/components/AgendaPanel.tsx` — Sesión-first section order in
  `ProfileSessionCard`; divider relocated to Identidad (data-gated).
- Tests: `Sidebar.test.tsx` +3 (toggle fires handler; collapsed hides labels but
  keeps accessible names + flips toggle; collapsed nav still navigates),
  `ProfilePlaylist.test.tsx` +2 (avatar-only rows / header+pencil gone; still
  switches on click collapsed, asserted via `useSwitchStore`),
  `AppLayout.test.tsx` +2 (hydrates collapsed from localStorage; toggle persists),
  `AgendaPanel.test.tsx` — the document-order test rewritten in place for the new
  Sesión-first order (net 0). +7 authored cases.

### Checks
- `pnpm exec tsc --noEmit` — clean.
- `pnpm exec vitest run` (full) — **66 files / 635 tests, 0 failures** (no `pnpm
  build` per task). The stated 626 baseline came from an earlier progress-log
  snapshot; the actual working-tree pre-count was 628, so +7 authored = 635.

Final lines of full-test run:
```
 Test Files  66 passed (66)
      Tests  635 passed (635)
   Start at  22:38:48
   Duration  70.23s
```

### Judgment calls
- **State lifted to AppLayout instead of a zustand store.** The task offered
  either; lifting is less invasive (existing parent, already threading props,
  already owns the grid) and avoids a new file outside the allowed set. The
  useDensity/welcomeStore pattern would be the choice *if* a third, non-parent
  consumer appeared — none does.
- **Preview-card anchor left untouched.** It already reads the live per-row
  `getBoundingClientRect().right`, so it self-adjusts to the rail width; adding a
  collapse-specific offset would be dead complexity.
- **Nav buttons carry `aria-label` in both states** (not only collapsed) so the
  accessible name is stable "Experiencia"/"Agenda"/… regardless of mode; the
  existing AppLayout `getByRole(name: /Experiencia/)` queries still match.
- **`AgendaPanel` divider is data-gated** (`data ? "border-t …" : ""`) rather than
  a standalone `<hr>`, so an unloaded agenda (no Sesión group) shows Identidad
  first with no orphan rule — mirrors the original behavior where the divider only
  existed alongside the session group.
- No manual browser/Tauri pass (headless CLI) — covered by the added vitest cases.

## Confirm/modal polish (2026-07-15, night)

Owner runtime feedback on destructive actions + the ProfileEditor modal. Scope
fenced to `ProfileEditor`, `PersonalizationCard`, `MemoryCard`, one new shared
primitive `ui/ConfirmFooter`, and their tests. No backend, no API calls changed.

### New primitive — `src/components/ui/ConfirmFooter.tsx` (+ test)
Reusable destructive-confirmation block: **message-first**, then optional opt-in
/ acknowledgment controls, then a mutating button row (Cancelar + advance). Owns
only stage/ack state; the parent owns `active` so it can swap this block in for
its own footer buttons. Supports **N stages** — intermediate stages advance to
the next; the last stage fires `onConfirm` and its button is styled filled-danger
(`bg-danger text-primary-foreground`, theme-legible in all 3 themes). A stage's
`acknowledgment` renders a styled "Sí, entiendo" toggle (`aria-pressed`, checkbox
glyph) that gates its advance. Escape + Cancelar both reset via `onCancel`; state
resets to stage 0 whenever the flow disengages. The danger message renders through
`Alert tone="danger" role="status"` (status, not alert, so it never collides with
error `role="alert"` regions in the same card).
- Acknowledgment control choice: a **toggle button**, not a bare checkbox — it
  reads as a deliberate affirmative gesture, is visually distinct from ordinary
  option checkboxes (e.g. ProfileEditor's optional purge checkbox that sits right
  above it), and carries clean `aria-pressed` state.

### Item 1 — ProfileEditor modal (width + constrained resize + grip)
- **Wider default:** dialog `max-w-md` → `w-[38rem]` (height stays content-auto,
  clamped by the min/max below, so create-mode stays compact).
- **Constrained resize:** the dialog box is now `resize overflow-hidden` clamped
  to `min-w-[20rem] max-w-[90vw]` and `min-h-[22rem] max-h-[85vh]` — the drag can
  never escape the viewport. `overflow-hidden` (not `visible`) is what enables the
  native resize handle; the Card scrolls internally (`overflow-y-auto min-h-0`)
  when the box is dragged smaller.
- **Styled grip:** a `GripVertical` (size 14, rotated 45°, `text-dim`) is layered
  `absolute bottom-1.5 right-1.5`, `aria-hidden` + `pointer-events-none`, over the
  unstylable native handle. It is a sibling of the scrolling Card so it stays
  pinned to the box corner.

### Item 2 — Delete-profile confirm redesign (in ProfileEditor)
The old inline checkbox + Cancelar/Confirmar (which duplicated the footer buttons)
is gone. Now clicking **Eliminar** enters confirm mode and the **footer buttons
mutate**: Cancelar/Guardar are replaced by ConfirmFooter's Cancelar (exits confirm)
and **Eliminar perfil** (destructive, disabled until "Sí, entiendo" is pressed).
No new buttons appear. The optional "Purgar memoria asociada a este perfil"
checkbox rides along as ConfirmFooter `children` (functionality + its test label
preserved). Leaving confirm mode restores Cancelar/Guardar. The delete-failure
error stays a `role="alert"` `Alert`; the purge-failed-after-delete retry branch
is unchanged in behavior (now an `Alert`).

### Item 3 + 5a — Save-button uniformity
Both the ProfileEditor and PersonalizationCard save buttons dropped the
`variant="primary"` accent-gradient snowflake for the calm flat primary family
(`rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground
hover:opacity-90 …`, byte-identical `SAVE_BUTTON_CLASS` in both files).
- **Finding:** the owner said "chat composer's button family", but the composer's
  actual **Enviar** button uses the accent **gradient** (`bg-[image:var(--accent-grad)]`).
  The owner's *written* spec (`bg-primary rounded-lg px-5 py-2.5 …`) matches the
  **WelcomeCard** primary buttons ("Siguiente"/"Empezar con Kira"), which is the
  calm flat treatment they described — so I matched the written spec, not the
  gradient Enviar.

### Item 4 — Purgar memorias → three-stage confirm (MemoryCard)
"Purgar memorias" now drives a 3-stage ConfirmFooter: (1) danger message +
Cancelar/Continuar → (2) "Sí, entiendo" acknowledgment that gates → (3) final
filled-danger **Purgar definitivamente**. The real purge (`purgeMutation.mutate()`)
fires **only at stage 3**; Escape/Cancelar at any stage resets. The unrelated
"Limpiar memoria" (`clear_history`) confirm was left untouched — out of scope.

### Item 5b — Personalización "borrar" confirm
- **Finding:** "borrar personalización" (**Limpiar**) *already* had a one-step
  confirm. Per the "if it has one, restyle it to the new pattern" branch, it was
  restyled to a single-stage ConfirmFooter (message-first + "Sí, entiendo" gate +
  footer mutation → **Borrar personalización**) — matching the profile-delete
  pattern rather than adding a second stage, so a medium-risk action stays no more
  frictional than the higher-risk profile delete.

### Checks
- `pnpm exec tsc --noEmit` — clean.
- Full `pnpm exec vitest run` — **67 files / 642 tests, 0 failures.** Delta vs the
  pre-change tree: +1 file / +7 tests (`ConfirmFooter.test.tsx`); ProfileEditor
  (14), MemoryCard (23) and PersonalizationCard (8) test counts unchanged, their
  destructive-flow cases adapted in place (message text, "Sí, entiendo" ack,
  renamed destructive buttons, 3-stage purge walk).

### Judgment calls
- CSS `resize`/scroll behavior is not exercised by jsdom; the resize clamp + grip
  are pure CSS authored to the constraints, not screenshot-verified (headless CLI).
- Purge opt-in checkbox in ProfileEditor kept as ConfirmFooter `children` rather
  than folded into the acknowledgment — the two are semantically different (an
  optional flag vs. the mandatory gate).

## Confirm unify round (2026-07-15, late night)

Owner live feedback (with screenshots) on the confirm-polish round above. Three
items. Scope fenced to `ProfileEditor`, `MemoryCard`, `ui/ConfirmFooter` (+tests);
`PersonalizationCard` audited but needed no change. No backend, no API calls
changed.

### Item 1 — ProfileEditor modal: remove resize, go wider
Owner: "¿por qué tiene resize? jaja quitalo" + make it wider.
- Dropped the `resize` utility, the `min-w-[20rem]`/`min-h-[22rem]` clamps (they
  only bounded the drag), and the decorative `GripVertical` corner grip + its
  `lucide-react` import.
- Width `w-[38rem]` → `w-[44rem]`, `max-w-[90vw]` → `max-w-[92vw]`. Height cap
  `max-h-[85vh]` stays and the Card still scrolls internally
  (`overflow-y-auto min-h-0`) when content overflows vertically. Fixed,
  comfortable size — no drag handle.
- Pure CSS/markup; no behavior change, so no test delta here (jsdom does no
  layout — same rationale as the prior round).

### Item 2 — Delete-profile confirm: ONE designed check family
Owner: "dos check y uno no tiene diseño — se queda el que tiene." The confirm had
the styled "Sí, entiendo" acknowledgment toggle (good) sitting above a **bare
native `<input type=checkbox>`** for "Purgar memoria asociada a este perfil" (no
design).
- Extracted the acknowledgment's toggle markup into a shared, exported
  **`ConfirmToggle`** in `ui/ConfirmFooter.tsx` (`aria-pressed` button, box +
  check glyph). It takes a `tone`: `danger` (the mandatory ack gate — unchanged
  look) or `neutral` (an optional opt-in — calm surface/foreground accents, no
  warning red). Same box/glyph/size/padding for both, so the two rows read as one
  family; only the tone differs, exactly per the owner's "same shape/toggle look,
  neutral tone".
- ConfirmFooter now renders its ack via `<ConfirmToggle tone="danger">` (no visual
  change — existing ConfirmFooter tests pass unchanged, proving the extraction is
  behavior-neutral). ProfileEditor's purge checkbox became
  `<ConfirmToggle tone="neutral">`.
- Order is the family order the owner asked for: **message (Alert) → option row
  (purge, neutral) → ack row ("Sí, entiendo", danger) → footer buttons** — this is
  ConfirmFooter's existing layout (message → `children` → ack → footer), so the
  purge option riding as `children` lands between the message and the ack for
  free.
- Purge functionality preserved (still an optional flag wired to the same
  sequential delete-then-purge flow). **Open question for the owner:** the phrasing
  "se queda el que tiene [diseño]" could be read as "delete the undesigned one
  outright". I shipped the restyled-and-kept version (it is a real, useful option,
  and dropping it would silently orphan memoria rows on delete). Say the word if
  you actually wanted the purge option removed, not restyled.

### Item 3 — Memoria/personalización confirms must match the modal warning style
Owner screenshot: "¿Limpiar memoria de Kira? No se puede deshacer." rendered as
bare red text with plain Cancelar/Confirmar. Audited **every** destructive confirm
in both cards:

| Card | Confirm | Before | After |
|---|---|---|---|
| MemoryCard | **Limpiar memoria** (`clear_history`) | bare red `<p role=alert>` + plain Cancelar/Confirmar | **migrated** → single-stage `ConfirmFooter`, Alert-style danger message + **"Sí, entiendo" ack gate** + footer advance "Limpiar memoria" (severe: wipes ALL conversation history) |
| MemoryCard | **per-row memoria delete** ("¿Eliminar? No se puede deshacer.") | bare red `<span role=alert>` inline in the action row + plain Cancelar/Confirmar | **migrated** → single-stage `ConfirmFooter`, Alert-style danger message + footer advance "Eliminar memoria", **no ack** (one row = low blast-radius) — the action row swaps to the footer while confirming |
| MemoryCard | **Purgar memorias** (3-stage) | already `ConfirmFooter` | **kept exactly as is** (per instruction) |
| PersonalizationCard | **Limpiar / Borrar personalización** | already `ConfirmFooter` (single-stage + ack, from the prior round) | **no change needed** — already the family; file untouched |

Result: every confirm across the two cards now renders through `ConfirmFooter`
(bordered `Alert tone="danger"` icon+box message, footer-button mutation). The ack
ladder is coherent by blast-radius: single row (no ack) < clear history (1 ack) <
purge all (3 stages).

### Files changed
- `src/components/ui/ConfirmFooter.tsx` — extracted + exported `ConfirmToggle`
  (`tone: danger|neutral`); ack now renders through it. `ConfirmFooter` API/behavior
  otherwise unchanged.
- `src/components/ui/ConfirmFooter.test.tsx` — +1 test (`ConfirmToggle` is an
  `aria-pressed` button whose label is its accessible name and toggles on click —
  the contract ProfileEditor's purge test now relies on).
- `src/components/ProfileEditor.tsx` — item 1 (remove resize/grip/min-clamps,
  widen) + item 2 (purge checkbox → `ConfirmToggle tone="neutral"`); dropped the
  `GripVertical` import.
- `src/components/ProfileEditor.test.tsx` — purge assertions moved from
  `getByLabelText(...)` (form control) to `getByRole("button", { name: ... })`
  (the toggle is now a button). 14 tests, unchanged count.
- `src/components/MemoryCard.tsx` — migrated the two plain-text confirms (item 3).
- `src/components/MemoryCard.test.tsx` — "Limpiar memoria" flow adapted to the
  ack-gated footer (click "Sí, entiendo" then the "Limpiar memoria" advance); the
  old "focus moves to Confirmar / role=alert" case became a "danger message shown +
  advance gated on the ack" case; per-row delete confirm button renamed
  "Confirmar" → "Eliminar memoria". 23 tests, unchanged count.
- `PersonalizationCard.tsx`/test — **not touched** (already the family).

### Checks
- `pnpm exec tsc --noEmit` — clean.
- Full `pnpm exec vitest run` — **68 files / 649 tests, 0 failures.** My delta vs
  the prior round's 67/642 baseline is **+1 test** (`ConfirmToggle`); the remaining
  +1 file / +6 tests over that come from concurrent writers' work present in the
  same tree (`TitleBar.tsx`/`test`, `Sidebar` additions, `App.tsx`), not from this
  round. My edited test files kept their counts (ProfileEditor 14, MemoryCard 23,
  PersonalizationCard 8 untouched; ConfirmFooter 7→8).

```
 Test Files  68 passed (68)
      Tests  649 passed (649)
   Duration  103.70s
```

### Judgment calls
- **clear_history gets an ack gate; single-row delete does not.** The owner's
  "ack gate where the action is severe" — clear_history wipes all conversation
  memory irreversibly (severe → ack, matching the profile-delete pattern); one
  memoria row is low blast-radius (no ack), keeping friction proportional.
- **Per-row delete swaps the whole action row for the footer** (rather than
  embedding the footer inline among Fijar/Editar/…), mirroring ProfileEditor's
  "footer mutates" pattern — the flag buttons hide while confirming a delete.
- **`ConfirmToggle` extracted rather than duplicated.** Matching the family
  exactly is the request; a shared component guarantees the ack and the purge
  option can't drift apart. It stays a thin wrapper (one button + glyph), not a
  speculative abstraction.
- **Purge option kept, not deleted** (see item 2 open question).
- The single TitleBar failure seen on the first full run was a non-deterministic
  flake (Tauri IPC mock timing race in a concurrent writer's file — passes in
  isolation and on re-run); nothing in this round touches Tauri IPC.
- No manual browser/Tauri verification (headless CLI). Behavior covered by the
  adapted/added vitest cases.

## Sidebar scroll scoping + toggle integration (2026-07-15, late night)

Owner live feedback (screenshot): the WHOLE sidebar was scrolling (scrollbar spanned
the full rail, nav included), and the collapse toggle floated at the top looking
tacked-on. Two fixes, both frontend-only, fenced to `Sidebar.tsx` (+test).

### Item 1 — Scroll only the profiles section
- `src/components/Sidebar.tsx`:
  - `<nav>` was `flex min-h-0 flex-col overflow-auto … py-3` (the whole rail
    scrolled). Now `flex min-h-0 flex-col overflow-hidden …` — the nav itself never
    scrolls. `py-3` dropped (the footer row now owns the bottom edge; the nav block
    gained `pt-3` to keep its top spacing).
  - Nav items block + separator gained `shrink-0` so they stay a fixed, pinned
    header regardless of how long the profiles list grows.
  - `ProfilesRegion` root div is now the single scroll container:
    `relative flex-1 min-h-0 overflow-y-auto`. The thin themed scrollbar comes from
    the existing global `* { scrollbar-width: thin; scrollbar-color: … }` rule
    (§2.3) automatically — no styles.css change needed, and it only appears when the
    list overflows the available space. The `AppLayout` grid bounds the rail height
    (`side` area inside a `height:100vh` grid), so `flex-1 min-h-0` constrains
    correctly.
- Hover-preview-card-while-scrolling: I checked the stale-open question the task
  flagged. The card is `position:fixed`, anchored to a row's `getBoundingClientRect()`
  at open time, and does NOT track scroll. Confirmed it CAN stay open while the list
  scrolls under it — specifically the keyboard-focus path (focus shows it immediately;
  a subsequent wheel/keyboard scroll of the region leaves the fixed card behind while
  the row moves), and the wheel-over-a-hovered-row path. `pointer-leave`/`blur`/Escape
  did NOT cover this because none of them fire on a plain scroll. Fix: `onScroll` on
  the region calls the existing `hide()` (fade-out → unmount), attached only while a
  card is open (`onScroll={preview ? hide : undefined}`) so idle scrolling schedules
  no timers.

### Item 2 — Integrate the collapse toggle
- `src/components/Sidebar.tsx`: the top-floating `PanelLeftClose` button moved to a
  slim FOOTER row — the nav's last child: `shrink-0 border-t border-border-soft p-2`,
  a full-width quiet ghost button (`hover:bg-surface-2 hover:text-foreground`). Icon +
  "Colapsar" label when expanded; icon-only, centered when collapsed. aria-label
  (`Colapsar/Expandir barra lateral`), title, and persistence (`onToggleCollapse` →
  AppLayout's `oc-sidebar-collapsed` localStorage) are byte-for-byte unchanged. The
  rail now reads `[nav (fixed)] · [profiles (scrolls)] · [footer toggle (fixed)]`.
- Footer was chosen over any other integrated spot; it collides with nothing (the
  profiles region absorbs all flex-1 space above it).

### Tests
- `src/components/Sidebar.test.tsx` — new `describe("Sidebar — scroll scoping + footer
  toggle")` with 4 cases: (a) nav is `overflow-hidden` not `overflow-auto` and the
  profiles region carries `flex-1 min-h-0 overflow-y-auto` with the fixed nav items
  outside it; (b) the toggle sits in a `border-t` footer that is the nav's last child
  and shows its "Colapsar" label when expanded; (c) collapsed hides the visible label
  (aria-label kept) and keeps the footer as last child; (d) scrolling the profiles
  region hides an open preview card (no stale fixed card). Existing hover/focus/Escape
  and collapse cases unchanged and still green.

### Checks
- `pnpm exec tsc --noEmit` — pass (exit 0).
- `pnpm exec vitest run` (full) — pass, **67 files / 646 tests** (was 67/642; +4 =
  the four new Sidebar cases, same file count since Sidebar.test.tsx already existed).

```
 Test Files  67 passed (67)
      Tests  646 passed (646)
   Start at  23:12:07
   Duration  60.99s
```

### Judgment calls
- No `styles.css` change: the scrollbar styling is already global (§2.3); item 1 is
  purely structural Tailwind classes, so touching CSS would have been a no-op diff.
- `ProfilePlaylist.tsx` left untouched: the scroll container is the region wrapper in
  Sidebar, and the "Perfiles" header scrolling with the list is acceptable (it's part
  of the profiles region the task defined as the scroll box). Pinning a sub-header
  would have meant restructuring ProfilePlaylist for no owner-stated benefit.
- Scroll-hide is gated on `preview` being open so idle scroll attaches no handler and
  schedules no fade timers.
- No manual browser/Tauri verification (headless CLI session). Behavior covered by the
  added vitest cases (fake-timer scroll-hide, class assertions, footer placement).

## Custom window chrome (2026-07-15, late night)

Owner ask: *"ver la posibilidad si la ventana de la app puede tener diseño
personalizado e íntegro con nuestros temas"* — the native OS title bar clashed
with the dark cockpit. Recipe applied cleanly (Tauri v2, `@tauri-apps/api` ^2
already installed), so it was implemented.

### What landed
- `src-tauri/tauri.conf.json` — main window `"decorations": false` (frameless);
  size / `minWidth` / `minHeight` / `resizable: true` unchanged.
- `src-tauri/capabilities/default.json` — added the four core window
  permissions the custom controls need on top of `core:default`:
  `core:window:allow-minimize`, `allow-toggle-maximize`, `allow-close`,
  `allow-start-dragging` (the last one is what makes `data-tauri-drag-region`
  live; the read-only `core:window:default` set does not include these).
- `src/components/TitleBar.tsx` (+ `.test.tsx`) — h-8 `bg-card` /
  `border-b border-border-soft` bar, so it re-skins with every theme via tokens.
  Left: mini `BrandMark` + "OpenCohost" (text-xs, muted). Right: Minimizar /
  Maximizar / Cerrar (lucide `Minus` / `Square` / `X`) driving
  `getCurrentWindow().minimize() / toggleMaximize() / close()`. Cerrar hovers
  `bg-danger-bg text-danger`; the others ghost-hover `bg-surface-2`. The bar is
  the `data-tauri-drag-region`; the brand lockup is `pointer-events-none` so a
  drag on the logo falls through to it, and double-click-to-maximize is left to
  Tauri's native drag-region handling (no JS handler). Buttons are NOT drag
  regions. Aria-labels + titles in Spanish.
- `src/App.tsx` — TitleBar mounted ABOVE `BackendGate`/`AppLayout` inside an
  `.oc-root-shell` flex column, so it stays visible through the boot splash and
  the window is always draggable/closable.
- `src/styles.css` (append-only) — `.oc-root-shell` (100vh, clip) +
  `.oc-app-body` (`calc(100vh - 2rem)`, clip) + `.oc-app-body > * { height:100% !important }`.
  That one override retargets AppLayout's inline `height:100vh` and BackendGate's
  `h-screen` at the body row so nothing spills past the bar — done in CSS because
  AppLayout.tsx belongs to another writer and both intervening providers are
  DOM-less (`> *` hits the single fill element in both states).

### Tauri-outside safety
Handlers dynamic-`import("@tauri-apps/api/window")` inside try/catch; the vite
dev server and jsdom lack `__TAURI_INTERNALS__`, so the IPC call throws and is
swallowed — no crash, tests stay green (mock asserts the calls).

### Checks
- `pnpm exec tsc --noEmit` — see report.
- Full `pnpm exec vitest run` — see report (delta: +1 file / +2 tests, TitleBar).

### Manual runtime pass (owner — not verifiable in headless CLI)
1. Drag feel: grab the bar (and the logo) to move the window; confirm no lag.
2. Win11 Snap Layouts: hover the (custom) maximize button / drag to a screen
   edge — `decorations:false` can drop native snap unless wry keeps the frame.
   `shadow` defaults to `true` in v2 (not set explicitly), which is what should
   preserve the resize border + snap on Windows; verify both actually work.
3. Resize borders: confirm all four edges + corners still resize the frameless
   window (Tauri provides hit-testing on decorations:false; note any dead edge).
4. Double-click the bar → toggles maximize (native drag-region behavior).
5. Maximized state: check the bar/buttons don't sit under the screen edge and
   that the window still restores from the custom maximize button.

## Merged window bar (2026-07-15, late night)

Owner screenshot showed TWO stacked bars with two logos: the custom window
`TitleBar` (mini logo + "OpenCohost" + window buttons) sitting directly above the
app `TopBar` (logo + wordmark + tagline + "Developed by Franguh" + StatusRail +
gear). Owner ask: collapse them into ONE merged window bar.

### What landed
- `src/components/TitleBar.tsx` — grew `h-8` → `h-10` and became the single bar:
  `<header data-tauri-drag-region>` (banner) with, left→right: BrandMark(24) +
  `Open`**`Cohost`** wordmark + tagline `focus over panic` / credit link (the
  `TopBar` lockup, moved verbatim; credit kept EXACT — href
  `https://github.com/franguh`, `target="_blank"`, `rel="noreferrer"`, aria-label
  "Developed by Franguh"), tagline+credit `hidden xl:flex`; a `flex-1` drag
  spacer; the app-controls slot `#oc-titlebar-app-controls`
  (`TITLEBAR_APP_CONTROLS_SLOT_ID`); a divider; and the three caption buttons
  (unchanged). Brand statics are `pointer-events-none` so drags fall through to
  the bar; the credit link is `pointer-events-auto` so it stays clickable.
- `src/components/TopBar.tsx` + `.test.tsx` — DELETED (grep confirmed only
  AppLayout + its own test imported it). Its brand lockup + tagline + credit went
  into TitleBar; its StatusRail + SettingsPopover are now portaled by AppLayout.
  Its two surviving contracts (credit link, no-avatar) were ported into
  `TitleBar.test.tsx`.
- `src/components/AppLayout.tsx` — dropped the `top` grid row (grid areas
  `"top top top" "side main queue" "player player player"` → `"side main queue"`,
  with `gridTemplateRows: minmax(0,1fr)` so the one content row fills the body and
  the columns scroll internally). Removed the `<TopBar>` row. Now portals
  `<StatusRail/> + <SettingsPopover onShowWelcome={handleShowWelcome}/>` into the
  TitleBar slot via `createPortal`, gated on the slot being found after mount.
  `handleShowWelcome` (restore welcome store + `setActiveSection("experiencia")`)
  is UNCHANGED and stays local — the portaled gear is still a React-child of
  AppLayout, so its closure over `activeSection` works with zero lifting.
- `src/App.tsx` — no structural change (TitleBar already mounted above
  BackendGate); comment refreshed for the 40px merged bar.
- `src/styles.css` — `--oc-titlebar-h: 2rem` → `2.5rem` (h-8 → h-10), so the
  `.oc-app-body` `calc(100vh - var)` math stays exact. Comment notes the bar is
  intentionally NOT `overflow-hidden` so chip/gear popovers drop below it.

### Why a portal (wiring decision)
The status/gear cluster must appear ONLY past the gate, but the bar must stay
mounted ABOVE the gate for boot draggability. Readiness lives inside
`BackendGate` (out of scope) and the welcome navigation (`activeSection`) lives
inside `AppLayout` (out of a store; welcomeStore/SettingsPopover/Sidebar are all
out of scope, and no new files were allowed). So neither an `appControls` prop on
TitleBar (App can't know readiness) nor lifting `activeSection` to App (would need
a store or to touch BackendGate) fit the constraints. Portaling from AppLayout
(which only exists past the gate) into the bar's slot is the least-invasive path:
StatusRail's react-query context and SettingsPopover's `onShowWelcome` closure
both flow from the React tree (AppLayout), while the DOM lands in the bar. During
boot AppLayout is unmounted → slot empty → bar shows brand + window buttons only.

### Drag-region correctness (Tauri v2)
`data-tauri-drag-region` sits ONLY on the `<header>` background and the `flex-1`
spacer. In v2 dragging fires only on the element under the pointer that carries
the attribute, so every interactive child (credit link, status chips, gear,
caption buttons) keeps its clicks without an explicit exclusion. The slot div
does NOT carry the attribute (its children are interactive). A test queries every
`button`/`a` and asserts none carries it; double-click-maximize stays native.

### Tests
- `TitleBar.test.tsx`: 2 → 6. Kept: brand + 3 controls, caption buttons drive the
  Tauri API. Added: credit-link contract (ported; queried with `hidden:true`
  since the tagline is `hidden` below xl in jsdom), no-avatar (ported), cluster
  injected-into-slot-when-ready / absent-during-boot (via a portal probe), and
  drag-region present-on-background / absent-on-every-interactive-element.
- `AppLayout.test.tsx`: renders `<TitleBar/>` alongside `<AppLayout/>` in the
  harness so the portal slot + banner exist; the welcome-restore-from-gear flow
  and all landmark/nav assertions pass unchanged (9 tests).
- `TopBar.test.tsx` removed (−1 file, −2 tests). `App.test.tsx` / `main.test.tsx`
  untouched and green (both mock AppLayout/App, so no portal renders there).

### Checks
- `pnpm exec tsc --noEmit` — clean.
- Full `pnpm exec vitest run` — 67 files / 651 tests passed (baseline 68/649;
  −1 file = TopBar.test removed, net +2 tests = +4 TitleBar − 2 TopBar).
- `pnpm build` (`tsc && vite build`) — pass.

### Manual runtime pass (owner — not verifiable in headless CLI)
1. One bar only: confirm the two stacked bars/logos are gone — brand, status
   chips, gear and window buttons all sit on a single ~40px bar.
2. Drag: grab empty bar space / the logo to move the window; confirm the credit
   link, status chips, gear and caption buttons all still click (no dead drag).
3. Popovers: open each StatusRail chip + the gear; confirm the panels drop BELOW
   the bar and are not clipped (the bar is overflow-visible; z-50/z-10 over the
   body content — watch for any app element painting over them).
4. 1280 min width: confirm brand + 4 chips + gear + 3 buttons fit with no
   horizontal scroll; the Modelo chip truncates and tagline/credit show at xl.
5. Boot: during the "Preparando/Comprobando motor local" splash the bar shows
   brand + window buttons only (no chips/gear), and the window stays draggable.

## Detail round (2026-07-16)

Three owner live-feedback fixes. Frontend-only, scope fenced to `Sidebar.tsx`
(+test), `ProfilePlaylist.tsx`, `StatusRail.tsx` (+test).

### Item 1 — Profile hover card height clamp
- `src/components/Sidebar.tsx` (`ProfilesRegion`) — the fixed-position preview
  card was anchored at the row's `rect.top`, so rows near the viewport bottom
  (last profiles) rendered low and got cut off. Added `cardRef` + a `clampedTop`
  state and a `useLayoutEffect` that measures the card's `offsetHeight` after
  mount and pins `top = min(rowTop, innerHeight - cardHeight - 8)`. Runs pre-paint
  (no visible jump) and re-runs on `detail.isLoading/isError/data` so the clamp
  recomputes when the fetched prompt replaces "cargando…" (that changes the
  height). Card style now reads `top: clampedTop ?? preview.top`. As a
  last-resort cap for a prompt taller than the viewport, the card gained
  `max-h-[calc(100vh-16px)] overflow-y-auto` (that bounds `offsetHeight`, so the
  clamp never yields a negative top).
- `src/components/Sidebar.test.tsx` — new case (hover card v3): stubs
  `HTMLElement.prototype.offsetHeight` (jsdom reports 0) to 220, `innerHeight` to
  600, and the row's `getBoundingClientRect().top` to 560; asserts the tooltip's
  `style.top` clamps to `600 - 220 - 8 = 372px` (below the row's own top). Global
  mocks restored in a `finally`.

### Item 2 — Remove the undesigned second (native) hover tooltip
Grepped both files for `title=`. Four found, all duplicating an aria-label or the
styled hover card — all removed; every aria-label kept (a11y intact).

Removed:
- `Sidebar.tsx` nav item — `title={collapsed ? item.label : undefined}` (dup of
  `aria-label={item.label}`).
- `Sidebar.tsx` collapse toggle — `title={collapsed ? "Expandir…" : "Colapsar…"}`
  (dup of the same aria-label).
- `ProfilePlaylist.tsx` collapsed "+ Nuevo" button — `title="Nuevo perfil"` (dup of
  `aria-label="Nuevo perfil"`).
- `ProfilePlaylist.tsx` profile row button — `title={collapsed ? name : undefined}`
  (dup of `aria-label`, and it was the exact unstyled second tooltip stacking on
  the styled preview card the owner reported).

Kept: none of the `title` attributes. The edit pencil (`aria-label="Editar perfil
{name}"`) carries no `title` — nothing to remove there.

### Item 3 — Status rail container border
- `src/components/StatusRail.tsx` — the rail lives inside the h-10 title bar, so
  its wrapper read as a bordered pill. Dropped `rounded-xl border
  border-border-soft bg-surface-1 shadow-soft` from BOTH the main wrapper and the
  isLoading wrapper; the chips (their own borders/rounding untouched) now sit
  directly on the bar. Kept `flex min-w-0 items-center gap-2` (+ `px-2.5`); dropped
  the main wrapper's `py-2` (it made the group taller than the 40px bar —
  items-center centers the chips) and the loading wrapper's fixed `h-[52px]`.
- `src/components/StatusRail.test.tsx` — no existing test asserted those container
  classes; added four `not.toHaveClass` guards (`rounded-xl`/`border`/`shadow-soft`/
  `bg-surface-1`) to the existing "renders four instrument chips" case to lock it.

### Checks
- `pnpm exec tsc --noEmit` — clean (exit 0).
- `pnpm exec vitest run` (full) — **68 files / 654 tests, 0 failures.** Delta from
  this round: +1 test (the Sidebar clamp case). StatusRail gained 4 assertions
  inside an existing test (no new `it`); ProfilePlaylist unchanged.

```
 Test Files  68 passed (68)
      Tests  654 passed (654)
```

### Judgment calls
- **Item 2 nav/toggle titles.** The owner's report framed the double-hover on
  profile rows, but the directive was "remove every `title` that duplicates an
  aria-label." The collapsed nav items and collapse toggle only ever showed the
  native `title` (no styled card there), so removing it drops the sole *mouse*
  tooltip for those collapsed icons — the screen-reader accessible name stays on
  aria-label. Removed per the explicit directive; flagging here in case a designed
  tooltip is wanted for the collapsed icon rail later.
- **Item 1 clamp state vs. imperative style.** Used a `clampedTop` state read into
  the style object (`top: clampedTop ?? preview.top`) instead of imperatively
  mutating `cardRef.current.style.top`. Imperative mutation would be reset by any
  React re-render whose deps didn't change, silently un-clamping the card; the
  state approach is deterministic across re-renders.
- **Item 3 padding.** Only `py-2` (main) and `h-[52px]` (loading) were "off"
  against the 40px bar, so those were the padding/height adjustments; `px-2.5`
  and `gap-2` (chip spacing) were kept as instructed.

## Boot experience (2026-07-16)

Owner problem: app start showed (1) a white window flash, (2) an "opencohost
cargando" text splash, (3) a third loader — "es raro tener 3 loaders y que
ninguno funcione bien". Wanted: dark from the first frame, ONE loader (a light
motion-graphics animation of the Kira brand mark), driven by REAL load state,
never fixed timers.

### What the 3 loaders actually were
1. **White window flash** — the native Tauri window (no `backgroundColor`) plus
   the unstyled `index.html` before the CSS bundle loads both paint the default
   white. Read as one white flash.
2. **Gate "Preparando motor local…"** — `BackendGate`'s `bootstrapping`-phase
   splash: a plain `OpenCohost` wordmark + static status text, no animation.
3. **Gate "Comprobando motor local…"** — the `probing`-phase text swap. With no
   shared visual between the two phases, the abrupt `Preparando…` → `Comprobando…`
   change reads as a *second, separate* loader. That is the owner's third loader.

   (Post-gate, in-app data spinners were also inventoried and deliberately LEFT,
   per scope — they are query states, not boot loaders: `ProfileSwitcher`'s
   "aplicando…" `animate-spin` ring during a profile switch, and `KiraCover`'s
   "cargando…" model-name fallback + breathing presence ring while the status
   query resolves.)

### Portfolio loader — what was ported, what was fixed
Reference: `E:/Job/Portfolio_Fran/src/components/UI/Loader` (read-only). It is a
centered mark over a gently pulsing gradient with a looping spin and an
opacity fade — but its lifecycle is a **fixed `visible` prop / duration `n`**,
never bound to real readiness (the owner's known flaw). Ported: the visual
language — a centered brand element, a soft breathing/pulse motion, gentle
symmetric easing, a quiet caption. Fixed: the lifecycle is fully decoupled from
duration. `BootLoader` takes NO `visible`/timer prop; its breathing keyframes
(`boot-breathe`/`boot-glow`) **loop infinitely** so there is no "completion"
frame, and it is unmounted the instant the gate flips `ready`. Mount = shown,
unmount = gone. No exit fade was added on purpose: keeping the loader mounted
for a fade-out would reintroduce exactly the duration floor the owner rejected
("que carguen on load, no que tengan tiempo").

### Tauri `backgroundColor` verdict
**Supported.** Installed Tauri is 2.11.x (npm `@tauri-apps/api` 2.11.1, CLI
2.11.4, crate `tauri` 2.11.5) — past 2.1 where the field landed. The bundled
`config.schema.json` defines `WindowConfig.backgroundColor` ("Set the window and
webview background color") accepting a hex string. Set to `#05070b` in
`tauri.conf.json` — this covers BOTH the native window layer and the webview
layer (per the schema description), which is the real fix for the white flash;
the inline `index.html` style is the belt-and-suspenders for the pre-CSS frame.
(Windows note from the schema: alpha is ignored on the window/webview layers —
irrelevant here, the color is fully opaque.)

### Kill the white flash
- `index.html` — inline `<style>` sets `html, body { margin: 0; background-color:
  #05070b; }` (literal `--void`/`--background` value, hardcoded because CSS vars
  aren't defined before the bundle loads). A static, branded splash (inline
  `BrandMark`-motif SVG, hardcoded colors, no bundle/CSS dependency) is placed
  **inside `#root`**, so `ReactDOM.createRoot().render()` replaces it the instant
  React mounts and `BootLoader` takes over — no lingering extra loader.
- `src-tauri/tauri.conf.json` — window `backgroundColor: "#05070b"`.

### The single loader
- `src/components/ui/BootLoader.tsx` (new) — dark, brand-first: the `BrandMark`
  breathes (scale + opacity) over a soft `--accent-soft` glow that breathes with
  it. Keeps the gate's a11y contract: `role="status"` + `aria-live="polite"` +
  `aria-busy`, with the live phase copy as the accessible caption (`BrandMark`
  is `aria-hidden` so it isn't announced twice). Reduced-motion is neutralised
  by the global kill switch in `styles.css` (breathing collapses to a static
  frame).
- `src/components/BackendGate.tsx` — the `bootstrapping`/`probing` waiting UI now
  returns `<BootLoader statusLabel={statusCopy} />`. The **state machine is
  untouched**: same `bootstrapBackend()` bootstrap, same 1s health poll, same
  failure-threshold/retry, same abort/cleanup. The `error` branch is split out
  byte-identical (same `role="alert"`, `OpenCohost` heading, detail line,
  autofocused `Reintentar`). No `setTimeout` minimum-duration splash existed —
  confirmed — so nothing artificial gates readiness.
- `src/styles.css` — appended the looping `boot-breathe`/`boot-glow` keyframes.

### No fixed timers
Verified the gate has no artificial min-duration timer (its only timers are the
legit per-fetch health timeout and the poll interval). The loader appears on
mount and disappears exactly when `phase` flips to `ready`.

### Tests
- New `src/components/ui/BootLoader.test.tsx` — 2 cases: exposes the polite
  status region carrying the live phase label; renders the breathing brand mark
  (`.boot-mark` hook + `aria-hidden` `BrandMark` svg).
- `BackendGate.test.tsx` / `App.test.tsx` — **no changes needed**: BootLoader
  preserves `role="status"` + `aria-live="polite"` + the exact phase copy, and
  the error branch is unchanged, so all 13 + 1 existing assertions pass verbatim
  (proof of a behavior-preserving swap).

Delta (this round, isolated): **+1 test file, +2 tests**. Files: `index.html`,
`src-tauri/tauri.conf.json`, `src/components/BackendGate.tsx`, `src/styles.css`,
`src/components/ui/BootLoader.tsx` (new), `src/components/ui/BootLoader.test.tsx`
(new).

Checks:
- `pnpm exec tsc --noEmit` — clean (exit 0).
- Targeted `pnpm exec vitest run` (BootLoader + BackendGate + App) — 16/16 green.
- Full `pnpm exec vitest run` — **68 files / 654 tests, 0 failures** (shared
  working tree also carried a concurrent Sidebar/StatusRail round; the 654 =
  baseline 651 + that round's +1 + this round's +2).

```
 Test Files  68 passed (68)
      Tests  654 passed (654)
```

Manual checks pending for the owner (headless session — no Tauri shell here):
- **First-frame color**: launch `pnpm tauri dev` (or the built app) and confirm
  the window is dark (`#05070b`) from the very first paint — no white flash on
  the native window, the webview, or the pre-CSS HTML.
- **Splash → app handoff**: confirm exactly ONE loader — the breathing Kira mark
  with the "Preparando…/Comprobando…" caption — and that it disappears the moment
  the engine is ready (no double-brand pop, no lingering spinner). Then flip
  reduced-motion ON and confirm the mark is static (no breathing) but the boot
  still completes on readiness.
- **Error branch**: kill the backend and confirm the informative error card
  (heading + detail + autofocused "Reintentar") still appears after the failure
  threshold, unchanged.

## Boot memory wall + fade-out (2026-07-16)

Owner ask: give the boot splash a "memory wall" of Kira art behind the
breathing mark, and a fade-out on ready ("le falta un fadeout").

### Source-art optimization (`scripts/optimize-boot-art.py`)
Pillow-based (verified `PIL 12.1.1` in `flux_env`), max-width 960 LANCZOS,
metadata stripped, flattened onto `--void` (#05070b), saved WebP q70 to
`public/boot/kira-01.webp … kira-08.webp` in a **stable order** that is the
contract with `BOOT_COLLAGE_ART`. Re-run on new art (edit `SOURCES` or pass
paths as argv). Eight source PNGs (2.2–2.4 MB each) → 20–79 KB each, ~97–99%
smaller (~423 KB total for all eight tiles).

| tile         | source  | webp  | saved |
|--------------|---------|-------|-------|
| kira-01.webp | 2.44 MB | 73 KB | 97%   |
| kira-02.webp | 2.37 MB | 68 KB | 97%   |
| kira-03.webp | 1.62 MB | 20 KB | 99%   |
| kira-04.webp | 1.80 MB | 28 KB | 99%   |
| kira-05.webp | 1.92 MB | 44 KB | 98%   |
| kira-06.webp | 2.19 MB | 50 KB | 98%   |
| kira-07.webp | 2.19 MB | 77 KB | 97%   |
| kira-08.webp | 2.18 MB | 55 KB | 98%   |

### BootCollage (`src/components/ui/BootCollage.tsx`)
Full-viewport, `aria-hidden`, pointer-inert background layer behind the
BootLoader mark. At mount it Fisher-Yates-shuffles the eight tiles and takes a
random 4–6 into a `grid-cols-3` wall (`grid-auto-rows: 1fr`, object-cover).
Each tile is an eager `<img>` that starts `opacity-0` and fades to `opacity-[0.1]`
on **its own** load event (`--dur-slow` ease-out, no timers); a tile whose file
never loads simply stays invisible (no placeholder, never blocks). A slow Ken
Burns drift (scale 1↔1.05, 20s, `infinite alternate`, alternating origin per
index) lives in `styles.css` and is killed by the existing reduced-motion
switch. A radial veil (`.boot-collage-veil`) darkens the center to `--void` so
the breathing mark + status stay the hero, with a light overall wash and
`saturate(.7)` desaturation on the wall.

### Splash fade-out (`src/components/BackendGate.tsx`)
The `phase`/polling/error state machine is untouched. Splash lifetime is now a
separate `splashOpen` flag: on `ready`, the app mounts **immediately** and the
splash stays as an `absolute inset-0 z-50` overlay above it, transitioning
opacity 1→0 (`--dur-slow` ease-out, `pointer-events-none` while closing), then
unmounting on the overlay's own `transitionend` — guarded with
`event.target === event.currentTarget` so the collage tiles' opacity transitions
bubbling up don't tear it down — or a `SPLASH_FADE_MS` (360ms) fallback for
environments (jsdom, dropped events) that never emit `transitionend`. The
overlay anchors to `.oc-app-body` (given `position: relative` via an append-only
rule in `styles.css`, keeping the existing height math intact). The error card
is unchanged and never carries the splash/collage.

### Verification
- `pnpm exec tsc --noEmit` — clean (exit 0).
- Full `pnpm exec vitest run` — **69 files / 660 tests, 0 failures** (baseline
  68/654; +1 file BootCollage.test.tsx, +6 tests: 4 collage + 2 gate fade).
- `pnpm build` (`tsc && vite build`) — green; `dist/boot/kira-0*.webp` shipped.

```
 Test Files  69 passed (69)
      Tests  660 passed (660)
```

Manual checks pending for the owner (headless session — no Tauri shell here):
- **Memory wall**: launch the app and confirm a faint, slowly drifting grid of
  Kira art sits behind the breathing mark — legible mark + caption over a dark,
  veiled center; the wall reshuffles (4–6 tiles) each boot.
- **Fade-out**: confirm the splash fades out (~320ms) the instant the engine is
  ready, revealing the app underneath (no hard cut, no double-brand pop). Then
  flip reduced-motion ON and confirm tiles are static, no Ken Burns, and the
  splash still tears down on readiness.
- **Error branch**: kill the backend and confirm the error card (no collage)
  still appears unchanged after the failure threshold.

## Visual round (2026-07-16, morning)

Two owner-feedback items. Frontend-only, no backend touched. Scope fenced to
`BootCollage.tsx` (+test), `StatusRail.tsx` (+test — no test change needed),
and `styles.css` (boot-collage rules only).

### Item 1 — Boot collage: more visible + feathered edges
- `src/components/ui/BootCollage.tsx` — tile load-fade target opacity raised
  `opacity-[0.1]` → `opacity-[0.35]` (+25 points, "que se vean más"). Pulled it
  out into a single `TILE_LOADED_OPACITY` module constant so it stays a one-line
  knob if the owner fine-tunes.
- `src/styles.css` — `.boot-collage-tile` gained a per-tile radial feather mask
  so the 3-col grid seams dissolve ("bordes desvanecidos"): tiles read as soft
  memory patches, not rectangles. Shipped value (twinned `-webkit-mask-image` +
  `mask-image`):
  `radial-gradient(ellipse 75% 75% at center, #000 45%, transparent 98%)`.
  Mask sits on the img (`.boot-collage-tile`); at the 1.05 Ken Burns scale the
  feather is ~94% complete by the wrapper's `overflow-hidden` clip, so seams
  vanish during drift too, and it's exact at rest / under reduced-motion.
- `src/components/ui/BootCollage.test.tsx` — the load-fade assertion updated
  `opacity-[0.1]` → `opacity-[0.35]` (before/after-load pair).
- **Caption legibility verified by geometry (headless — no pixel check).** The
  caption sits ~8–10% below vertical center (gap-7 under the 76px mark). The
  center veil (`ellipse 65% 58%` solid `--void` → transparent at 72%, plus a 42%
  void wash) gives ~75–80% void coverage there, and in a 4–6-tile / 3-col grid
  the vertical center falls on a now-feathered row seam — so effective tile
  brightness behind the caption is ~7% even at 0.35. Conclusion: 0.35 does NOT
  fight the caption; the central veil was left untouched (per the task's "only
  strengthen the veil if it fights").

### Item 2 — Status-rail chips: remove the colored state dots
- `src/components/StatusRail.tsx` — removed the per-chip tone dot
  (`h-[6px] w-[6px] rounded-full` + `DOT_CLASSES[tone]` + `animate-pulse` on
  info) from `StatusChip`; chips are now icon + state text. The escalation
  styling on the chip surface (`CHIP_ESCALATION`, `data-taxonomy`) is unchanged.
  Also removed the chip-level dot from the `Conectando con el motor…` loading
  placeholder for consistency (text-only now).
  - Dead-code cleanup: dropped the now-unused `TAXONOMY_TONE` map and the local
    `const tone = TAXONOMY_TONE[taxonomy]` (their only consumer was the removed
    dot). `DOT_CLASSES` is **kept** — still used by the Motor popover's
    DetailRow per-row dots, which are untouched.
- No test change: `StatusRail.test.tsx` never asserted chip dots (it asserts
  state via `data-taxonomy` text). The detail-row dot assertions (popover
  content is checked by text) stay intact and green.

Checks:
- `pnpm exec tsc --noEmit` — clean (exit 0).
- Focused `pnpm exec vitest run BootCollage.test.tsx StatusRail.test.tsx` —
  23/23 (BootCollage 4, StatusRail 19).
- Full `pnpm exec vitest run` — **69 files / 660 tests, 0 failures** (baseline
  unchanged — no test count delta; both items are visual + dead-code cleanup).

```
 Test Files  69 passed (69)
      Tests  660 passed (660)
```

Judgment calls:
- **Mask on the img, not the wrapper.** Considered masking the tile wrapper
  (feather fixed at the cell box, immune to Ken Burns scale) but the img mask is
  the task's stated shape and — per the ~94%-by-clip math above — feathers seams
  effectively even under the 1.05 drift, with zero JSX churn. Wrapper is the
  fallback if the owner ever reports a residual hard edge on the drift's
  trailing corner.
- **Opacity kept as a Tailwind arbitrary-value constant** (`opacity-[0.35]`)
  rather than a CSS var, matching the existing class-based fade + one-line-tweak
  ask.
- **Veil untouched** (see Item 1 note) — geometry says the guarantee holds; a
  headless pixel check was not possible.

## Controles round (2026-07-16, morning)

Owner live feedback: two items in **Controles → Voz y micrófono** and
**Controles → Memoria**.

### Item 1 — Undesigned selects in Voz y micrófono

`VoiceCard` rendered its **Idioma** and **Motor TTS** selectors through
`ui/Select`'s *native* variant (`children` = `<option>` elements), which falls
through to the unstyled OS `<select>`. `ui/Select` already ships a designed
custom variant, keyed by the presence of the `options` prop (a token-styled
`role="combobox"` button + `role="listbox"` dropdown with the app's borders,
chevron and check affordance).

- Swapped both selects to the `options` API. Behaviour is byte-identical:
  option **values** (`argentina`/`neutral`, `ligero`/`pesado`) unchanged,
  current-value binding unchanged (`value={voice}` / `value={engine}`), and the
  change handlers are the *same* functions — the custom variant hands
  `applyVoice`/`applyEngine` the value string directly instead of an event, so
  `onChange={applyVoice}` replaces `onChange={(e)=>applyVoice(e.target.value)}`.
- The Pesado (Heavy) per-option gate (`disabled` when `!heavy_available`) is
  preserved via `SelectOption.disabled`; the custom variant refuses clicks on a
  disabled option and marks it `aria-disabled="true"`.
- **>6 options check:** N/A — both selects have exactly **2** options. Note for
  future callers: `ui/Select`'s custom dropdown `<ul>` has **no `max-height` /
  internal scroll cap** — a select with a long option set would let the listbox
  grow unbounded and could overflow the viewport. Not a problem here; worth a
  `max-h-*` + `overflow-y-auto` on the listbox if a long catalog ever uses it.

Test idiom migrated to the custom-select shape (matching `Select.test.tsx` /
`StreamPanel` / `AgendaPanel`): `toHaveValue(...)` → `toHaveTextContent(label)`;
`fireEvent.change(select, {value})` → open (`click` the combobox) then click the
`role="option"`. The Motor-change test now seeds `heavy_available:true` so the
Pesado option is selectable (a native `<select>` let `fireEvent.change` bypass
the disabled attribute; the custom variant does not) and asserts the real
`set_motor_tts` dispatch body.

### Item 2 — "Memorias no aparecen" + section polish

**Root-cause investigation (reported before fixing):** this is **not** a
frontend rendering/query regression. Traced end to end:

- The confirm-flow refactor (`b4f5657`) that the report fingered touched only
  the per-row/clear `ConfirmFooter`s — it never touched the list query or the
  list-rendering branches.
- The list contract matches on every layer: frontend `MemoriaListItem` ↔ backend
  `GET /api/memoria/list` (`SELECT id,title,created_at,updated_at,revision,
  pinned,private,inactive ... WHERE profile_id = ?`) ↔ msw fixture — same
  `{ items: [...] }` shape, same fields. No shape/query-key/toggle/confirm-filter
  bug in the current code.
- The **only** list-affecting change in history is **FIX-A** (`da108a0`):
  `profileId` switched from `useStatusQuery().data?.active_profile` (the display
  **name**, always present in `/api/status`) to `active_profile_id` (the stable
  **UUID**). The backend seeds `active_profile_id` from
  `MotorVocalIA._current_profile_id` and saves memorias under that same UUID, so
  the FE contract is correct **for a correctly-seeded backend**.

The observed "No hay memorias guardadas" symptom therefore requires a
**profile_id keying mismatch at runtime** — `active_profile_id` is populated
(truthy, so it is *not* the "Activá un perfil" branch) but points at a UUID that
does not match the `profile_id` the memorias were stored under. That happens
when memorias were saved before the backend keyed by UUID (name-keyed rows) and
are now queried by UUID: the pre-FIX-A frontend queried by name and listed them,
so from the user's view they "used to appear". This is a **backend/data-migration
condition** (re-key legacy memorias to the profile UUID, or have the backend
resolve both), **not** something the frontend should paper over — reverting to
name-keying would re-break brand-new UUID-keyed memorias, i.e. re-introduce the
exact bug FIX-A fixed. **Reported, not hacked around**, per the round's rules.

Why the suite stayed green while runtime broke (the classic): the msw **status**
fixture hardcodes `active_profile_id: "profile-id-default"` and the **list**
handler ignored `profile_id` entirely, so every test drove the happy path and no
test ever proved the frontend forwards the *right* key.

**Regression test added** — `forwards active_profile_id (not the display name) as
profile_id, so a correctly-keyed list renders`: sets `active_profile_id` to a
known UUID and makes the list handler mirror the backend's `WHERE profile_id = ?`
(rows only when the UUID matches). It fails if the FE regresses to sending the
display name or an empty id. This is the guard the suite was missing.

**UI polish** of the "Memorias guardadas — detalle" section:

- Quiet header row: the label now carries a muted count (`N memorias` /
  `1 memoria`, `tabular-nums text-dim`) sourced from the loaded list.
- Chevron affordance on the show/hide toggle (kept the existing `Ver`/`Ocultar`
  button — stable accessible name so the ~13 existing `getByRole("button",
  {name:"Ver"})` queries hold — with `aria-expanded` and a `▾` that rotates
  `-90°` when collapsed, matching `Collapsible`'s idiom).
- Designed empty state replacing the bare sentence: a dashed-border panel with a
  `🧠` glyph, **"Kira todavía no guardó memorias."**, and a dim hint line
  ("Van apareciendo acá a medida que Kira conversa y decide qué vale la pena
  recordar."). Two existing tests updated to the new copy.
- Rows left intact — they already use `text-sm` title / `text-[11px] text-dim`
  meta and carry the per-row confirmed delete from the confirm round.

### Checks

- `pnpm exec tsc --noEmit` — clean (exit 0).
- Full `pnpm exec vitest run` — **69 files / 661 tests, 0 failures**
  (baseline 660 + 1 new regression test).

```
 Test Files  69 passed (69)
      Tests  661 passed (661)
```

### Judgment calls

- **Kept `ui/Select`'s native variant.** Did not touch `Select.tsx` — the
  designed variant already existed behind the `options` prop; the fix was to
  *use* it, not to rebuild the control.
- **Show/hide + chevron over a full `Collapsible` swap.** Both were sanctioned;
  the button-with-chevron keeps the toggle's accessible name stable and avoids
  churning ~13 unrelated MemoryCard test queries for zero visual gain.
- **Reported the memoria break instead of coding around it.** The honest cause is
  a profile_id keying mismatch on the backend/data side; a frontend name-fallback
  would silently re-break UUID-keyed memorias. Locked the FE half of the contract
  with the new regression test and left the data migration to the backend owner.
