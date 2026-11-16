import { act, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { KiraCover } from './KiraCover.js';
import { useAvatarPresentationStore } from '../../store/avatarPresentationStore.js';
import { useStageControlsStore } from '../../store/stageControlsStore.js';
vi.mock('../../api/status.js', () => ({ useStatusQuery: () => ({ data: undefined }) }));
vi.mock('../../api/avatar.js', () => ({ useAvatarConfigQuery: () => ({ data: undefined }), avatarImageUrl: () => '' }));
const stage = vi.hoisted(() => ({ done: undefined as undefined | (() => void) }));
vi.mock('../avatar-vrm/components/VrmStage.js', () => ({ VrmStage: (p: {onQaAnimationFinished?: () => void}) => { stage.done = p.onQaAnimationFinished; return null; } }));
beforeEach(() => { vi.useFakeTimers(); useStageControlsStore.setState({ qaRunning: false, qaIndex: 0 }); useAvatarPresentationStore.setState({mode: '3d', selectedModel: 'model.vrm'}); });
afterEach(() => { vi.useRealTimers(); useAvatarPresentationStore.setState({mode: '2d', selectedModel: undefined}); });
function mount() { return render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><KiraCover /></QueryClientProvider>); }
it('ignores duplicate completion and an obsolete callback after manual navigation', async () => {
  const view = mount(); act(() => useStageControlsStore.getState().startQa());
  const old = stage.done!;
  act(() => { old(); old(); });
  fireEvent.click(screen.getByTitle('Siguiente'));
  act(() => { old(); vi.advanceTimersByTime(250); });
  expect(screen.getByText('Validación QA (2/16)')).toBeInTheDocument();
  await act(async () => {});
  view.unmount();
});
it('cancels the settle timer on stop, restart and unmount', () => {
  const view = mount(); act(() => useStageControlsStore.getState().startQa());
  act(() => stage.done!()); act(() => useStageControlsStore.getState().stopQa());
  act(() => useStageControlsStore.getState().startQa());
  act(() => vi.advanceTimersByTime(250));
  expect(screen.getByText('Validación QA (1/16)')).toBeInTheDocument();
  act(() => stage.done!()); view.unmount();
  act(() => vi.advanceTimersByTime(250));
});
