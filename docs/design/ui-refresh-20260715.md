# OpenCohost UI Refresh — "Focus Over Panic" (2026-07-15)

Implementation-ready design spec. Writers: you do NOT need the reference images or the
original conversation — everything needed is in this file plus the cited source paths.
All paths are relative to the repo root `E:/VoiceAI/OpenCohost_UI/`.

**Scope is hard-bounded** to: (a) status bar, (b) chat panel, (c) motion system,
(d) alerts + alert-style setting, (e) Agenda "Perfil Co-host" form. Anything else you
notice while implementing goes to the "SDD proposal candidates" list at the end —
do not change it.

**Stack facts (verified):** React 18 + TypeScript + Tailwind 3.4 + Vite 5 (Tauri shell).
`lucide-react@^0.468.0` is ALREADY a dependency (`package.json` line 24, used in
`src/components/WelcomeCard.tsx`) — use it for all icons, add NO new dependencies.
Tests: `vitest 3.2.6` + `@testing-library/react` + `msw` (`pnpm test` → `vitest run`;
`pretest` regenerates `src/api/types.gen.ts` from `openapi.snapshot.json`).
Build gate: `pnpm build` → `tsc && vite build`.

**Themes (verified in `src/styles/tokens.css`):** THREE themes via CSS vars keyed on
`[data-theme]` on `<html>`: `cockpit` (dark, default), `aurora` (dark, glassy),
`studio` (LIGHT). Every change in this spec must render correctly in all three —
especially `studio`, whose tone tokens were hand-tuned for WCAG AA
(see the F3/B2 comments at `tokens.css` lines 203–223 and the guard test
`src/styles/tokens.contrast.test.ts`). Theme persistence: zustand module-singleton +
`localStorage["oc-theme"]` + `data-theme` attr (`src/theme/useTheme.ts`); density
preference uses the identical pattern with `localStorage["oc-density"]` +
`data-density` (`src/theme/useDensity.ts`). New preferences in this spec MUST reuse
that exact pattern.

**Copy contract:** Argentine voseo ("escribí", "mantené", "vas a"), sentence case,
operator-perspective naming, active voice. Errors say what happened + what to do.
Empty states invite action. All copy strings in this spec are final — use them verbatim.

---

## 1. Design thesis + signature element

**Thesis.** The header says "FOCUS OVER PANIC"; the UI must earn it. Today the status
strip renders a healthy app as an emergency ("Sistema: error", "Health: red", three red
chips) and the chat opens with a fake user message. The refresh re-languages state:
**color is a verb, not a mood** — alarming color appears only when the operator must
act; everything else is a calm, legible readout that explains *why* it is what it is.

**Signature element: the status strip as a calm cockpit readout.** One quiet
mono-labelled rail of instrument chips — neutral surfaces, a single small tone dot per
chip, a why-popover on every chip. All boldness budget goes here. Everything else in
this refresh (chat, alerts, form, motion) is disciplined and quiet, using the same
state taxonomy and motion tokens the readout establishes.

**State taxonomy (used everywhere in this spec):**

| Taxonomy state | Meaning | Tone token | Visual weight |
|---|---|---|---|
| `ok` | Working as intended | `--ok` | dot only — chip surface stays neutral |
| `info` | Live activity, no action | `--info` | dot only, optional gentle pulse |
| `attention` | Degraded/transient, watch it | `--warn` | dot + tinted border (`--warn-bd`) |
| `action` | Operator must do something | `--danger` | dot + tinted border + tinted bg (full existing Badge danger treatment) |
| `neutral` | Static fact / no signal | `--muted-foreground` | dot at 50% opacity, neutral surface |

Rule: `action` is the ONLY state that gets a filled tinted background. This is the
single mechanism that fixes "a working app looks broken".

---

## 2. Token additions

### 2.1 Motion tokens — `src/styles/tokens.css`

Add to the `:root, [data-theme="cockpit"]` block (they are theme-invariant scale
tokens, like `--radius` at lines 113–118 — do NOT redeclare in aurora/studio):

```css
/* motion — one system app-wide. 3 durations, 2 easings.
   fast  = micro feedback (hover color, opacity, dots)
   base  = structural (collapse, rotate, popovers, chips)
   slow  = entrances/exits (toasts, banners, empty states) */
--dur-fast: 140ms;
--dur-base: 220ms;
--dur-slow: 320ms;
--ease-out: cubic-bezier(0.22, 1, 0.36, 1);   /* expressive settle — already used by welcome-slide-in */
--ease-io: cubic-bezier(0.45, 0, 0.25, 1);    /* symmetric in-out for reversible state (collapse, toggle) */
```

### 2.2 Tailwind mapping — `tailwind.config.ts`

Extend `theme.extend` (alongside the existing `keyframes`/`animation` at lines 71–79):

```ts
transitionDuration: {
  fast: "var(--dur-fast)",
  base: "var(--dur-base)",
  slow: "var(--dur-slow)"
},
transitionTimingFunction: {
  out: "var(--ease-out)",
  io: "var(--ease-io)"
},
// `transition-colors` must ALSO animate `filter`, or the §2.5 global hover-brightness
// fix is inert on every element carrying the utility (ui/Button.tsx line 21 hardcodes
// `transition-colors` on ALL buttons; its transition-property list would otherwise
// omit filter and win over the §2.5 element selector).
transitionProperty: {
  colors: "color, background-color, border-color, text-decoration-color, fill, stroke, filter"
},
keyframes: {
  eq: { "0%, 100%": { height: "8px" }, "50%": { height: "26px" } },
  "rise-in": {
    from: { opacity: "0", transform: "translateY(4px)" },
    to: { opacity: "1", transform: "translateY(0)" }
  }
},
animation: {
  eq: "eq 1s ease-in-out infinite",
  "rise-in": "rise-in var(--dur-slow) var(--ease-out) both"
}
```

Usage classes this creates: `duration-fast|base|slow`, `ease-out` (overridden — fine,
it now resolves to the brand curve), `ease-io`, `animate-rise-in`. The
`transitionProperty.colors` override redefines the stock `transition-colors` utility
app-wide (same class name, filter added) — no component class strings change for it.

### 2.3 Scrollbar styling — `src/styles.css`

There is currently ZERO scrollbar styling anywhere (verified by grep) — raw OS
scrollbars. Add globally (bottom of `src/styles.css`); vars make it correct in all
three themes. **One mechanism only — standard properties.** Chromium ≥ 121 (the
WebView2 this app runs on) ignores `::-webkit-scrollbar` pseudo-elements on any
element where `scrollbar-width`/`scrollbar-color` are set, so a webkit block
alongside these two properties would be dead CSS. **Accepted tradeoff:** the
standard properties offer no hover state, no track styling, and no custom
thickness beyond `thin` — the thumb is one static, theme-aware color. That is
the entire scrollbar treatment; do not add a `::-webkit-scrollbar` block
expecting it to layer on top.

```css
/* Cockpit scrollbars — thin, quiet, theme-aware. Standard properties ONLY:
   WebView2 (Chromium ≥121) disables ::-webkit-scrollbar wherever
   scrollbar-width/scrollbar-color are set, so no hover/track styling exists. */
* {
  scrollbar-width: thin;
  scrollbar-color: color-mix(in srgb, var(--muted-foreground) 35%, transparent) transparent;
}
```

The Phase 1 visual check is therefore: thin thumb, theme-tinted, transparent
track, **no hover change** — anything more is not achievable with this mechanism.

### 2.4 Reduced motion — `src/styles.css`

Replace the existing narrow block (lines 71–73, which only covers
`.welcome-slide-image`) with a global kill switch:

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

Keep existing `motion-reduce:*` utilities in components — they're now redundant but
harmless. New components do NOT need per-element `motion-reduce:` classes.

### 2.5 Global hover fix — `src/styles.css` + §2.2

`button:hover { filter: brightness(1.08); }` (line 24) snaps instantly — the most
common "jarring pop" in the app. The fix has TWO mandatory halves; the element rule
alone is NOT enough:

1. Change the `button` rule (line 20) to:

```css
button {
  cursor: pointer;
  transition: filter var(--dur-fast) var(--ease-io);
}
```

2. Ship the `transitionProperty.colors` extension from §2.2. Without it, any button
   carrying a Tailwind transition utility — and `ui/Button.tsx` line 21 hardcodes
   `transition-colors` on every `<Button>` (ConversationPanel tabs, the
   SettingsPopover trigger, etc.) — overrides the element selector with a
   `transition-property` list that omits `filter`, leaving the brightness snap
   in place on most buttons in the app. With the extension, `transition-colors`
   plus the §3c `duration-fast ease-io` sweep animates the hover brightness
   through one mechanism everywhere.

### 2.6 No new color tokens

The existing tone system (`--ok/--warn/--danger/--info` + `-bg`/`-bd` per theme) fully
covers the state taxonomy. Do not add colors. `--panic` stays reserved (kill-switch
only) and is untouched by this refresh.

---

## 3. Per-component specs

### 3a. Status bar → calm cockpit readout

**Files (all verified to exist):**
- `src/components/StatusRail.tsx` — the chip rail (rewrite).
- `src/components/TopBar.tsx` — remove the avatar circle (lines 41–45).
- Tests to update: `src/components/StatusRail.test.tsx`, `src/components/TopBar.test.tsx`
  (they assert current labels like `Sistema: error · salud` — expectations must move to
  the new copy below).

**Real data sources (trace for the writer):**
- `useStatusQuery()` (`src/api/status.ts`) polls `GET /api/status` every 2 s.
- Response type: `StatusResponse` (`src/api/client.ts` lines 12–26 — generated shape +
  hand-added `ollama_warming?`, `avatar_state?`, `active_profile_id?`).
- Fields used: `is_ready: boolean`, `current_model: string | null`,
  `is_speaking: boolean`, `is_processing: boolean`, `active_profile: string`,
  `ollama_warming?: boolean`, and `health` (`HealthState`, `src/api/types.gen.ts`
  lines 187–208): `vram_status`, `rtf_status`, `ollama_status`, `qwen_status`,
  `overall_status`, `ollama_lifecycle`, `qwen_lifecycle`, `free_vram_mb: number`,
  `rtf_rolling_avg: number | null`.
- Status vocabularies are untyped strings; keep the existing `healthTone()` sets
  (`StatusRail.tsx` lines 20–22): OK = `ok/green/healthy/running/ready`,
  WARN = `yellow/warn/degraded/low/waiting/unhealthy`, DANGER = `red/critical/down/failed`.

**Current behavior (what's wrong):** seven pills — `● Sistema: error · salud` (danger),
`● Modelo: gemma4:e4b` (info-blue), `● Health: red` (danger — duplicates Sistema),
`● Voz: en silencio` (neutral), `● Inactivo` (neutral — duplicates the same activity
axis as Voz), `● Perfil: default` — plus a gear and a **meaningless round avatar
circle** (the app has no user accounts). "error"-wording + two red pills for a
recoverable health state = panic. No icons, no explanation of why.

**New behavior — FOUR chips + gear.** The `Health` chip is deleted (folded into the
Motor rollup + its popover). `Voz` and `Inactivo` merge into one `Kira` activity chip.
The avatar circle button in `TopBar.tsx` is deleted outright. Every chip is a
`<button>` that toggles a small explanation popover (click or Enter/Space; Escape and
outside-click close — reuse the open/close pattern from
`src/components/SettingsPopover.tsx` lines 82–103).

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ ◔ OpenCohost                    [♥ Motor OK] [⛛ gemma4:e4b] [✦ Kira: en      │
│   FOCUS OVER PANIC                                      espera] [◎ Akira] ⚙  │
└──────────────────────────────────────────────────────────────────────────────┘
   chip anatomy:  [ icon  label  ·dot ]     ← neutral surface, mono label
   popover (on chip press):
   ┌──────────────────────────────────┐
   │ Motor: atención                  │
   │ La salud está en amarillo (VRAM).│
   │ Kira sigue funcionando.          │
   │ ── detalle ─────────────────────│
   │ · VRAM libre    3 210 MB      ●  │
   │ · Velocidad     RTF 0.82      ●  │
   │ · Ollama        running       ●  │
   │ · Qwen (voz)    ready         ●  │
   │ ── qué hacer ───────────────────│
   │ Si pasa a rojo, bajá el tier del │
   │ modelo desde Controles.          │
   └──────────────────────────────────┘
```

**Chip visual spec.** Base: `inline-flex items-center gap-1.5 rounded-full border
border-border bg-surface-2 px-3 py-1.5 text-[12.5px] font-semibold mono
text-muted-foreground transition-colors duration-fast`. Icon: lucide, `size={13}`,
`aria-hidden`. Dot: 6 px round, tone-colored (reuse `dotClasses` idea from
`src/components/ui/Badge.tsx`). Taxonomy escalation:
- `ok` / `info` / `neutral`: ONLY the dot changes color. Chip surface stays neutral.
  `info` dot may pulse gently (`animate-pulse` — global reduced-motion kills it).
- `attention`: dot + `border-warn-bd text-warn` (no bg fill).
- `action`: full `bg-danger-bg border-danger-bd text-danger` (the only filled state).

Keep the rail's `role="status"` + `aria-label="Estado operativo de OpenCohost"` and
the signature partial-ring motif (`StatusRail.tsx` lines 106–115), re-tinted to the
Motor chip's tone.

**Chips, states, and exact copy:**

**Chip 1 — Motor** (icon: `Activity`). Rollup replacing both `Sistema` and `Health`.
Rewrite `computeSistemaRollup` (exported, keep the export name so tests locate it)
priority table:

| Condition (priority order) | Taxonomy | Chip label | Popover body (first line = why, second = what to do) |
|---|---|---|---|
| status query `isError` | action | `Sin conexión` | `No hay respuesta del motor local.` / `Revisá que OpenCohost esté corriendo y reintentá.` |
| `healthTone(overall_status) === "danger"` | action | `Motor: necesita acción` | `La salud del sistema está en rojo ({dims}).` / `Revisá el detalle abajo; si sigue en rojo, reiniciá el motor.` |
| `healthTone === "warn"` | attention | `Motor: atención` | `La salud está en amarillo ({dims}). Kira sigue funcionando.` / `Si pasa a rojo, bajá el tier del modelo desde Controles.` |
| `!is_ready && ollama_warming` | attention | `Motor: cargando modelo` | `El modelo se está cargando en Ollama.` / `Suele tardar menos de un minuto — no hace falta hacer nada.` |
| `!is_ready` | attention | `Motor: preparando` | `El motor todavía no está listo para responder.` / `Esperá unos segundos; si no arranca, revisá Ollama.` |
| `healthTone === "neutral"` (unknown vocab) | neutral | `Motor: …` | `Todavía no llegó el primer reporte de salud.` |
| else | ok | `Motor OK` | `Todo en orden: salud verde y modelo cargado.` |

`{dims}` = comma-joined human names of the degraded dimensions, derived by running
`healthTone()` over `vram_status`, `rtf_status`, `ollama_status`, `qwen_status` and
naming those that are warn/danger: `VRAM`, `velocidad`, `Ollama`, `voz (Qwen)`.

The Motor popover ALWAYS appends the detail table (this is where the deleted `Health`
chip's information now lives, with real numbers instead of the word "red"):

| Row label | Value | Dot tone |
|---|---|---|
| `VRAM libre` | `{free_vram_mb} MB` (rounded int) | `healthTone(vram_status)` |
| `Velocidad` | `RTF {rtf_rolling_avg}` (2 decimals) or `—` if null | `healthTone(rtf_status)` |
| `Ollama` | `{ollama_status}` (mono, raw) | `healthTone(ollama_status)` |
| `Qwen (voz)` | `{qwen_status}` (mono, raw) | `healthTone(qwen_status)` |

**Chip 2 — Modelo** (icon: `Cpu`). ALWAYS `neutral` (a model name is a fact, not an
alert — the current info-blue was noise). Label: `{current_model}` mono, truncated
with `max-w-[190px] text-ellipsis` as today; `sin modelo` when null. Popover:
`Modelo activo en Ollama.` / `Lo cambiás desde Controles → Modelo.` The separate
`Modelo: calentando…` warn badge (line 120) is deleted — that state now lives in the
Motor rollup row above.

**Chip 3 — Kira** (icon: `AudioLines`). Merges `Voz` + `Inactivo`, named from the
operator's perspective — the operator cares what *Kira* is doing:

| Condition | Taxonomy | Label | Popover |
|---|---|---|---|
| `is_speaking` | info | `Kira: hablando` | `Está reproduciendo su respuesta por voz.` |
| `is_processing` | info | `Kira: pensando…` | `Está generando una respuesta.` |
| else | neutral | `Kira: en espera` | `Sin turnos nuevos — no es un error.` / `Escribile en el chat o mantené el micrófono para hablarle.` |

This popover copy is the direct answer to "nobody understands why 'Voz: en silencio'
or 'Inactivo'": silence is explained as normal and the next action is invited.

**Chip 4 — Perfil** (icon: `VenetianMask` — Kira's persona, not a user account).
Always `neutral`, mono. Label: `{active_profile}`. Popover: `Personalidad activa de
Kira.` / `La cambiás desde Perfiles en la barra lateral.`

**Loading state** (query `isLoading`): keep one neutral chip `Conectando con el
motor…` (replaces `Cargando estado del motor…`), no red anywhere.

**Error state** (query `isError`): render ONLY the Motor chip, in its `Sin conexión`
`action` state from the priority table — mirroring today's dedicated single-badge
`isError` branch (`StatusRail.tsx` lines 96–102). The Modelo, Kira, and Perfil chips
are OMITTED entirely (with `data` undefined they have no model name, activity flags,
or profile); do not invent placeholder copy for them.

**TopBar.tsx change:** delete the `<button aria-label="cuenta" …/>` block
(lines 41–45) entirely. Nothing replaces it; the gear becomes the last element.

**A11y:** each chip `aria-expanded` + `aria-controls` for its popover; popover
`role="dialog"` with `aria-label` = chip label; dots are `aria-hidden` (state is in
the text, never color-only — this is why labels carry the state word). Contrast: only
existing AA-audited tone tokens are used. Focus: chips inherit the global
`:focus-visible` ring (`src/styles.css` lines 44–50).

**Motion:** chip tone changes animate `transition-colors duration-fast ease-io`;
popover enters with `animate-rise-in`.

### 3b. Chat panel (`src/components/ConversationPanel.tsx`)

Current structure (verified): tabs row (Todo/Chat/Alertas) → "Conversación / sesión en
vivo" row → scrollable `tabpanel` with turns → composer (`Input` with trailing
`Enviar` button) → error line. Canned turns array `TURNS` (lines 43–46):
`viewer-question` renders a fake operator bubble `¿Cómo viene el stream hoy?`
(lines 99–108) pinned FIRST; `mute-notice` renders `🎫 el chat de viewers está
silenciado` as a divider pinned LAST (lines 121–128, appended at lines 278–283) — so
it visually "follows" the timeline as it grows. System lines come from two real
streams rendered as centered dividers: agenda lifecycle events
(`useAgendaEvents`, `src/api/agenda.ts`) and operator-action events
(`useEventStore`, labels whitelisted in `src/lib/appEvents.ts` lines 52–78 — e.g.
`Motor: listo`, `Motor: cargando modelo`). Kira turns are labelled by
`KiraBadgeLabel` (lines 54–63): a Badge pill containing the glyph `◈` — the
"pseudo-icon" to kill.

#### (i) Empty state replaces the canned first message

Delete `viewer-question` from `TURNS` and its render branch (lines 99–108).

**Exact empty-state rule:** the empty state renders on the **Todo** and **Chat**
tabs whenever there are **zero chat-kind turns** — no transcript turns and no
thinking indicator — **regardless of alert-kind event lines** (agenda lifecycle +
app-event dividers). This distinction is load-bearing: `motor.*` events like
`Motor: listo` (`src/lib/appEvents.ts` lines 65+) land within seconds of startup,
so a literal "stream is empty" check would kill the invitation almost immediately.
Event lines still render behind/around the empty state per the tab's filter; only
chat-kind turns dismiss it. The **Alertas** tab never shows this empty state — it
keeps `Sin turnos en este filtro.` (line 330) as its empty case.

When the rule matches, render a centered empty state in the tabpanel:

```
│                                  │
│            (KiraFace)            │   ← 40px round Kira mark
│    Empezá a chatear con Kira     │   ← text-sm font-semibold text-foreground
│  Escribí un mensaje abajo, o     │   ← text-xs text-muted-foreground, max-w-[220px]
│  mantené el micrófono para       │
│  hablarle.                       │
│                                  │
```

Copy (verbatim): title `Empezá a chatear con Kira`; body `Escribí un mensaje abajo, o
mantené el micrófono para hablarle.` Entrance: `animate-rise-in`. The existing
`Sin turnos en este filtro.` line (line 330) stays for the **Alertas** tab's empty
case only — on Todo/Chat the invitation above replaces it.

#### (ii) Kira avatar — real mark instead of the ◈ pill

Create `src/components/ui/KiraFace.tsx`: a small round SVG avatar reusing the EXACT
Kira-face geometry already in `src/components/ui/BrandMark.tsx` (lines 30–35: cyan
circle `fill-accent2` + two eye rects + mouth rect, all `fill-foreground`… note in
BrandMark the eyes are `fill-foreground` on the accent circle — for the avatar use the
same: circle `className="fill-accent2"`, eyes/mouth `fill` = `var(--background)` so
they read on the accent in all themes). Props: `size?: number` (default 22),
`className?`, `aria-hidden`. This makes the brand mark and the chat speaker the same
character — intentional identity, zero new assets.

Rewrite `KiraBadgeLabel` (lines 54–63): `<KiraFace size={22} aria-hidden />` followed
by the existing mono label `KIRA` / `KIRA · AGENDA` (keep the
`text-[var(--kira-cyan)]` treatment). Delete the `Badge`+`◈` usage.

#### (iii) Viewers-muted notice anchors ONCE at the composer

Delete `mute-notice` from `TURNS`, its render branch (lines 121–128), and its
`muteTurn` append (lines 278–283). Add a persistent quiet banner as the FIRST child of
the composer container (the `div.border-t` at line 333), above the form:

```
├──────────────────────────────────┤
│ ⊘ Chat de viewers silenciado     │  ← banner: h-7, flex items-center gap-2,
├──────────────────────────────────┤     text-[11px] mono text-dim, icon MessageSquareOff size 12
│ [ Escribí un mensaje…    🎙 Enviar]│
└──────────────────────────────────┘
```

Copy: `Chat de viewers silenciado`. Tooltip (`title` attr): `Kira no está leyendo el
chat de viewers en esta sesión.` It never scrolls with the timeline and only changes
if the state changes (today it's a static canned state — wiring a real backend mute
state is an SDD candidate, §5). Taxonomy: `neutral` — no tone color.

#### (iv) System/status lines — intentional quiet treatment

Replace the bare centered-divider rendering for `turn.event` (lines 111–119) with a
centered **meta chip**: `mx-auto w-fit rounded-full bg-surface-2 border
border-border-soft px-2.5 py-0.5 text-[11px] mono text-dim`, entrance
`animate-rise-in`. No side rule-lines (delete the two `h-px` spans). Event label text
stays exactly as emitted (`Motor: listo`, `Motor: cargando modelo`, agenda labels…) —
labels are owned by `src/lib/appEvents.ts` / `src/api/agenda.ts` and are NOT edited in
this refresh. Wrap the chip in a container with `role="status"` only for genuinely new
arrivals (existing render path already re-renders; no aria changes needed beyond
keeping them in DOM order).

#### (v) Scrollbars

Covered globally by §2.3 — no per-component work beyond verifying the tabpanel
(`overflow-auto`, line 325) picks up the thin themed scrollbar.

#### (vi) Composer mic button — pure relocation of the PTT hold

**Reuse, do not reimplement:** `usePttHold()` from `src/api/ptt.ts` (lines 148–276) —
the same hook `src/components/PTTCard.tsx` uses. Zero backend changes; the transcript
never reaches the UI by privacy design (see the PRIVACY note in `src/api/ptt.ts`
lines 17–20), so the sent-state must read intentional, not broken.

Mechanics:
1. Extract `STATE_COPY` and `ERROR_COPY` from `PTTCard.tsx` (lines 9–21) into
   `src/api/pttCopy.ts` (verbatim move) and import them in both `PTTCard.tsx` and
   `ConversationPanel.tsx`. Pure relocation — PTTCard behavior unchanged.
2. In the composer, extend the `Input`'s `trailing` cluster (lines 341–349): mic
   button BEFORE the `Enviar` button. `Input` already supports arbitrary trailing
   nodes (`src/components/ui/Input.tsx` lines 43–56).
3. Mic button behavior: hold-to-talk via `onPointerDown={start}` /
   `onPointerUp/onPointerCancel/onLostPointerCapture={stop}` + `setPointerCapture`
   (copy the pointer pattern from `PTTCard.tsx` lines 79–82, 151–171) and
   button-local `onKeyDown/onKeyUp` for Space/Enter (lines 84–94). **Do NOT add the
   window-level key/blur listeners** (`PTTCard.tsx` lines 104–135) — PTTCard already
   owns the global gesture when mounted; a second global listener would double-start.
   The server's single-slot 409 + 3 s keepalive watchdog backstops any race between
   the two surfaces.
4. Enablement: the brief asks "enabled only when the LiveAudio service is up".
   **Verified: no proactive STT-availability signal exists** — `HealthState` has no
   STT dimension and `GET /api/ptt/state` reflects the controller, not WhisperLive
   reachability; unavailability only surfaces as a 503 on `POST /api/ptt/start`
   (mapped to `stt_unreachable`, `src/api/ptt.ts` line 231). Honest zero-backend
   behavior: the mic is enabled whenever the app is running (the `BackendGate`
   already guarantees the backend); a press while STT is down immediately shows the
   existing `ERROR_COPY.stt_unreachable` in the composer status line and the button
   returns to idle. After the FIRST `stt_unreachable` failure, render the mic with
   `opacity-60` and tooltip `PTT no disponible — WhisperLive no está corriendo.`
   until a later press succeeds. A real reachability probe is an SDD candidate (§5).
5. Sent-state: track the previous hook state; on the `flushing → idle` transition
   with `error === null`, show a quiet chip above the composer for 4 s:
   icon `Mic` size 12 + `Turno de voz enviado` (`text-[11px] mono text-dim`,
   `animate-rise-in`, `role="status"`). This mirrors PTTCard's baseline pattern
   (lines 52–77) but simplified: the composer chip confirms the *send*, not the reply
   (Kira's reply lands in the transcript anyway via `useLastReply`).

Mic button visual states (icons: `Mic`, `MicOff`):

| Hook state | Visual | aria |
|---|---|---|
| `idle` | `Mic` icon, `text-muted-foreground hover:text-foreground` | `aria-label="Mantené para hablar con Kira"` `aria-pressed=false` |
| `connecting` | `Mic`, `text-info`, dot pulse | `aria-label="Conectando…"` |
| `listening` | `Mic`, `text-danger` + `bg-danger-bg` circular halo, gentle pulse | `aria-pressed=true`, `aria-label="Escuchando… soltá para enviar"` |
| `flushing` | `Mic`, `text-muted-foreground animate-pulse` | `aria-label="Procesando…"` |
| degraded (after 503) | `MicOff`, `opacity-60` | `title="PTT no disponible — WhisperLive no está corriendo."` |

Button box: `flex h-full w-10 items-center justify-center` inside the trailing
cluster, `transition-colors duration-fast`. Keep `touch-none select-none`.

**Tests to update:** `src/components/ConversationPanel.test.tsx` (asserts the canned
first message and mute-notice today), plus new cases: empty state renders when
transcript empty; mute banner exists exactly once and outside the scroll region; mic
button start/stop calls (mock `usePttHold` or reuse the msw handlers used by
`src/api/ptt.test.ts`).

### 3c. Motion system

**Audit result (all animation/transition surfaces found by grep, with disposition):**

| Surface | Today | New |
|---|---|---|
| `styles.css` `button:hover` brightness | instant snap | element rule `transition: filter var(--dur-fast) var(--ease-io)` PLUS `transitionProperty.colors` extended with `filter` so `transition-colors` buttons animate too (§2.5 + §2.2) |
| `styles.css` `welcome-slide-in` | 280ms `cubic-bezier(.22,1,.36,1)` | `var(--dur-slow) var(--ease-out)` (same curve, now tokenized) |
| `ui/Collapsible.tsx` body + chevron (also the copy in `StreamPanel.tsx` lines 86–104) | `duration-200 ease-in-out` | `duration-base ease-io` |
| `ui/Select.tsx` chevron (line 67) | `duration-200` | `duration-base ease-io` |
| `ui/Toast.tsx` (line 230) / `ui/Snackbar.tsx` (line 104) | `duration-300 ease-out` | `duration-slow ease-out` (token curve) |
| `ui/Switch.tsx` knob (line 33) | default 150ms | `duration-fast ease-io` |
| `ui/Button.tsx`, `Input.tsx`, `Sidebar.tsx`, `SettingsPopover.tsx`, `PlayerBar.tsx`, `ModelCard.tsx`, `ProfilePlaylist.tsx`, `ProfileEditor.tsx`, `TopBar.tsx`, `AgendaPanel.tsx`, `WelcomeCard.tsx`, `StreamPanel.tsx` — all `transition-colors`/`transition-opacity`/`transition` | default 150ms, default curve | add `duration-fast ease-io` wherever a `transition-*` utility already exists (mechanical sweep; do not add transitions to elements that have none) |
| `animate-pulse` (PTTCard listening, ConversationPanel thinking, KiraCover ring, ModelCard progress) | keep — Tailwind pulse at 2s is already calm | keep as-is |
| `animate-ping` ("sesión en vivo" dot, ConversationPanel line 313) | keep | keep as-is |
| `animate-spin` (ProfileSwitcher spinner) | keep | keep as-is |
| `keyframes eq` (tailwind.config) | keep | keep as-is |

**Rules for writers:** never introduce a raw `duration-[0-9]+` or `ease-in-out`/
`ease-linear` class again — only `duration-fast|base|slow` + `ease-out|ease-io`.
New entrances use `animate-rise-in`. Reduced motion is handled globally (§2.4);
remove nothing, add no per-element guards.

### 3d. Alerts — presence without color

**Current state (verified):** inline alerts are bare `<p role="alert"
class="text-xs text-danger">…` scattered across panels (e.g. `AgendaPanel.tsx`
lines 179–183, 321–324, 420–424, 826–829; `ConversationPanel.tsx` 354–358;
`ProfileEditor.tsx` 226–230, 248–252…). `Toast`/`Snackbar` (`src/components/ui/`)
already use the soft-tint tone system. The owner likes the quiet look; the problem is
inline alerts have zero structural presence — they pass unnoticed.

**New component: `src/components/ui/Alert.tsx`.**

```tsx
export type AlertTone = "ok" | "warn" | "danger" | "info" | "neutral";
export interface AlertProps {
  tone?: AlertTone;          // default "neutral"
  title?: string;            // optional bold first line
  children: ReactNode;
  className?: string;
}
```

Renders ONE DOM shape; the three style variants are pure CSS keyed off
`data-alert-style` on `<html>` (so switching styles restyles every alert instantly,
no re-render):

```html
<div role="alert" class="oc-alert" data-tone="danger">
  <TriangleAlert class="oc-alert-icon" size={14} aria-hidden />  <!-- icon per tone -->
  <div><p class="oc-alert-title">…</p><p class="oc-alert-body">…</p></div>
</div>
```

Tone → icon (lucide): `ok`→`CircleCheck`, `warn`→`TriangleAlert`,
`danger`→`OctagonAlert`, `info`→`Info`, `neutral`→`CircleDashed`.

**Variant CSS** (append to `src/styles.css`; uses only existing tone vars — colorless-
by-default means the SURFACE stays neutral; tone appears only in icon/accent):

```css
/* Alert style variants — data-alert-style on <html>, default "sereno" */
.oc-alert { display: flex; gap: 10px; align-items: flex-start; border-radius: var(--r-md);
  padding: 10px 12px; font-size: 12px; line-height: 1.5; color: var(--foreground);
  animation: rise-in var(--dur-slow) var(--ease-out) both; }
.oc-alert-title { font-weight: 700; margin: 0 0 2px; }
.oc-alert-body { margin: 0; color: var(--muted-foreground); }
.oc-alert-icon { flex-shrink: 0; margin-top: 1px; }
.oc-alert[data-tone="ok"]      { --alert-tone: var(--ok);      --alert-bd: var(--ok-bd); }
.oc-alert[data-tone="warn"]    { --alert-tone: var(--warn);    --alert-bd: var(--warn-bd); }
.oc-alert[data-tone="danger"]  { --alert-tone: var(--danger);  --alert-bd: var(--danger-bd); }
.oc-alert[data-tone="info"]    { --alert-tone: var(--info);    --alert-bd: var(--info-bd); }
.oc-alert[data-tone="neutral"] { --alert-tone: var(--muted-foreground); --alert-bd: var(--border); }
.oc-alert-icon { color: var(--alert-tone); }

/* 1) sereno (default) — quiet panel, hairline border, icon carries the tone */
:root[data-alert-style="sereno"] .oc-alert,
:root:not([data-alert-style]) .oc-alert {
  background: var(--surface-2); border: 1px solid var(--border-soft);
}
/* 2) marcado — left accent bar, a notch more presence, still no tinted fill */
:root[data-alert-style="marcado"] .oc-alert {
  background: var(--surface-2); border: 1px solid var(--border-soft);
  border-left: 3px solid var(--alert-tone); padding-left: 11px;
}
/* 3) contorno — transparent, outlined in the tone's soft border color */
:root[data-alert-style="contorno"] .oc-alert {
  background: transparent; border: 1px solid var(--alert-bd);
}
```

AA note: body text is `--muted-foreground` on `--surface-2` — already an existing,
shipped combination; the tone color appears only on the icon (non-text). No new
contrast pairs are introduced. `src/styles/tokens.contrast.test.ts` must stay green.

**Migration in this refresh:** convert ONLY the inline `role="alert"` paragraphs
inside the in-scope files to `<Alert tone="danger">…</Alert>` / `<Alert tone="warn">…`:
- `ConversationPanel.tsx` (the error line at lines 354–358) — migrated **in Phase 4**,
  not Phase 3: Phase 3's chat work leaves that bare `<p role="alert">` untouched, and
  Phase 4 (which ships the `Alert` component) converts it. `ConversationPanel.tsx` is
  listed in Phase 4's files for exactly this one edit.
- `AgendaPanel.tsx`'s `ProfileSessionCard` — migrated in Phase 5 (§3e change 7),
  which is why Phase 5 depends on Phase 4.
- `StatusRail` has none.

All other panels keep their current alerts (migrating them is
mechanical follow-up work, listed as an SDD candidate). `Toast`/`Snackbar` are NOT
restyled (they already read fine) — but their durations join the motion tokens (§3c).

**Settings control: `src/theme/useAlertStyle.ts`** — clone `src/theme/useDensity.ts`
verbatim-pattern (zustand module singleton, applied at module init):

```ts
const STORAGE_KEY = "oc-alert-style";
export const ALERT_STYLES = ["sereno", "marcado", "contorno"] as const;
// applyAlertStyle: document.documentElement.dataset.alertStyle = style;
// localStorage persistence identical to useDensity.ts lines 9–16
```

UI: in `src/components/SettingsPopover.tsx`, add a new section between `Tema`
(lines 125–130) and `Vista` (line 132):

```tsx
<section aria-labelledby="settings-alerts-label" className="space-y-2 border-t border-border-soft pt-3.5">
  <span id="settings-alerts-label" className="…same label classes…">Alertas</span>
  <Segmented ariaLabel="Estilo de alertas" options={[
    { value: "sereno", label: "Sereno" },
    { value: "marcado", label: "Marcado" },
    { value: "contorno", label: "Contorno" }
  ]} value={alertStyle} onChange={setAlertStyle} />
  <Alert tone="info" title="Así se ve una alerta">Elegí el estilo que más te acomode.</Alert>
</section>
```

The live `<Alert>` preview inside the popover updates instantly when the segmented
changes (CSS attribute switch) — self-demonstrating control. Reuses
`src/components/ui/Segmented.tsx` (exists, verified).

**Tests:** new `src/components/ui/Alert.test.tsx` (renders role=alert, tone data-attr,
title/body) + `src/theme/useAlertStyle.test.ts` (mirror `useTheme.test.ts` /
`useDensity` patterns: default, persistence, data-attr) + extend
`SettingsPopover.test.tsx` (section renders, change persists).

### 3e. Agenda → "Perfil Co-host" form (`src/components/AgendaPanel.tsx`, `ProfileSessionCard`, lines 118–269)

**Current behavior (verified + screenshot):** Card "Perfil Co-host" contains, in
order: duplicated section label "PERFIL CO-HOST" → profile `Select` → name `Input`
with `Guardar perfil` button beside it (mid-form!) → style `textarea` → section
"CONFIGURACIÓN DE SESIÓN" → Turnos/Modo selects → `Ritmo` label + `Segmented`
jammed against the card's bottom/left edge with no breathing room.

**Backend truth the layout must encode (from the code, lines 104–117):**
- `Guardar perfil` persists ONLY name + style (`POST /api/agenda/cohost-profiles`).
- Turnos/Ritmo/Modo AUTO-SAVE individually on change (`PUT /api/agenda/session`,
  partial update) — they are NOT covered by the save button.

So "move save to the end of everything" would lie about scope. The correct fix: two
visually distinct groups — an editable *profile* group whose save button closes THAT
group, and a *session* group explicitly marked as applying instantly.

**New structure + wireframe:**

```
┌─ Perfil Co-host ────────────────────────────── [aplicando…] ▾ ┐
│                                                                │
│  IDENTIDAD                                                     │
│  Perfil guardado                                               │
│  [ Natural                                              ▾ ]    │
│  Nombre                                                        │
│  [ Natural                                                ]    │
│                                                                │
│  ESTILO                                                        │
│  Cómo suena Kira                                               │
│  [ Soná como co-host natural de stream: cercana, con     ]    │
│  [ humor seco…                                            ]    │
│                                                                │
│                              [ Guardar perfil ]  ← primary,    │
│  Guarda el nombre y el estilo como un perfil     right-aligned,│
│  reutilizable.                                   closes group  │
│ ───────────────────────────────────────────────────────────── │
│  SESIÓN · se aplica al instante                                │
│  Turnos por tema          Modo de seguridad en vivo            │
│  [ 5              ▾ ]     [ Live-safe                 ▾ ]      │
│                                                                │
│  Ritmo                                                         │
│  ( Calmo | Normal | Dinámico )      ← inline-flex shrink-wrap, │
│                                        mb-1, never touches     │
│                                        the card edge           │
└────────────────────────────────────────────────────────────────┘
```

**Exact changes:**
1. Delete the duplicated inner section label `Perfil Co-host` (line 186) — replace
   with `Identidad`.
2. Add field labels (today the Select and Input are unlabelled visually):
   `Perfil guardado` above the Select, `Nombre` above the name Input — use the
   existing `text-xs text-muted-foreground` label treatment (as at line 227).
3. Move `Guardar perfil` OUT of the name row (delete the
   `grid grid-cols-[1fr_auto]` wrapper, lines 194–210 — the Input becomes full-width)
   to the END of the profile group, right-aligned
   (`flex justify-end`), `variant="primary"`. Below it (or beside, left) the helper:
   `Guarda el nombre y el estilo como un perfil reutilizable.`
   (`text-xs text-muted-foreground`). Pending label: `Guardando…` (replaces button
   text while `saveProfile.isPending`, mirroring `ProfileEditor.tsx` line 343).
4. New `Estilo` section label above the textarea; add a visible field label
   `Cómo suena Kira` (matches the textarea's intent; keep placeholder
   `Cómo querés que suene Kira…` and `aria-label` as-is).
5. Session group: section label becomes `Sesión` with an inline suffix chip
   `se aplica al instante` (`text-[10px] mono text-dim` inside the label row) — this
   sentence is what tells the operator these fields don't need the save button.
   Separate the groups with `border-t border-border-soft pt-3.5` (the app's existing
   section-divider idiom, e.g. `SettingsPopover.tsx` line 132).
6. Ritmo spacing fix: wrap label + control in a `space-y-2` block (label currently
   floats via the parent's `space-y-2` — verified the Segmented sits flush at
   line 253–262); give the `Segmented` `className="mb-1"` — no `self-start`:
   `align-self` only applies to flex/grid items and this wrapper is plain block
   flow, so it would be a dead class. Segmented's root is `inline-flex`, which
   already shrink-wraps to content width in block flow. Ensure the group's
   container keeps the card's `p-4` inset so the pill never collides with the
   card edge. Section container gets `pb-1` bottom breathing room.
7. Error surfacing: replace the top bare `<p role="alert">` (lines 179–183) with the
   new `<Alert tone="danger">` (from §3d), placed INSIDE the group it belongs to:
   save errors under the save button, session errors atop the session group. Keep the
   existing message strings (`No se pudo guardar el perfil.`, `No se pudo aplicar el
   perfil.`, `No se pudo guardar la configuración de sesión.`).

**A11y:** every control keeps its current `aria-label`; new visible labels use
`htmlFor`/`id` pairs where the control accepts `id` (Input does; the custom Select
uses `aria-label` — leave as-is). Section labels keep the `sectionLabel()` helper
(line 92). Tab order becomes identical to visual order (it isn't today: save sits
between name and style).

**Tests:** update `src/components/AgendaPanel.test.tsx` — it queries the current DOM
order and the `Guardar perfil` button's position; add an assertion that the save
button follows the textarea in document order and that session controls still fire
their individual `PUT` mutations.

---

## 4. Implementation phase plan

Dependency graph: Phases 2, 3, and 4 are independent of each other; all depend on
Phase 1. **Phase 5 depends on Phase 4** (§3e change 7 renders the `<Alert>` component
Phase 4 delivers) — do not run it earlier or in parallel with Phase 4. Phase 6 last.
Run per-phase checks with the project interpreter/tooling: `pnpm build`
(= `tsc && vite build`) and `pnpm test` (= `vitest run`; `pretest` regenerates
types from the snapshot — offline-safe).

**Phase 1 — Foundations (tokens, scrollbars, reduced motion).**
- Files: `src/styles/tokens.css`, `tailwind.config.ts`, `src/styles.css`.
- Checks: `pnpm build`; `pnpm test` (must stay green, especially
  `src/styles/tokens.contrast.test.ts`); visually confirm thin scrollbars in all
  three themes (`localStorage["oc-theme"]` = cockpit/aurora/studio) — expect a
  static theme-tinted thumb with NO hover change, per the §2.3 tradeoff.

**Phase 2 — Status readout.**
- Files: `src/components/StatusRail.tsx`, `src/components/TopBar.tsx`,
  `src/components/StatusRail.test.tsx`, `src/components/TopBar.test.tsx`.
- Checks: `pnpm build`; `pnpm vitest run src/components/StatusRail.test.tsx
  src/components/TopBar.test.tsx`; then full `pnpm test`. Manual: with MSW fixture
  states, verify only `action` states show a filled red chip; avatar circle gone;
  popovers open/close via keyboard (Enter, Escape) and outside click.

**Phase 3 — Chat panel.**
- Files: `src/components/ConversationPanel.tsx`, `src/components/ui/KiraFace.tsx`
  (new), `src/api/pttCopy.ts` (new, extracted), `src/components/PTTCard.tsx`
  (import-path change ONLY), `src/components/ConversationPanel.test.tsx`.
- Checks: `pnpm build`; `pnpm vitest run src/components/ConversationPanel.test.tsx
  src/components/PTTCard.test.tsx src/api/ptt.test.ts` (PTT suites must pass
  UNCHANGED — proves pure relocation); full `pnpm test`. Manual: empty state on fresh
  load; muted banner static above composer; mic hold → listening → release →
  `Turno de voz enviado` chip.

**Phase 4 — Alerts + settings variant control.**
- Files: `src/components/ui/Alert.tsx` (new), `src/theme/useAlertStyle.ts` (new),
  `src/styles.css` (variant CSS), `src/components/SettingsPopover.tsx`,
  `src/components/ConversationPanel.tsx` (ONLY the §3d error-line migration at
  lines 354–358 — Phase 3 leaves that `<p>` untouched),
  `src/components/ui/Alert.test.tsx` (new), `src/theme/useAlertStyle.test.ts` (new),
  `src/components/SettingsPopover.test.tsx`,
  `src/components/ConversationPanel.test.tsx` (error-line assertion only, if it
  targets that paragraph).
- Checks: `pnpm build`; targeted vitest on the three test files; full `pnpm test`.
  Manual: switch Sereno/Marcado/Contorno in the gear — the in-popover preview and any
  visible alert restyle instantly; choice survives reload
  (`localStorage["oc-alert-style"]`).

**Phase 5 — Perfil Co-host form.**
- Files: `src/components/AgendaPanel.tsx` (only `ProfileSessionCard` + its imports),
  `src/components/AgendaPanel.test.tsx`.
- Checks: `pnpm build`; `pnpm vitest run src/components/AgendaPanel.test.tsx`; full
  `pnpm test`. Manual: tab order = visual order; Ritmo pill has clear air on all
  sides in comfortable AND compact density (`data-density="compact"` tightens `p-4`
  via `src/styles.css` lines 55–60 — verify no new collision).

**Phase 6 — Motion sweep + a11y pass.**
- Files: `src/components/ui/Collapsible.tsx`, `src/components/ui/Select.tsx`,
  `src/components/ui/Toast.tsx`, `src/components/ui/Snackbar.tsx`,
  `src/components/ui/Switch.tsx`, `src/components/ui/Button.tsx`,
  `src/components/ui/Input.tsx`, `src/components/StreamPanel.tsx`,
  `src/components/Sidebar.tsx`, plus the mechanical `duration-fast ease-io` sweep
  over files listed in §3c (class-string edits only, no logic).
- Checks: `pnpm build`; full `pnpm test`; manual reduced-motion pass (OS setting or
  DevTools emulation): no pulsing/sliding anywhere, app fully usable; keyboard-only
  walkthrough of status popovers, mic button, settings segmented, form.

---

## 5. SDD proposal candidates (out of scope — do NOT implement)

1. **STT/LiveAudio reachability in `/api/status`.** The mic button and PTTCard can
   only learn WhisperLive is down by failing a start (503). A health dimension (or
   `GET /api/ptt/health`) would let the UI disable voice affordances honestly.
2. **Real viewers-chat mute state.** The "chat de viewers silenciado" notice is a
   hardcoded canned turn (`ConversationPanel.tsx` TURNS). Wire it to the actual
   stream/chat-monitor state so the banner reflects and toggles reality.
3. **Remove/gate `TestToastsCard`.** `AgendaPanel.tsx` lines 852–866 ships a
   dev-only toast tester in the production Agenda panel — release-readiness leak.
4. **Chat history persistence.** The transcript is session-local state; every app
   restart wipes it (no chat-history endpoint exists, per R8 audio-only design).
   Decide product stance: persist locally, or embrace ephemerality in the empty state.
5. **Alert migration sweep.** After §3d lands, ~20 bare `role="alert"` paragraphs
   remain across ModelCard/VoiceCard/StreamPanel/MusicPanel/ProfileEditor etc. —
   mechanical migration to `<Alert>` for one consistent alert language.
6. **Copy centralization / i18n.** An i18n endpoint + locale switcher exist
   (`SettingsPopover` Idioma section) but every UI string is hardcoded es-AR in
   components — extraction would make the locale switch real for the UI.
7. **Fixed-width shell.** `body { min-width: 1280px }` + the hard grid
   (`AppLayout.tsx` `248px 1fr 372px`) block smaller windows; a responsive pass is
   its own track.
8. **"Mostrar logs" stub.** The settings toggle stores state but renders nothing
   (needs a backend log-stream endpoint or removal).

---

## Self-critique (quality floor check)

- **Keyboard focus**: chips/popovers/mic all inherit the global `:focus-visible` rule
  (`styles.css` 44–50) plus explicit ring utilities — verified pattern already used
  app-wide. ✔
- **Reduced motion**: single global media rule (§2.4) covers every new and existing
  animation; nothing conveys state through motion alone (labels always carry it). ✔
- **Contrast AA**: no new color pairs — all new surfaces reuse audited tone tokens;
  the alert body text uses an existing shipped pair; `tokens.contrast.test.ts` gates
  regressions. Studio (light) explicitly re-verified in every phase's manual check. ✔
- **AI-default look avoided**: no new palette, no new fonts, no dependency added; the
  refresh sharpens the existing dark+green cockpit instead of re-skinning it. The one
  bold move (calm readout) is information design, not decoration. ✔
- **Honesty checks**: save-button scope matches the API's real persistence split;
  mic enablement doesn't fake a signal the backend can't give; the muted banner is
  documented as canned until candidate #2 lands. ✔
