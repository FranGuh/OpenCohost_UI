import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AvatarCard } from "./AvatarCard.js";
import { AVATAR_FIXTURE } from "../api/mock/fixtures.js";

describe("AvatarCard", () => {
  it("defaults the mode select to the fixture mode", () => {
    render(<AvatarCard />);
    expect(screen.getByRole("combobox", { name: "Modo" })).toHaveValue(AVATAR_FIXTURE.mode);
  });

  it("applies a mode change through the mock command", async () => {
    render(<AvatarCard />);
    const select = screen.getByRole("combobox", { name: "Modo" }) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "estatico" } });

    expect(select.value).toBe("estatico");
    expect(select).toBeDisabled();
    expect(screen.getByText("aplicando…")).toBeInTheDocument();

    await waitFor(() => expect(select).not.toBeDisabled());
  });

  it("renders one row per Kira state with its current image ref", () => {
    render(<AvatarCard />);
    for (const entry of AVATAR_FIXTURE.images) {
      expect(screen.getAllByText(entry.label).length).toBeGreaterThan(0);
      expect(screen.getByText(entry.image)).toBeInTheDocument();
    }
  });

  it("renders a disabled, not-wired Cambiar affordance per state row with a role=status note", () => {
    render(<AvatarCard />);
    const changeButtons = screen.getAllByRole("button", { name: /^Cambiar imagen/ });
    expect(changeButtons).toHaveLength(AVATAR_FIXTURE.images.length);
    changeButtons.forEach((button) => expect(button).toBeDisabled());

    expect(screen.getByText(/necesitaría subida multipart/i)).toBeInTheDocument();
  });

  it("previews a state through the mock command and shows a preview swatch", async () => {
    render(<AvatarCard />);
    const preview = screen.getByRole("combobox", { name: "Estado a probar" }) as HTMLSelectElement;
    fireEvent.change(preview, { target: { value: "error" } });

    fireEvent.click(screen.getByRole("button", { name: "Probar" }));
    await waitFor(() => expect(screen.getByRole("img", { name: /Error/i })).toBeInTheDocument());
    expect(screen.getByText(/vista previa local/i)).toBeInTheDocument();
  });
});
