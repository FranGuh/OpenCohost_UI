# Open work — UI

Last reconciled **2026-08-11** at `ab96bae`, branch `codex/ui-ux-audit-proposal-20260709`.
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

**One cosmetic call.** "Memoria" now appears three times on that screen: the nav item, the
segment label, and `MemoryCard`'s own heading (`controles.memory.card.title`). Not fixed —
renaming a card title is the owner's call, not a cleanup.

---

## 2. The composer — diagnosed, not fixed

Two independent defects on the direct-chat path. Both are real; neither is speculative.

**A hung POST leaves the composer dead with no feedback.** `src/api/client.ts` sets no timeout on
any request. `handleSubmit` (`src/features/experiencia/ConversationPanel.tsx:519-550`) clears the
input only after `await send(text)` resolves, and the Send button is `disabled={pending}`. So a
fetch that never settles gives: text stuck in the input, button permanently greyed, no error
banner — and because `handleSubmit` opens with `if (pending) return`, every later send is silently
dropped until reload.

Observed live on 2026-08-10: the operator's turn reached the engine (`[TURN_LATENCY] source=direct
queue_wait_ms=31`, provider `nvidia_nim`) while the UI still showed an unsent message and a dead
button.

Fix: an `AbortSignal` timeout so a hang becomes a visible, recoverable error instead of a grey
button — and so the next occurrence leaves evidence.

**The Idempotency-Key wedges on conflict.** `src/api/chat.ts:38-40` rotates the key only
`onSuccess`. Keeping it across a failure is deliberate and correct for a *verbatim* retry — the
backend replays and dedupes. But if the operator edits the text before retrying, the backend sees
the same key with a different payload and returns `conflict` (`opencohost/api/dispatch.py:63-67`)
→ 409, for the full 600s TTL (`dispatch.py:24`). The composer is bricked for ten minutes.

Fix: rotate the key when the text changes after a failure. The tradeoff is honest — if the
original turn did land, Kira answers twice, which beats a ten-minute lockout.

---

## 3. The command palette — owner wants it to stop navigating

The owner's words: *"me gusta más tenerlo integrado con el input y chat flotante, o sea se invoca
ahí, no llevar a otra sección."*

**It routes you out of the chat.** `ConversationPanel.tsx:813-817` — picking a command from the
launcher calls `setActiveTab("comandos")`. Deliberate (a July layout correction), now reversed by
the owner.

The floating host **already exists and is unused**: `ComposerCommandPanel` in non-`inline` mode
(`src/features/commands/ComposerCommandPanel.tsx:295-303`) renders a `role="dialog"` above the
composer with the picked command's Stepper inside. `ConversationPanel` only ever mounts it with
`inline`. This is re-wiring, not building.

**Cancelar in the Comandos tab is a dead button.** `ComposerCommandPanel.tsx:252`:
`const dismiss = inline ? returnToList : onClose`. At the list level there is no active command,
so `returnToList` sets `activeId` to `null` — which it already is. The button does nothing. It
should return to the chat. Note the two call sites want different things: the Stepper's cancel
should return to the list, the list's cancel should close the panel.

---

## 4. Deferred with a reason

**Master-detail for the memories list.** Still the right idea and still unbuilt. Today each of
~118 rows owns three `useState`, its own `useMemoriaRowQuery` and three mutations. The Segmented
split means you only pay that while actually on the memories pane, which is why this stopped being
urgent — but it is the fix if the list ever feels slow to open. `docs/MEMORY_SURFACE_HANDOFF.md`
§4–§5 has the full brief, including the R8 privacy constraint that makes selection-as-activation
mandatory. Judge any proposal by whether it *deletes* per-row machinery.

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
- **Assert absence, not invisibility.** `MemoriaPanel`'s tests use `not.toBeInTheDocument()`
  precisely because `not.toBeVisible()` would pass with all three panes mounted and two hidden —
  which is the thing the design forbids. All three tests were confirmed to go red under that
  shortcut.
- **Every geometry change ships with an explicit note about what a human still has to look at.**
  A vacuous test is worse than no test: it makes the next person believe the behaviour is guarded.
