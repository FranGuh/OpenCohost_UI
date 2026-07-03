import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { ProfileEditor } from "./ProfileEditor.js";

describe("ProfileEditor", () => {
  it("renders nothing when closed, and a labelled dialog when open", () => {
    const { rerender } = render(<ProfileEditor open={false} mode="create" onClose={() => {}} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    rerender(<ProfileEditor open mode="create" onClose={() => {}} />);
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(screen.getByText("Nuevo perfil")).toBeInTheDocument();
  });

  it("moves focus to the name field on open", () => {
    render(<ProfileEditor open mode="create" onClose={() => {}} />);
    expect(screen.getByLabelText("Nombre")).toHaveFocus();
  });

  it("returns focus to the trigger element when closed (WCAG 2.4.3)", () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            abrir
          </button>
          <ProfileEditor open={open} mode="create" onClose={() => setOpen(false)} />
        </>
      );
    }
    render(<Harness />);
    const trigger = screen.getByRole("button", { name: "abrir" });
    trigger.focus();
    fireEvent.click(trigger);
    expect(screen.getByLabelText("Nombre")).toHaveFocus();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(trigger).toHaveFocus();
  });

  it("calls onClose on close-button click, overlay click, and Escape", () => {
    const onCloseButton = vi.fn();
    const { unmount } = render(<ProfileEditor open mode="create" onClose={onCloseButton} />);
    fireEvent.click(screen.getByRole("button", { name: "Cerrar" }));
    expect(onCloseButton).toHaveBeenCalledTimes(1);
    unmount();

    const onCloseOverlay = vi.fn();
    render(<ProfileEditor open mode="create" onClose={onCloseOverlay} />);
    fireEvent.mouseDown(screen.getByRole("dialog").parentElement as HTMLElement);
    expect(onCloseOverlay).toHaveBeenCalledTimes(1);

    const onCloseEsc = vi.fn();
    render(<ProfileEditor open mode="create" onClose={onCloseEsc} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onCloseEsc).toHaveBeenCalledTimes(1);
  });

  it("rejects an empty name on submit and never surfaces the not-wired note", () => {
    render(<ProfileEditor open mode="create" onClose={() => {}} />);

    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));

    expect(screen.getByRole("alert")).toHaveTextContent("El nombre no puede estar vacío.");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("submitting a valid name shows the not-wired disclosure instead of a persisted result", async () => {
    render(<ProfileEditor open mode="create" onClose={() => {}} />);

    fireEvent.change(screen.getByLabelText("Nombre"), { target: { value: "Nuevo Perfil" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        "La gestión de perfiles se habilitará cuando el backend lo soporte"
      )
    );
  });

  it("delete confirm step also surfaces the not-wired disclosure, never a fake persisted delete", async () => {
    render(<ProfileEditor open mode="edit" initialName="Akira" onClose={() => {}} />);

    fireEvent.click(screen.getByRole("button", { name: "Eliminar" }));
    expect(screen.getByText(/¿Eliminar «Akira»\?/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        "La gestión de perfiles se habilitará cuando el backend lo soporte"
      )
    );
  });
});
