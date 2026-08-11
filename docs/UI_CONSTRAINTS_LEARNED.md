# UI constraints learned — 2026-08-10

Written during the Select/Dialog/overflow batch (commits `04ddc95`…`d65fd82`). These are
things that cost real debugging to find. Read this before designing any new surface in this
repo; several of them are invisible until they bite, and two of them already shipped as bugs.

---

## 1. `Card` makes itself a containing block for `fixed` descendants

`src/ui/Card.tsx:11` applies `style={{ backdropFilter: "var(--surface-blur)" }}`. The token is
`blur(16px) saturate(1.1)` on **aurora** (`src/styles/tokens.css:145`) and `none` on cockpit and
studio (`:64`, `:209`).

Per CSS Filter Effects, a non-`none` `backdrop-filter`:

- creates a **stacking context**, and
- makes the element a **containing block for `position: fixed` descendants**.

So on aurora, anything `fixed` inside a `Card` is positioned relative to the Card, not the
viewport. This has produced two separate bugs:

- **Dropdowns painted over by the next card.** Fixed in `40f7537` by portaling the `Select`
  listbox to `document.body`. An earlier attempt (`de3de33`, 2026-07-10) added `z-20` to the
  wrapper and did nothing — raising the `.relative` wrapper only scopes the inner `z-50` into a
  new context rooted at 20; it never addresses a later sibling.
- **`Dialog`'s `fixed inset-0` overlay mispositioned on aurora.** `src/ui/Dialog.tsx` did not
  portal, and every mount is inside a `Card`. That used to be because `ControlsPanel.tsx`'s
  `ControlGroup` wrapped every Controles section in one — `ControlGroup` is deleted (replaced by
  a `PaneSwitcher`, see `ControlsPanel.tsx`). It stays true today for a different, per-call-site
  reason: `MemoryCard.tsx` and `ProfileSwitcher.tsx` (whose `Card` wraps `ProfileEditor`'s Dialog)
  each own their own `Card`. **Fixed in `48016d3`** with the same move Select took: portal to
  `document.body`. Still owed a look in a real aurora window — jsdom cannot render
  `backdrop-filter` or compute a containing block, so no test proves the overlay now centres.

**Rule:** if a surface uses `position: fixed` and can be mounted inside a `Card`, it must portal.
Do not reason about z-index first — check the containing block.

---

## 2. A capture-phase listener on `window` is not scoped to the window

`window.addEventListener("scroll", handler, true)` sees scroll events from **every** element in
the document, because capture propagates from `window` down to the target.

`Select` closes on scroll (a portaled list does not follow its trigger). When `6f7194b` gave the
list `max-height` + `overflow-y-auto`, that same listener started catching the list's **own**
scrolling — so one turn of the wheel inside the dropdown closed it. Adding
`scrollIntoView` to centre the selected option would have closed a select the instant it opened.

Fixed in `d65fd82` by ignoring events whose target is inside the list.

**Rule:** when adding internal scrolling to anything, check whether a capture listener upstream is
already listening for scroll. The failure is silent and jsdom cannot see it.

---

## 3. What the test suite can and cannot prove

jsdom has **no layout engine**. Every geometry read returns zero. It also does not implement
`Element.prototype.scrollIntoView` at all — `src/test/setup.ts:18-22` stubs it, which means any
behaviour that depends on real scrolling is invisible.

Consequences, stated plainly so nobody re-learns them:

- Paint order, stacking, and whether anything is actually visible on screen: **unverifiable**.
- Derived values ARE verifiable: stub `getBoundingClientRect` and `window.innerHeight`, then read
  back the resulting inline style. `Select.test.tsx` and `Sidebar.test.tsx` both do this. It proves
  the number came from measurement rather than a constant — nothing more.
- A green suite after a geometry change means "nothing else broke", never "the fix works".

**Rule:** every geometry change ships with an explicit note about what still needs a human looking
at a real window. A vacuous test is worse than no test — it makes the next person believe the
behaviour is guarded.

---

## 4. `Select` owns all dropdown geometry; call sites own nothing

`src/ui/Select.tsx` is a single implementation. The two-mode union (an `options` array for the
themed dropdown, `<option>` children for a bare native `<select>`) was **deleted in `6f7194b`**,
because neither branch was "wrong" to the type checker and three call sites silently shipped
unstyled OS chrome — two of them carrying committed comments admitting it.

The primitive owns: portal, stacking, open direction, width from the trigger, max-height from
measured space, internal scroll, scroll-to-selection, click-outside, close on scroll/resize, ARIA,
selected/disabled states, tokens.

This is **enforced by construction**, not by convention: `className` lands on the outer wrapper
(`Select.tsx`'s `cn("relative", className)`), and the `<ul>` carries hardcoded classes. A call site
physically cannot reach the dropdown's stacking, height, scroll or position.

The one gap: there is no width API, so `ProviderCard.tsx:372` passes `className="w-44"` to size the
trigger. It is coherent (the panel measures that same wrapper), but the "call sites pass only
options/value/onChange/disabled/aria" rule is not literally satisfiable until a width prop exists.

**Rule:** before treating "this control has no design" as a CSS problem, check which primitive the
call site is actually using and how.

---

## 5. Two controls that are correctly NOT `Select`

Confirmed by an exhaustive sweep (patterns: `<select`, `<option`, `<optgroup`, `<datalist`,
`role="listbox|option|menu|combobox"`, `aria-expanded`, `aria-haspopup`, `createPortal`,
`getBoundingClientRect`, `type="radio"`, document `pointerdown`/`mousedown` listeners):

- **`SettingsPopover.tsx`** — a multi-widget panel (Segmented, Switch, Alert, a nested Select, a
  help accordion), not a single-value picker.
- **`ComposerCommandPanel.tsx`** — live-filtered command autocomplete with rich option rows and
  keyboard nav driven from a *different* focused element (the composer input).

Neither was ever a native `<select>`. Do not migrate them; `Select` cannot serve either without
becoming something else.

`Segmented` (`src/ui/Segmented.tsx`) is the right primitive for short mutually-exclusive enums and
is used at 11 call sites. `SettingsPopover.tsx:210-231` deliberately branches between `Segmented`
(≤3 options) and `Select` (>3) — that is a considered choice, not an oversight.

---

## 6. Scroll ownership: the app is already disciplined

An audit of every `max-h-*`/`overflow-*` in `src/` found that Controles, Agenda, Stream, Música,
Memoria, the Sidebar and ConversationPanel's feed each have exactly one scroll owner, and it is
the right one:

- Controles / Agenda / Stream / Música / Memoria → `SettingsSection.tsx`'s inner body `<div>`, the
  element actually carrying `overflow-auto` (`PANEL_CLASS`). Cards render straight into page flow
  with no inner box. **This is the reference pattern.** `MainStage.tsx` no longer owns this
  `<main>` itself for any section — every one of the five routes through `SettingsSection` now
  (JD-9: Stream/Música used to hand-roll a second copy of the same `<main>`; that branch is
  `SettingsSection`'s own `if (!header)` case).
- **Header-slot pattern** (Controles/Agenda/Memoria): `SettingsSection`'s `header` prop renders in
  a `shrink-0` sibling ABOVE the scrolling body, both inside the same `<main>` — not `sticky`, not
  `fixed`, just ordinary flex layout with the header outside the scroll container. This is how a
  pane switcher stays on screen regardless of how far the active pane's body scrolls. Stream and
  Música pass no `header`, so they get `SettingsSection`'s other branch: a single
  `<main className={PANEL_CLASS}>`, no header slot, byte-identical to what `MainStage.tsx` used to
  render inline. See `SettingsSection.tsx`'s own doc comment, and `docs/OPEN_WORK.md` §1 for what
  jsdom still cannot prove about this split (DOM ancestry is verifiable — `SettingsSection.test.tsx`
  does; whether the header visually stays put while the body scrolls is not).
- Sidebar → nav buttons and footer are `shrink-0`; only `ProfilesRegion` scrolls.
- ConversationPanel → the tabpanel, with content capped (`TRANSCRIPT_CAP = 200`).
- `Dialog` → the shell clips (`max-h-[85vh] overflow-hidden`) and the inner `Card` scrolls
  (`min-h-0 … overflow-y-auto`). Both current callers do this correctly.

**`MemoryCard`'s list used to be the one deviation** — the only card that boxed itself
(`max-h-96`) instead of trusting the panel scroll like every sibling. Removed in `ab96bae` when the
card moved into its own Memoria section, where the pane it lives in IS the content. The app now has
zero inner scroll boxes outside the owners listed above. Do not add one; the pattern to copy is
"no inner box".

---

## 7. A fragile invariant nothing in the UI enforces

`src-tauri/tauri.conf.json` sets `minWidth: 1280`, `minHeight: 820` (default 1440×950).

Several things are correct *only* because of that floor: `WelcomeCard` is a fixed 680px with no
scroll (and a test pins the absence of `overflow-y-auto`), `KiraCover` clips a 520px stage with no
scroll, and Controles panels need no inner cap. If the floor is ever lowered, or the app is opened
in a plain browser tab, those silently clip.

Nothing in the UI layer asserts this. Treat it as a real dependency when designing anything with a
fixed height.

---

## 8. An un-extracted primitive, noted not built

The pattern `min-h-[96px] max-h-[240px] overflow-y-auto resize-y` is repeated byte-for-byte across
`MemoryCard`, `EditorialCardsCard`, `PersonalizationCard`, `ProfileEditor` and `AgendaPanel`. It is
primitive-shaped but has not been extracted, deliberately — it works and nobody asked.
`EditorialCardsCard.tsx:62-65` holds the closest thing to a spec (`textareaBase`,
`textareaNarrative`, `textareaCompact`) if it is ever pulled out.

---

## 9. i18n bundles fail closed

`src/i18n/bundles/<domain>.en.ts` is typed `Record<keyof typeof <domain>Es, string>`, so a key added
or removed in one bundle without the other is a **compile error**. This is the guard working — do
not work around it. It also means key removal and last-use removal must land in the same commit.

One hole worth knowing: excess-property checking does **not** fire for keys arriving via a spread,
so every EN bundle must stay a direct object literal — not `satisfies`, not a spread build.
