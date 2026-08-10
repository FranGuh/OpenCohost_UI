import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Alert } from "./Alert.js";

describe("Alert", () => {
  it("renders role=alert with the tone data-attr (default neutral)", () => {
    render(<Alert>Algo pasó.</Alert>);

    const alert = screen.getByRole("alert");
    expect(alert).toHaveAttribute("data-tone", "neutral");
    expect(alert).toHaveTextContent("Algo pasó.");
  });

  it("renders the given tone as a data-attr", () => {
    render(<Alert tone="danger">No se pudo guardar.</Alert>);

    expect(screen.getByRole("alert")).toHaveAttribute("data-tone", "danger");
  });

  it("renders an optional bold title above the body", () => {
    render(
      <Alert tone="info" title="Así se ve una alerta">
        Elegí el estilo que más te acomode.
      </Alert>
    );

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Así se ve una alerta");
    expect(alert).toHaveTextContent("Elegí el estilo que más te acomode.");
  });

  it("omits the title paragraph when no title is given", () => {
    const { container } = render(<Alert>Solo body.</Alert>);

    expect(container.querySelector(".oc-alert-title")).not.toBeInTheDocument();
    expect(container.querySelector(".oc-alert-body")).toHaveTextContent("Solo body.");
  });

  it.each(["ok", "warn", "danger", "info", "neutral"] as const)(
    "renders exactly one tone icon for tone=%s",
    (tone) => {
      const { container } = render(<Alert tone={tone}>msg</Alert>);
      expect(container.querySelectorAll(".oc-alert-icon")).toHaveLength(1);
    }
  );
});
