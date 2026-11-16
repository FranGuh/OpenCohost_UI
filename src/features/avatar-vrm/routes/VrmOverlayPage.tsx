import { useCallback, useEffect, useRef, useState } from 'react';
import { VrmStage } from '../components/VrmStage.js';
import { localBackend, VrmApi } from '../domain/vrmApi.js';
import { VrmLipSync } from '../domain/vrmLipSync.js';
import './overlay.css';

export function VrmOverlayPage() {
  const [base, setBase] = useState(import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8765');
  const [models, setModels] = useState<string[]>([]);
  const [model, setModel] = useState('');
  const [token, setToken] = useState('');
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);
  const [revision, setRevision] = useState(0);
  const sync = useRef<VrmLipSync>();
  const sample = useCallback((frameId?: number, deltaSeconds?: number) => sync.current?.sample(frameId, deltaSeconds) ?? 0, []);
  const isAudioActive = useCallback(() => sync.current?.isAudioActive() ?? false, []);
  const fail = useCallback((message: string) => { setError(message); setReady(false); }, []);
  useEffect(() => {
    const controller = new AbortController();
    setModels([]); setModel('');
    try {
      const api = new VrmApi(base);
      void api.models(controller.signal).then(items => {
        if (controller.signal.aborted) return;
        const names = items.map(item => item.filename);
        setModels(names);
        const requested = new URLSearchParams(window.location.search).get('model');
        setModel(requested && names.includes(requested) ? requested : names[0] ?? '');
        setError(names.length ? '' : 'No VRM models found in the configured backend directory.');
      }).catch(() => { if (!controller.signal.aborted) fail('Could not list models. Check the backend address and CORS configuration.'); });
    } catch { fail('Backend must be a loopback origin.'); }
    return () => controller.abort();
  }, [base, revision, fail]);
  useEffect(() => {
    const hidden = () => {
      if (document.hidden) { sync.current?.dispose(); sync.current = undefined; setReady(false); }
    };
    document.addEventListener('visibilitychange', hidden);
    return () => { document.removeEventListener('visibilitychange', hidden); sync.current?.dispose(); sync.current = undefined; };
  }, []);
  const connect = async () => {
    sync.current?.dispose(); sync.current = undefined;
    try {
      const api = new VrmApi(base, token);
      const pipeline = new VrmLipSync(api, new AudioContext(), fail);
      sync.current = pipeline;
      await pipeline.start();
      if (sync.current !== pipeline) { pipeline.dispose(); return; }
      setError(''); setReady(true);
    } catch (e) { sync.current?.dispose(); sync.current = undefined; fail(e instanceof Error ? e.message : 'Audio unavailable'); }
  };
  let url = '';
  try { if (model) url = new VrmApi(localBackend(base)).modelUrl(model); } catch { /* Form reports invalid origin. */ }
  return <main className="vrm-overlay">
    {url && <VrmStage key={revision} url={url} sample={sample} isAudioActive={isAudioActive} onError={fail} />}
    {!ready && <section className="vrm-controls" aria-label="Avatar setup">
      <h1>VRM overlay</h1>
      <p>Use OBS Interact to configure this source. Credentials remain in memory until reload.</p>
      <label>Backend origin<input value={base} onChange={event => { sync.current?.dispose(); setBase(event.target.value); }} /></label>
      <label>Model<select value={model} onChange={event => setModel(event.target.value)}>{models.map(name => <option key={name}>{name}</option>)}</select></label>
      <label>Operator token<input type="password" autoComplete="off" value={token} onChange={event => setToken(event.target.value)} /></label>
      <button disabled={!model || !token} onClick={() => void connect()}>Enable silent analysis</button>
      <button onClick={() => setRevision(value => value + 1)}>Retry model</button>
      {error && <p role="alert">{error}</p>}
    </section>}
  </main>;
}
