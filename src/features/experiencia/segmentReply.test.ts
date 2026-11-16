import { describe, expect, it } from "vitest";
import {
  REPLY_SEGMENT_LONG_CHARS,
  REPLY_SEGMENT_MAX,
  REPLY_SEGMENT_MIN_CHARS,
  segmentReply
} from "./segmentReply.js";

// ~75 chars per sentence, every one a clean boundary candidate.
const sentence = (n: number) => `Esta es la frase número ${n} y sirve para llenar el párrafo con texto normal.`;
const paragraph = (count: number, from = 1) =>
  Array.from({ length: count }, (_, i) => sentence(from + i)).join(" ");
// Lowercase prose with no terminator at all: no boundary candidate inside it.
const run = (minChars: number) => "una idea que sigue, ".repeat(Math.ceil(minChars / 20)).trim();
// Long enough that a sentence boundary right after it is eligible.
const longRun = () => run(REPLY_SEGMENT_LONG_CHARS + 10);

describe("segmentReply thresholds", () => {
  it("keeps the documented limits", () => {
    expect(REPLY_SEGMENT_MIN_CHARS).toBeGreaterThanOrEqual(120);
    expect(REPLY_SEGMENT_MIN_CHARS).toBeLessThanOrEqual(160);
    expect(REPLY_SEGMENT_LONG_CHARS).toBeGreaterThan(REPLY_SEGMENT_MIN_CHARS);
    expect(REPLY_SEGMENT_MAX).toBeGreaterThanOrEqual(3);
    expect(REPLY_SEGMENT_MAX).toBeLessThanOrEqual(4);
  });
});

describe("segmentReply basics", () => {
  it("returns no segment for empty or blank text", () => {
    expect(segmentReply("")).toEqual([]);
    expect(segmentReply("   \n\n  ")).toEqual([]);
  });

  it("keeps a short reply as one bubble", () => {
    expect(segmentReply("¡Hola! ¿Qué tal estás hoy?")).toEqual(["¡Hola! ¿Qué tal estás hoy?"]);
  });

  it("keeps a short reply with paragraph breaks as one bubble", () => {
    const text = "Hola.\n\nQué tal.\n\nAquí estoy.";
    expect(segmentReply(text)).toEqual([text]);
  });

  it("splits at a paragraph break once the first part is long enough", () => {
    const p1 = paragraph(2);
    const p2 = paragraph(2, 3);
    expect(segmentReply(`${p1}\n\n${p2}`)).toEqual([p1, p2]);
  });

  it("merges short paragraphs until the minimum length is reached", () => {
    const p1 = "Primero, una idea corta para empezar.";
    const p2 = paragraph(1);
    const p3 = paragraph(2, 5);
    const p4 = paragraph(2, 9);
    // p1 + p2 is ~115 chars: below the minimum, so p3 joins too.
    expect(segmentReply(`${p1}\n\n${p2}\n\n${p3}\n\n${p4}`)).toEqual([`${p1}\n\n${p2}\n\n${p3}`, p4]);
  });

  it("does not split a medium paragraph at its sentences", () => {
    const p = paragraph(3);
    expect(p.length).toBeLessThan(REPLY_SEGMENT_LONG_CHARS);
    expect(segmentReply(p)).toEqual([p]);
  });

  it("splits a long paragraph only between whole sentences", () => {
    const p = paragraph(12);
    const segments = segmentReply(p);
    expect(segments.length).toBeGreaterThan(1);
    expect(segments.join(" ")).toBe(p);
    for (const segment of segments) {
      expect(segment).toMatch(/^Esta es la frase número \d+/);
      expect(segment).toMatch(/texto normal\.$/);
    }
  });

  it("caps the number of segments and merges the rest into the last one", () => {
    const paragraphs = Array.from({ length: 7 }, (_, i) => paragraph(2, i * 2 + 1));
    const segments = segmentReply(paragraphs.join("\n\n"));
    expect(segments).toHaveLength(REPLY_SEGMENT_MAX);
    expect(segments.slice(0, -1)).toEqual(paragraphs.slice(0, REPLY_SEGMENT_MAX - 1));
    expect(segments[segments.length - 1]).toBe(paragraphs.slice(REPLY_SEGMENT_MAX - 1).join("\n\n"));
  });

  it("splits the paragraph-break boundary even when CRLF line endings are used", () => {
    const p1 = paragraph(2);
    const p2 = paragraph(2, 3);
    expect(segmentReply(`${p1}\r\n\r\n${p2}`)).toEqual([p1, p2]);
  });
});

describe("segmentReply keeps structured blocks intact", () => {
  it("keeps an intro that ends with a colon together with its list", () => {
    const intro = `${paragraph(2)} Te dejo estas ideas:`;
    const list = "- Primera idea.\n- Segunda idea.\n- Tercera idea.";
    expect(segmentReply(`${intro}\n\n${list}`)).toEqual([`${intro}\n\n${list}`]);
  });

  it("never splits between the items of a loose list", () => {
    const intro = paragraph(2);
    const items = [1, 2, 3].map((n) => `- ${paragraph(2, n * 10)}`);
    const list = items.join("\n\n");
    expect(segmentReply(`${intro}\n\n${list}`)).toEqual([intro, list]);
  });

  it("never splits the sentences inside a list item", () => {
    const item = `- ${paragraph(8)}`;
    expect(segmentReply(item)).toEqual([item]);
  });

  it("keeps a closing line with the list before it", () => {
    const intro = paragraph(2);
    const list = "1. Uno.\n2. Dos.\n3. Tres.";
    const closing = paragraph(2, 20);
    expect(segmentReply(`${intro}\n\n${list}\n\n${closing}`)).toEqual([intro, `${list}\n\n${closing}`]);
  });

  it("keeps a fenced code block with blank lines in one piece", () => {
    const intro = paragraph(2);
    const code = "```python\ndef hola():\n    return 1\n\n\ndef adios():\n    return 2\n\n# Fin. Otra cosa.\n```";
    const segments = segmentReply(`${intro}\n\n${code}`);
    expect(segments).toEqual([intro, code]);
  });

  it("never splits inside an unclosed fence while streaming", () => {
    const intro = paragraph(2);
    const code = `\`\`\`\n${paragraph(3)}\n\n${paragraph(3, 4)}\n\n${paragraph(3, 8)}`;
    expect(segmentReply(`${intro}\n\n${code}`)).toEqual([intro, code]);
  });

  it("keeps a heading with the content after it", () => {
    const p1 = paragraph(2);
    const p2 = paragraph(2, 3);
    expect(segmentReply(`${p1}\n\n## Siguiente paso\n\n${p2}`)).toEqual([p1, `## Siguiente paso\n\n${p2}`]);
  });

  it("never splits the sentences inside a table row", () => {
    const row = `| ${paragraph(6)} | Otra celda. |`;
    const table = `| A | B |\n| --- | --- |\n${row}`;
    expect(segmentReply(table)).toEqual([table]);
  });

  it("never splits the sentences inside a blockquote", () => {
    const quote = `> ${paragraph(6)}`;
    expect(segmentReply(quote)).toEqual([quote]);
  });

  it("does not split before an indented continuation block", () => {
    const p1 = paragraph(2);
    const indented = `    ${paragraph(2, 3)}`;
    expect(segmentReply(`${p1}\n\n${indented}`)).toHaveLength(1);
  });
});

describe("segmentReply avoids false sentence boundaries", () => {
  it("splits a long run at a real boundary (positive control)", () => {
    const head = `${longRun()} y llegó.`;
    expect(segmentReply(`${head} García también llegó.`)).toEqual([head, "García también llegó."]);
  });

  it.each([
    ["Spanish title", "y el Sr. García llegó tarde."],
    ["Spanish title Dra.", "con la Dra. Pérez hablando."],
    ["etc.", "y otras cosas etc. Luego seguimos."],
    ["p. ej.", "por ejemplo p. ej. Madrid es grande."],
    ["multi-dot acronym", "como en EE.UU. Hoy es distinto."],
    ["English e.g.", "such as e.g. Python works."],
    ["initial", "como dijo J. Rowling en su libro."],
    ["decimal", "la versión 2.5 Ahora funciona."],
    ["ellipsis", "y bueno... La verdad es que no."],
    ["unicode ellipsis", "y bueno… La verdad es que no."],
    ["lowercase after question", "¿en serio? pues sí que lo es."],
    ["URL with dots", "visita https://ejemplo.com/a.B?x=1 Luego vuelve."],
    ["www URL", "visita www.Ejemplo.com Luego vuelve."],
    ["inline code", "usa `a. B` para eso."],
    ["bold span", "**esto va. Junto** hasta aquí."],
    ["open inverted question", "¿sabes si esto va. Junto o no?"],
    ["parenthesis", "(como esto. Dentro del paréntesis) sigue."],
    ["emoji only", "y eso me encanta 😄 Luego seguimos."],
    ["digit start", "el paso fue claro. 2 personas vinieron."]
  ])("does not split at %s", (_label, tail) => {
    const text = `${longRun()} ${tail}`;
    expect(segmentReply(text)).toEqual([text]);
  });

  it("splits before ¿ and ¡ openers", () => {
    const head = `${longRun()} y ya está.`;
    expect(segmentReply(`${head} ¿Qué te parece?`)).toEqual([head, "¿Qué te parece?"]);
    expect(segmentReply(`${head} ¡Me encanta!`)).toEqual([head, "¡Me encanta!"]);
  });

  it("keeps an emoji after the terminator with the sentence it closes", () => {
    const head = `${longRun()} ¡qué bien! 😄`;
    expect(segmentReply(`${head} Luego seguimos.`)).toEqual([head, "Luego seguimos."]);
  });

  it("keeps a ZWJ emoji sequence and a flag intact", () => {
    const head = `${longRun()} y ya programo. 👩‍💻 🇲🇽`;
    expect(segmentReply(`${head} Mañana más.`)).toEqual([head, "Mañana más."]);
  });

  it("keeps closing quotes and emphasis with the sentence", () => {
    const head = `${longRun()} y dijo «ya está.»`;
    expect(segmentReply(`${head} Después se fue.`)).toEqual([head, "Después se fue."]);
    const bold = `${longRun()} y **ya está.**`;
    expect(segmentReply(`${bold} Después se fue.`)).toEqual([bold, "Después se fue."]);
  });

  it("splits a sentence that ends a URL", () => {
    const head = `${longRun()} visita https://ejemplo.com.`;
    expect(segmentReply(`${head} Luego vuelve.`)).toEqual([head, "Luego vuelve."]);
  });
});

describe("segmentReply is stable while streaming", () => {
  const samples = [
    paragraph(12),
    [paragraph(2), paragraph(1, 3), paragraph(3, 5), paragraph(2, 9), paragraph(2, 12)].join("\n\n"),
    `${paragraph(2)} Mira:\n\n- uno.\n\n- dos.\n\n${paragraph(5, 4)}\n\n\`\`\`js\nconst a = 1;\n\nconst b = 2;\n\`\`\`\n\n${paragraph(4, 20)}`,
    `${longRun()} ¡qué bien! 😄 ¿Y tú? Yo bien. El Sr. García llegó... Luego, nada. ${paragraph(6)}\n\n## Título\n\n${paragraph(3)}`,
    `| A | B |\n|---|---|\n| x. Y | z |\n\n${paragraph(5)}\r\n\r\n${paragraph(5, 6)}`
  ];

  it.each(samples.map((text, i) => [i, text] as const))(
    "never re-flows an already shown segment (sample %i)",
    (_i, text) => {
      const final = segmentReply(text);
      // A sample that never splits would prove nothing about stability.
      expect(final.length).toBeGreaterThan(1);
      let previous: string[] = [];
      for (let k = 1; k <= text.length; k++) {
        const current = segmentReply(text.slice(0, k));
        // Shown segments only grow: count never drops, closed ones never change.
        expect(current.length).toBeGreaterThanOrEqual(previous.length);
        for (let i = 0; i < previous.length - 1; i++) expect(current[i]).toBe(previous[i]);
        // Every prefix segmentation is a prefix of the final one.
        for (let i = 0; i < current.length - 1; i++) expect(current[i]).toBe(final[i]);
        if (current.length > 0) {
          expect(final[current.length - 1].startsWith(current[current.length - 1])).toBe(true);
        }
        previous = current;
      }
    }
  );
});
