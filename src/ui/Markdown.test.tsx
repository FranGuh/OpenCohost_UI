import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
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

  it("renders an inline $...$ LaTeX span via KaTeX math renderer", () => {
    const { container } = render(<Markdown content={"el vector $\\vec{v}$ y el contexto $C_{tema}$"} />);
    const katexSpans = container.querySelectorAll(".katex");
    expect(katexSpans.length).toBe(2);
    expect(screen.getByText("\\vec{v}")).not.toBeNull();
    expect(screen.getByText("C_{tema}")).not.toBeNull();
  });

  it("renders a $$...$$ span via KaTeX display math", () => {
    const { container } = render(<Markdown content={"la fórmula $$P(w_n | w_1)$$ manda"} />);
    expect(container.querySelector(".katex-display, .katex")).not.toBeNull();
    expect(screen.getByText("P(w_n | w_1)")).not.toBeNull();
  });

  it("renders $...$ inside GFM table cells via KaTeX", () => {
    const { container } = render(
      <Markdown content={"| a | b |\n| - | - |\n| $\\rightarrow$ | 2 |"} />
    );
    const katexSpan = container.querySelector("td .katex");
    expect(katexSpan).not.toBeNull();
  });

  it("converts bare LaTeX arrows outside math mode into clean Unicode arrows", () => {
    const { container } = render(
      <Markdown content={"Token A \\rightarrow Fallo \\rightarrow Token B"} />
    );
    expect(container.textContent).toContain("Token A → Fallo → Token B");
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

  // T7: a per-code-block copy control, since Kira's replies render fenced
  // code blocks as Markdown (not plain text) — see T7's own instructions.
  it("renders a copy control on a fenced code block that copies its exact raw text", async () => {
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText: writeTextMock } });

    render(<Markdown content={"```\nconst x = 1;\nconst y = 2;\n```"} />);
    const copyButton = screen.getByRole("button", { name: "Copiar código" });

    fireEvent.click(copyButton);

    expect(writeTextMock).toHaveBeenCalledWith("const x = 1;\nconst y = 2;\n");
    expect(await screen.findByRole("button", { name: "¡Copiado!" })).toBeInTheDocument();
  });

  it("renders one independent copy control per fenced code block", () => {
    render(<Markdown content={"```\nuno();\n```\n\ntexto\n\n```\ndos();\n```"} />);
    expect(screen.getAllByRole("button", { name: "Copiar código" })).toHaveLength(2);
  });
});

it("never renders remote images from a reply (audit hardening)", () => {
  render(<Markdown content={"mira ![un pixel](https://evil.example/p.png) esto"} />);
  expect(document.querySelector("img")).toBeNull();
  expect(screen.getByText(/mira\s+esto/)).toBeInTheDocument();
});

describe("Markdown — breaks option (operator bubble)", () => {
  it("keeps single newlines as <br> when breaks is set", () => {
    const { container } = render(<Markdown content={"linea uno\nlinea dos"} breaks />);
    expect(container.querySelectorAll("p br")).toHaveLength(1);
  });

  it("does not add <br> for soft newlines by default (Kira replies unchanged)", () => {
    const { container } = render(<Markdown content={"linea uno\nlinea dos"} />);
    expect(container.querySelectorAll("br")).toHaveLength(0);
  });

  it("still escapes raw HTML with breaks set", () => {
    const { container } = render(<Markdown content={"<b>x</b>\n<script>1</script>"} breaks />);
    expect(container.querySelector("b")).toBeNull();
    expect(container.querySelector("script")).toBeNull();
    expect(container.textContent).toContain("<b>x</b>");
  });
});
