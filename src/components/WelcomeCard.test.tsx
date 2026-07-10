import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AVATAR_IMAGE, FALLBACK_AVATAR } from "./kiraState.js";
import { WelcomeCard } from "./WelcomeCard.js";

describe("WelcomeCard", () => {
  it("renders the real OpenCohost and idle Kira assets inline", () => {
    render(<WelcomeCard onDismiss={vi.fn()} />);

    expect(screen.getByRole("heading", { name: "Bienvenido a OpenCohost" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "OpenCohost" })).toHaveAttribute("src", "/brand/opencohost.png");
    expect(screen.getByRole("img", { name: "Kira" })).toHaveAttribute("src", AVATAR_IMAGE.idle);
  });

  it("dismisses explicitly and falls back when the idle avatar cannot load", () => {
    const onDismiss = vi.fn();
    render(<WelcomeCard onDismiss={onDismiss} />);
    const avatar = screen.getByRole("img", { name: "Kira" });

    fireEvent.error(avatar);
    expect(avatar).toHaveAttribute("src", FALLBACK_AVATAR);

    fireEvent.click(screen.getByRole("button", { name: "Entendido" }));
    expect(onDismiss).toHaveBeenCalledOnce();
  });
});
