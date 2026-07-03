# OpenCohost Tauri Shell Prototype

This is an isolated UI prototype for OpenCohost.

It does **not** replace the current CustomTkinter app. It exists to validate a faithful polish of the
existing interface before any migration decision.

## Goal

Show OpenCohost as:

> a local AI cohost harness that conducts a prepared stream agenda using approved context cards,
> memory, and guardrails.

The current Python engine remains the source of truth. This shell should treat it as an external engine,
not as React component state.

## Design correction

The first prototype went too far toward a generic SaaS/dashboard visual language. That was the wrong
direction.

This prototype now follows a **faithful polish** rule:

- keep the same two-column structure;
- keep Kira as the left-side primary experience;
- keep the top status strip, tabs, cards, and operator controls recognizable;
- improve hierarchy, spacing, labels, and error severity;
- do not turn OpenCohost into a different-looking product before the current identity is validated.

## Proposed future bridge

The prototype includes `src/lib/pythonEngineBridge.ts` with three intended modes:

1. `demo` — mocked state for visual validation.
2. `http` — future local HTTP bridge, for example `http://127.0.0.1:<port>`.
3. `sidecar` — future Tauri sidecar that launches or attaches to the Python engine.

No production Python code is changed by this prototype.

## Run later

Dependencies are intentionally not installed here.

```powershell
cd OpenCohost_TAURI
pnpm install
pnpm dev
```

For a future Tauri desktop run:

```powershell
pnpm tauri dev
```

## Current preview files

- `preview-static.html` — faithful polish: very close to the current app, cleaner hierarchy.
- `preview-alt-aurora.html` — alternate color proposal: same app shape, stronger violet/pink/cyan identity.

## Design principle

The first screen should stay recognizably OpenCohost, but it should not let raw engine errors dominate
the product narrative.

It should communicate:

- Kira is conducting the stream.
- The current agenda item is clear.
- Approved context cards are visible.
- Guardrails are active.
- The operator can take over at any moment.
