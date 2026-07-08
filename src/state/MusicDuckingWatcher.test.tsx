import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { server } from "../test/server.js";
import { frozenStatusHandler } from "../test/handlers.js";
import { STATUS_QUERY_KEY } from "../api/status.js";
import { PlaybackProvider, usePlaybackContext } from "./PlaybackProvider.js";
import { MusicDuckingWatcher } from "./MusicDuckingWatcher.js";

/** Exposes only `ducked` so tests can assert on the value MusicDuckingWatcher
 * derives from the live status poll, without depending on any real panel UI. */
function DuckedReadout() {
  const { ducked } = usePlaybackContext();
  return <span data-testid="ducked">{String(ducked)}</span>;
}

function renderWatcher() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    queryClient,
    ...render(
      React.createElement(
        QueryClientProvider,
        { client: queryClient },
        React.createElement(
          PlaybackProvider,
          null,
          React.createElement(MusicDuckingWatcher),
          React.createElement(DuckedReadout)
        )
      )
    )
  };
}

describe("MusicDuckingWatcher (FIX-D)", () => {
  afterEach(() => {
    server.resetHandlers();
  });

  it("ducks playback when GET /api/status reports is_speaking:true", async () => {
    server.use(frozenStatusHandler(1, { is_speaking: true }));
    renderWatcher();

    await waitFor(() => expect(screen.getByTestId("ducked")).toHaveTextContent("true"));
  });

  it("stays un-ducked when GET /api/status reports is_speaking:false", async () => {
    server.use(frozenStatusHandler(1, { is_speaking: false }));
    renderWatcher();

    await waitFor(() => expect(screen.getByTestId("ducked")).toHaveTextContent("false"));
  });

  it("un-ducks once a later poll flips is_speaking back to false (no extra network — shares the [\"status\"] cache)", async () => {
    server.use(frozenStatusHandler(1, { is_speaking: true }));
    const { queryClient } = renderWatcher();
    await waitFor(() => expect(screen.getByTestId("ducked")).toHaveTextContent("true"));

    server.use(frozenStatusHandler(2, { is_speaking: false }));
    // Force a refetch instead of waiting on the real 2s interval — deterministic
    // and proves this reads the SAME ["status"] query used elsewhere (no second poll).
    await queryClient.refetchQueries({ queryKey: STATUS_QUERY_KEY });

    await waitFor(() => expect(screen.getByTestId("ducked")).toHaveTextContent("false"));
  });
});
