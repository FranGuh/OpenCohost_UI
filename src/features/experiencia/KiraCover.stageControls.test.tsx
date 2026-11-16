import { act, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, expect, it, vi } from "vitest";

const stage = vi.hoisted(() => ({ props: {} as { framingMode?: string; qaAnimationUrl?: string | null } }));
vi.mock("../../api/status.js", () => ({ useStatusQuery: () => ({ data: undefined }) }));
vi.mock("../../api/avatar.js", () => ({ useAvatarConfigQuery: () => ({ data: undefined }), avatarImageUrl: () => "" }));
vi.mock("../avatar-vrm/components/VrmStage.js", () => ({
  VrmStage: (p: { framingMode?: string; qaAnimationUrl?: string | null }) => {
    stage.props = p;
    return null;
  }
}));

import { KiraCover } from "./KiraCover.js";
import { useAvatarPresentationStore } from "../../store/avatarPresentationStore.js";
import { useStageControlsStore } from "../../store/stageControlsStore.js";

beforeEach(() => {
  window.localStorage.clear();
  useAvatarPresentationStore.setState({ mode: "3d", selectedModel: "model.vrm" });
  useStageControlsStore.setState({ framingMode: "half", qaRunning: false, qaIndex: 0, stage3dMounted: false });
});

function mount() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <KiraCover />
    </QueryClientProvider>
  );
}

it("renders no floating framing or animation-test controls", () => {
  mount();
  expect(screen.queryByText("Cuerpo")).not.toBeInTheDocument();
  expect(screen.queryByText("Probar Animaciones")).not.toBeInTheDocument();
  expect(screen.queryByText("Probar animaciones")).not.toBeInTheDocument();
});

it("feeds the stage framing and animation url from the shared store and reports the 3D stage as mounted", () => {
  const view = mount();
  expect(stage.props.framingMode).toBe("half");
  expect(useStageControlsStore.getState().stage3dMounted).toBe(true);
  act(() => useStageControlsStore.getState().setFramingMode("head"));
  expect(stage.props.framingMode).toBe("head");
  act(() => useStageControlsStore.getState().startQa());
  expect(stage.props.qaAnimationUrl).toBe("/animations/idle.vrma");
  view.unmount();
  expect(useStageControlsStore.getState().stage3dMounted).toBe(false);
});
