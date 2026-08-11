import "@testing-library/jest-dom/vitest";
import { afterAll, afterEach, beforeAll } from "vitest";
import { server } from "./server.js";

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

// jsdom has no real media pipeline — HTMLMediaElement.play()/pause() throw
// "not implemented" by default. MusicPanel plays managed tracks via a real
// <audio> element (client-side-playback model, resolution 2911), so every
// test touching it needs these stubbed globally rather than per-test.
if (typeof window !== "undefined" && window.HTMLMediaElement) {
  window.HTMLMediaElement.prototype.play = () => Promise.resolve();
  window.HTMLMediaElement.prototype.pause = () => {};
}

// jsdom doesn't implement Element#scrollIntoView at all (not even a no-op —
// it's `undefined`). Select scrolls its selected option into view on open, so
// every test that opens a dropdown needs this stubbed globally.
if (typeof window !== "undefined" && window.Element && !window.Element.prototype.scrollIntoView) {
  window.Element.prototype.scrollIntoView = () => {};
}
