import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  bootstrapBackend: vi.fn(),
  createRoot: vi.fn(),
  render: vi.fn()
}));

vi.mock("react-dom/client", () => ({
  default: {
    createRoot: (...args: unknown[]) => mocks.createRoot(...args)
  }
}));

vi.mock("./lib/backendBootstrap.js", () => ({
  bootstrapBackend: () => mocks.bootstrapBackend()
}));

vi.mock("./api/queryClient.js", () => ({ queryClient: {} }));
vi.mock("./App.js", () => ({ App: () => null }));

describe("main entrypoint", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.bootstrapBackend.mockReset();
    mocks.createRoot.mockReset();
    mocks.render.mockReset();
    mocks.bootstrapBackend.mockImplementation(() => new Promise(() => {}));
    mocks.createRoot.mockReturnValue({ render: mocks.render });
    document.body.innerHTML = '<div id="root"></div>';
  });

  it("mounts React synchronously without waiting for backend bootstrap", async () => {
    await import("./main.js");

    expect(mocks.createRoot).toHaveBeenCalledWith(document.getElementById("root"));
    expect(mocks.render).toHaveBeenCalledTimes(1);
    expect(mocks.bootstrapBackend).not.toHaveBeenCalled();
  });
});
