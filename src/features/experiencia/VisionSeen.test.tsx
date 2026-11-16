import { http, HttpResponse } from "msw";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import React from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { server } from "../../test/server.js";
import { useUiLocaleStore } from "../../i18n/locale.js";
import { API_BASE_URL } from "../../test/handlers.js";
import { VisionSeen } from "./VisionSeen.js";
import { VisionInlineThumbnails } from "./VisionInlineThumbnails.js";

const FRAME = "data:image/jpeg;base64,AAA";

function renderWith(node: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(React.createElement(QueryClientProvider, { client: queryClient }, node));
}

function serveLook(body: Record<string, unknown> | null) {
  server.use(
    http.get(`${API_BASE_URL}/api/vision/looks/look-1/thumbnails`, () =>
      body ? HttpResponse.json({ id: "look-1", thumbnails: [FRAME], ...body }) : new HttpResponse(null, { status: 404 })
    )
  );
}

describe("VisionSeen (what Kira saw)", () => {
  beforeEach(() => useUiLocaleStore.setState({ locale: "en" }));
  afterEach(() => useUiLocaleStore.setState({ locale: "es" }));

  it("is collapsed by default and expands to the description on click", async () => {
    serveLook({ description: "A game with a health bar at 30%." });
    renderWith(<VisionSeen lookId="look-1" />);

    const toggle = await screen.findByRole("button", { name: "What Kira saw" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText(/health bar/)).toBeNull();

    await userEvent.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("A game with a health bar at 30%.")).toBeInTheDocument();

    await userEvent.click(toggle);
    expect(screen.queryByText(/health bar/)).toBeNull();
  });

  it("uses the Spanish label in es", async () => {
    useUiLocaleStore.setState({ locale: "es" });
    serveLook({ description: "Algo en pantalla." });
    renderWith(<VisionSeen lookId="look-1" />);
    expect(await screen.findByRole("button", { name: "Lo que vio Kira" })).toBeInTheDocument();
  });

  it("renders nothing once the look expired (404)", async () => {
    serveLook(null);
    const { container } = renderWith(<VisionSeen lookId="look-1" />);
    await waitFor(() => expect(container).toBeEmptyDOMElement());
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("renders nothing when the backend withholds the description", async () => {
    serveLook({});
    const { container } = renderWith(<VisionSeen lookId="look-1" />);
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });
});

describe("VisionInlineThumbnails lightbox", () => {
  beforeEach(() => useUiLocaleStore.setState({ locale: "en" }));
  afterEach(() => useUiLocaleStore.setState({ locale: "es" }));

  it("opens on click with the full frame, focuses close, and Escape closes and restores focus", async () => {
    serveLook({});
    renderWith(<VisionInlineThumbnails lookId="look-1" framesSent={1} />);
    const opener = (await screen.findByRole("img", { name: "Frame 1 of 1 that Kira saw" })).closest("button") as HTMLElement;
    opener.focus();

    await userEvent.click(opener);

    const dialog = await screen.findByRole("dialog", { name: "Frames Kira saw (enlarged)" });
    expect(dialog.querySelector("img")).toHaveAttribute("src", FRAME);
    expect(screen.getByRole("button", { name: "Close enlarged image" })).toHaveFocus();

    await userEvent.keyboard("{Escape}");

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(opener).toHaveFocus();
  });

  it("closes with the close button but not when the image itself is clicked", async () => {
    serveLook({});
    renderWith(<VisionInlineThumbnails lookId="look-1" framesSent={1} />);
    await userEvent.click(await screen.findByRole("img", { name: /Frame 1 of 1/ }));
    const dialog = await screen.findByRole("dialog");

    await userEvent.click(dialog.querySelector("img") as HTMLElement);
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Close enlarged image" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("labels the close button in Spanish", async () => {
    useUiLocaleStore.setState({ locale: "es" });
    serveLook({});
    renderWith(<VisionInlineThumbnails lookId="look-1" framesSent={1} />);
    await userEvent.click(await screen.findByRole("img", { name: /Fotograma 1 de 1/ }));
    expect(await screen.findByRole("button", { name: "Cerrar imagen ampliada" })).toBeInTheDocument();
  });
});
