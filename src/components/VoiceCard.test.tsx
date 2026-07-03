import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { VoiceCard } from "./VoiceCard.js";

describe("VoiceCard", () => {
  it("defaults to AR Argentina, local-only TTS on, Media speed, and Piper engine", () => {
    render(<VoiceCard />);
    expect(screen.getByRole("combobox", { name: "Idioma" })).toHaveValue("ar");
    expect(screen.getByRole("switch", { name: "Solo TTS local (Piper)" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("button", { name: "Media" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("combobox", { name: "Motor TTS" })).toHaveValue("piper");
  });

  it("renders a not-wired status note disclosing voice settings aren't persisted yet", () => {
    render(<VoiceCard />);
    expect(screen.getByRole("status")).toHaveTextContent(/no se guardan todavía/);
  });

  it("applies an idioma change through the mock command, disabling only the select while applying", async () => {
    render(<VoiceCard />);
    const select = screen.getByRole("combobox", { name: "Idioma" }) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "neutral" } });

    expect(select.value).toBe("neutral");
    expect(select).toBeDisabled();
    expect(screen.getByText("aplicando…")).toBeInTheDocument();

    // independence — the other three controls stay enabled
    expect(screen.getByRole("switch", { name: "Solo TTS local (Piper)" })).not.toBeDisabled();
    expect(screen.getByRole("button", { name: "Media" })).not.toBeDisabled();
    expect(screen.getByRole("combobox", { name: "Motor TTS" })).not.toBeDisabled();

    await waitFor(() => expect(select).not.toBeDisabled());
  });

  it("applies a speed change through the mock command", async () => {
    render(<VoiceCard />);
    fireEvent.click(screen.getByRole("button", { name: "Lenta" }));
    expect(screen.getByRole("button", { name: "Lenta" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("aplicando…")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Idioma" })).not.toBeDisabled();
    await waitFor(() => expect(screen.queryByText("aplicando…")).not.toBeInTheDocument());
  });

  it("toggles the local-only TTS switch through the mock command and updates the hint copy", async () => {
    render(<VoiceCard />);
    const toggle = screen.getByRole("switch", { name: "Solo TTS local (Piper)" });
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(screen.getByText(/Modo nube desactivado/)).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("aplicando…")).not.toBeInTheDocument());
  });

  it("applies a motor TTS change through the mock command", async () => {
    render(<VoiceCard />);
    const select = screen.getByRole("combobox", { name: "Motor TTS" }) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "qwen3-tts" } });
    expect(select.value).toBe("qwen3-tts");
    await waitFor(() => expect(select).not.toBeDisabled());
  });

  it("shows a note that heavy TTS / reference voice is experimental-gated and out of scope", () => {
    render(<VoiceCard />);
    expect(screen.getByText(/EXPERIMENTAL_HEAVY_TTS_ENABLED/)).toBeInTheDocument();
  });
});
