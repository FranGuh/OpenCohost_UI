import { fireEvent, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { WelcomeCard } from "./WelcomeCard.js";

describe("WelcomeCard modal carousel", () => {
  it("exposes accessible modal semantics and focuses the close action", () => {
    render(<WelcomeCard onDismiss={vi.fn()} />);

    expect(screen.getByRole("dialog", { name: "Conocé a Kira" })).toHaveAttribute("aria-modal", "true");
    expect(screen.getByRole("button", { name: "Cerrar bienvenida" })).toHaveFocus();
    expect(screen.getByText("1 de 5")).toBeInTheDocument();
  });

  it("navigates all five slides with controls and shows the final CTA", async () => {
    const user = userEvent.setup();
    render(<WelcomeCard onDismiss={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Siguiente" }));
    expect(screen.getByRole("heading", { name: "Tu agenda, siempre presente" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Anterior" }));
    expect(screen.getByRole("heading", { name: "Conocé a Kira" })).toBeInTheDocument();

    for (let index = 0; index < 4; index += 1) await user.click(screen.getByRole("button", { name: "Siguiente" }));
    expect(screen.getByRole("heading", { name: "Tu flujo, tus reglas" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Empezar con Kira" })).toBeInTheDocument();
  });

  it("supports arrow navigation and Escape dismissal", () => {
    const onDismiss = vi.fn();
    render(<WelcomeCard onDismiss={onDismiss} />);

    fireEvent.keyDown(document, { key: "ArrowRight" });
    expect(screen.getByText("2 de 5")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "ArrowLeft" });
    expect(screen.getByText("1 de 5")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it("cycles Tab and Shift+Tab within the dialog", async () => {
    const user = userEvent.setup();
    render(<WelcomeCard onDismiss={vi.fn()} />);
    const close = screen.getByRole("button", { name: "Cerrar bienvenida" });
    const next = screen.getByRole("button", { name: "Siguiente" });

    expect(close).toHaveFocus();
    await user.tab({ shift: true });
    expect(next).toHaveFocus();
    await user.tab();
    expect(close).toHaveFocus();
  });

  it("restores the previously focused element when unmounted", () => {
    const prior = document.createElement("button");
    document.body.append(prior);
    prior.focus();
    const { unmount } = render(<WelcomeCard onDismiss={vi.fn()} />);

    expect(screen.getByRole("button", { name: "Cerrar bienvenida" })).toHaveFocus();
    unmount();
    expect(prior).toHaveFocus();
    prior.remove();
  });

  it("offers labelled progress buttons for direct slide selection", async () => {
    const user = userEvent.setup();
    render(<WelcomeCard onDismiss={vi.fn()} />);
    const first = screen.getByRole("button", { name: "Ir a la diapositiva 1: Conocé a Kira" });
    expect(first).toHaveAttribute("aria-current", "step");

    await user.click(screen.getByRole("button", { name: "Ir a la diapositiva 4: Tu cockpit de streaming" }));
    expect(screen.getByRole("heading", { name: "Tu cockpit de streaming" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ir a la diapositiva 4: Tu cockpit de streaming" })).toHaveAttribute("aria-current", "step");
    expect(first).not.toHaveAttribute("aria-current");
  });

  it("uses explicit color-mix contracts for themed translucent surfaces", () => {
    render(<WelcomeCard onDismiss={vi.fn()} />);
    const dialog = screen.getByRole("dialog");
    expect(dialog.parentElement).toHaveClass("bg-[color-mix(in_srgb,var(--background)_80%,transparent)]");
    expect(dialog.querySelector(".shadow-panel")).toHaveClass("border-[color-mix(in_srgb,var(--border)_70%,transparent)]");
    expect(dialog.querySelector(".shadow-panel")).toHaveClass("bg-[color-mix(in_srgb,var(--background)_30%,transparent)]");
  });

  it("recaptures Tab in either direction when the focused control unmounts", () => {
    render(<WelcomeCard onDismiss={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Siguiente" }));
    const previous = screen.getByRole("button", { name: "Anterior" });
    previous.focus();
    fireEvent.click(screen.getByRole("button", { name: "Ir a la diapositiva 1: Conocé a Kira" }));
    expect(document.activeElement).not.toBe(screen.getByRole("dialog"));

    fireEvent.keyDown(document, { key: "Tab" });
    expect(screen.getByRole("button", { name: "Cerrar bienvenida" })).toHaveFocus();

    const outside = document.createElement("button");
    document.body.append(outside);
    outside.focus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(screen.getByRole("button", { name: "Siguiente" })).toHaveFocus();
    outside.remove();
  });

  it.each(["Cerrar bienvenida", "Omitir"])("dismisses through %s", async (label) => {
    const onDismiss = vi.fn();
    const user = userEvent.setup();
    render(<WelcomeCard onDismiss={onDismiss} />);
    await user.click(screen.getByRole("button", { name: label }));
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it("uses the supplied illustration and hides it after a single failed fallback", () => {
    render(<WelcomeCard onDismiss={vi.fn()} />);
    const image = screen.getByRole("img", { name: "Kira y sus capacidades en OpenCohost" });
    expect(image).toHaveAttribute("src", "/welcome/kira-capabilities.png");
    fireEvent.error(image);
    expect(image).not.toBeVisible();
    fireEvent.error(image);
    expect(image).not.toBeVisible();
  });
});
