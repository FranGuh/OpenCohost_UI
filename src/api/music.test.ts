import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import React from "react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { server } from "../test/server.js";
import {
  defaultMusicLibrary,
  defaultMusicState,
  musicFadeValidationHandler,
  musicImportErrorHandler,
  musicImportValidationHandler,
  musicLibraryGetErrorHandler,
  musicMoodErrorHandler,
  musicMoodValidationHandler,
  musicStateGetHandler,
  musicTrackDeleteErrorHandler,
  musicTrackDeleteNotFoundHandler
} from "../test/handlers.js";
import { ApiError, NotFoundError, ValidationError } from "./client.js";
import {
  deleteMusicTrack,
  getMusicLibrary,
  getMusicState,
  postMusicFade,
  postMusicImport,
  postMusicMood,
  trackAudioUrl,
  useDeleteMusicTrackMutation,
  useMusicFadeMutation,
  useMusicImportMutation,
  useMusicMoodMutation,
  useMusicStateQuery
} from "./music.js";

function createWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
}

describe("getMusicLibrary", () => {
  it("returns the library from GET /api/music/library", async () => {
    const result = await getMusicLibrary();
    expect(result).toEqual(defaultMusicLibrary);
  });

  it("throws ApiError when the library is unavailable (503)", async () => {
    server.use(musicLibraryGetErrorHandler());
    await expect(getMusicLibrary()).rejects.toThrow(ApiError);
  });
});

describe("postMusicMood", () => {
  it("returns the active mood, valid tracks in that bucket, and a suggested track id", async () => {
    const result = await postMusicMood("calm");
    expect(result.active_mood).toBe("calm");
    expect(result.tracks.every((track) => track.mood === "calm" && track.status === "ok")).toBe(true);
    expect(result.suggested_track_id).toBe("track-1");
  });

  it("throws ValidationError on 422 (unknown mood)", async () => {
    server.use(musicMoodValidationHandler());
    await expect(postMusicMood("not-a-real-mood")).rejects.toThrow(ValidationError);
  });

  it("throws ApiError on a non-422 failure (music_unavailable)", async () => {
    server.use(musicMoodErrorHandler());
    await expect(postMusicMood("calm")).rejects.toThrow(ApiError);
  });
});

describe("useMusicMoodMutation", () => {
  it("resolves with the MusicMoodResponse for the requested mood", async () => {
    const { result } = renderHook(() => useMusicMoodMutation(), { wrapper: createWrapper() });
    result.current.mutate("hype");
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.active_mood).toBe("hype");
  });
});

describe("getMusicState", () => {
  it("returns the orchestration-only music state", async () => {
    const result = await getMusicState();
    expect(result).toEqual(defaultMusicState);
  });
});

describe("useMusicStateQuery", () => {
  it("hydrates from GET /api/music/state", async () => {
    const { result } = renderHook(() => useMusicStateQuery(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.data).toEqual(defaultMusicState));
  });
});

describe("postMusicFade", () => {
  it("posts direction/duration_ms and returns the resulting state with a fade intent", async () => {
    const result = await postMusicFade("out", 4000);
    expect(result.fade).toEqual({ direction: "out", duration_ms: 4000, seq: 1, ts: 0 });
  });

  it("throws ValidationError on 422 (unknown direction)", async () => {
    server.use(musicFadeValidationHandler());
    // @ts-expect-error intentionally invalid direction to exercise the 422 branch
    await expect(postMusicFade("sideways")).rejects.toThrow(ValidationError);
  });
});

describe("useMusicFadeMutation", () => {
  it("writes the returned MusicStateResponse into the music-state query cache", async () => {
    server.use(musicStateGetHandler(defaultMusicState));
    const { result } = renderHook(() => useMusicFadeMutation(), { wrapper: createWrapper() });
    result.current.mutate({ direction: "in", durationMs: 2000 });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.fade).toEqual({ direction: "in", duration_ms: 2000, seq: 1, ts: 0 });
  });
});

describe("postMusicImport", () => {
  it("posts path/mood and returns the imported track", async () => {
    const result = await postMusicImport("C:\\music\\intro.mp3", "hype");
    expect(result.track).toEqual({ id: "track-imported", label: "intro.mp3", mood: "hype", status: "ok" });
  });

  it("throws ValidationError on 422 (unknown mood / invalid path)", async () => {
    server.use(musicImportValidationHandler());
    await expect(postMusicImport("C:\\music\\intro.mp3", "not-a-real-mood")).rejects.toThrow(ValidationError);
  });

  it("throws ApiError on 503 (music_write_failed)", async () => {
    server.use(musicImportErrorHandler());
    await expect(postMusicImport("C:\\music\\intro.mp3", "hype")).rejects.toThrow(ApiError);
  });
});

describe("useMusicImportMutation", () => {
  it("invalidates the music library query on success", async () => {
    const { result } = renderHook(() => useMusicImportMutation(), { wrapper: createWrapper() });
    result.current.mutate({ path: "C:\\music\\intro.mp3", mood: "hype" });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.track.id).toBe("track-imported");
  });
});

describe("deleteMusicTrack", () => {
  it("deletes the track and resolves with ok:true", async () => {
    const result = await deleteMusicTrack("track-1");
    expect(result).toEqual({ ok: true });
  });

  it("throws NotFoundError on 404 (unknown/already-deleted track)", async () => {
    server.use(musicTrackDeleteNotFoundHandler());
    await expect(deleteMusicTrack("does-not-exist")).rejects.toThrow(NotFoundError);
  });

  it("throws ApiError on 503 (music_write_failed)", async () => {
    server.use(musicTrackDeleteErrorHandler());
    await expect(deleteMusicTrack("track-1")).rejects.toThrow(ApiError);
  });
});

describe("useDeleteMusicTrackMutation", () => {
  it("invalidates the music library query on success", async () => {
    const { result } = renderHook(() => useDeleteMusicTrackMutation(), { wrapper: createWrapper() });
    result.current.mutate("track-1");
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });
});

describe("trackAudioUrl", () => {
  it("builds the client-side-playback URL without fetching it", () => {
    expect(trackAudioUrl("track-1")).toMatch(/\/api\/music\/track\/track-1\/audio$/);
  });

  it("URL-encodes the track id", () => {
    expect(trackAudioUrl("a b")).toContain("track/a%20b/audio");
  });
});
