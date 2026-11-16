import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useUiLocaleStore } from "../../i18n/locale.js";
import { SpeechPlaybackBar, shouldShowPlaybackBar } from "./SpeechPlaybackBar.js";

const idle = { paused: false, readaloud_active: false, readaloud_pending: 0 };

beforeEach(() => {
  useUiLocaleStore.setState({ locale: "en" });
});

describe("shouldShowPlaybackBar", () => {
  it("is hidden when idle or unknown", () => {
    expect(shouldShowPlaybackBar(undefined)).toBe(false);
    expect(shouldShowPlaybackBar(idle)).toBe(false);
  });
  it("shows for active, pending or paused", () => {
    expect(shouldShowPlaybackBar({ ...idle, readaloud_active: true })).toBe(true);
    expect(shouldShowPlaybackBar({ ...idle, readaloud_pending: 1 })).toBe(true);
    expect(shouldShowPlaybackBar({ ...idle, paused: true })).toBe(true);
  });
});

describe("SpeechPlaybackBar", () => {
  it("renders nothing when idle", () => {
    const { container } = render(<SpeechPlaybackBar state={idle} onStop={vi.fn()} onPause={vi.fn()} onResume={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows Stop and Pause while reading, wiring both", () => {
    const onStop = vi.fn();
    const onPause = vi.fn();
    render(
      <SpeechPlaybackBar
        state={{ ...idle, readaloud_active: true, readaloud_pending: 2 }}
        onStop={onStop}
        onPause={onPause}
        onResume={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Stop reading" }));
    fireEvent.click(screen.getByRole("button", { name: "Pause speech" }));
    expect(onStop).toHaveBeenCalledTimes(1);
    expect(onPause).toHaveBeenCalledTimes(1);
  });

  it("toggles to Resume when paused", () => {
    const onResume = vi.fn();
    render(<SpeechPlaybackBar state={{ ...idle, paused: true }} onStop={vi.fn()} onPause={vi.fn()} onResume={onResume} />);
    expect(screen.queryByRole("button", { name: "Pause speech" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Resume speech" }));
    expect(onResume).toHaveBeenCalledTimes(1);
  });

  it("disables controls while busy", () => {
    render(
      <SpeechPlaybackBar state={{ ...idle, readaloud_active: true }} busy onStop={vi.fn()} onPause={vi.fn()} onResume={vi.fn()} />
    );
    expect(screen.getByRole("button", { name: "Stop reading" })).toBeDisabled();
  });
});
