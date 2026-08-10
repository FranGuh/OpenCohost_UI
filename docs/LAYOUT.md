# Layout guide

How the app shell is put together, and how to change it.

## Regions

`src/features/shell/AppLayout.tsx` is a CSS grid with 3 named areas in a single
row. Each area mounts exactly one component:

```
"side main queue"
```

| Grid area | Component | Role |
|---|---|---|
| `side` | `shell/Sidebar.tsx` | nav (5 sections) + profile playlist |
| `main` | `shell/MainStage.tsx` | the stage — renders per `activeSection` |
| `queue` | `experiencia/ConversationPanel.tsx` | chat/alerts queue |

The column track is dynamic: the `side` column animates between
`SIDEBAR_WIDTH.collapsed` and `SIDEBAR_WIDTH.expanded`, `main` takes `1fr`, and
`queue` is a fixed `CHAT_COLUMN_WIDTH`. The row is a single `minmax(0, 1fr)` —
every panel scrolls inside its own area, the page never does.

**Brand and status are not grid areas.** They live in the native-style window
chrome: `shell/TitleBar.tsx` renders the brand lockup and exposes a controls
slot, and `AppLayout` portals `<StatusRail />` and `<SettingsPopover />` into
that slot once the app is ready (during boot the slot stays empty). The whole
bar carries `data-tauri-drag-region` — in Tauri v2 dragging fires only on
elements that declare it, so any new child of `TitleBar` needs it too or it
becomes a dead spot in the drag handle.

**`experiencia/PlayerBar.tsx` is currently not mounted.** The `player` grid area
and its `<PlayerBar />` block are commented out in `AppLayout.tsx`. The component
and its tests are still live code, and it still owns its `experiencia.playerBar.*`
i18n keys — do not delete it on the assumption that it is dead; re-enabling it is
a one-block edit plus a fourth grid area.

`activeSection` (`Sidebar.tsx`'s `Section` type) is owned by `AppLayout` and
passed down to `Sidebar` and `MainStage` — that's the only cross-region wiring.

## Identity — single source

Everything visual resolves from **`src/styles/tokens.css`**. Components never hardcode color or font.

- **Brand color**: edit `--focus` (primary/signature) and `--pulse` (secondary) in the `:root, [data-theme="cockpit"]` block at the top of the file. Every theme (`cockpit`/`aurora`/`studio`) also has its own palette lower in the file if you want per-theme tuning instead.
- **Fonts**: edit `--font-mono` (UI chrome — nav, labels, buttons) and `--font-sans` (Kira's reply text, headings) in the same block. Both are system stacks — no web font loading.
- Tailwind (`tailwind.config.ts`) just maps `bg-primary`, `font-mono`, `text-focus`, etc. to these CSS vars — don't add new hex values there.

## Primitives (`src/ui/`)

The design system. `Button`, `Card`, `Badge`, `Switch`, `Select`, `Segmented`,
`Slider`, `Input`, `Tabs`, `Alert`, `Collapsible`, `Markdown`, `Toast`,
`ConfirmFooter`, `BrandMark`, `KiraFace`, `BootLoader`, `BootCollage`. Compose
from these before writing new markup — they already carry the token-driven
theming and focus-ring accessibility pattern.

`src/ui/` sits below every feature: it may import from `src/lib/` and
`src/i18n/`, and it must never import from `src/features/`. That direction is
what keeps the design system reusable; an inbound edge from a feature is a
layering inversion, not a shortcut.

## Copy (`src/i18n/`)

No user-visible string is written inline. Components call `const t = useT()` and
render `t("<domain>.<path>")`; the text lives in `src/i18n/bundles/<domain>.es.ts`
and its `.en.ts` sibling. Each EN bundle is typed
`Record<keyof typeof <domain>Es, string>`, so a key present in Spanish and
missing in English is a **compile error**, not a runtime fallback.

Use `useT()` rather than the bare `t` import inside components — `useT()`
subscribes to the locale store, and a component that reads bare `t` renders the
boot language forever with no test able to see it. See
`docs/UI_DOMAIN_I18N_MIGRATION.md` for the full substrate.

## How-to

**Rearrange a section** — reorder the `NAV_ITEMS` array in `Sidebar.tsx`; the grid areas in `AppLayout.tsx` don't need to change unless you're moving a whole panel to a different grid slot.

**Add a nav item** — four edits:
1. add an entry to `NAV_ITEMS` in `Sidebar.tsx` — `(id / icon / labelKey)`, where `labelKey` is `"shell.nav.<id>"`;
2. add that key to **both** `src/i18n/bundles/shell.es.ts` and `shell.en.ts` (miss the EN half and `tsc` fails);
3. extend the `Section` union;
4. add the matching branch in `MainStage.tsx`'s `activeSection` switch.

**Restyle a panel** — use existing primitives (`Card`, `Badge`, etc.) and Tailwind classes that resolve to tokens (`bg-card`, `text-focus`, `border-border-soft`). Avoid new inline hex — if a color doesn't exist yet, add it as a token first.

**Change identity** — edit the brand tokens in `tokens.css` (see above). One edit, every component and every theme variant picks it up.
