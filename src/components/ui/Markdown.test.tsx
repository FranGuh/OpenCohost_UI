import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Markdown } from "./Markdown.js";

describe("Markdown — Kira reply formatting", () => {
  it("renders **bold** as a <strong>", () => {
    render(<Markdown content="hola **mundo**" />);
    const strong = screen.getByText("mundo");
    expect(strong.tagName).toBe("STRONG");
  });

  it("renders *italic* as an <em>", () => {
    render(<Markdown content="che, *dale*" />);
    expect(screen.getByText("dale").tagName).toBe("EM");
  });

  it("renders `inline code` as a <code> that is not inside a <pre>", () => {
    const { container } = render(<Markdown content="corré `pnpm test` ahora" />);
    const code = screen.getByText("pnpm test");
    expect(code.tagName).toBe("CODE");
    expect(code.closest("pre")).toBeNull();
    expect(container.querySelector("pre")).toBeNull();
  });

  it("renders a fenced code block as <pre><code> with internal horizontal scroll", () => {
    const { container } = render(<Markdown content={"```\nconst x = 1;\n```"} />);
    const pre = container.querySelector("pre");
    expect(pre).not.toBeNull();
    expect(pre!.querySelector("code")).not.toBeNull();
    expect(pre!.className).toContain("overflow-x-auto");
  });

  it("renders a GFM table wrapped in an overflow-x-auto scroll container", () => {
    const { container } = render(
      <Markdown content={"| a | b |\n| - | - |\n| 1 | 2 |"} />
    );
    const table = container.querySelector("table");
    expect(table).not.toBeNull();
    expect(container.querySelector("th")?.textContent).toBe("a");
    expect(container.querySelector("td")?.textContent).toBe("1");
    // The table lives inside a scroll container so a wide table never widens the bubble.
    expect(table!.parentElement?.className).toContain("overflow-x-auto");
  });

  it("renders a bullet list as <ul><li>", () => {
    const { container } = render(<Markdown content={"- uno\n- dos"} />);
    expect(container.querySelector("ul")).not.toBeNull();
    expect(container.querySelectorAll("li")).toHaveLength(2);
  });

  it("renders links with target=_blank and rel=noreferrer (opens externally from Tauri)", () => {
    render(<Markdown content="ver [docs](https://example.com)" />);
    const link = screen.getByRole("link", { name: "docs" });
    expect(link).toHaveAttribute("href", "https://example.com");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noreferrer");
  });

  it("renders an inline $...$ LaTeX span as styled inline code (no math renderer installed)", () => {
    render(<Markdown content={"el vector $\\vec{v}$ y el contexto $C_{tema}$"} />);
    const vec = screen.getByText("\\vec{v}");
    expect(vec.tagName).toBe("CODE");
    expect(vec.closest("pre")).toBeNull();
    expect(screen.getByText("C_{tema}").tagName).toBe("CODE");
  });

  it("renders a $$...$$ span as inline code too", () => {
    render(<Markdown content={"la fórmula $$P(w_n | w_1)$$ manda"} />);
    expect(screen.getByText("P(w_n | w_1)").tagName).toBe("CODE");
  });

  it("converts $...$ inside GFM table cells (the 15:40 breakage case)", () => {
    const { container } = render(
      <Markdown content={"| a | b |\n| - | - |\n| $\\rightarrow$ | 2 |"} />
    );
    const code = container.querySelector("td code");
    expect(code).not.toBeNull();
    expect(code!.textContent).toBe("\\rightarrow");
  });

  it("leaves dollar amounts and unclosed $ fragments as plain text", () => {
    const { container } = render(<Markdown content={"cuesta $100 y quedó $P(w_n cortado"} />);
    expect(container.querySelector("code")).toBeNull();
    expect(container.textContent).toContain("$100");
    expect(container.textContent).toContain("$P(w_n cortado");
  });

  it("never rewrites $ inside a fenced code block", () => {
    const { container } = render(<Markdown content={"```\nprecio = \"$total$\"\n```"} />);
    const pre = container.querySelector("pre");
    expect(pre!.textContent).toContain('precio = "$total$"');
    // Only the block's own <code>, no injected inline-code siblings.
    expect(container.querySelectorAll("code")).toHaveLength(1);
  });

  it("keeps raw HTML as escaped text — no rehype-raw, so injected markup never renders", () => {
    const { container } = render(<Markdown content="un <b>tag</b> crudo" />);
    // The <b> is NOT parsed into a real element…
    expect(container.querySelector("b")).toBeNull();
    // …it stays visible as literal text.
    expect(container.textContent).toContain("<b>tag</b>");
  });
});

it("never renders remote images from a reply (audit hardening)", () => {
  render(<Markdown content={"mirá ![un pixel](https://evil.example/p.png) esto"} />);
  expect(document.querySelector("img")).toBeNull();
  expect(screen.getByText(/mirá\s+esto/)).toBeInTheDocument();
});
