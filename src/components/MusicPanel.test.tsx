import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MusicPanel } from "./MusicPanel.js";

describe("MusicPanel", () => {
  it("renders a quick-test button per fixture mood", () => {
    render(<MusicPanel />);
    expect(screen.getByRole("button", { name: "Calm" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Hype" })).toBeInTheDocument();
  });

  it("playing a mood marks it active via the mock command", async () => {
    render(<MusicPanel />);
    expect(screen.getByTestId("music-active-mood")).toHaveTextContent("Sin mood en reproducción.");

    fireEvent.click(screen.getByRole("button", { name: "Hype" }));

    expect(screen.getByRole("button", { name: "Hype" })).toHaveAttribute("aria-pressed", "true");
    await waitFor(() => expect(screen.getByTestId("music-active-mood")).toHaveTextContent("Hype"));
    await waitFor(() => expect(screen.getByRole("button", { name: "Hype" })).not.toBeDisabled());
  });

  it("switching to another mood replaces the active one (only one playing at a time)", async () => {
    render(<MusicPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Hype" }));
    expect(screen.getByRole("button", { name: "Hype" })).toHaveAttribute("aria-pressed", "true");
    await waitFor(() => expect(screen.getByRole("button", { name: "Hype" })).not.toBeDisabled());

    fireEvent.click(screen.getByRole("button", { name: "Calm" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Calm" })).toHaveAttribute("aria-pressed", "true"));
    expect(screen.getByRole("button", { name: "Hype" })).toHaveAttribute("aria-pressed", "false");
  });

  it("disables the mood grid while a mood command is applying (single-flight)", async () => {
    render(<MusicPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Hype" }));
    expect(screen.getByRole("button", { name: "Calm" })).toBeDisabled();

    await waitFor(() => expect(screen.getByRole("button", { name: "Calm" })).not.toBeDisabled());
  });

  it("Fade out is disabled until a mood is active, then clears it", async () => {
    render(<MusicPanel />);
    expect(screen.getByRole("button", { name: "Fade out" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Hype" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Fade out" })).not.toBeDisabled());

    fireEvent.click(screen.getByRole("button", { name: "Fade out" }));

    await waitFor(() =>
      expect(screen.getByTestId("music-active-mood")).toHaveTextContent("Sin mood en reproducción.")
    );
    expect(screen.getByRole("button", { name: "Fade out" })).toBeDisabled();
  });

  it("lists library tracks with a status badge each", () => {
    render(<MusicPanel />);
    const items = screen.getAllByRole("listitem", { name: /^Track:/ });
    expect(items).toHaveLength(4);
    expect(screen.getAllByText("OK")).toHaveLength(2);
    expect(screen.getByText("faltante")).toBeInTheDocument();
    expect(screen.getByText("inválido")).toBeInTheDocument();
  });

  it("removes a track via the mock command and discloses it is not persisted", async () => {
    render(<MusicPanel />);
    fireEvent.click(screen.getByRole("button", { name: /Quitar "ambient_drift.mp3"/ }));

    await waitFor(() =>
      expect(screen.getAllByRole("listitem", { name: /^Track:/ })).toHaveLength(3)
    );
    expect(screen.queryByText("ambient_drift.mp3")).not.toBeInTheDocument();
    expect(screen.getByText(/Quitar tracks y limpiar faltantes/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Limpiar faltantes" })).not.toBeDisabled());
  });

  it("Limpiar faltantes removes every track marked faltante", async () => {
    render(<MusicPanel />);
    expect(screen.getByText("faltante")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Limpiar faltantes" }));

    await waitFor(() => expect(screen.queryByText("faltante")).not.toBeInTheDocument());
    expect(screen.getAllByRole("listitem", { name: /^Track:/ })).toHaveLength(3);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Quitar "hype_intro.wav"/ })).not.toBeDisabled()
    );
  });

  it("renders Importar as a disabled not-wired affordance with a role=status note", () => {
    render(<MusicPanel />);
    const importButton = screen.getByRole("button", { name: "Importar" });
    expect(importButton).toBeDisabled();
    expect(screen.getByText(/decisión pendiente del owner/i)).toBeInTheDocument();
  });
});
