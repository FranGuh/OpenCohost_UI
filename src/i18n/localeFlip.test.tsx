import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProfileSwitchProvider } from "../api/useProfileSwitch.js";
import { AgendaPanel } from "../features/agenda/AgendaPanel.js";
import { ComposerCommandPanel } from "../features/commands/ComposerCommandPanel.js";
import { ControlsPanel } from "../features/controles/ControlsPanel.js";
import { ConversationPanel } from "../features/experiencia/ConversationPanel.js";
import { SettingsPopover } from "../features/shell/SettingsPopover.js";
import { useEventStore } from "../store/eventStore.js";
import { useLogsPrefStore } from "../store/useLogsPref.js";
import { agendaGetHandler, defaultAgenda, evolvingLastReplyHandler, frozenStatusHandler } from "../test/handlers.js";
import { server } from "../test/server.js";
import { ToastProvider } from "../ui/Toast.js";
import { useUiLocaleStore } from "./locale.js";

// Same contract as ConversationPanel.test.tsx: the LiveAudio WS echo hook is
// unit-tested elsewhere, so it's mocked down to a no-op — this file only
// needs ConversationPanel to mount, not to exercise PTT.
vi.mock("../api/liveTranscript.js", () => ({
  useLiveTranscript: () => {}
}));

/**
 * The whole suite runs almost entirely in the default `es` locale, so a green
 * run proves the Spanish came out byte-identical — and, on its own, proves
 * nothing about English. This file (plus `t.test.ts`) is what actually
 * exercises a locale flip end to end through a real component tree: store
 * write → `useT()` subscription → re-render → EN bundle lookup — one tripwire
 * per domain, not exhaustive EN coverage (see the second describe block
 * below).
 *
 * It deliberately asserts on components, not on `t()`. `t.test.ts` already
 * covers the substrate in isolation; what can silently rot is the wiring —
 * a component that reads `t` without subscribing, a memo that bakes a string
 * in and never recomputes, or a subtree that only renders correctly when
 * mounted fresh in the target locale instead of flipped into it. Those fail
 * here and nowhere else.
 */

/**
 * The trigger's own accessible name is translated too, so the caller has to say
 * which language it expects to find it in. That is not incidental: a helper
 * that hardcoded "Configuración" would fail the moment the flip worked, which
 * is exactly how this file was written the first time.
 */
function openSettings(triggerName: "Configuración" | "Settings") {
  render(<SettingsPopover onShowWelcome={() => {}} />);
  fireEvent.click(screen.getByRole("button", { name: triggerName }));
}

function interfaceControl(groupName: "Idioma de la interfaz" | "Interface language") {
  return screen.getByRole("group", { name: groupName });
}

beforeEach(() => {
  window.localStorage.clear();
  useUiLocaleStore.setState({ locale: "es" });
  document.documentElement.lang = "es";
});

afterEach(() => {
  // The store is module-level state shared across this file's tests — leaving
  // it on "en" would leak into whatever runs next.
  useUiLocaleStore.setState({ locale: "es" });
});

describe("locale flip — the interface actually re-translates", () => {
  it("switches the settings chrome from Spanish to English and back", async () => {
    openSettings("Configuración");

    // Spanish first, so the assertions below are a change and not a constant.
    expect(screen.getByText("Tema")).toBeInTheDocument();
    expect(screen.getByText("Alertas")).toBeInTheDocument();
    expect(screen.getByText("Vista")).toBeInTheDocument();

    fireEvent.click(within(interfaceControl("Idioma de la interfaz")).getByRole("button", { name: "EN" }));

    await waitFor(() => expect(screen.getByText("Theme")).toBeInTheDocument());
    expect(screen.getByText("Alerts")).toBeInTheDocument();
    expect(screen.getByText("View")).toBeInTheDocument();
    expect(screen.queryByText("Tema")).not.toBeInTheDocument();
    expect(screen.queryByText("Alertas")).not.toBeInTheDocument();
    // The trigger's own aria-label is copy as much as the body is.
    expect(screen.getByRole("button", { name: "Settings" })).toBeInTheDocument();

    // And back — a one-way flip would be just as broken.
    fireEvent.click(within(interfaceControl("Interface language")).getByRole("button", { name: "ES" }));

    await waitFor(() => expect(screen.getByText("Tema")).toBeInTheDocument());
    expect(screen.queryByText("Theme")).not.toBeInTheDocument();
  });

  it("re-translates copy nested inside a lazily-opened subtree", async () => {
    // Mount in Spanish and flip through the UI — not by presetting the store
    // before render() — so the help flyout is a subtree opened AFTER a real
    // flip, not one that merely renders correctly because it was fresh in
    // English from the start. That is the shape that would catch copy
    // resolved in a useState initializer or a useMemo(…, []).
    openSettings("Configuración");

    fireEvent.click(within(interfaceControl("Idioma de la interfaz")).getByRole("button", { name: "EN" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Settings" })).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Help" }));

    await waitFor(() => expect(screen.getByText("Experience")).toBeInTheDocument());
    expect(screen.queryByText("Experiencia")).not.toBeInTheDocument();
  });

  it("keeps the two language controls distinguishable in English", async () => {
    // §8.3: the interface control's options are locale CODES precisely so they
    // never collide with the backend control's endonyms. If someone ever
    // translates them into full language names, this goes ambiguous and the
    // three protected Idioma tests start failing for a reason nobody expects.
    // Flipped through the UI, matching the rest of this file, rather than
    // presetting the store before render().
    openSettings("Configuración");

    fireEvent.click(within(interfaceControl("Idioma de la interfaz")).getByRole("button", { name: "EN" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Settings" })).toBeInTheDocument());

    const group = interfaceControl("Interface language");
    expect(within(group).getByRole("button", { name: "ES" })).toBeInTheDocument();
    expect(within(group).getByRole("button", { name: "EN" })).toHaveAttribute("aria-pressed", "true");
  });
});

/**
 * The suite above only ever mounts SettingsPopover, so it says nothing about
 * the other 33 `useT()` consumers. None of these panels own a locale
 * switcher of their own, so each test flips the module-level store directly
 * (wrapped in `act` — this is a real React tree, not a plain-object test like
 * t.test.ts) rather than through UI, then asserts one string re-translates.
 * Breadth, not depth: one tripwire per domain, not exhaustive EN coverage.
 */
describe("locale flip — one tripwire per domain", () => {
  beforeEach(() => {
    useEventStore.setState({ events: [] });
    useLogsPrefStore.setState({ showLogs: false });
  });

  it("agenda: re-translates the empty-queue message", async () => {
    server.use(agendaGetHandler({ ...defaultAgenda, queued_topics: [] }));
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <AgendaPanel />
        </ToastProvider>
      </QueryClientProvider>
    );
    // QueueCard lives in the "Temas" pane (PaneSwitcher) — "Perfil co-host" is
    // the default.
    fireEvent.click(screen.getByRole("button", { name: "Temas" }));
    await waitFor(() => expect(screen.getByText("No hay temas en cola todavía.")).toBeInTheDocument());

    act(() => useUiLocaleStore.getState().setLocale("en"));

    expect(screen.getByText("No topics in the queue yet.")).toBeInTheDocument();
    expect(screen.queryByText("No hay temas en cola todavía.")).not.toBeInTheDocument();
  });

  it("controles: re-translates a group header", () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <ProfileSwitchProvider>
          <ControlsPanel />
        </ProfileSwitchProvider>
      </QueryClientProvider>
    );
    expect(screen.getByRole("button", { name: "Perfil y modelo" })).toBeInTheDocument();

    act(() => useUiLocaleStore.getState().setLocale("en"));

    expect(screen.getByRole("button", { name: "Profile and model" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Perfil y modelo" })).not.toBeInTheDocument();
  });

  it("experiencia: re-translates the kiraBusy pending note baked into the visibleTurns memo (useT identity)", async () => {
    // t.ts's useT() deliberately hands back a fresh closure per locale so a
    // useMemo listing `t` as a dependency recomputes on a flip.
    // ConversationPanel's `visibleTurns` memo (which bakes this exact note
    // into `pendingNote`) is the one real consumer of that identity change —
    // this is the only test in the suite that flips the locale on it.
    server.use(frozenStatusHandler(1, { is_speaking: true }));
    server.use(evolvingLastReplyHandler({ turn_id: 1 }, { text: "ya te contesto", turn_id: 2 }, 1));
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <ConversationPanel />
      </QueryClientProvider>
    );
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());

    fireEvent.change(screen.getByPlaceholderText("Escribí un mensaje para Kira…"), { target: { value: "hola" } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar" }));

    await waitFor(() =>
      expect(screen.getByText("Kira te escuchó — responderá después del bloque actual")).toBeInTheDocument()
    );

    act(() => useUiLocaleStore.getState().setLocale("en"));

    expect(screen.getByText("Kira heard you — she'll answer after the current block")).toBeInTheDocument();
    expect(screen.queryByText("Kira te escuchó — responderá después del bloque actual")).not.toBeInTheDocument();
  });

  it("commands: re-translates the palette title and a step's question, which doubles as the input's accessible name", () => {
    // The command palette was just converted from module-init t() to
    // key-holding fields (§8.8), so it now translates live — nothing guarded
    // that until this test. `question` matters specifically because it is
    // also each stepper input's aria-label (src/features/commands/primitives.tsx).
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <ComposerCommandPanel query="/agenda" onClose={() => {}} />
      </QueryClientProvider>
    );
    expect(screen.getByText("Comandos del chat")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /agenda — programá un tema/ }));
    expect(screen.getByLabelText("¿Qué tema querés agendar?")).toBeInTheDocument();

    act(() => useUiLocaleStore.getState().setLocale("en"));

    expect(screen.getByText("Chat commands")).toBeInTheDocument();
    expect(screen.getByLabelText("What topic do you want to schedule?")).toBeInTheDocument();
    expect(screen.queryByText("Comandos del chat")).not.toBeInTheDocument();
  });
});
