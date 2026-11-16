import { render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useUiLocaleStore } from "../../i18n/locale.js";
import { t } from "../../i18n/t.js";
import type { VisionBenchmark } from "../../api/vision.js";
import { VisionBenchmarkInfo } from "./VisionBenchmark.js";
import { catalogDesc, catalogNote } from "./visionCatalog.js";

const BACKEND_2B_NOTE =
  "Same accuracy as 4B on probes; answers Spanish questions in English (0/10) and ignores the length cap.";

const BENCH_2B: VisionBenchmark = {
  verdict: "light",
  vram_gib: 1.84,
  describe_s: 1.34,
  spanish: false,
  note: BACKEND_2B_NOTE,
  measured_on: "2026-10-02"
};

function renderInfo(tag: string, benchmark: VisionBenchmark = BENCH_2B) {
  render(React.createElement(VisionBenchmarkInfo, { benchmark, tag, testId: "bench" }));
  return screen.getByTestId("bench");
}

describe("VisionBenchmarkInfo localized notes", () => {
  beforeEach(() => useUiLocaleStore.setState({ locale: "en" }));
  afterEach(() => useUiLocaleStore.setState({ locale: "es" }));

  it("renders the Spanish note for a catalog tag, phrased against the measurement date", () => {
    useUiLocaleStore.setState({ locale: "es" });
    const detail = renderInfo("qwen3-vl:2b-instruct");
    expect(detail).toHaveTextContent("medido antes del prompt en español");
    expect(detail).not.toHaveTextContent(BACKEND_2B_NOTE);
  });

  it("renders the English note for a catalog tag", () => {
    const detail = renderInfo("qwen3-vl:2b-instruct");
    expect(detail).toHaveTextContent("measured before the Spanish prompt");
    expect(detail).not.toHaveTextContent(BACKEND_2B_NOTE);
  });

  it("matches a catalog tag written with :latest or another case", () => {
    const detail = renderInfo("Gemma4:E2B:latest", { ...BENCH_2B, verdict: "broken", note: "backend gemma" });
    expect(detail).not.toHaveTextContent("backend gemma");
    expect(detail).toHaveTextContent("Ollama 0.30.11");
  });

  it("falls back to the backend note for an unknown tag", () => {
    const detail = renderInfo("mystery:7b", { ...BENCH_2B, note: "Invents objects" });
    expect(detail).toHaveTextContent("Invents objects");
  });
});

describe("vision catalog copy", () => {
  afterEach(() => useUiLocaleStore.setState({ locale: "es" }));

  it("has a localized note for every backend benchmark entry and a desc for every suggested entry", () => {
    for (const locale of ["es", "en"] as const) {
      useUiLocaleStore.setState({ locale });
      for (const tag of ["qwen3-vl:4b-instruct", "qwen3-vl:2b-instruct", "gemma4:e2b", "gemma4:e4b", "gemma4:12b"]) {
        expect(catalogNote(tag, "BACKEND", t)).not.toBe("BACKEND");
      }
      for (const tag of ["qwen3-vl:4b-instruct", "qwen3-vl:2b-instruct"]) {
        expect(catalogDesc(tag, "BACKEND", t)).not.toBe("BACKEND");
      }
    }
  });

  it("falls back to the backend text for unknown tags and an empty note stays empty", () => {
    expect(catalogDesc("gemma3:4b", "Small and quick", t)).toBe("Small and quick");
    expect(catalogNote("mystery:7b", "", t)).toBe("");
  });
});
