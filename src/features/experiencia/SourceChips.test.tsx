import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useUiLocaleStore } from "../../i18n/locale.js";

const openExternalUrl = vi.fn().mockResolvedValue(true);
vi.mock("../../lib/openUrl.js", () => ({
  openExternalUrl: (url: string) => openExternalUrl(url)
}));

import { SourceChips } from "./SourceChips.js";

describe("SourceChips", () => {
  beforeEach(() => {
    openExternalUrl.mockClear();
    useUiLocaleStore.setState({ locale: "en" } as never);
  });

  it("renders nothing without sources", () => {
    const { container } = render(<SourceChips sources={undefined} />);
    expect(container).toBeEmptyDOMElement();
    const empty = render(<SourceChips sources={[]} />);
    expect(empty.container).toBeEmptyDOMElement();
  });

  it("shows a localized label and one link per source, named by the host of its own URL", () => {
    render(
      <SourceChips
        sources={[
          { host: "THIS-LABEL-IS-IGNORED", url: "https://www.nvidia.com/news/a?id=1" },
          { host: "x", url: "https://en.wikipedia.org/wiki/Patch" }
        ]}
      />
    );
    expect(screen.getByText("Sources")).toBeInTheDocument();
    const nvidia = screen.getByRole("link", { name: "Open nvidia.com in your browser" });
    expect(nvidia).toHaveTextContent("nvidia.com");
    expect(nvidia).toHaveAttribute("href", "https://www.nvidia.com/news/a?id=1&utm_source=opencohost");
    expect(screen.getByRole("link", { name: "Open en.wikipedia.org in your browser" })).toHaveTextContent("en.wikipedia.org");
    expect(screen.queryByText("THIS-LABEL-IS-IGNORED")).toBeNull();
  });

  it("is localized in Spanish", () => {
    useUiLocaleStore.setState({ locale: "es" } as never);
    render(<SourceChips sources={[{ host: "a.com", url: "https://a.com/x" }]} />);
    expect(screen.getByText("Fuentes")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Abrir a.com en el navegador" })).toBeInTheDocument();
  });

  it("a click opens the attributed URL through the external opener, not the webview", async () => {
    render(<SourceChips sources={[{ host: "a.com", url: "https://a.com/x?q=1#frag" }]} />);
    const link = screen.getByRole("link", { name: /a\.com/ });
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    await userEvent.click(link);
    expect(openExternalUrl).toHaveBeenCalledTimes(1);
    expect(openExternalUrl).toHaveBeenCalledWith("https://a.com/x?q=1&utm_source=opencohost#frag");
  });

  it("a click does not navigate the app webview itself", async () => {
    render(<SourceChips sources={[{ host: "a.com", url: "https://a.com/x" }]} />);
    const link = screen.getByRole("link", { name: /a\.com/ });
    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    link.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it("a source that is not https renders as plain text, not a link, and opens nothing", async () => {
    render(
      <SourceChips
        sources={[
          { host: "plain.com", url: "http://plain.com/a" },
          { host: "bad", url: "javascript:alert(1)" },
          { host: "ok", url: "https://ok.com/a" }
        ]}
      />
    );
    expect(screen.getAllByRole("link")).toHaveLength(1);
    const plain = screen.getByText("plain.com");
    expect(plain.closest("a")).toBeNull();
    await userEvent.click(plain);
    expect(openExternalUrl).not.toHaveBeenCalled();
    // A URL with no host to name is not shown at all.
    expect(screen.queryByText(/javascript/i)).toBeNull();
  });

  it("shows each site once and at most three chips", () => {
    render(
      <SourceChips
        sources={[
          { host: "a", url: "https://a.com/1" },
          { host: "a", url: "https://www.a.com/2" },
          { host: "b", url: "https://b.com/1" },
          { host: "c", url: "https://c.com/1" },
          { host: "d", url: "https://d.com/1" }
        ]}
      />
    );
    expect(screen.getAllByRole("link").map((el) => el.textContent)).toEqual(["a.com", "b.com", "c.com"]);
  });

  it("writes nothing to browser storage", () => {
    const before = [window.localStorage.length, window.sessionStorage.length];
    render(<SourceChips sources={[{ host: "a", url: "https://a.com/1" }]} />);
    expect([window.localStorage.length, window.sessionStorage.length]).toEqual(before);
  });
});
