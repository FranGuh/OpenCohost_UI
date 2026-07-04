# Layout guide

How the app shell is put together, and how to change it.

## Regions

`AppLayout.tsx` is a CSS grid with 5 named areas. Each area mounts exactly one component:

```
"top  top  top"
"side main queue"
"player player player"
```

| Grid area | Component | Role |
|---|---|---|
| `top` | `TopBar.tsx` | brand lockup (`BrandMark` + wordmark) + `StatusRail` (status badges) + settings |
| `side` | `Sidebar.tsx` | nav (5 sections) + profile playlist |
| `main` | `MainStage.tsx` | the stage — renders per `activeSection` |
| `queue` | `ConversationPanel.tsx` | chat/alerts queue |
| `player` | `PlayerBar.tsx` | now-playing transport bar |

Brand and status live inside `TopBar` rather than as separate grid areas — they're a single visual cluster (a header), not independent layout regions, so splitting them into the grid would add a slot with no layout reason. If you ever need to move status somewhere else in the grid (e.g. into the sidebar), pull `<StatusRail />` out of `TopBar` and give it its own grid area.

`activeSection` (`Sidebar.tsx`'s `Section` type) is owned by `AppLayout` and passed down to `Sidebar` and `MainStage` — that's the only cross-region wiring.

## Identity — single source

Everything visual resolves from **`src/styles/tokens.css`**. Components never hardcode color or font.

- **Brand color**: edit `--focus` (primary/signature) and `--pulse` (secondary) in the `:root, [data-theme="cockpit"]` block at the top of the file. Every theme (`cockpit`/`aurora`/`studio`) also has its own palette lower in the file if you want per-theme tuning instead.
- **Fonts**: edit `--font-mono` (UI chrome — nav, labels, buttons) and `--font-sans` (Kira's reply text, headings) in the same block. Both are system stacks — no web font loading.
- Tailwind (`tailwind.config.ts`) just maps `bg-primary`, `font-mono`, `text-focus`, etc. to these CSS vars — don't add new hex values there.

## Primitives (`src/components/ui/`)

`Button`, `Card`, `Badge`, `Switch`, `Select`, `Segmented`, `BrandMark`. Compose from these before writing new markup — they already carry the token-driven theming and focus-ring accessibility pattern.

## How-to

**Rearrange a section** — reorder the `NAV_ITEMS` array in `Sidebar.tsx`; the grid areas in `AppLayout.tsx` don't need to change unless you're moving a whole panel to a different grid slot.

**Add a nav item** — add an entry to `NAV_ITEMS` in `Sidebar.tsx` (id/icon/label), extend the `Section` union, and add the matching branch in `MainStage.tsx`'s `activeSection` switch.

**Restyle a panel** — use existing primitives (`Card`, `Badge`, etc.) and Tailwind classes that resolve to tokens (`bg-card`, `text-focus`, `border-border-soft`). Avoid new inline hex — if a color doesn't exist yet, add it as a token first.

**Change identity** — edit the brand tokens in `tokens.css` (see above). One edit, every component and every theme variant picks it up.
