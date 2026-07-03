import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ObsCard } from "./ObsCard.js";
import { OBS_FIXTURE } from "../api/mock/fixtures.js";

describe("ObsCard", () => {
  it("defaults Habilitar OBS to the fixture value", () => {
    render(<ObsCard />);
    expect(screen.getByRole("switch", { name: "Habilitar OBS" })).toHaveAttribute(
      "aria-checked",
      String(OBS_FIXTURE.enabled)
    );
  });

  it("toggles Habilitar OBS through the mock command", async () => {
    render(<ObsCard />);
    const toggle = screen.getByRole("switch", { name: "Habilitar OBS" });
    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute("aria-checked", "true");
    expect(toggle).toBeDisabled();

    await waitFor(() => expect(toggle).not.toBeDisabled());
  });

  it("discloses that OBS creds are owner-supplied and no backend endpoint exists yet", () => {
    render(<ObsCard />);
    expect(screen.getByText(/credenciales que vos configurás/i)).toBeInTheDocument();
  });

  it("hides the connection settings inside a closed native details/summary by default", () => {
    render(<ObsCard />);
    const details = screen.getByText("Configuración de conexión").closest("details");
    expect(details).not.toBeNull();
    expect(details).not.toHaveAttribute("open");
  });

  it("prefills host, port, and source from the fixture", () => {
    render(<ObsCard />);
    expect(screen.getByLabelText("Host")).toHaveValue(OBS_FIXTURE.host);
    expect(screen.getByLabelText("Puerto")).toHaveValue(String(OBS_FIXTURE.port));
    expect(screen.getByLabelText("Fuente")).toHaveValue(OBS_FIXTURE.source);
  });

  it("never pre-fills or echoes back the OBS password, showing a neutral configurada badge instead", () => {
    render(<ObsCard />);
    const passwordInput = screen.getByLabelText("Contraseña") as HTMLInputElement;
    expect(passwordInput).toHaveAttribute("type", "password");
    expect(passwordInput.value).toBe("");
    expect(screen.getByText("configurada")).toBeInTheDocument();
  });

  it("runs Probar conexión through the mock command and shows a result status note", async () => {
    render(<ObsCard />);
    const button = screen.getByRole("button", { name: "Probar conexión", hidden: true });
    fireEvent.click(button);

    expect(button).toBeDisabled();
    await waitFor(() => expect(button).not.toBeDisabled());
    expect(screen.getByText(/no se verificó de verdad/i)).toBeInTheDocument();
  });
});
