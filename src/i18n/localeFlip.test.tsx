import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SettingsPopover } from "../features/shell/SettingsPopover.js";
import { useUiLocaleStore } from "./locale.js";

/**
 * The whole suite runs in the default `es` locale, so 1058 passing tests prove
 * the Spanish came out byte-identical — and prove nothing whatsoever about
 * English. This file is the one guard that actually exercises a locale flip
 * end to end through a real component tree: store write → `useT()`
 * subscription → re-render → EN bundle lookup.
 *
 * It deliberately asserts on a component, not on `t()`. `t.test.ts` already
 * covers the substrate in isolation; what can silently rot is the wiring —
 * a component that reads `t` without subscribing, or a memo that bakes a
 * string in and never recomputes. Those fail here and nowhere else.
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
    // The help flyout mounts after the flip, so this catches a bundle that is
    // only correct for content already on screen when the locale changed.
    useUiLocaleStore.setState({ locale: "en" });
    openSettings("Settings");

    fireEvent.click(screen.getByRole("button", { name: "Help" }));

    await waitFor(() => expect(screen.getByText("Experience")).toBeInTheDocument());
    expect(screen.queryByText("Experiencia")).not.toBeInTheDocument();
  });

  it("keeps the two language controls distinguishable in English", () => {
    // §8.3: the interface control's options are locale CODES precisely so they
    // never collide with the backend control's endonyms. If someone ever
    // translates them into full language names, this goes ambiguous and the
    // three protected Idioma tests start failing for a reason nobody expects.
    useUiLocaleStore.setState({ locale: "en" });
    openSettings("Settings");

    const group = interfaceControl("Interface language");
    expect(within(group).getByRole("button", { name: "ES" })).toBeInTheDocument();
    expect(within(group).getByRole("button", { name: "EN" })).toHaveAttribute("aria-pressed", "true");
  });
});
