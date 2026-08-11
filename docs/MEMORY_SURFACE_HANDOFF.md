# Handoff — the Saved Memories surface

**Status: PARTLY EXECUTED, and this document's central verdict was overruled.** Written
2026-08-10 as a design brief; annotated 2026-08-11 after the work shipped in `48016d3` +
`ab96bae`. Read this box before trusting anything below it.

**What shipped instead of §2's recommendation.** §2 concluded "take the `Dialog`" because a
section could only claim ~727px against a dialog's ~1350px. The owner chose the section anyway,
and was right for a reason §2 missed: the space comparison was self-refuting. §1 of this very
document proves settings cards already render at 630–850px, so width was never the constraint —
the constraint was one card carrying too much responsibility. A first attempt did collapse the
queue column to buy the width back; that made Memoria the only section without the chat, and was
reverted. **`ConversationPanel` is mounted for every section, unconditionally. Do not gate it.**

**What still stands.** §3 (the `Dialog` portal blocker) — done. §4's core insight — that the
detail record is thin and the justification is *deleting per-row machinery*, not adding surface —
is **still true and still unimplemented**. §5's load-bearing details (R8 selection-as-activation,
trigger placement, destructive flows, the no-silent-revert cache write, exact wire bodies, scroll
ownership, i18n atomicity) all still apply to whoever builds that.

**What is now obsolete.** §2's verdict, §6's ordering, and §7's open questions 1–3 (answered by
what shipped). §7 Q4 (where Statistics lives) is still open.

**Read `docs/UI_CONSTRAINTS_LEARNED.md` first**, and `docs/OPEN_WORK.md` for what is actually next.

---

## 0. The owner's ask, verbatim

> el modulo de personalizacion y saved memories tiene su propia complejidad para vivir en 300px,
> quiza debemos extirparlos a su propio modal con sidebar o sacarlo de controls y meterlo en su
> propia seccion no tengo idea como lo hariamos

Three premises in that sentence. Two are wrong, and correcting them shrinks the job.

---

## 1. Premise check

### "300px" — wrong, and it matters

There is no 300px anywhere. `AppLayout.tsx:23` is `gridTemplateColumns: "248px 1fr 465px"`, the
default window is 1440×950 (`src-tauri/tauri.conf.json:17-18`), and after `MainStage`'s and
`ControlGroup`'s padding a card renders at roughly **630–850px** depending on sidebar state. No
`max-w-` exists in `src/features/controles/`.

So the problem is **not** horizontal room. It is that `MemoryCard` boxes itself into `max-h-96`
(384px tall) — the only card in Controles that opts out of the panel scroll every sibling relies
on — while carrying far more responsibility than a card should.

Fixing this by chasing width would fix nothing.

### "personalización y saved memories" — these are two unrelated things

| | MemoryCard | PersonalizationCard |
|---|---|---|
| Lines | **763** | 215 |
| Hook call sites | **27** (13 `useState`, 4 queries, 6 mutations) | 7 |
| i18n keys | **99** (`controles.memory.*`) | 23 (`controles.personalization.*`) |
| Test file | **958 lines, 53 tests** | 199 lines, 12 tests |
| Backend | `/api/memoria/*`, **per-profile** | `/api/personalization`, **global, profile-independent** |
| Query keys | `memoria-stats/list/row/notice` | `personalization` |

No shared state, provider, cache entry, route or i18n key. They sit together only because
`ControlsPanel.tsx:60-64` mounts them in one `ControlGroup`.

**Personalization does not have a complexity problem.** A form plus a two-step danger zone, 215
lines. Moving it would be inventing a coupling the data does not have.

**Scope this to MemoryCard.** If a later surface genuinely needs both, that is a separate decision
with its own evidence.

### A third card is hiding in that group

`ControlsPanel.tsx:63` also mounts `EditorialCardsCard` under the same "Memory" title and the same
`persistKey="controles-memoria-personalizacion"` collapse. Any plan that empties the group must say
where it lands. It is not addressed here.

---

## 2. Section vs modal — the counterintuitive answer

The owner offered both. A prior design rejected the section option claiming it would mean
"inventing navigation plumbing that does not exist". **That claim was wrong** — but the option
still loses, for a different and better reason.

**Adding a nav section is cheap and documented.** `docs/LAYOUT.md:80-84` gives four edits: an entry
in `NAV_ITEMS` (`Sidebar.tsx:20-26`), the `shell.nav.<id>` key in **both** shell bundles, the
`Section` union (`Sidebar.tsx:10`), and a branch in `MainStage`'s switch. No test pins the nav list
length or section count, so a sixth item breaks nothing.

**But a section cannot claim the screen.** `ConversationPanel` — the 465px queue column
(`AppLayout.tsx:19,104`) — is mounted **unconditionally** at `AppLayout.tsx:129-134`, outside
`MainStage`'s section switch, with no per-section gating. Every section, new ones included, lives
in the `1fr` main column: **~727px** with the sidebar expanded at the default window size. Escaping
that means adding a fourth grid area, which `docs/LAYOUT.md:33-37` calls out as beyond the four-edit
recipe (the commented-out `player` area is the only precedent).

A `Dialog` sized `w-[min(78rem,94vw)]` gets **~1350px** at the same window.

**So the modal has roughly twice the room a section would.** For a two-pane master-detail library,
that decides it. Take the `Dialog`.

Revisit only if the queue column ever becomes section-aware — at that point a section becomes the
better home and the migration is small, because the master-detail component would be the same
either way. Build it as a self-contained component that a `Dialog` happens to host, not as
something welded to dialog internals.

---

## 3. Blocked on one primitive fix — do this first

`src/ui/Dialog.tsx` does not portal, and `Card` makes itself a containing block for `fixed`
descendants on the aurora theme (see constraints doc §1). Every `Dialog` mount today is inside a
`Card`. So on aurora the overlay positions against the card, not the viewport.

At 44rem this is tolerable-invisible. At 78rem it will not be.

**Fix `Dialog` to `createPortal(…, document.body)` before building anything on top of it.**
Unconditionally — the precedent `Select` set in `40f7537`. Focus trap and restore are ref- and
document-listener based, so relocation does not affect them, and testing-library `screen` queries
`document.body`, so existing dialog tests stay valid. This also fixes `ProfileEditor` for free.

Verify with the full suite before moving on. This is its own commit.

---

## 4. What the master-detail is actually for

**The detail pane is thin — do not build a workbench.** The real record
(`opencohost/api/models.py:841-864`) is:

```
id, title, content, created_at, updated_at, pinned, private, inactive, draft, promoted
```

No tags, no source label (provenance collapses to one boolean), no relations, no scores.
`GET /api/memoria/list` accepts only `profile_id`. A mockup imagining "origen, tipo, vigencia,
relaciones" is imagining fields that do not exist.

**The justification is the list side.** Today each of 111 rows owns three `useState`, its own
`useMemoriaRowQuery`, three mutations, an inline edit form and a private `Dialog`. Master-detail is
a **deletion**: 3×N state → ~5, N queries → 1, N×3 mutations → 3, per-row dialog → gone.

Judge any proposed change by whether it deletes that. If a design adds surface without collapsing
the per-row machinery, it has missed the point.

**Explicitly reject:** pagination or virtualization (111 compact rows is nothing), a table/DataGrid
abstraction, tabs in the detail pane, a new drawer primitive.

---

## 5. Load-bearing details for whoever implements

- **R8 privacy.** `MemoryCard.tsx:55-60` explains `enabled: false` + manual refetch: content is
  never preloaded with the list, and only an explicit operator click fetches it. Selection-as-
  trigger preserves this **only if selection means activation** — click, Enter, Space. Never focus,
  never hover, or keyboard traversal becomes bulk content fetching. A test pins the spy count.
- **Trigger placement.** With `enabled: false` and a changing key, `refetch()` must run from an
  effect on the new `selectedId`, not from the click handler — the hook has to re-render with the
  new key first.
- **Destructive flows must survive intact**: per-row delete's two-step with no request before
  confirm; purge's three stages including the ack; clear-history's ack gate. Keep `ConfirmFooter`.
- **No-silent-revert** (`MemoryCard.test.tsx:480-509`) pins the row-cache write at
  `memoria.ts:415-421`: edit → save → re-edit **without changing selection** shows saved content.
  Keep that shape; re-selecting legitimately refetches and MSW's fixture would mask the guarantee.
- **Wire bodies are pinned exactly**: flags `{profile_id, id, pinned}`, delete `{profile_id, id}`,
  update `{profile_id, id, title, content}` — and `profile_id` is the UUID, never the display name.
- **Scroll ownership**: exactly two scrollers — the list pane and the detail content — built with
  the `min-h-0` flex chain the repo already uses (`ProfileEditor.tsx:155`, `AppLayout.tsx:26-27`).
  The dialog shell clips; the card inside must **not** also scroll. No `max-h-*` on the list.
- **i18n**: both bundles move together or `tsc` fails. Key removal and last-use removal are atomic.
- **Constraint from the owner:** no backend changes, no change to mutation semantics in this phase.
  Funnel display through one derived `visibleItems` so a future server-side
  `search/filter/sort/limit/cursor` slots in without a layout rewrite. Do not add speculative props.

---

## 6. Suggested order, each step green

1. **Portal `Dialog`.** Own commit. Full suite must stay at its current count.
2. **Add the manager component and its tests, unmounted.** Purely additive; `MemoryCard` untouched.
   New i18n keys are type-safe before first use.
3. **Rewire `MemoryCard`**: delete the list internals, add the entry point, relocate purge into the
   existing danger section. Trim its test file and remove dead keys — one commit, because the typed
   bundle makes key removal and last-use removal atomic.

The orphaned `localStorage["oc-collapse-memoria-list"]` needs no migration; note it in the message.

---

## 7. Open questions — the owner's call

1. **Where does the entry point live?** A button in the Memory group that says how many memories
   there are, or something more prominent? Today the list hides behind a collapse toggle, which is
   itself a symptom of the component being too big for its slot.
2. **`EditorialCardsCard`** — stays in a group now named for two cards that left, moves, or gets its
   own group? (§1)
3. **Does Personalization move at all?** The evidence says it has no problem to solve. Confirm it
   stays before anyone bundles it in.
4. **Statistics** — the counts block (`MemoryCard.tsx:608-629`) reads turns/digest/saved/pinned
   plus editorial-card status. Stay in Settings, or move into the manager's footer?

---

## 8. What this document does not claim

Nothing here has been implemented or measured against a running app. Every `file:line` was read on
2026-08-10 and should be re-verified before work starts. The width figures are computed from the
grid definition and the default window size, not measured in a browser — the ratio (a dialog gets
roughly twice a section's room) is the load-bearing part, not the exact pixels.
