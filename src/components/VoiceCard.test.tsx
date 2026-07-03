import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { VoiceCard } from "./VoiceCard.js";

describe("VoiceCard", () => {
  it("defaults to AR Argentina, local-only TTS on, and Media speed", () => {
    render(<VoiceCard />);
    expect(screen.getByRole("button", { name: "AR Argentina" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("switch", { name: "Solo TTS local (Piper)" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("button", { name: "Media" })).toHaveAttribute("aria-pressed", "true");
  });

  it("switches the voice option locally on click", () => {
    render(<VoiceCard />);
    fireEvent.click(screen.getByRole("button", { name: "Neutral" }));
    expect(screen.getByRole("button", { name: "Neutral" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "AR Argentina" })).toHaveAttribute("aria-pressed", "false");
  });

  it("switches the speed option locally on click", () => {
    render(<VoiceCard />);
    fireEvent.click(screen.getByRole("button", { name: "Lenta" }));
    expect(screen.getByRole("button", { name: "Lenta" })).toHaveAttribute("aria-pressed", "true");
  });

  it("toggles the local-only TTS switch and updates the hint copy", () => {
    render(<VoiceCard />);
    const toggle = screen.getByRole("switch", { name: "Solo TTS local (Piper)" });
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(screen.getByText(/Modo nube desactivado/)).toBeInTheDocument();
  });
});
