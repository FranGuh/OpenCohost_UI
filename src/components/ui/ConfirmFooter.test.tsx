import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { ConfirmFooter, type ConfirmStage } from "./ConfirmFooter.js";

const SINGLE: ConfirmStage[] = [
  { message: "Peligro absoluto.", acknowledgment: "Sí, entiendo", advanceLabel: "Borrar" }
];

const THREE: ConfirmStage[] = [
  { message: "Etapa uno.", advanceLabel: "Continuar" },
  { message: "Etapa dos.", acknowledgment: "Sí, entiendo", advanceLabel: "Continuar" },
  { message: "Etapa tres.", advanceLabel: "Purgar definitivamente" }
];

function Harness({ stages, onConfirm }: { stages: ConfirmStage[]; onConfirm: () => void }) {
  const [active, setActive] = useState(true);
  return (
    <ConfirmFooter active={active} stages={stages} onConfirm={onConfirm} onCancel={() => setActive(false)} />
  );
}

describe("ConfirmFooter", () => {
  it("renders nothing while inactive", () => {
    render(<ConfirmFooter active={false} stages={SINGLE} onConfirm={() => {}} onCancel={() => {}} />);
    expect(screen.queryByText("Peligro absoluto.")).not.toBeInTheDocument();
  });

  it("shows the message first and gates the destructive button on the acknowledgment", () => {
    const onConfirm = vi.fn();
    render(<Harness stages={SINGLE} onConfirm={onConfirm} />);

    // message-first
    expect(screen.getByText("Peligro absoluto.")).toBeInTheDocument();
    // destructive advance disabled until acknowledged
    expect(screen.getByRole("button", { name: "Borrar" })).toBeDisabled();
    expect(onConfirm).not.toHaveBeenCalled();

    // acknowledging enables it
    fireEvent.click(screen.getByRole("button", { name: "Sí, entiendo" }));
    expect(screen.getByRole("button", { name: "Borrar" })).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: "Borrar" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("advances through stages, mutating the footer button, firing onConfirm only on the last", () => {
    const onConfirm = vi.fn();
    render(<Harness stages={THREE} onConfirm={onConfirm} />);

    // stage 1 — no ack, advance is a plain Continuar
    expect(screen.getByText("Etapa uno.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Purgar definitivamente" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));

    // stage 2 — ack gates Continuar
    expect(screen.getByText("Etapa dos.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continuar" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Sí, entiendo" }));
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));

    // stage 3 — final destructive, no purge fired until now
    expect(screen.getByText("Etapa tres.")).toBeInTheDocument();
    expect(onConfirm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Purgar definitivamente" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("Cancelar backs out (onCancel)", () => {
    const { unmount } = render(<Harness stages={SINGLE} onConfirm={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(screen.queryByText("Peligro absoluto.")).not.toBeInTheDocument();
    unmount();
  });

  it("Escape backs out (onCancel)", () => {
    render(<Harness stages={SINGLE} onConfirm={() => {}} />);
    expect(screen.getByText("Peligro absoluto.")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByText("Peligro absoluto.")).not.toBeInTheDocument();
  });

  it("resets to the first stage when re-activated after backing out", () => {
    function ToggleHarness() {
      const [active, setActive] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setActive(true)}>
            abrir
          </button>
          <ConfirmFooter
            active={active}
            stages={THREE}
            onConfirm={() => {}}
            onCancel={() => setActive(false)}
          />
        </>
      );
    }
    render(<ToggleHarness />);

    fireEvent.click(screen.getByRole("button", { name: "abrir" }));
    fireEvent.click(screen.getByRole("button", { name: "Continuar" })); // now on stage 2
    expect(screen.getByText("Etapa dos.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    fireEvent.click(screen.getByRole("button", { name: "abrir" }));

    // re-opened at stage 1, not the stage it was left on
    expect(screen.getByText("Etapa uno.")).toBeInTheDocument();
    expect(screen.queryByText("Etapa dos.")).not.toBeInTheDocument();
  });

  it("keeps the destructive button disabled while busy", () => {
    render(
      <ConfirmFooter
        active
        stages={[{ message: "Sin vuelta.", advanceLabel: "Borrar" }]}
        onConfirm={() => {}}
        onCancel={() => {}}
        busy
      />
    );
    expect(screen.getByRole("button", { name: "Borrar" })).toBeDisabled();
  });
});
