# UI domain split + i18n substrate — migration plan

Branch: `refactor/ui-domains-i18n-20260810` (based on `264017d`).
Scope: this repo only (`OpenCohost_UI`). Nothing in `E:/VoiceAI` (the Python backend) is in scope.

This document is the whole contract. An implementer working a single batch should need
nothing else except the batch number they were given.

---

## 0. Ground rules that apply to every batch

**Baseline gate**, measured on `264017d` with a clean tree:

| Check | Command | Expected |
| --- | --- | --- |
| Tests | `pnpm test` | 82 files, 1050 tests, all passing, ~83s |
| Import integrity | `pnpm exec tsc --noEmit` | no output |

Both must be green at the end of every batch. A batch that cannot reach green is reported,
not forced.

**Why `tsc` is the workhorse here.** `tsconfig.json` uses `"module": "NodeNext"` /
`"moduleResolution": "nodenext"`, has no path aliases, and every relative import carries an
explicit `.js` extension (`import { Alert } from "./ui/Alert.js"`). So every single file move
invalidates a set of import specifiers, and `tsc --noEmit` names each one with an exact
`file:line`. Predicting the breakage (this document does) is a convenience; `tsc` is the
authority.

**Where `tsc` is blind.** `vi.mock("...")` takes a *string literal*, not an import.
TypeScript will not flag a stale one; the test will fail at runtime, or worse, silently render
the real component. There are 12 `vi.mock` calls in the repo and exactly **three** of them
name a module that moves in this migration. They are listed in §3 and §7 — check them by hand.

**Rules.**

- No behavior change, no visual change, no copy rewording, no voseo neutralization.
- No new npm dependency.
- Do not touch `src-tauri/`, `dist/`, `node_modules/`, `public/`, `openapi.snapshot.json`,
  or `src/api/types.gen.ts` (generated).
- Do not commit, stage, branch, or revert. The orchestrator commits each batch after
  verifying it.
- Batches run **sequentially**. `MainStage.tsx`, `AppLayout.tsx` and `App.tsx` are edited by
  almost every batch; parallel batches would collide in those three files.

**One warning about `pnpm test`.** The `pretest` script runs `gen:api:offline`, which
rewrites `src/api/types.gen.ts` from `openapi.snapshot.json`. On a clean tree this is a
no-op. If `git status` shows `types.gen.ts` dirty after a test run, that is the generator,
not your batch — do not include it in the diff.

---

## 1. Domain map

### 1.1 Destination shape

```
src/
  main.tsx            ← unchanged (entry point, referenced by index.html)
  App.tsx             ← unchanged (root component; only its import lines change)
  styles.css          ← unchanged
  ui/                 ← the shared design system, lifted out of components/
  i18n/               ← new (§4)
  features/
    shell/            app frame: window bar, grid, nav, section router, global gates
    experiencia/      Kira's presence stage + the conversation column
    agenda/
    stream/
    musica/
    controles/
    perfiles/
    commands/         the command palette
  api/  lib/  state/  store/  theme/  styles/  test/   ← all unchanged
```

`src/components/` ceases to exist when the last batch lands.

### 1.2 Why these names

The nav taxonomy is taken verbatim from `src/components/Sidebar.tsx:19-25` —
`experiencia`, `agenda`, `stream`, `musica`, `controles`. Three names are added, none invented:

- **`shell`** — the chrome that is not a nav section. It has no product name because the user
  never navigates to it; `shell` is the honest engineering term for the app frame.
- **`perfiles`** — the Sidebar's own section header renders the literal string `Perfiles`
  (`Sidebar.tsx`, ProfilesRegion). This is product vocabulary from the same file as the nav.
- **`commands`** — the folder already exists (`src/components/commands/`), and the
  ConversationPanel tab strip already renders `Comandos`
  (`ConversationPanel.tsx:27`, `type TabValue = "todo" | "chat" | "comandos" | ...`).

### 1.3 File-by-file map — top level of `src/components/`

Evidence is the real import graph plus what the component renders. "Sole importer" means
exactly one non-test module imports it.

| Current path | Destination | Domain | Evidence |
| --- | --- | --- | --- |
| `AgendaPanel.tsx` | `features/agenda/AgendaPanel.tsx` | agenda | Imported by `MainStage.tsx:3` (the `activeSection === "agenda"` branch) and by `agendaTurnOptions.test.tsx`. Renders session settings, the co-host identity form and the approved-topic queue against `api/agenda.ts`. |
| `AppLayout.tsx` | `features/shell/AppLayout.tsx` | shell | Sole importer `App.tsx:1`. Renders the 3-column grid, owns `activeSection`, mounts `ProfileSwitchProvider` + `PlaybackProvider`, portals `StatusRail` + `SettingsPopover` into the title bar. |
| `AvatarCard.tsx` | `features/controles/AvatarCard.tsx` | controles | Sole importer `ControlsPanel.tsx`. Renders `api/avatar.ts` config. |
| `BackendGate.tsx` | `features/shell/BackendGate.tsx` | shell | Sole importer `App.tsx:2`. Renders the boot loader / retry screen; nothing else mounts until it passes. |
| `ComposerCommandPanel.tsx` | `features/commands/ComposerCommandPanel.tsx` | commands | Imported by `ConversationPanel.tsx:9` and `commands/commands.test.tsx`. Its own non-`ui` imports are only `commands/Stepper.js` and `commands/registry.js` — it hosts the palette, it is not a conversation feature. |
| `ControlsPanel.tsx` | `features/controles/ControlsPanel.tsx` | controles | Sole importer `MainStage.tsx:2`. Renders the nine cards below inside `Collapsible` sections. |
| `ConversationPanel.tsx` | `features/experiencia/ConversationPanel.tsx` | experiencia | Sole importer `AppLayout.tsx:6` (the permanent `queue` grid column). Renders the Todo/Chat/Comandos/Alertas/Logs strip, the chat composer and the live PTT mic. The product's own definition of Experiencia is `SettingsPopover.tsx:20-22`: *"Chateá con Kira en texto o por voz (Push-to-Talk). El avatar refleja su estado"* — that sentence describes this component plus `KiraCover`. **See §1.6 for the ambiguity.** |
| `EditorialCardsCard.tsx` | `features/controles/EditorialCardsCard.tsx` | controles | Sole importer `ControlsPanel.tsx`. |
| `EventBridge.tsx` | `features/shell/EventBridge.tsx` | shell | Sole importer `App.tsx:3`. Renders nothing; bridges `api/events` into toasts app-wide. |
| `KiraCover.tsx` | `features/experiencia/KiraCover.tsx` | experiencia | Sole importer `MainStage.tsx:1`, used only in the default (`experiencia`) branch. Renders the avatar. |
| `MainStage.tsx` | `features/shell/MainStage.tsx` | shell | Sole importer `AppLayout.tsx:5`. Pure section router — it renders one panel per nav section and owns none of them. |
| `MemoryCard.tsx` | `features/controles/MemoryCard.tsx` | controles | Sole importer `ControlsPanel.tsx`. |
| `ModelCard.tsx` | `features/controles/ModelCard.tsx` | controles | Sole importer `ControlsPanel.tsx`. |
| `MusicPanel.tsx` | `features/musica/MusicPanel.tsx` | musica | Imported by `MainStage.tsx:5` (`musica` branch) **and** `commands/registry.tsx:22`, which pulls `pickRotationTrack`. Cross-domain into exactly one other domain — stays in `musica`, `commands` reaches in. |
| `ObsCard.tsx` | `features/controles/ObsCard.tsx` | controles | Sole importer `ControlsPanel.tsx`. |
| `PTTCard.tsx` | `features/controles/PTTCard.tsx` | controles | Sole importer `ControlsPanel.tsx`. Renders the LiveAudio WebSocket URL config plus a test hold button. **Ambiguous** — see §1.6. |
| `PersonalizationCard.tsx` | `features/controles/PersonalizationCard.tsx` | controles | Sole importer `ControlsPanel.tsx`. |
| `PlayerBar.tsx` | `features/experiencia/PlayerBar.tsx` | experiencia | **No live importer.** `AppLayout.tsx:10` has the import commented out and line 136 sits inside a JSX comment block; only `PlayerBar.test.tsx` loads it. Its real dependencies are `kiraState.js`, `api/chat.js`, `api/status.js` — the Kira presence surface, not the music library. **Ambiguous** — see §1.6. |
| `ProfileEditor.tsx` | `features/perfiles/ProfileEditor.tsx` | perfiles | Imported by `ProfilePlaylist.tsx:5` (which lives in the sidebar → shell) **and** `ProfileSwitcher.tsx:8` (which lives in controles). Two different domains, so it belongs to neither — it anchors the `perfiles` domain. |
| `ProfilePlaylist.tsx` | `features/perfiles/ProfilePlaylist.tsx` | perfiles | Sole importer `Sidebar.tsx:4`. Renders the "Perfiles" row list in the rail. Kept with `ProfileEditor`, which it owns the lifecycle of. |
| `ProfileSwitcher.tsx` | `features/perfiles/ProfileSwitcher.tsx` | perfiles | Sole importer `ControlsPanel.tsx`. Routed to `perfiles` rather than `controles` so that `ProfileEditor` has exactly one home and both of its consumers sit beside it. |
| `ProviderCard.tsx` | `features/controles/ProviderCard.tsx` | controles | Sole importer `ControlsPanel.tsx`. |
| `SettingsPopover.tsx` | `features/shell/SettingsPopover.tsx` | shell | Sole importer `AppLayout.tsx:8`, portaled into the title bar. Owns theme / density / alert style / logs / Idioma / help — all global. |
| `Sidebar.tsx` | `features/shell/Sidebar.tsx` | shell | Imported by `AppLayout.tsx:3` and `MainStage.tsx:6` (`type Section`). Owns `NAV_ITEMS`, i.e. the taxonomy itself. |
| `StatusRail.tsx` | `features/shell/StatusRail.tsx` | shell | Sole importer `AppLayout.tsx:7`, portaled into the title bar. Renders global health, provider and context telemetry. |
| `StreamPanel.tsx` | `features/stream/StreamPanel.tsx` | stream | Sole importer `MainStage.tsx:4`. |
| `TitleBar.tsx` | `features/shell/TitleBar.tsx` | shell | Imported by `App.tsx:4` and `AppLayout.tsx:9` (`TITLEBAR_APP_CONTROLS_SLOT_ID`). |
| `VoiceCard.tsx` | `features/controles/VoiceCard.tsx` | controles | Sole importer `ControlsPanel.tsx`. |
| `WelcomeCard.tsx` | `features/experiencia/WelcomeCard.tsx` | experiencia | Sole importer `MainStage.tsx:8`, rendered only inside the `experiencia` branch. |
| `kiraState.ts` | `features/experiencia/kiraState.ts` | experiencia | Imported by `KiraCover.tsx:3` and `PlayerBar.tsx:6` — both experiencia. Avatar-state derivation plus the avatar labels. |
| `agendaTurnOptions.test.tsx` | `features/agenda/agendaTurnOptions.test.tsx` | agenda | A test with no component of its own. It is a drift guard proving `AgendaPanel` and the `/perfil` command read the same `AGENDA_TURN_OPTIONS` array. Its subject is the agenda contract, so it lands in `agenda` and keeps a cross-folder import into `features/commands/`. |

Every `*.test.tsx` moves with its component, same basename, same directory.

### 1.4 `src/components/commands/`

| Current path | Destination | Domain | Evidence |
| --- | --- | --- | --- |
| `commands/registry.tsx` | `features/commands/registry.tsx` | commands | Imported by `ComposerCommandPanel.tsx`, `ConversationPanel.tsx:15` (`matchCommands`), `Stepper.tsx` and `agendaTurnOptions.test.tsx`. The `COMMANDS` data table. |
| `commands/primitives.tsx` | `features/commands/primitives.tsx` | commands | Imported by `registry.tsx`, `Stepper.tsx`, `wire.ts`. |
| `commands/Stepper.tsx` | `features/commands/Stepper.tsx` | commands | Sole importer `ComposerCommandPanel.tsx:2`. |
| `commands/wire.ts` | `features/commands/wire.ts` | commands | Imported by `registry.tsx` and `primitives.tsx`. Request shaping + `errorCopy` + the priority/length/safety vocabularies. |
| `commands/LogsPanel.tsx` | `features/experiencia/LogsPanel.tsx` | experiencia | **Corrected placement.** Sole importer `ConversationPanel.tsx:16`; it renders `store/eventStore` engine events as the conversation column's `Logs` tab. It is not a command and does not import anything from `commands/`. It sits in that folder for historical reasons only. |

### 1.5 `src/components/ui/` → `src/ui/`

All 19 components (`Alert`, `Badge`, `BootCollage`, `BootLoader`, `BrandMark`, `Button`,
`Card`, `Collapsible`, `ConfirmFooter`, `Input`, `KiraFace`, `Markdown`, `Segmented`,
`Select`, `Slider`, `Snackbar`, `Switch`, `Tabs`, `Toast`) and their 13 tests move to
`src/ui/`, keeping their filenames.

**Justification for moving rather than leaving it at `src/components/ui/`:**

1. Once §1.3 lands, `src/components/` would contain exactly one child, `ui/`. A folder named
   "components" holding only the design system is a leftover that misdescribes itself, and the
   whole point of this refactor is to retire the flat `src/components/` dump.
2. The marginal cost is zero for the domain batches. A file moving to
   `src/features/agenda/` has to rewrite `./ui/Alert.js` either way — to
   `../../components/ui/Alert.js` or to `../../ui/Alert.js`. Same edit, shorter string.
3. It fixes the one reverse dependency in the tree: `src/theme/ThemeSwitcher.tsx` currently
   imports `../components/ui/Button.js`, i.e. the theme layer reaches down into a *component*
   folder. After the move that reads `../ui/Button.js`, which is honest.

The only real cost is that the 23 files still sitting in `src/components/` after Batch 1 have
their `./ui/X.js` rewritten to `../ui/X.js`, and then rewritten again when they move. That is
~30 mechanical one-line edits, all reported by `tsc`, and it buys every subsequent batch the
ability to write its **final** import path with no follow-up pass. That is why the `ui` move
is Batch 1 and not Batch 9.

### 1.6 Assignments I am not confident about

Stated plainly, because a wrong guess dressed up as certainty costs more than a flagged one.

- **`ConversationPanel.tsx` → `experiencia`.** The alternative is a standalone `conversacion`
  domain. Arguments for `experiencia`: the product's own help text (`SettingsPopover.tsx:20-22`)
  defines Experiencia as chat + PTT + avatar state, which is precisely `ConversationPanel` +
  `KiraCover`. Argument against: `ConversationPanel` is the permanently-mounted third grid
  column, not a nav section, so it is arguably shell chrome. **Defaulting to `experiencia`
  because the product vocabulary is explicit and adding a tenth domain for one component
  is not worth it.** If the owner later separates them, the move is one `git mv` — the file
  has no importers other than `AppLayout`.
- **`PTTCard.tsx` → `controles`.** Import evidence is unambiguous (`ControlsPanel` is the sole
  importer) but the *concept* is Experiencia: PTT is the voice input surface, and the live mic
  button actually lives in `ConversationPanel`. This file is the configuration card — LiveAudio
  URL, connection test, a test hold button. **Defaulting to `controles` because that is where it
  renders and who consumes it.** Note that its copy (`api/pttCopy.ts`) is shared with
  `ConversationPanel`, which is why those strings go into the *experiencia* bundle (§6, E11).
- **`PlayerBar.tsx` → `experiencia`.** It is shelved: no live import, only a test. It could
  equally be argued into `musica` (it is a transport bar) or `shell` (its dead mount point is
  AppLayout's commented-out player row). **Defaulting to `experiencia` because its three real
  dependencies are `kiraState`, `api/chat` and `api/status`, and the thing it displays is
  Kira's last reply.** Do not delete it in this refactor; deleting shelved code is a separate
  decision.
- **`LogsPanel.tsx` → `experiencia`.** Import evidence is clean, but it means one batch touches
  two feature folders. Flagged in §3 Batch 7.
- **`ProfileSwitcher.tsx` → `perfiles` rather than `controles`.** Pure judgment: its sole
  importer is in `controles`, so a strict import-only reading puts it there. I split it out so
  that `ProfileEditor` — which genuinely serves two domains — has a home that is not a "shared"
  dumping ground. If the owner prefers strict import-following, move `ProfileSwitcher.tsx` into
  `features/controles/` and leave `ProfileEditor` + `ProfilePlaylist` in `perfiles`; nothing
  else in this plan changes.

### 1.7 Cross-domain components

Three components are reached into from outside their own domain. None of them is imported by
three or more domains, so none of them is promoted to a shared location:

| Component | Reached from | Handling |
| --- | --- | --- |
| `musica/MusicPanel.tsx` (`pickRotationTrack`) | `commands/registry.tsx` | Stays in `musica`. `commands` imports `../musica/MusicPanel.js`. Worth watching: it is a panel component exporting a pure helper. If a third consumer appears, extract the helper to `src/lib/`. |
| `perfiles/ProfileEditor.tsx` | `perfiles/ProfilePlaylist.tsx`, `perfiles/ProfileSwitcher.tsx` | Resolved by creating the `perfiles` domain — after the split it has no cross-domain reader. |
| `experiencia/kiraState.ts` | `experiencia/KiraCover.tsx`, `experiencia/PlayerBar.tsx` | Not cross-domain once both consumers land in `experiencia`. |

The genuinely shared code — `src/ui/`, `src/lib/`, `src/store/`, `src/state/`, `src/api/` — is
already outside `features/` and stays there.

### 1.8 What happens to the other `src/` folders

Default is "stays where it is". Every exception below is argued.

| Folder | Decision | Reason |
| --- | --- | --- |
| `src/api/` (24 modules + 20 tests) | **Stays.** | Transport plus react-query hooks. `client.ts` alone is imported by 15 modules; `queryClient.ts` and `status.ts` cross every domain. Splitting it per-domain would fracture the shared client and rewrite 60+ import lines for no structural gain — and the domain boundary is already legible from the filenames. One partial exception: `api/pttCopy.ts` is not transport, it is display copy; it dissolves into the i18n bundles in extraction batch E11 (§6) and does not move before then. |
| `src/lib/` (`cn.ts`, `appEvents.ts`, `backendBootstrap.ts`) | **Stays.** | Three leaf utilities with cross-domain consumers. `cn.ts` is imported by nearly every component. |
| `src/state/` (`PlaybackProvider.tsx`, `MusicDuckingWatcher.tsx`) | **Stays.** | Tempting to fold into `features/musica/`, and wrong. The comment at `AppLayout.tsx:54-65` explains that `PlaybackProvider` was deliberately hoisted **above** MainStage's section switch precisely so audio survives navigating away from `musica`. Moving it into `features/musica/` would re-assert the ownership that comment says was a bug. `MusicDuckingWatcher` bridges `api/status`'s `is_speaking` into it — also global. |
| `src/store/` (5 zustand singletons) | **Stays.** | `eventStore` (4 readers across 3 domains), `switchStore`, `avatarLiveStore`, `welcomeStore`, `useLogsPref` — each read by two or more domains, all module singletons. |
| `src/theme/` (`useTheme`, `useDensity`, `useAlertStyle`, `ThemeSwitcher`) | **Stays.** | Presentation-level preferences, consumed only by `SettingsPopover` and the global stylesheet. `ThemeSwitcher.tsx`'s import of the design system shortens from `../components/ui/Button.js` to `../ui/Button.js` in Batch 1; that is the only edit it needs. |
| `src/styles/` (`tokens.css`, `tokens.contrast.test.ts`) | **Stays.** | `main.tsx:6` imports `./styles/tokens.css`. No reason to touch it. |
| `src/test/` (`handlers.ts`, `server.ts`, `setup.ts`) | **Stays.** | `vite.config.ts` pins `setupFiles: ["./src/test/setup.ts"]`. Moving it means editing the build config for zero gain. Note that ~29 moving test files import `../test/server.js` and will need the depth bumped to `../../test/server.js`. |
| `src/App.tsx`, `src/main.tsx`, `src/styles.css`, `src/vite-env.d.ts` | **Stay at `src/` root.** | `index.html` points at `main.tsx`; `App.tsx` is the root component and `App.test.tsx`/`main.test.tsx` sit beside them. Entry points at the root is the conventional shape and moving them buys nothing. Only their import lines change. |

---

## 2. Barrel files: **no**

**Decision: no `index.ts` in any `src/features/<domain>/`, and none in `src/ui/`.** Every
import stays a direct, deep, `.js`-suffixed path — `import { AgendaPanel } from
"../agenda/AgendaPanel.js"`. This applies to `src/i18n/` too: `src/i18n/bundles.ts` is the
assembled dictionary, not a re-export barrel, and consumers import `src/i18n/t.js` directly.

The tradeoff, honestly:

**What a barrel would buy.** Shorter, uniform import lines. Freedom to rename or split a file
inside a domain without touching consumers. A visible declaration of each domain's public
surface — which is genuinely the strongest argument, since domains like `controles` have ten
files of which only `ControlsPanel` is meant to be reached from outside.

**What it would cost here, specifically.**

1. **Real cycle risk, not theoretical.** This codebase already has cross-panel imports:
   `commands/registry.tsx` → `musica/MusicPanel.tsx`, and `experiencia/ConversationPanel.tsx`
   → `commands/registry.tsx` + `commands/ComposerCommandPanel.tsx`. With barrels, importing
   *one* symbol from a domain pulls in *every* module that domain re-exports. A
   `features/musica/index.ts` that ever grows a second export touching `commands` closes the
   loop `commands → musica → commands`. ESM cycles do not error; they hand you `undefined` at
   module-evaluation time, which surfaces as "Element type is invalid" in a component that
   was fine yesterday. That is the 3am failure this refactor should not create.
2. **It blunts the tool the whole migration depends on.** A stale deep import is reported by
   `tsc` at the exact `file:line` that is wrong. A stale barrel export is reported once, at
   the barrel, and the actual broken consumer is invisible. Over nine move batches that
   difference is the difference between mechanical and archaeological.
3. **It would not even be used by most of the codebase.** 82 test files import their subject
   directly and would keep doing so (importing a component under test through a barrel drags
   its whole domain into every test's module graph — slower, and it defeats `vi.mock`).
   So a barrel would serve maybe 15 call sites while the other several hundred bypass it.
4. **Barrels are load-bearing only with tree-shaking pressure or a large public surface.**
   Neither applies: this is a desktop app bundled by Vite, and each domain has one or two
   externally-reached files.

The public-surface argument is answered more cheaply by convention: within a domain, only the
file named after the section (`AgendaPanel`, `ControlsPanel`, `StreamPanel`, `MusicPanel`) is
imported from outside. That is already true today and needs no file to enforce it.

**If any implementer adds an `index.ts`, that is a stop condition** (§7) — mixed import styles
across nine batches is worse than either style consistently.

---

## 3. Batch plan — modularization

Nine batches, strictly sequential. Each is one commit, each is independently green.

### Ordering rationale

The order is **shared design system → leaf domains → mid hubs → top hubs**, i.e. the exact
reverse of the render tree.

- `ui/` first because every later batch needs to write its final `../../ui/X.js` path. Moving
  it last would mean re-touching all nine finished feature folders in the final commit.
  It is also the safest possible first batch — one `git mv` of a directory and a pure
  find-and-replace — which validates the whole loop (`git mv` → fix imports → `tsc` → test)
  before any domain semantics are involved.
- **A hub moves in the same batch as its children, or after them, never before.** If
  `ControlsPanel` moved to `features/controles/` while its nine cards stayed behind, it would
  carry `../../components/AvatarCard.js` imports for six batches and then need rewriting
  anyway. So `ControlsPanel` moves *with* its cards, and `MainStage`/`AppLayout`/`App` — which
  are hubs for everything — move last.
- The practical payoff of hubs-last: during the whole migration, **whatever is still sitting
  in `src/components/` is shell.** After Batch 8 that folder holds exactly the eight shell
  components and their tests; Batch 9 empties it. Every intermediate state is readable at a
  glance.
- Leaf domains (`agenda`, `stream`, `musica`) go early because each one touches exactly one
  hub file (`MainStage.tsx`), so a mistake is cheap and obvious.

### Notation

`git mv` needs the destination directory to exist. Create it first:
PowerShell `New-Item -ItemType Directory -Force -Path src/features/agenda`, or Git Bash
`mkdir -p src/features/agenda`. Forward slashes work in `git mv` on Windows.

Every batch's expected test delta is **1050 in → 1050 out, 82 files in → 82 files out**.
Moves change no behavior. If the count moves, something was deleted or a file stopped being
collected — stop and report.

---

### Batch 1 — lift the design system to `src/ui/`

```
git mv src/components/ui src/ui
```

Moves 32 files (19 components + 13 tests) in one command.

**Imports that break (32 files, all reported by `tsc`):**

| Where | Rewrite |
| --- | --- |
| 17 files inside `src/ui/` (`Alert`, `Badge`, `BootCollage`, `BrandMark`, `Button`, `Card`, `Collapsible`, `ConfirmFooter`, `Input`, `KiraFace`, `Segmented`, `Select`, `Slider`, `Snackbar`, `Switch`, `Tabs`, `Toast`) | `../../lib/cn.js` → `../lib/cn.js` |
| `src/App.tsx` | `./components/ui/Toast.js` → `./ui/Toast.js` |
| 23 files in `src/components/*.tsx|.ts` | `./ui/X.js` → `../ui/X.js` |
| 3 files in `src/components/commands/` (`primitives.tsx`, `registry.tsx`, `Stepper.tsx`) | `../ui/X.js` → `../../ui/X.js` |
| `src/theme/ThemeSwitcher.tsx` | `../components/ui/Button.js` → `../ui/Button.js` |
| 4 test files (`AgendaPanel.test.tsx`, `AppLayout.test.tsx`, `EventBridge.test.tsx`, `agendaTurnOptions.test.tsx`) | `./ui/Toast.js` → `../ui/Toast.js` |

Files inside `src/ui/` that import each other (`BootLoader` → `BootCollage`/`BrandMark`,
`ConfirmFooter` → `Alert`/`Button`, `Segmented` → `Button`) and all 13 `ui` tests use
same-directory `./X.js` specifiers — those do **not** change.

`vi.mock` audit: none affected.

Commit: `refactor(ui): lift the design system out of components into src/ui`

---

### Batch 2 — agenda

```
git mv src/components/AgendaPanel.tsx          src/features/agenda/AgendaPanel.tsx
git mv src/components/AgendaPanel.test.tsx     src/features/agenda/AgendaPanel.test.tsx
git mv src/components/agendaTurnOptions.test.tsx src/features/agenda/agendaTurnOptions.test.tsx
```

**Imports that break:**

- `features/agenda/AgendaPanel.tsx` — `../api/agenda.js` → `../../api/agenda.js`;
  nine `../ui/*.js` → `../../ui/*.js`.
- `features/agenda/AgendaPanel.test.tsx` — `../test/handlers.js`, `../test/server.js` →
  `../../test/…`; `../ui/Toast.js` → `../../ui/Toast.js`. (`./AgendaPanel.js` unchanged.)
- `features/agenda/agendaTurnOptions.test.tsx` — `../api/agenda.js` → `../../api/agenda.js`;
  `./commands/primitives.js` → `../../components/commands/primitives.js`;
  `./commands/registry.js` → `../../components/commands/registry.js`;
  `../ui/Toast.js` → `../../ui/Toast.js`. (Those two `commands` paths are rewritten again in
  Batch 7 — unavoidable, this test spans two domains by design.)
- `src/components/MainStage.tsx` — `./AgendaPanel.js` → `../features/agenda/AgendaPanel.js`.

`vi.mock` audit: none affected.

Commit: `refactor(ui): move the agenda panel into features/agenda`

---

### Batch 3 — stream

```
git mv src/components/StreamPanel.tsx      src/features/stream/StreamPanel.tsx
git mv src/components/StreamPanel.test.tsx src/features/stream/StreamPanel.test.tsx
```

**Imports that break:**

- `StreamPanel.tsx` — `../api/mock/fixtures.js`, `../api/stream.js` → `../../api/…`;
  nine `../ui/*.js` → `../../ui/*.js`.
- `StreamPanel.test.tsx` — `../api/mock/fixtures.js`, `../test/handlers.js`,
  `../test/server.js` → `../../…`.
- `src/components/MainStage.tsx` — `./StreamPanel.js` → `../features/stream/StreamPanel.js`.

`vi.mock` audit: none affected.

Commit: `refactor(ui): move the stream panel into features/stream`

---

### Batch 4 — musica

```
git mv src/components/MusicPanel.tsx      src/features/musica/MusicPanel.tsx
git mv src/components/MusicPanel.test.tsx src/features/musica/MusicPanel.test.tsx
```

**Imports that break:**

- `MusicPanel.tsx` — `../api/mock/fixtures.js`, `../api/mock/useMockCommand.js`,
  `../api/music.js`, `../state/PlaybackProvider.js` → `../../…`; four `../ui/*.js` →
  `../../ui/*.js`.
- `MusicPanel.test.tsx` — `../state/PlaybackProvider.js`, `../test/handlers.js`,
  `../test/server.js` → `../../…`.
- `src/components/MainStage.tsx` — `./MusicPanel.js` → `../features/musica/MusicPanel.js`.
- `src/components/commands/registry.tsx` — `../MusicPanel.js` →
  `../../features/musica/MusicPanel.js`. (Rewritten once more in Batch 7 to `../musica/…`.)

`vi.mock` audit: none affected.

Commit: `refactor(ui): move the music panel into features/musica`

---

### Batch 5 — perfiles

```
git mv src/components/ProfileEditor.tsx        src/features/perfiles/ProfileEditor.tsx
git mv src/components/ProfileEditor.test.tsx   src/features/perfiles/ProfileEditor.test.tsx
git mv src/components/ProfilePlaylist.tsx      src/features/perfiles/ProfilePlaylist.tsx
git mv src/components/ProfilePlaylist.test.tsx src/features/perfiles/ProfilePlaylist.test.tsx
git mv src/components/ProfileSwitcher.tsx      src/features/perfiles/ProfileSwitcher.tsx
git mv src/components/ProfileSwitcher.test.tsx src/features/perfiles/ProfileSwitcher.test.tsx
```

**Imports that break:**

- All three components — `../api/*.js`, `../lib/cn.js` → `../../…`; all `../ui/*.js` →
  `../../ui/*.js`. Their mutual imports (`./ProfileEditor.js`) are unchanged.
- All three tests — `../api/useProfileSwitch.js`, `../store/switchStore.js`,
  `../test/*.js` → `../../…`.
- `src/components/Sidebar.tsx` — `./ProfilePlaylist.js` →
  `../features/perfiles/ProfilePlaylist.js`.
- `src/components/ControlsPanel.tsx` — `./ProfileSwitcher.js` →
  `../features/perfiles/ProfileSwitcher.js`. (Rewritten in Batch 6 to `../perfiles/…`.)

`vi.mock` audit: none affected.

Commit: `refactor(ui): move the profiles surface into features/perfiles`

---

### Batch 6 — controles

The panel and its nine cards move together, so `MainStage` takes exactly one edit.

```
git mv src/components/ControlsPanel.tsx           src/features/controles/ControlsPanel.tsx
git mv src/components/ControlsPanel.test.tsx      src/features/controles/ControlsPanel.test.tsx
git mv src/components/AvatarCard.tsx              src/features/controles/AvatarCard.tsx
git mv src/components/AvatarCard.test.tsx         src/features/controles/AvatarCard.test.tsx
git mv src/components/EditorialCardsCard.tsx      src/features/controles/EditorialCardsCard.tsx
git mv src/components/EditorialCardsCard.test.tsx src/features/controles/EditorialCardsCard.test.tsx
git mv src/components/MemoryCard.tsx              src/features/controles/MemoryCard.tsx
git mv src/components/MemoryCard.test.tsx         src/features/controles/MemoryCard.test.tsx
git mv src/components/ModelCard.tsx               src/features/controles/ModelCard.tsx
git mv src/components/ModelCard.test.tsx          src/features/controles/ModelCard.test.tsx
git mv src/components/ObsCard.tsx                 src/features/controles/ObsCard.tsx
git mv src/components/ObsCard.test.tsx            src/features/controles/ObsCard.test.tsx
git mv src/components/PTTCard.tsx                 src/features/controles/PTTCard.tsx
git mv src/components/PTTCard.test.tsx            src/features/controles/PTTCard.test.tsx
git mv src/components/PersonalizationCard.tsx     src/features/controles/PersonalizationCard.tsx
git mv src/components/PersonalizationCard.test.tsx src/features/controles/PersonalizationCard.test.tsx
git mv src/components/ProviderCard.tsx            src/features/controles/ProviderCard.tsx
git mv src/components/ProviderCard.test.tsx       src/features/controles/ProviderCard.test.tsx
git mv src/components/VoiceCard.tsx               src/features/controles/VoiceCard.tsx
git mv src/components/VoiceCard.test.tsx          src/features/controles/VoiceCard.test.tsx
```

20 files.

**Imports that break:**

- All ten components — `../api/*.js`, `../lib/cn.js` → `../../…`; every `../ui/*.js` →
  `../../ui/*.js`. Their sibling imports (`./AvatarCard.js` etc. inside `ControlsPanel`) are
  unchanged.
- `ControlsPanel.tsx` additionally — `../features/perfiles/ProfileSwitcher.js` →
  `../perfiles/ProfileSwitcher.js`.
- All ten tests — `../test/handlers.js`, `../test/server.js` → `../../test/…`;
  `ControlsPanel.test.tsx` also `../api/useProfileSwitch.js` → `../../api/useProfileSwitch.js`.
- `src/components/MainStage.tsx` — `./ControlsPanel.js` →
  `../features/controles/ControlsPanel.js`.

`vi.mock` audit: none affected.

Commit: `refactor(ui): move the controls panel and its cards into features/controles`

---

### Batch 7 — commands (and the misfiled LogsPanel)

```
git mv src/components/ComposerCommandPanel.tsx      src/features/commands/ComposerCommandPanel.tsx
git mv src/components/ComposerCommandPanel.test.tsx src/features/commands/ComposerCommandPanel.test.tsx
git mv src/components/commands/registry.tsx         src/features/commands/registry.tsx
git mv src/components/commands/primitives.tsx       src/features/commands/primitives.tsx
git mv src/components/commands/Stepper.tsx          src/features/commands/Stepper.tsx
git mv src/components/commands/wire.ts              src/features/commands/wire.ts
git mv src/components/commands/wire.test.ts         src/features/commands/wire.test.ts
git mv src/components/commands/commands.test.tsx    src/features/commands/commands.test.tsx
git mv src/components/commands/LogsPanel.tsx        src/features/experiencia/LogsPanel.tsx
git mv src/components/commands/LogsPanel.test.tsx   src/features/experiencia/LogsPanel.test.tsx
```

10 files. `src/components/commands/` is now empty and disappears.

**This batch is smaller than it looks.** `src/components/commands/X` and
`src/features/commands/X` are at the *same depth* (`src/<a>/<b>/X`), so every `../../api/…`,
`../../lib/…`, `../../state/…`, `../../store/…`, `../../test/…` and `../../ui/…` specifier in
the four command modules is already correct and must **not** be touched.

**Imports that break:**

- `features/commands/registry.tsx` — `../../features/musica/MusicPanel.js` →
  `../musica/MusicPanel.js`. (Nothing else.)
- `features/commands/ComposerCommandPanel.tsx` — moved one level deeper:
  `../lib/cn.js` → `../../lib/cn.js`; `./commands/Stepper.js` → `./Stepper.js`;
  `./commands/registry.js` → `./registry.js`.
- `features/commands/ComposerCommandPanel.test.tsx` — `../store/eventStore.js` →
  `../../store/eventStore.js`.
- `features/commands/commands.test.tsx` — `../ComposerCommandPanel.js` →
  `./ComposerCommandPanel.js`. (Its `../../state/…` and `../../test/…` are unchanged.)
- `features/experiencia/LogsPanel.tsx` and `LogsPanel.test.tsx` — `../../lib/cn.js` and
  `../../store/eventStore.js` are unchanged (same depth). Nothing breaks in these two files.
- `src/components/ConversationPanel.tsx` — `./ComposerCommandPanel.js` →
  `../features/commands/ComposerCommandPanel.js`; `./commands/registry.js` →
  `../features/commands/registry.js`; `./commands/LogsPanel.js` →
  `../features/experiencia/LogsPanel.js`.
- `src/features/agenda/agendaTurnOptions.test.tsx` — `../../components/commands/registry.js`
  → `../commands/registry.js`; `../../components/commands/primitives.js` →
  `../commands/primitives.js`.

`vi.mock` audit: none affected.

**Note for the reviewer:** this batch creates `src/features/experiencia/` and puts two files in
it before Batch 8 fills it. That is deliberate — `LogsPanel` shares a folder with the command
modules today, so moving it here costs one extra `git mv` in a batch that is already touching
that directory, versus leaving it misfiled or paying a tenth batch.

Commit: `refactor(ui): move the command palette into features/commands`

---

### Batch 8 — experiencia

```
git mv src/components/ConversationPanel.tsx      src/features/experiencia/ConversationPanel.tsx
git mv src/components/ConversationPanel.test.tsx src/features/experiencia/ConversationPanel.test.tsx
git mv src/components/KiraCover.tsx              src/features/experiencia/KiraCover.tsx
git mv src/components/KiraCover.test.tsx         src/features/experiencia/KiraCover.test.tsx
git mv src/components/WelcomeCard.tsx            src/features/experiencia/WelcomeCard.tsx
git mv src/components/WelcomeCard.test.tsx       src/features/experiencia/WelcomeCard.test.tsx
git mv src/components/PlayerBar.tsx              src/features/experiencia/PlayerBar.tsx
git mv src/components/PlayerBar.test.tsx         src/features/experiencia/PlayerBar.test.tsx
git mv src/components/kiraState.ts               src/features/experiencia/kiraState.ts
git mv src/components/kiraState.test.ts          src/features/experiencia/kiraState.test.ts
```

10 files.

**Imports that break:**

- `ConversationPanel.tsx` — `../api/*.js` (six of them), `../lib/cn.js`, `../store/*.js`
  → `../../…`; five `../ui/*.js` → `../../ui/*.js`;
  `../features/commands/ComposerCommandPanel.js` → `../commands/ComposerCommandPanel.js`;
  `../features/commands/registry.js` → `../commands/registry.js`;
  `../features/experiencia/LogsPanel.js` → `./LogsPanel.js`.
- `KiraCover.tsx` — `../api/status.js`, `../store/avatarLiveStore.js` → `../../…`.
  (`./kiraState.js` unchanged.)
- `PlayerBar.tsx` — `../api/status.js`, `../api/chat.js`, `../lib/cn.js` → `../../…`;
  `../ui/Badge.js`, `../ui/Switch.js` → `../../ui/…`.
- `kiraState.ts` — `../api/client.js` → `../../api/client.js`;
  `../ui/Badge.js` → `../../ui/Badge.js`.
- `WelcomeCard.tsx` — no relative imports; nothing breaks.
- Tests — `ConversationPanel.test.tsx`, `KiraCover.test.tsx`, `PlayerBar.test.tsx`:
  `../store/*.js`, `../test/*.js` → `../../…`; `kiraState.test.ts`: `../api/client.js` →
  `../../api/client.js`. `WelcomeCard.test.tsx` needs nothing.
- `src/components/MainStage.tsx` — `./KiraCover.js` →
  `../features/experiencia/KiraCover.js`; `./WelcomeCard.js` →
  `../features/experiencia/WelcomeCard.js`.
- `src/components/AppLayout.tsx` — `./ConversationPanel.js` →
  `../features/experiencia/ConversationPanel.js`. **Also update the commented-out
  `// import { PlayerBar } from "./PlayerBar.js";` at line 10** — `tsc` will not flag a
  comment, and leaving a stale path there is a trap for whoever un-shelves it.

**`vi.mock` audit — one hit:**

- `src/features/experiencia/ConversationPanel.test.tsx:30` —
  `vi.mock("../api/liveTranscript.js", ...)` must become
  `vi.mock("../../api/liveTranscript.js", ...)`. **`tsc` will not report this.** If it is
  missed, the mock silently stops applying and the real polling hook runs in the test.

Commit: `refactor(ui): move the conversation and presence surfaces into features/experiencia`

---

### Batch 9 — shell

```
git mv src/components/AppLayout.tsx           src/features/shell/AppLayout.tsx
git mv src/components/AppLayout.test.tsx      src/features/shell/AppLayout.test.tsx
git mv src/components/MainStage.tsx           src/features/shell/MainStage.tsx
git mv src/components/MainStage.test.tsx      src/features/shell/MainStage.test.tsx
git mv src/components/Sidebar.tsx             src/features/shell/Sidebar.tsx
git mv src/components/Sidebar.test.tsx        src/features/shell/Sidebar.test.tsx
git mv src/components/TitleBar.tsx            src/features/shell/TitleBar.tsx
git mv src/components/TitleBar.test.tsx       src/features/shell/TitleBar.test.tsx
git mv src/components/StatusRail.tsx          src/features/shell/StatusRail.tsx
git mv src/components/StatusRail.test.tsx     src/features/shell/StatusRail.test.tsx
git mv src/components/SettingsPopover.tsx     src/features/shell/SettingsPopover.tsx
git mv src/components/SettingsPopover.test.tsx src/features/shell/SettingsPopover.test.tsx
git mv src/components/BackendGate.tsx         src/features/shell/BackendGate.tsx
git mv src/components/BackendGate.test.tsx    src/features/shell/BackendGate.test.tsx
git mv src/components/EventBridge.tsx         src/features/shell/EventBridge.tsx
git mv src/components/EventBridge.test.tsx    src/features/shell/EventBridge.test.tsx
```

16 files. `src/components/` is now empty and disappears.

**Imports that break:**

- All eight components — `../api/*.js`, `../lib/*.js`, `../state/*.js`, `../store/*.js`,
  `../theme/*.js` → `../../…`; every `../ui/*.js` → `../../ui/*.js`.
- Their cross-feature imports collapse one level: in `MainStage.tsx`,
  `../features/agenda/AgendaPanel.js` → `../agenda/AgendaPanel.js` (same for
  `stream`, `musica`, `controles`, and the two `experiencia` imports); in `AppLayout.tsx`,
  `../features/experiencia/ConversationPanel.js` → `../experiencia/ConversationPanel.js`
  **and the commented-out PlayerBar line**; in `Sidebar.tsx`,
  `../features/perfiles/ProfilePlaylist.js` → `../perfiles/ProfilePlaylist.js`.
  Their sibling imports (`./Sidebar.js`, `./MainStage.js`, `./TitleBar.js`) are unchanged.
- All eight tests — `../api/*.js`, `../store/*.js`, `../test/*.js` → `../../…`;
  `AppLayout.test.tsx` also `../ui/Toast.js` → `../../ui/Toast.js` (and `EventBridge.test.tsx`
  likewise).
- `src/App.tsx` — `./components/AppLayout.js` → `./features/shell/AppLayout.js`;
  `./components/BackendGate.js` → `./features/shell/BackendGate.js`;
  `./components/EventBridge.js` → `./features/shell/EventBridge.js`;
  `./components/TitleBar.js` → `./features/shell/TitleBar.js`.

**`vi.mock` audit — two hits, both invisible to `tsc`:**

- `src/App.test.tsx:20` — `vi.mock("./components/AppLayout.js", ...)` must become
  `vi.mock("./features/shell/AppLayout.js", ...)`. If missed, `App.test.tsx` renders the
  **real** `AppLayout` (with its providers, portals and polls) instead of the stub.
- `src/features/shell/BackendGate.test.tsx:16` — `vi.mock("../lib/backendBootstrap.js", ...)`
  must become `vi.mock("../../lib/backendBootstrap.js", ...)`.

(`src/main.test.tsx` mocks `./App.js`, `./lib/backendBootstrap.js` and
`./api/queryClient.js` — none of those move. `src/lib/backendBootstrap.test.ts`,
`src/api/client.test.ts` and `src/features/shell/TitleBar.test.tsx` mock packages or
non-moving modules.)

Commit: `refactor(ui): move the app shell into features/shell and retire src/components`

---

### Post-migration verification (not a commit)

After Batch 9, confirm the end state:

- `src/components/` does not exist.
- `pnpm exec tsc --noEmit` clean, `pnpm test` → 82 files / 1050 tests.
- No `index.ts` anywhere under `src/features/` or `src/ui/`.
- `grep -rn 'components/' src/` returns nothing.

---

## 4. i18n substrate design

Two hard requirements drive everything below: **no new dependency**, and **a key present in
ES but missing in EN must fail `tsc --noEmit`**, not fall back silently at runtime.

### 4.1 Files

```
src/i18n/
  locale.ts              active UI locale (zustand store + hook)
  t.ts                   TKey, t(), useT()
  bundles.ts             assembles ES and EN from the per-domain files
  bundles/
    shell.es.ts        shell.en.ts
    experiencia.es.ts  experiencia.en.ts
    agenda.es.ts       agenda.en.ts
    controles.es.ts    controles.en.ts
    stream.es.ts       stream.en.ts
    musica.es.ts       musica.en.ts
    perfiles.es.ts     perfiles.en.ts
    commands.es.ts     commands.en.ts
    ui.es.ts           ui.en.ts
  t.test.ts              the one runnable check for the resolver
```

Nine domains × 2 locales = 18 bundle files, matching the nine feature folders (`ui` covers
`src/ui/`). Per-domain files are the point: extraction batch E5 touches only `agenda.es.ts` and
`agenda.en.ts`, so batches never collide in a bundle.

### 4.2 Compile-time completeness — the whole mechanism

```ts
// src/i18n/bundles/agenda.es.ts
export const agendaEs = {
  "agenda.session.turns.aria": "Intentos por tema",
  "agenda.topic.title.placeholder": "Tema claro, máximo 90 caracteres",
  "agenda.constraints.max": "Máximo {n} etiquetas."
} as const;
```

```ts
// src/i18n/bundles/agenda.en.ts
import type { agendaEs } from "./agenda.es.js";

export const agendaEn: Record<keyof typeof agendaEs, string> = {
  "agenda.session.turns.aria": "Attempts per topic",
  "agenda.topic.title.placeholder": "A clear topic, 90 characters max",
  "agenda.constraints.max": "{n} tags maximum."
};
```

That annotation is the entire enforcement:

- **Missing EN key** → `TS2739: Type '{...}' is missing the following properties from type
  'Record<...>'`. A hard `tsc --noEmit` failure.
- **Extra EN key** → `TS2353: Object literal may only specify known properties`. Also a hard
  failure, so EN cannot drift the other way either.

ES is the source of truth; EN is structurally derived from it. No codegen, no lint rule, no
script, no dependency.

```ts
// src/i18n/bundles.ts
import { agendaEs } from "./bundles/agenda.es.js";
import { agendaEn } from "./bundles/agenda.en.js";
/* … the other eight pairs … */

export const ES = { ...agendaEs, ...commandsEs, /* … */ };
export const EN: Record<keyof typeof ES, string> = { ...agendaEn, ...commandsEn, /* … */ };

export type TKey = keyof typeof ES;
```

The annotation on `EN` is a second, whole-dictionary check: it catches a domain pair where
someone added the `.es.ts` spread and forgot the `.en.ts` one.

Do **not** write `as const` on the `ES` assembly — spreading already-`as const` sources gives
the key union we need, and the extra assertion buys nothing.

Because two domains could in principle define the same key and the later spread would win
silently, the naming convention (§5) makes every key start with its owning domain. Collisions
are then structurally impossible.

### 4.3 The active locale

`src/i18n/locale.ts`, modelled directly on `src/theme/useDensity.ts:1-34` (read on init,
write through, DOM side effect) with the defensive `try/catch` from
`src/store/useLogsPref.ts:5-11` — a storage-denied environment must not break module
initialisation for the whole app.

```ts
import { create } from "zustand";

const STORAGE_KEY = "oc-ui-locale";
export const UI_LOCALES = ["es", "en"] as const;
export type UiLocale = (typeof UI_LOCALES)[number];
const DEFAULT_LOCALE: UiLocale = "es";          // today's behaviour, byte for byte

function readStored(): UiLocale { /* try/catch, validate against UI_LOCALES */ }
function apply(next: UiLocale) {
  document.documentElement.lang = next;         // see the note below
  try { window.localStorage.setItem(STORAGE_KEY, next); } catch { /* best effort */ }
}

interface UiLocaleState { locale: UiLocale; setLocale(next: UiLocale): void; }

const initial = readStored();
document.documentElement.lang = initial;

export const useUiLocaleStore = create<UiLocaleState>((set) => ({
  locale: initial,
  setLocale: (next) => { apply(next); set({ locale: next }); }
}));

export function useUiLocale() { /* { locale, setLocale }, same shape as useDensity() */ }
```

Three notes:

- **`UI_LOCALES` is hardcoded, not read from the backend.** `GET /api/i18n` returns the
  locales the *backend* has bundles for. The UI can only render locales it has compiled
  bundles for. If the backend ships a third locale, the UI list does not grow until someone
  adds `<domain>.fr.ts` files — which `tsc` will then force to be complete.
- **`document.documentElement.lang`.** `index.html` currently hardcodes `lang="en"` while the
  entire UI is Spanish — a pre-existing accessibility defect (screen readers pick the wrong
  voice). Writing `lang` here fixes it for free. It is technically a DOM change, so if the
  owner wants a strictly zero-behavior-change substrate batch, drop the two `lang` lines and
  file the fix separately. Recommendation: keep it; it is one line and it is correct.
- **Placement** — `src/i18n/locale.ts` rather than `src/store/` or `src/theme/`, because the
  store is meaningless without `t.ts` and the bundles beside it. `src/theme/` is about
  CSS-level presentation (`data-density`, `data-alert-style`); locale is content selection.

### 4.4 `t()`

```ts
// src/i18n/t.ts
import { EN, ES, type TKey } from "./bundles.js";
import { useUiLocaleStore } from "./locale.js";

export type { TKey };

export function t(key: TKey, vars?: Record<string, string | number>): string {
  const dict = useUiLocaleStore.getState().locale === "en" ? EN : ES;
  const raw = dict[key];
  return vars ? raw.replace(/\{(\w+)\}/g, (m, name) => String(vars[name] ?? m)) : raw;
}

/** Subscribes the caller to locale changes, then hands back `t`. */
export function useT() {
  useUiLocaleStore((s) => s.locale);
  return t;
}
```

- **Interpolation** is `{name}` placeholders and one `String.replace`. A missing variable
  leaves the literal `{name}` in the output rather than throwing — loud in a rendered test,
  and copy must never crash the UI. Typing the variable names out of the string literal is
  possible with template-literal types; it is not worth the inference cost or the
  read-at-3am cost, so `Record<string, string | number>` it is.
- **No locale parameter.** `t()` reads the store directly via `getState()`, so it works
  identically inside a component, inside an event handler, and inside a plain module such as
  `src/lib/appEvents.ts`.
- **Two consumption styles, both supported and both needed:**
  - Components call `const t = useT();` once at the top. The subscription is what makes the
    locale flip re-render them.
  - Non-component modules `import { t } from "../i18n/t.js"` and call it directly.
    This is correct **only if the call happens at render/event time**, not at module
    evaluation time — see §4.6.
- **`t.test.ts`** is the one runnable check: a key round-trips in both locales,
  interpolation substitutes, a missing variable leaves the placeholder intact, and
  `Object.keys(EN).length === Object.keys(ES).length`.

### 4.5 Pluralization — surveyed, and the answer is "no engine"

Every plural-sensitive string in the repo, found by scanning for `=== 1`, `> 1`, `!== 1`:

| Location | String |
| --- | --- |
| `src/components/MemoryCard.tsx:263` | `"Se importó 1"` / `` `Se importaron ${n}` `` |
| `src/components/MemoryCard.tsx:264` | `"duplicada"` / `"duplicadas"` |
| `src/components/MemoryCard.tsx:265` | `"muy corta"` / `"muy cortas"` |
| `src/components/MemoryCard.tsx:588` | `"memoria"` / `"memorias"` |
| `src/lib/appEvents.ts:107` | `` `Kira guardó ${n} memorias` `` / `"Kira guardó una memoria"` |

**Five sites, four of them in one file, and every one already has the `=== 1` branch written
in the caller.** Both target languages have the same two-form plural rule.

So: **no plural engine, no `Intl.PluralRules`, no `_one`/`_other` resolver.** Two explicit
keys per case, selected by the branch that already exists:

```ts
result.imported === 1
  ? t("controles.memory.import.summary.one")
  : t("controles.memory.import.summary.many", { n: result.imported })
```

This adds zero machinery and keeps the extraction diff to the string literals themselves. If a
sixth site ever appears with a language that needs more forms, revisit then — that is a
five-line change to `t()`, not an architecture.

### 4.6 Copy that lives outside components

This is the complete audit. The distinction that matters is **when the string is evaluated**:
a `t()` call inside a function body or a JSX expression is evaluated per render and follows the
locale; a `t()` call at module top level is evaluated once at import and is frozen at the boot
locale.

| Site | Shape | Plan |
| --- | --- | --- |
| `src/api/pttCopy.ts` | `ERROR_COPY` / `STATE_COPY`, module-level `Record`s | Consumed by `PTTCard` and `ConversationPanel`. **No test imports either symbol** (verified). Convert to functions `errorCopy(code)` / `stateCopy(state)` returning `t(...)`, and update the two call sites from `ERROR_COPY[code]` to `errorCopy(code)`. Fully hot-swappable. Keys live in the **experiencia** bundle. |
| `src/lib/appEvents.ts` | `EVENT_COPY`, a map of `(detail) => string` | Already lazy — the functions run at emit time. Replace the literal bodies with `t()`. No signature change, no call-site change. |
| `src/features/commands/wire.ts` | `errorCopy`, `describeMood`, `describeConnect`, `describeSessionAction`, `describeStreamLimits` | All functions → straight `t()` substitution. `wire.test.ts` asserts them with `toMatch(/…/i)` regexes over Spanish fragments, which keeps passing because ES output is byte-identical. |
| `src/features/commands/wire.ts` | `PRIORITY_VOCAB`, `LENGTH_VOCAB`, `SAFETY_VOCAB` — module-level arrays with a `label` field | **Boot-locale holdout.** `commands.test.tsx:122-124` iterates `PRIORITY_VOCAB` and does `screen.getByRole("option", { name: entry.label })`, i.e. it looks up rendered text *by the imported value*. If `label` became a key, the lookup would search for the key string and fail. Keep `label: t("…")` evaluated at module init. See §4.7. |
| `src/features/commands/registry.tsx` | `COMMANDS`, a module-level array with `title` / `description` / `primaryLabel` / `actionNote` | **Boot-locale holdout.** `agendaTurnOptions.test.tsx:40` imports `COMMANDS` directly. Same treatment. |
| `src/features/experiencia/kiraState.ts` | `AVATAR_LABEL`, `LOCAL_SLEEP_LABEL` | `kiraState.test.ts:106,114` compares `resolveAvatar().label` against the imported `LOCAL_SLEEP_LABEL` — a **self-referential** assertion that passes whatever the value is. So this one can be done properly: make `AVATAR_LABEL` / `LOCAL_SLEEP_LABEL` hold `TKey`s, have `resolveAvatar` return the key, and let `KiraCover`/`PlayerBar` call `t(label)`. Hot-swappable *and* the test stays untouched. |
| `src/api/agenda.ts:359` | `` `▸ intento ${n} · tema: ${title}` `` | Builds an app-event feed line. Extract with two interpolation variables. |
| `src/api/mock/fixtures.ts` | Stream/Music preset labels (`"bajo"` / `"medio"` / `"alto"`, etc.) | Mock data for endpoints that do not exist yet, but it renders in `StreamPanel`. Extract into the `stream` / `musica` bundles. Low value, low risk. |
| `src/features/shell/SettingsPopover.tsx` | `HELP_TOPICS` (5 title+body pairs) | Real UI copy, module-level const, no test imports it. Move the array to hold keys and resolve in the render — hot-swappable. |
| `src/features/shell/Sidebar.tsx` | `NAV_ITEMS` (5 labels) | Same: hold keys, resolve in the render. No test imports `NAV_ITEMS`. |
| `src/features/shell/BackendGate.tsx` | Boot phase copy + `"Reintentar"` | Renders before anything else. The locale store reads `localStorage` at module init, so `t()` is available this early. Extract into `shell`. |
| `src/ui/ConfirmFooter.tsx:110` | `cancelLabel = "Cancelar"` default parameter | Default parameters evaluate per call, so `t("ui.confirm.cancel")` works and is hot-swappable. Goes in the `ui` bundle. |
| `src/ui/KiraFace.tsx:22` | `aria-label="Kira"` | A proper noun. **Leave it.** |
| `src/features/agenda/AgendaPanel.tsx:534-541` | `TEMPLATE_TOPICS` — 5 seed topic titles, angles and constraint tags | **Content, not chrome.** These are demo prefills the owner is expected to replace, and "translating" them changes what Kira would be asked to talk about. **Recommend leaving them in Spanish.** Flagged as an owner question in §7. |

### 4.7 The boot-locale holdouts, stated plainly

Three module-level structures — `COMMANDS`, the three `*_VOCAB` arrays, and (optionally)
`AVATAR_LABEL` — are imported *by identity* from test files. Keeping them as consts evaluated
at module init keeps those tests untouched and green, at the cost that **those specific
surfaces (the command palette's titles, descriptions and vocabulary labels) show the language
that was active when the app booted, and need a restart to change.**

That is an acceptable landing point, because:

- The owner's stated goal is "all the text visible in EN/ES". It is, in both languages.
- The backend's own `Idioma` control is *already* restart-scoped, so restart-to-apply is a
  familiar shape in this app.
- The alternative costs three edited test files for a palette that most sessions never open
  twice in two languages.

Batch E12 (§6) is written up as the optional fix if the owner disagrees. It is the one batch
in this plan that deliberately edits test files.

### 4.8 The Idioma card: **two controls, one card**

This is the most user-visible decision in the plan, so here is the argument.

**They are not the same setting.** `src/api/i18n.ts:6-9` says it outright: `PUT /api/i18n`
sets the language **Kira speaks**, it never hot-swaps the running backend, and
`pending_restart` is the honest "applies on next start" signal. The UI locale is interface
chrome and can flip in a frame. Collapsing them into one control asserts an equivalence the
system does not implement.

**The mixed configuration is a real use case for this product.** A Spanish-speaking streamer
running an English-language stream wants a Spanish interface and an English-speaking Kira.
That is not a contrived edge case for a streaming co-host — it may be the second most common
configuration after "both the same". One control forbids it outright.

**A single control would have to lie about its own latency.** Flipping it would change the
interface instantly *and* show "Reinicio requerido" — a control that is simultaneously applied
and pending. That is the worst of the three options; the badge stops meaning anything.

**Two controls is also the cheapest and safest to build.** `SettingsPopover.test.tsx` locates
the existing control with `screen.getByRole("group", { name: "Idioma" })` at lines 186, 196
and 220. Testing-library matches accessible names exactly for string queries, so as long as
the **existing** Segmented keeps `ariaLabel="Idioma"` unchanged and the **new** one uses a
distinct name, all three existing Idioma tests keep passing untouched.

**What the owner sees.** The `Idioma` section grows from one control to two labelled rows:

| Row | Control | Behaviour |
| --- | --- | --- |
| **Interfaz** | `Segmented`, `ariaLabel="Idioma de la interfaz"` | Flips the whole UI immediately. Persists to `localStorage["oc-ui-locale"]`. Never calls the backend. Never shows a restart badge. |
| **Voz de Kira** | the existing `Segmented`, `ariaLabel="Idioma"`, unchanged | Still `PUT /api/i18n`. Still shows `"Reinicio requerido — se aplica en el próximo inicio de OpenCohost."` when `pending_restart` is true. |

**What the `pending_restart` badge means afterwards:** exactly what it means today, and only
that — *Kira's speech* changes at next boot. It renders inside the "Voz de Kira" row's block,
so it can no longer be read as commentary on the interface. The badge string itself stays
byte-identical (rewording is out of scope), but the two row labels are new copy — they have to
be, because a second control needs a name. Note that as a small, deliberate copy *addition*,
not a rewording.

**Explicitly not done:** the interface control does not offer to change Kira's language too,
and changing Kira's language does not touch the interface. No coupling, no "apply to both"
checkbox.

**Follow-up worth doing later, not now:** sharpen the badge sentence to name Kira explicitly
(`"…se aplica al reiniciar OpenCohost"` → something that says *Kira's voice*). That is a
reword, which this plan forbids.

---

## 5. Key naming convention

### Scheme

```
<domain>.<surface>.<slot>[.<variant>]
```

- **`<domain>`** — exactly one of the nine folder names: `shell`, `experiencia`, `agenda`,
  `stream`, `musica`, `controles`, `perfiles`, `commands`, `ui`. Mandatory, always first.
  It names the **owning** domain, not the reading one — `controles/PTTCard.tsx` legitimately
  reads `experiencia.ptt.*` keys because `api/pttCopy.ts` serves both surfaces. This prefix is
  also what makes the flat spread in `bundles.ts` collision-free.
- **`<surface>`** — the component or section within the domain, `lowerCamel`:
  `sessionSettings`, `titleBar`, `memoryCard`, `ptt`. One or two segments; do not build a
  five-level path just because the JSX nests five deep.
- **`<slot>`** — what the string *is*, `lowerCamel`.
- **`<variant>`** — only for genuine variants of the same slot: `.one`/`.many`,
  `.pending`, `.empty`.

### Slot rules

| Kind of string | Rule | Example suffix |
| --- | --- | --- |
| Visible text | no suffix | `agenda.session.title` |
| Accessible name only (an `aria-label` on an icon button, a `Segmented` `ariaLabel`) | suffix `.aria` | `agenda.session.turns.aria` |
| Text that is *both* visible and the accessible name | **one key, no suffix**, read by both usages — never two keys with the same value | `shell.settings.welcome.action` |
| Section heading / card title | `.title`; the small uppercase eyebrow labels use `.eyebrow` | `shell.settings.theme.eyebrow` |
| `placeholder` | `.placeholder` | `agenda.topic.title.placeholder` |
| Button / action label | `.action`; its in-flight form is `.action.pending` | `agenda.profile.save.action` |
| Helper or sub-text under a control | `.hint` | `commands.action.hint` |
| Empty state | `.empty` | `experiencia.feed.empty` |
| Confirmation prompt | `.confirm` | `controles.memory.import.confirm` |
| Error copy tied to a backend code | `.error.<backendCode>`, code verbatim | `experiencia.ptt.error.sttUnreachable` |
| Error copy with no backend code | `.error` | `agenda.topic.add.error` |
| Notice / badge | `.notice` | `shell.settings.language.pendingRestart` |

### Hard rules

1. **Never encode the language, the value, or a number in the key.**
   `agenda.priority.alta` is fine (`alta` is a domain value, stable across locales);
   `agenda.priority.high` is not (it encodes English).
2. **Never build a key by concatenation at runtime.** `t("agenda.priority." + value)` defeats
   the `TKey` union and therefore defeats the whole completeness guarantee. When a lookup is
   needed, write an explicit `Record<PriorityValue, TKey>` map — `tsc` then checks both the
   map's exhaustiveness and every key in it.
3. **One key per distinct string.** If two surfaces genuinely show the same word, they still
   get their own keys — a translator may need to diverge them, and merging is cheaper than
   splitting.
4. **Keys are sorted alphabetically within each bundle file.** Trivial, but it makes the
   ES/EN files diffable side by side, which is how a missing translation gets spotted before
   `tsc` even runs.

### Five real examples, from real strings in this repo

| Key | ES value (byte-identical to today) | Source | Why this shape |
| --- | --- | --- | --- |
| `experiencia.ptt.state.idle` | `Mantené para hablar` | `src/api/pttCopy.ts:22` | Plain visible text, no suffix. `PTTCard.test.tsx` asserts it as an accessible button name; the ES bundle must return it byte for byte or that test goes red. |
| `agenda.session.turns.aria` | `Intentos por tema` | `AgendaPanel.tsx:191` | `.aria` because it exists only as an `aria-label` on a `Select` — nothing renders it visibly. |
| `agenda.topic.title.placeholder` | `Tema claro, máximo 90 caracteres` | `AgendaPanel.tsx:684` | `.placeholder`. Note the accented `á`, which is exactly the class of character that breaks byte-identity if retyped. |
| `agenda.constraints.max` | `Máximo {n} etiquetas.` | `AgendaPanel.tsx:593` | The interpolation form. Today it is `` `Máximo ${MAX_CONSTRAINTS} etiquetas.` ``; it becomes `t("agenda.constraints.max", { n: MAX_CONSTRAINTS })`. The trailing period is part of the string. |
| `controles.memory.import.summary.one` / `.many` | `Se importó 1` / `Se importaron {n}` | `MemoryCard.tsx:263` | The plural pair, selected by the caller's existing `result.imported === 1` branch. No plural engine. |

---

## 6. Batch plan — extraction

Twelve mandatory batches (E0–E11) plus one optional (E12). One batch per domain, so no two
batches touch the same bundle file. **Run E0 first; the rest may run in any order after it,
but run them one at a time** — several of them touch `t.ts`'s consumers and all of them touch
`bundles.ts`.

### The invariant every extraction batch must satisfy

1. **The ES bundle returns every string byte for byte identical.** Copy the literal, never
   retype it. The characters that will bite you: `…` (U+2026, not three dots), `—` (em dash),
   `·` (middot), `▸`, `→`, `✓`, `≤`, all the accented vowels, `¿`/`¡`, and trailing periods.
   The 37 test files that assert Spanish literals are the safety net — but only if the bundle
   is a copy, not a transcription.
2. **Test count unchanged: 1050 in, 1050 out. 82 files in, 82 files out.** (E0 is the single
   exception — see below.)
3. **No test file appears in the batch diff.** Before handing the batch over, run
   `git diff --name-only` and confirm nothing matches `\.test\.tsx\?$`. (E0 and E12 are the
   declared exceptions.)
4. **`pnpm exec tsc --noEmit` is clean**, which by construction means the EN bundle for that
   domain is complete.
5. **EN is written in the same batch, as real English.** No `"TODO"` values, no
   `"[EN] Mantené para hablar"`. `tsc` forces *a* value; a placeholder shipped once is a
   placeholder forever, and the owner's goal is the EN text existing.

### Where the invariant is hard

- **Template literals with interpolation.** 32 of them carry Spanish. Each becomes a `t()`
  call with `{name}` placeholders. The risk is the *spacing around* the placeholder:
  `` `La salud del sistema está en rojo (${dims}).` `` must become
  `"La salud del sistema está en rojo ({dims})."` — parentheses and period included in the
  string. Re-read the rendered output character by character.
- **Strings assembled by `join`.** `MemoryCard.tsx:263-269` builds an import summary by
  pushing fragments into an array and joining with `" · "`. Keep the join in the component,
  extract each fragment as its own key, and keep the separator as a literal in the component
  (it is punctuation, not copy).
- **`KiraCover.tsx:191`** — `` ` · ${sessionModeLabel(...)}` `` prepends a separator to a
  computed label. Extract the label, leave the separator in the component.
- **Strings that are also test selectors.** Anything a test finds via
  `getByRole(..., { name: "…" })` or `getByText("…")`. These are the majority; they are the
  net, and they only work if rule 1 holds.
- **Module-level consts imported by tests.** Covered in §4.6 / §4.7 — those specific ones do
  not get the hot-swap treatment in their extraction batch.

### The batches

| # | Scope | Files touched | Bundle files | Notes |
| --- | --- | --- | --- | --- |
| **E0** | The substrate itself | `src/i18n/*` (new), `features/shell/SettingsPopover.tsx`, `features/shell/SettingsPopover.test.tsx` | all 18, created empty-but-valid | **The only batch that adds tests and edits a test file.** Creates `locale.ts`, `t.ts`, `bundles.ts`, the 18 bundle stubs, `t.test.ts`, and adds the "Interfaz" row to the Idioma card (§4.8). Test delta: **+N** (`t.test.ts` cases, plus new assertions for the new control). Existing Idioma assertions at `SettingsPopover.test.tsx:186,196,200,210,220` must remain **untouched and passing** — that is the check that the new control's accessible name does not collide. Commit: `feat(i18n): add the in-house bundle substrate and a UI language control` |
| **E1** | `src/ui/` | `ConfirmFooter.tsx` (the `cancelLabel` default) and any other primitive default label found | `ui.es.ts`, `ui.en.ts` | Deliberately the smallest domain — a warm-up that proves the invariant loop. Leave `KiraFace`'s `aria-label="Kira"` alone. Commit: `refactor(i18n): extract design-system copy into the ui bundle` |
| **E2** | shell chrome | `Sidebar.tsx` (`NAV_ITEMS`), `TitleBar.tsx`, `BackendGate.tsx`, `SettingsPopover.tsx` (`HELP_TOPICS` + section eyebrows + alert-style option labels), `AppLayout.tsx`, `MainStage.tsx`, `EventBridge.tsx` | `shell.*` | `NAV_ITEMS` and `HELP_TOPICS` become key-holding arrays resolved in the render (no test imports either). Commit: `refactor(i18n): extract shell chrome copy` |
| **E3** | `StatusRail.tsx` | 1 component (593 lines, ~41 copy sites) | `shell.*` | Split out of E2 purely for size. Heavy on interpolated health/telemetry strings — see "where the invariant is hard". Commit: `refactor(i18n): extract status rail copy` |
| **E4** | experiencia | `ConversationPanel.tsx`, `KiraCover.tsx`, `WelcomeCard.tsx`, `PlayerBar.tsx`, `LogsPanel.tsx`, `kiraState.ts` | `experiencia.*` | `kiraState.ts` gets the key-returning treatment from §4.6 (hot-swappable, test untouched). Commit: `refactor(i18n): extract the conversation and presence copy` |
| **E5** | agenda | `AgendaPanel.tsx` (936 lines, ~44 copy sites) | `agenda.*` | The largest single component. **Do not extract `TEMPLATE_TOPICS` (lines 534-541)** — see §7 open question. Commit: `refactor(i18n): extract agenda panel copy` |
| **E6** | commands | `registry.tsx`, `wire.ts`, `primitives.tsx`, `Stepper.tsx`, `ComposerCommandPanel.tsx` | `commands.*` | The largest copy mass (~83 sites). `COMMANDS` and the three `*_VOCAB` arrays stay module-level consts evaluated at init — boot-locale holdouts, §4.7. Everything reached through a function (`errorCopy`, `describeMood`, …) is fully hot-swappable. Commit: `refactor(i18n): extract command palette copy` |
| **E7** | controles, part 1 | `MemoryCard.tsx` (703 lines), `ProviderCard.tsx` (648 lines) | `controles.*` | Split from E8 by size only. Contains four of the five plural sites (§4.5). Commit: `refactor(i18n): extract memory and provider card copy` |
| **E8** | controles, part 2 | `ControlsPanel.tsx`, `EditorialCardsCard.tsx`, `PersonalizationCard.tsx`, `PTTCard.tsx`, `VoiceCard.tsx`, `AvatarCard.tsx`, `ObsCard.tsx`, `ModelCard.tsx` | `controles.*` | `PTTCard` keeps reading `api/pttCopy.ts` here; that module is converted in E11. Commit: `refactor(i18n): extract the remaining controls card copy` |
| **E9** | perfiles | `ProfileEditor.tsx`, `ProfilePlaylist.tsx`, `ProfileSwitcher.tsx` | `perfiles.*` | Includes the Sidebar preview card copy that lives in `Sidebar.tsx`'s `ProfilesRegion` — if E2 already took it, skip. Commit: `refactor(i18n): extract profiles copy` |
| **E10** | stream + musica | `StreamPanel.tsx`, `MusicPanel.tsx`, `api/mock/fixtures.ts` | `stream.*`, `musica.*` | Merged because both are small (~9 copy sites each) and both read `fixtures.ts` — two batches would collide in that file. Commit: `refactor(i18n): extract stream and music panel copy` |
| **E11** | cross-cutting copy modules | `api/pttCopy.ts`, `lib/appEvents.ts`, `api/agenda.ts:359` | `experiencia.*`, `shell.*` | `pttCopy`'s two `Record`s become functions; the two call sites (`PTTCard.tsx`, `ConversationPanel.tsx`) change from `ERROR_COPY[code]` to `errorCopy(code)`. `appEvents`' `EVENT_COPY` needs no signature change. PTT keys live in the **experiencia** bundle even though one reader is in `controles` (§5, ownership rule). Commit: `refactor(i18n): extract the shared copy modules` |
| **E12** *(optional)* | boot-locale holdouts | `commands/registry.tsx`, `commands/wire.ts`, `experiencia/kiraState.ts` **and three test files** | none new | Converts `COMMANDS` and the `*_VOCAB` arrays from consts to functions so the palette hot-swaps. **This batch edits `agendaTurnOptions.test.tsx`, `commands.test.tsx` and `kiraState.test.ts` and therefore breaks the extraction invariant on purpose.** Only run it if the owner wants those surfaces to change language without a restart. Commit: `refactor(i18n): make the command palette copy hot-swappable` |

---

## 7. Risks and stop conditions

Ranked by how likely they are to cost a session.

### 1. A stale `vi.mock` string path — `tsc` cannot see it

The highest-value item in this document. `vi.mock("./components/AppLayout.js")` is a string
literal; TypeScript never resolves it. Vitest, given a path that matches no module, either
throws or — worse — leaves the real module in place, so the test *passes* while asserting
against the wrong thing.

Exactly three are affected:

| File | Line | Batch | Change |
| --- | --- | --- | --- |
| `src/App.test.tsx` | 20 | **9** | `"./components/AppLayout.js"` → `"./features/shell/AppLayout.js"` |
| `src/components/BackendGate.test.tsx` | 16 | **9** | `"../lib/backendBootstrap.js"` → `"../../lib/backendBootstrap.js"` |
| `src/components/ConversationPanel.test.tsx` | 30 | **8** | `"../api/liveTranscript.js"` → `"../../api/liveTranscript.js"` |

Before finishing Batch 8 or 9, run `grep -rn "vi.mock(" src/` and eyeball every relative path.

### 2. A batch turns a test red

**Stop. Do not edit the test.** In a modularization batch a red test means a move was wrong,
not that an assertion was wrong. In an extraction batch it means the ES string is not
byte-identical — the fix is in the bundle, always.

Diagnostic order:
1. Is the failure "cannot find module" or "is not a function"? → a `vi.mock` path (risk 1) or
   an ESM cycle introduced by an accidental barrel (risk 6).
2. Is the failure a string mismatch? → copy the expected value out of the test's error output
   and diff it against the bundle value character by character. Suspect `…` vs `...`, `—` vs
   `-`, and a missing trailing period.
3. Is the failure a missing DOM node? → a component silently rendered a different branch,
   which in an extraction batch usually means a `t()` call was placed at module scope where the
   original was in the render.

Report the failing test name, the assertion diff and the batch number. Nothing is committed
until green, so there is nothing to roll back.

### 3. `tsc` reports an error the batch did not predict

If it is a **module-resolution** error (`TS2307 Cannot find module`), the prediction table was
incomplete — fix the import and note it. That is expected and harmless; the tables here are a
convenience, `tsc` is the authority.

If it is a **type** error (anything else), **stop**. Moving a file cannot introduce a type
error. Either a file was edited beyond its imports, or a `git mv` clobbered something. Report
before continuing.

### 4. Unusually entangled files, by name

| File | Why it is entangled | Handling |
| --- | --- | --- |
| `src/components/agendaTurnOptions.test.tsx` | A test with no component of its own, importing `AgendaPanel`, `commands/registry`, `commands/primitives`, `api/agenda` and `ui/Toast`. It is the only file that spans two feature folders after the split, and its imports are rewritten in **three** batches (2, 7, and again if `ui` paths shift). | Lands in `features/agenda/`. Expect to touch it more than once; that is not a mistake. |
| `src/components/commands/registry.tsx` (615 lines) | The most cross-domain module in the repo: five `api/*` modules, `state/PlaybackProvider`, `MusicPanel`'s `pickRotationTrack`, plus `ui`. It also holds the largest single block of copy and one of the boot-locale holdouts. | Batch 7 moves it; E6 extracts it. Do not try to do both in one pass. |
| `src/components/ConversationPanel.tsx` (928 lines) | 17 relative imports across six directories, and after Batch 7 three of them point at `features/commands/` and `features/experiencia/` before the file itself moves. | Batch 8. Its `vi.mock` is risk 1. |
| `src/components/MainStage.tsx`, `AppLayout.tsx`, `src/App.tsx` | Edited by nearly every batch. This is the entire reason the batches are sequential. | Never run two batches concurrently. |
| `src/components/AppLayout.tsx:10` and `:136` | A commented-out `import { PlayerBar } from "./PlayerBar.js"` and a `<PlayerBar />` inside a JSX comment. `tsc` will not flag either. | Update the comment in Batch 8 so the path is not a trap for whoever un-shelves it. |
| `src/components/PlayerBar.tsx` | Shelved: no live import, but a live test suite. Easy to mistake for dead code and delete. | Move it, do not delete it. Deleting shelved code is a separate owner decision. |
| `src/api/types.gen.ts` | Regenerated by the `pretest` hook on every `pnpm test`. | Never hand-edit. If it shows up dirty, it is the generator. |
| `src/components/AgendaPanel.tsx:534-541` | `TEMPLATE_TOPICS` — visible Spanish content that is arguably data, not UI copy. | See the open question below. |

### 5. ES byte-drift during extraction

The 37 Spanish-asserting test files only protect what they assert. A string that no test covers
can be silently mangled and nothing will notice until the owner sees it. Mitigation: copy, do
not retype; and when a batch is done, skim the bundle file for anything that looks
transcribed rather than pasted (straight apostrophes, `...` instead of `…`, a missing accent).

### 6. Someone adds a barrel

`src/features/<domain>/index.ts` is a **stop condition**. It defeats the `file:line` precision
the migration relies on and it creates real cycle risk given
`commands → musica` and `experiencia → commands` (§2). If one appears, delete it and rewrite
the imports to deep paths before continuing.

### 7. `localStorage` at module init

`src/i18n/locale.ts` reads storage at module scope. `useDensity.ts` does this unguarded and
`useLogsPref.ts` wraps it in `try/catch`. **Follow `useLogsPref`** — a storage-denied
environment must degrade to the default locale, not break module initialisation for the entire
app. `t.test.ts` should cover the throwing-storage path.

### 8. `pretest` regenerates a tracked file

`pnpm test` runs `gen:api:offline`, rewriting `src/api/types.gen.ts`. On a clean tree it is a
no-op. Confirm that before starting Batch 1; if it is *not* a no-op on this machine, every
batch diff will carry a generated file and the orchestrator's commits will be noisy.

---

## Open question for the owner

One thing could not be resolved from the code, and the answer changes extraction batch E5:

**`TEMPLATE_TOPICS` in `AgendaPanel.tsx:534-541`** — five seeded topic titles, angles and
constraint tags ("Nostalgia de los 2000 en gaming", "Burnout de streamers", …). They render as
clickable prefills. They are visible Spanish text, which argues for translating them; but they
are demo *content* the owner is expected to replace, and an English version would be five
different topic suggestions, not a translation of chrome.

This plan defaults to **leaving them in Spanish and not extracting them**. If the owner wants
them in the bundles, E5 grows by 25 strings and the EN side becomes an editorial decision
rather than a translation.

---

## Follow-ups explicitly out of scope

- **Voseo neutralization.** "Mantené", "Chateá", "Elegí", "Armá" stay exactly as they are.
  Neutralizing them is a separate batch with its own test updates, and it is much cheaper
  *after* extraction, when every affected string lives in nine bundle files instead of being
  scattered across 30 components.
- **Rewording the `pending_restart` badge** to name Kira explicitly (§4.8).
- **Deleting the shelved `PlayerBar`.**
- **Extracting `pickRotationTrack` out of `MusicPanel.tsx`** into `src/lib/` — worth doing if a
  third consumer ever appears (§1.7).

---

## 8. Corrections from execution

Appended as the plan was carried out. Where this section disagrees with the sections above,
**this section wins** — it records what the code actually did, not what was predicted.

### 8.1 The modularization ran in 8 commits, not 9

Batches 2, 3 and 4 (`agenda`, `stream`, `musica`) were executed by one implementer and landed
as a single commit, `638e8a7`. They are the same shape — one panel, one `MainStage.tsx` import
each — so splitting them bought no reviewability. Every other batch is its own commit. All nine
batches were individually verified against the gate before being grouped.

Commit trail: `f7fc5bd` (this plan) · `54244e0` (B1 ui) · `638e8a7` (B2-4) · `7a86af7` (B5) ·
`fde5b6b` (B6) · `a94af11` (B7) · `5a55929` (B8) · `03b5c58` (B9) · `68ee7ed` (stale comment
paths) · `3ddffc1` (E0).

### 8.2 `tsc` error codes for the completeness proof

§4.2 predicts `TS2739` for a missing EN key. The observed code for a **single** missing key is
**`TS2741`**; `TS2739` is the multi-property variant of the same check. Extra-key detection is
`TS2353`, exactly as documented. Both directions were verified by deliberately breaking a
bundle and watching `tsc` fail, not by inspection.

### 8.3 Two controls in one card cannot share option labels

§4.8 specifies distinct `ariaLabel`s for the two Idioma controls but says nothing about their
**option** labels. Giving the new interface control the same `"Español"`/`"English"` options as
the backend control makes `getByRole("button", { name: "English" })` ambiguous and breaks two of
the three protected tests. The interface control therefore uses the locale codes `"ES"`/`"EN"`,
which are not translated content and need no key (same reasoning as `KiraFace`'s literal
`"Kira"`).

**Rule for every later batch:** when a batch introduces a control beside an existing one, check
the *accessible names of its options*, not just the group name. Two controls whose options
collide will break tests that were correct before the batch.

### 8.4 The Idioma section is not gated on the backend

E0 first shipped the whole `Idioma` section inside `{i18n && …}`, inherited from when the card
was entirely backend-driven. That silently coupled the **local** interface control to
`GET /api/i18n`: a 500, a timeout or an older backend without the endpoint would have hidden a
setting that never touches the network — contradicting §4.8's "no coupling" claim.

Fixed in `3ddffc1`: the `<section>` and the interface row always render; only the "Voz de Kira"
block waits on `i18n`. Pinned by `SettingsPopover.test.tsx` →
*"survives a failing GET /api/i18n"*, which was verified to fail when the coupling is
reintroduced and pass when it is not.

### 8.5 Test-count baseline for the extraction batches

§6's invariant says 1050 tests / 82 files. That was the pre-E0 baseline. E0 added
`src/i18n/t.test.ts` and three `SettingsPopover` cases, so the baseline for **E1 onward** is:

| | Files | Tests |
| --- | --- | --- |
| Before E0 | 82 | 1050 |
| After E0 (`3ddffc1`) | 83 | 1058 |

E1-E11 must leave both numbers untouched.

### 8.6 The per-file tables in §6 are a floor, not the scope

E1 found copy that §6's own table did not name. The tables were built from module-level copy
(`const` maps, option arrays, exported records) and do not enumerate **inline JSX literals** —
`aria-label`, `placeholder`, `title`, `alt`, and bare text nodes — which is where most of the
copy in a 40-site component actually lives.

**Every extraction batch must run its own literal sweep over each file it owns**, and treat the
§6 table as a starting list rather than the full inventory. A useful pass:

```
grep -nE '"[^"]*[a-záéíóúñ¿¡][^"]*"' <file>      # quoted literals, incl. attributes
grep -nE '>[^<>{}]*[a-záéíóúñ][^<>{}]*<'  <file>  # bare JSX text nodes
```

Then discard what is not copy: `className`, imports, `data-*`, test ids, CSS values, proper
nouns (`Kira`, `OpenCohost`, `Twitch`, `OBS`), locale codes, and units.

### 8.7 Pre-existing English strings inside the Spanish UI

`Snackbar.tsx` and `Toast.tsx` shipped hardcoded **English** aria labels (`"Dismiss"`,
`"Notifications"`) in an otherwise Spanish interface. E1 extracted them byte-identically, which
is correct under the invariant but means `ui.es.ts` currently holds English values for three
keys.

That is a **pre-existing copy bug now made visible and cheap to fix** — the ES values want to
become `"Descartar"` and `"Notificaciones"`. Like voseo neutralization, it is a copy change and
therefore out of scope for extraction. Added to the follow-up list; do not fix it inside an
extraction batch.
