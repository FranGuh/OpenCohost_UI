import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeDownloadJob } from "../../../test/handlers.js";
import { useUiLocaleStore } from "../../../i18n/locale.js";
import { DownloadProgress, type DownloadProgressProps } from "./DownloadProgress.js";

function renderProgress(overrides: Partial<DownloadProgressProps> = {}) {
  const props: DownloadProgressProps = {
    job: makeDownloadJob(),
    maxRetries: 3,
    showResumedNote: false,
    busy: false,
    onPause: vi.fn(),
    onResume: vi.fn(),
    onCancel: vi.fn(),
    ...overrides
  };
  render(React.createElement(DownloadProgress, props));
  return props;
}

beforeEach(() => {
  useUiLocaleStore.setState({ locale: "en" });
});

describe("DownloadProgress renders the backend's numbers, formatted", () => {
  it("shows tag, phase, percent bar, bytes, speed and ETA", () => {
    renderProgress();
    expect(screen.getByText("qwen3:1.7b")).toBeInTheDocument();
    expect(screen.getByText("Downloading files")).toBeInTheDocument();
    const bar = screen.getByRole("progressbar", { name: "Download progress for qwen3:1.7b" });
    expect(bar).toHaveAttribute("aria-valuenow", "39");
    expect(screen.getByText("39%")).toBeInTheDocument();
    expect(screen.getByText("400.0 MB of 1.00 GB")).toBeInTheDocument();
    expect(screen.getByText("2.5 MB/s")).toBeInTheDocument();
    expect(screen.getByText("3m 05s left")).toBeInTheDocument();
  });

  it("shows the retry indicator while retrying", () => {
    renderProgress({ job: makeDownloadJob({ state: "retrying", retries_used: 2 }) });
    expect(screen.getByText("Retrying 2/3")).toBeInTheDocument();
  });

  it.each([
    ["network", "Network error. Check your connection and resume the download."],
    ["not_found", "The model was not found in the registry. Check the name."],
    ["disk_full", "Not enough disk space."],
    ["pull_error", "Ollama could not complete the download."],
    ["rejected", "The registry rejected the download."],
    ["internal", "Internal error during the download."],
    ["something_new", "The download failed."]
  ])("maps error_category %s to i18n copy (never raw text)", (category, copy) => {
    renderProgress({ job: makeDownloadJob({ state: "failed", error_category: category, error_type: "ConnectError" }) });
    expect(screen.getByRole("alert")).toHaveTextContent(copy);
    expect(screen.queryByText(/ConnectError/)).not.toBeInTheDocument();
  });

  it("shows the resumed-from-checkpoint note when asked", () => {
    renderProgress({ showResumedNote: true });
    expect(screen.getByText("Resumed from the last saved point.")).toBeInTheDocument();
  });
});

describe("DownloadProgress buttons are valid per state", () => {
  const cases: Array<[string, string[]]> = [
    ["queued", ["Pause", "Cancel"]],
    ["downloading", ["Pause", "Cancel"]],
    ["retrying", ["Pause", "Cancel"]],
    ["paused", ["Resume", "Cancel"]],
    ["failed", ["Resume", "Cancel"]],
    ["completed", []],
    ["cancelled", []]
  ];

  it.each(cases)("state %s offers %j", (state, expected) => {
    renderProgress({ job: makeDownloadJob({ state: state as never }) });
    for (const label of ["Pause", "Resume", "Cancel"]) {
      if (expected.includes(label)) expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
      else expect(screen.queryByRole("button", { name: label })).not.toBeInTheDocument();
    }
  });

  it("fires the matching handler", () => {
    const props = renderProgress({ job: makeDownloadJob({ state: "downloading" }) });
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(props.onPause).toHaveBeenCalledTimes(1);
    expect(props.onCancel).toHaveBeenCalledTimes(1);
  });

  it("offers 'Use this model' on a completed job when a handler is given", () => {
    const onUseModel = vi.fn();
    renderProgress({ job: makeDownloadJob({ state: "completed", percent: 100, installed: true }), onUseModel });
    fireEvent.click(screen.getByRole("button", { name: "Use this model" }));
    expect(onUseModel).toHaveBeenCalledWith("qwen3:1.7b");
  });
});
