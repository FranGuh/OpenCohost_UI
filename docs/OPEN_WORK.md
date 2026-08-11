# Open work — UI

Last reconciled **2026-08-11** after closing the composer + command-palette batch, branch
`codex/ui-ux-audit-proposal-20260709`.
Nothing here is pushed.

This is the entry point for the next track. Read `docs/UI_CONSTRAINTS_LEARNED.md` before
touching any surface — it carries the traps this repo already paid for.

---

## 1. Blocked on the owner, not on code

**Real-window validation.** Everything geometric in the last two batches is unproven by the
suite, and that is not a gap that more tests can close: jsdom has no layout engine, so paint
order, stacking, and whether anything is actually visible are all invisible to it. A green suite
after a geometry change means "nothing else broke", never "the fix works".

Owed a look in a running aurora window:

| What | Why it is unproven |
|---|---|
| `Dialog` centring after the portal (`48016d3`) | jsdom cannot render `backdrop-filter` or compute a containing block |
| Stream's spam select, Agenda's 20-option turn select | dropdown geometry is derived-value-tested only |
| A select in a cramped viewport (the 30–40px case) | the floor is unit-tested; the *result* is not |
| `ModelCard` in cloud mode | the backend deliberately returns an empty catalog there |
| The Memoria section at ~695px | asserted via a `grid-template-columns` string, not real geometry |
| The memories list with ~118 real rows under the panel scroll | no inner box any more; needs a sanity check on page length |
| The `SettingsSection.tsx` header/body split actually pinning the header while the body scrolls (Controles/Agenda/Memoria) | `SettingsSection.test.tsx` proves DOM ancestry only — the header sits outside the `overflow-auto` element; jsdom has no layout engine, so whether the header visually stays put while the body underneath it scrolls is unverifiable |
| `MemoryCard`'s counts grid (`repeat(auto-fill,minmax(104px,1fr))`) reflowing its column count at ~695px, and again with the sidebar collapsed | the column count is derived from real container width; jsdom returns zero for every geometry read |
| The collapsed nav's name card actually sitting beside its icon and not under the window chrome | the clamp math and the `position: fixed` anchor are unit-tested off stubbed rects; whether the result LOOKS right is not |
| The floating command panel above the composer with a tall Stepper (`/perfil`, `/agenda`) | it renders at `bottom-full` with no height cap of its own — it can only be seen to overflow the window in a real one |

**One cosmetic call.** "Memoria" now appears three times on that screen: the nav item, the
segment label, and `MemoryCard`'s own heading (`controles.memory.card.title`). Not fixed —
renaming a card title is the owner's call, not a cleanup.

---

## 2. The composer — FIXED 2026-08-11

Both defects are closed. Kept here with their evidence because the reasoning is the load-bearing
part; the code alone does not explain why the two halves differ.

**A hung POST left the composer dead with no feedback.** `handleSubmit`
(`src/features/experiencia/ConversationPanel.tsx`) clears the input only after `await send(text)`
resolves, and Send is `disabled={pending}`. A fetch that never settled gave: text stuck in the
input, button permanently greyed, no error banner — and because `handleSubmit` opens with
`if (pending) return`, every later send was silently dropped until reload.

Observed live on 2026-08-10: the turn reached the engine (`[TURN_LATENCY] source=direct
queue_wait_ms=31`, provider `nvidia_nim`) while the UI still showed an unsent message and a dead
button.

Fixed with `AbortSignal.timeout(CHAT_TURN_TIMEOUT_MS)` (15s) in `postChatTurn`, mapped to a 408
`ApiError`. **Armed on that one endpoint, not in `fetch`.** `/api/chat/turn` only enqueues, so 15s
means "hung"; model pulls and TTS synthesis are legitimately slower than that, and a blanket
timeout would break endpoints that never had this failure to defend against one that did.

**The Idempotency-Key wedged on conflict.** `src/api/chat.ts` rotated only `onSuccess`. Holding it
across a failure is correct for a *verbatim* retry — the backend replays and dedupes. But an
operator who edited the text before retrying sent the same key with a different payload, which
`opencohost/api/dispatch.py:63-67` answers with `conflict` → 409 for the full 600s TTL
(`dispatch.py:24`). Ten-minute lockout.

Fixed by tracking the last attempted text and rotating only when it changes. The tradeoff is
honest and deliberate: if the original turn did land, Kira answers twice — better than a
ten-minute brick. Both halves are pinned by tests, and both were proven to fail with the guard
removed (rotate-always breaks the retry test; rotate-never breaks the edit test).

---

## 3. The command palette — FIXED 2026-08-11

The owner's words: *"me gusta más tenerlo integrado con el input y chat flotante, o sea se invoca
ahí, no llevar a otra sección."*

**It no longer routes you out of the chat.** Picking a command from the launcher used to call
`setActiveTab("comandos")` (a July layout correction, reversed by the owner). It now sets
`launcherCommandId`, which mounts `ComposerCommandPanel` **without** `inline` — the floating
`role="dialog"` above the composer that had existed since the mockup and was never mounted. The
tab never moves and the conversation stays on screen; the test asserts both, because a tab that
stays put is worthless if the timeline left with it.

Two things that fell out of doing it:

- **Precedence.** Both surfaces render at `absolute inset-x-0 bottom-full`. An open command wins
  (`launcherOpen = showCommandPanel && launcherCommandId === null`), so typing `/` again cannot
  stack a launcher over — or silently replace — a half-filled Stepper. `aria-expanded` follows.
- **Focus restore was quietly broken and is now correct.** `composerRef.current.querySelector("input")`
  matched the *Stepper's* first text field, since both command surfaces mount inside `composerRef`.
  It focused that, then watched it unmount with the panel, dropping focus to `<body>`. The composer
  input now carries the fixed id `composer-input` and focus restore names it.

**Cancelar in the Comandos tab is no longer a dead button.** `dismiss = inline ? returnToList :
onClose` is right for cancel *inside an open command*, but the list level has no active command, so
it set `activeId` to the `null` it already was. `CommandList` now gets `onClose` directly, so the
list's Cancelar returns to the chat while the Stepper's still steps back to the list. Both
directions are tested.

Note Escape at the inline list level is still a no-op, deliberately: Escape dismisses a transient
overlay, and the Comandos tab is not one.

---

## 4. Deferred with a reason

**Master-detail for the memories list.** Still the right idea and still unbuilt. Today each of
~118 rows owns three `useState`, its own `useMemoriaRowQuery` and three mutations. The Segmented
split means you only pay that while actually on the memories pane, which is why this stopped being
urgent — but it is the fix if the list ever feels slow to open. `docs/MEMORY_SURFACE_HANDOFF.md`
§4–§5 has the full brief, including the R8 privacy constraint that makes selection-as-activation
mandatory. Judge any proposal by whether it *deletes* per-row machinery.

**`Segmented` is not a tablist, and the pane switchers use it as one.** Two Judgment Day judges
raised this. `Segmented` renders `role="group"` with independent `aria-pressed` buttons: no
`aria-controls`, no `role="tabpanel"`, no roving tabindex, no focus move or live-region
announcement when the whole body swaps. A screen-reader operator gets three separate tab stops and
no signal the main region changed. Deliberately out of scope for the correction round — it is a
shared primitive with 11 call sites and rewiring it there is its own change. The per-pane `<h2>`
headings deleted with `ControlGroup` were restored, which recovers document structure but not the
tab relationship.

**Kira's suggestions are only reachable from Agenda's non-default pane.** `SuggestionsCard` lives
in the Topics pane and the segment carries no count or badge, so an operator parked on Cohost
profile gets no signal that new approve/reject suggestions arrived mid-session. Raised as a
suggestion by one judge. The fix is a badge on the segment, which is new design rather than a
correction.

**A `Select` width API.** `ProviderCard.tsx:372` passes `className="w-44"` to size its trigger.
Coherent (the panel measures that same wrapper), but it means "call sites pass only
options/value/onChange/disabled" is not literally true yet.

**The un-extracted textarea primitive.** `min-h-[96px] max-h-[240px] overflow-y-auto resize-y`
repeats byte-for-byte across five components. Primitive-shaped, deliberately not extracted —
it works and nobody asked. `EditorialCardsCard.tsx:62-65` holds the closest thing to a spec.

**Locale governance.** Owner-local proposal at
`conductor/tracks/i18n_completion_20260723/proposal-locale-governance-20260810.md` (gitignored,
Python repo). Units U1–U6, five open questions. Not started.

---

## 5. Standing rules earned the hard way

- **`ConversationPanel` is mounted for every section.** Not unmounted, not `display: none`. It
  owns the transcript, composer draft, active tab and `seenLogId` as local state. `AppLayout.tsx`
  carries the comment; `AppLayout.test.tsx` carries the guard, and that guard was verified
  load-bearing by hand.
- **Unmount only where you can name the cost you are avoiding.** `MemoriaPanel` unmounts its
  inactive panes and its tests assert `not.toBeInTheDocument()`, because ~118 memory rows each own
  three `useState`, a query and three mutations. Controles and Agenda keep every pane **mounted**
  and hide them with the `hidden` attribute plus an inline `display: none` (the `[hidden]` UA rule
  loses to an author `display` utility — see `Tabs.tsx:136-142`), because unmounting there
  destroyed unsaved operator input, including `ObsCard`'s write-only password, which nothing can
  recover. Judgment Day caught this: the rule had been over-generalised from Memoria's perf case
  to two panels that never had it. Their tests assert the `hidden` attribute AND that a typed
  draft survives a pane round trip — the second is the one that would have caught the defect.
- **A test that names a guard must fail when the guard is deleted.** `PaneSwitcher`'s
  localStorage-failure test passed for two different wrong reasons before it was real: first
  because `window.localStorage.setItem = fn` does not replace the method in jsdom (Storage's proxy
  turns it into a stored entry keyed `"setItem"`), then because React reports a throw from an
  event handler asynchronously, so the synchronous assertions all still passed and only the run
  exited non-zero. Both versions reported green while the `try/catch` was absent. Verify by
  deleting the guard and watching that specific test go red — not the run, the test.
- **Every geometry change ships with an explicit note about what a human still has to look at.**
  A vacuous test is worse than no test: it makes the next person believe the behaviour is guarded.
- **`querySelector("input")` inside a container that hosts other people's inputs is a bug waiting
  to happen.** `composerRef` wraps the composer AND both command surfaces, so the bare selector
  matched a Stepper field, focused it, and lost focus to `<body>` when the panel unmounted. Name
  the element (`#composer-input`) — the repo already uses fixed ids for exactly this
  (`conversation-panel`, `command-palette-listbox`).
- **A deadline that cannot be advanced still has to be tested.** `AbortSignal.timeout` runs on
  Node's internal timers, which vitest's fake clock does not patch, so no test can make 15s pass.
  Split it: assert the request CARRIES an armed signal (spy on `AbortSignal.timeout`) and assert
  the `TimeoutError` → 408 mapping separately (stub `fetch` to throw one). Deleting either half
  turns exactly one of them red — verified.
