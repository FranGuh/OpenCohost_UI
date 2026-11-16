import { describe, expect, it, vi } from 'vitest';
import { EVT_AUTH, EVT_SPEECH, EVT_STATE, attachAvatarEvents } from './contract.js';

function handlers() {
  return { onAuth: vi.fn(), onSpeech: vi.fn(), onState: vi.fn() };
}

describe('avatar event contract', () => {
  it('uses the names phone.js dispatches', () => {
    expect([EVT_AUTH, EVT_SPEECH, EVT_STATE]).toEqual(['kira:auth', 'kira:speech', 'kira:state']);
  });

  it('routes auth, speech and state events', () => {
    const t = new EventTarget();
    const h = handlers();
    attachAvatarEvents(t, h);
    t.dispatchEvent(new CustomEvent('kira:auth', { detail: { token: 'abc' } }));
    t.dispatchEvent(new CustomEvent('kira:auth', { detail: { token: null } }));
    t.dispatchEvent(new CustomEvent('kira:speech', { detail: { phase: 'boundary' } }));
    t.dispatchEvent(new CustomEvent('kira:state', { detail: { state: 'thinking' } }));
    expect(h.onAuth.mock.calls).toEqual([['abc'], [null]]);
    expect(h.onSpeech).toHaveBeenCalledWith('boundary');
    expect(h.onState).toHaveBeenCalledWith('thinking');
  });

  it('ignores malformed details', () => {
    const t = new EventTarget();
    const h = handlers();
    attachAvatarEvents(t, h);
    t.dispatchEvent(new CustomEvent('kira:auth', { detail: { token: 42 } }));
    t.dispatchEvent(new CustomEvent('kira:auth'));
    t.dispatchEvent(new CustomEvent('kira:speech', { detail: { phase: 'nope' } }));
    t.dispatchEvent(new CustomEvent('kira:state', { detail: {} }));
    expect(h.onAuth).not.toHaveBeenCalled();
    expect(h.onSpeech).not.toHaveBeenCalled();
    expect(h.onState).not.toHaveBeenCalled();
  });

  it('detaches', () => {
    const t = new EventTarget();
    const h = handlers();
    const detach = attachAvatarEvents(t, h);
    detach();
    t.dispatchEvent(new CustomEvent('kira:auth', { detail: { token: 'abc' } }));
    expect(h.onAuth).not.toHaveBeenCalled();
  });
});
