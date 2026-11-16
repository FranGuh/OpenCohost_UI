import type { VrmApi } from './vrmApi.js';
import { clampDelta, rms } from './vrmAnimator.js';
import { vrmDiagnostics, type VrmDiagnosticSurface, type VrmSourceReason, type VrmDiagnosticsController } from './vrmDiagnostics.js';

/** One serialized poll loop; generations reject late network/decode completions. */
export class VrmLipSync {
  private stopped = true;
  private generation = 0;
  private lastSequence = -1;
  private source?: AudioBufferSourceNode;
  private sourceStarted = false;
  private analyser?: AnalyserNode;
  private gain?: GainNode;
  private samples = new Float32Array(512);
  private controller?: AbortController;
  private timer?: ReturnType<typeof setTimeout>;
  private watchdog?: ReturnType<typeof setTimeout>;
  private opening = 0;
  private latestElapsedMs: number | null = null;
  private static readonly STATE_REQUEST_TIMEOUT_MS = 1500;
  private static readonly AUDIO_REQUEST_TIMEOUT_MS = 4000;
  private static readonly ATTACK_TIME_CONSTANT_SECONDS = -1 / (60 * Math.log(0.6));
  private static readonly RELEASE_TIME_CONSTANT_SECONDS = 0.08;
  constructor(
    private api: Pick<VrmApi, 'state' | 'audio'>,
    private context: AudioContext,
    private onError: (message: string) => void,
    private surface: VrmDiagnosticSurface = 'unknown',
    private diagnostics: VrmDiagnosticsController = vrmDiagnostics,
  ) {}
  private diagnosticContextTime(): number | null {
    if (!this.diagnostics.isRecording()) return null;
    try { return Number.isFinite(this.context.currentTime) ? this.context.currentTime : null; }
    catch { return null; }
  }
  private recordSetupFailure(reason: 'resume_error' | 'context_suspended') {
    if (!this.diagnostics.isRecording()) return;
    this.diagnostics.recordSource(
      this.surface, reason, this.lastSequence, false, null, this.diagnosticContextTime(), null, null, null, null,
    );
  }
  async start() {
    try { await this.context.resume(); }
    catch (error) { this.recordSetupFailure('resume_error'); throw error; }
    if (this.context.state !== 'running') {
      this.recordSetupFailure('context_suspended');
      throw new Error('Use Interact to enable audio analysis');
    }
    this.stopped = false;
    clearTimeout(this.timer);
    this.timer = undefined;
    void this.poll(++this.generation);
  }
  isRunning(): boolean {
    return !this.stopped;
  }
  private clearSource(reason: VrmSourceReason, sequence = this.lastSequence, elapsedMs = this.latestElapsedMs) {
    const hadSource = Boolean(this.source || this.sourceStarted || this.analyser || this.gain || this.opening !== 0);
    if (this.diagnostics.isRecording() && (reason !== 'inactive' && reason !== 'request_abort' || hadSource)) {
      this.diagnostics.recordSource(
        this.surface, reason, sequence, false, elapsedMs, this.diagnosticContextTime(),
        null, null, null, null,
      );
    }
    if (this.source) { this.source.onended = null; try { this.source.stop(); } catch { /* Already ended. */ } this.source.disconnect(); }
    const interruptedActiveSource = this.sourceStarted && (
      reason === 'context_suspended' || reason === 'watchdog' || reason === 'request_error' || reason === 'transient_api_error'
    );
    if (interruptedActiveSource) {
      this.lastSequence = -1;
    }
    this.analyser?.disconnect(); this.gain?.disconnect();
    this.source = undefined; this.sourceStarted = false; this.analyser = undefined; this.gain = undefined; this.opening = 0;
  }
  isAudioActive(): boolean {
    return !this.stopped && this.context.state === 'running' && this.sourceStarted;
  }
  sample(frameId?: number, deltaSeconds?: number) {
    if (!this.analyser || this.context.state !== 'running') {
      this.opening = 0;
      if (this.diagnostics.isRecording()) {
        this.diagnostics.recordSample(this.surface, frameId, this.lastSequence, false, null, null, 0);
      }
      return this.opening;
    }
    this.analyser.getFloatTimeDomainData(this.samples);
    const energy = rms(this.samples);
    const target = energy < 0.04 ? 0 : Math.min(1, (energy - 0.04) * 4.0);
    const elapsed = clampDelta(Number.isFinite(deltaSeconds) ? deltaSeconds! : 1 / 60);
    const timeConstant = target > this.opening
      ? VrmLipSync.ATTACK_TIME_CONSTANT_SECONDS
      : VrmLipSync.RELEASE_TIME_CONSTANT_SECONDS;
    this.opening += (target - this.opening) * (1 - Math.exp(-elapsed / timeConstant));
    if (target === 0 && this.opening < 0.02) this.opening = 0;
    if (this.diagnostics.isRecording()) {
      this.diagnostics.recordSample(this.surface, frameId, this.lastSequence, true, energy, target, this.opening);
    }
    return this.opening;
  }
  private async runTimedRequest<T>(
    generation: number,
    timeoutMs: number,
    request: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    const controller = this.controller = new AbortController();
    const watchdog = this.watchdog = setTimeout(() => {
      controller.abort();
      if (!this.stopped && generation === this.generation) this.clearSource('watchdog');
    }, timeoutMs);
    try {
      return await request(controller.signal);
    } finally {
      clearTimeout(watchdog);
      if (this.watchdog === watchdog) this.watchdog = undefined;
      if (this.controller === controller) this.controller = undefined;
    }
  }
  private async poll(generation: number) {
    if (this.stopped || generation !== this.generation) return;
    try {
      const state = await this.runTimedRequest(
        generation,
        VrmLipSync.STATE_REQUEST_TIMEOUT_MS,
        signal => this.api.state(signal),
      );
      if (this.stopped || generation !== this.generation) return;
      this.latestElapsedMs = Number.isFinite(state.elapsed_ms) ? state.elapsed_ms : null;
      if (this.context.state !== 'running') throw new Error('Audio analysis suspended. Use Interact to enable it again.');
      if (!state.active) this.clearSource('inactive', state.sequence, state.elapsed_ms);
      else if (state.sequence !== this.lastSequence) {
        this.clearSource('sequence_change', state.sequence, state.elapsed_ms);
        const bytes = await this.runTimedRequest(
          generation,
          VrmLipSync.AUDIO_REQUEST_TIMEOUT_MS,
          signal => this.api.audio(state.sequence, signal),
        );
        if (this.stopped || generation !== this.generation) return;
        if (!bytes || bytes.byteLength === 0) { this.clearSource('empty_audio', state.sequence, state.elapsed_ms); return; }
        let buffer: AudioBuffer;
        const decodeStartedAt = this.diagnostics.mark();
        try {
          buffer = await this.context.decodeAudioData(bytes);
        } catch {
          if (!this.stopped && generation === this.generation) {
            this.clearSource('decode_error', state.sequence, state.elapsed_ms);
            this.lastSequence = state.sequence;
          }
          return;
        }
        const decodeEndedAt = decodeStartedAt === null ? null : this.diagnostics.mark();
        const decodeMs = decodeStartedAt !== null && decodeEndedAt !== null ? Math.max(0, decodeEndedAt - decodeStartedAt) : null;
        if (this.stopped || generation !== this.generation) return;
        const current = await this.runTimedRequest(
          generation,
          VrmLipSync.STATE_REQUEST_TIMEOUT_MS,
          signal => this.api.state(signal),
        );
        if (this.stopped || generation !== this.generation) return;
        if (this.context.state !== 'running') throw new Error('Audio analysis suspended. Use Interact to enable it again.');
        this.latestElapsedMs = Number.isFinite(current.elapsed_ms) ? current.elapsed_ms : null;
        if (current.active && current.sequence === state.sequence && current.elapsed_ms / 1000 < buffer.duration) {
          const source = this.context.createBufferSource();
          const analyser = this.context.createAnalyser();
          const gain = this.context.createGain();
          analyser.fftSize = 512; gain.gain.value = 0;
          source.buffer = buffer;
          source.connect(analyser); analyser.connect(gain); gain.connect(this.context.destination);
          this.source = source; this.analyser = analyser; this.gain = gain;
          source.onended = () => { if (this.source === source) this.clearSource('natural_end', state.sequence, this.latestElapsedMs); };
          const sourceOffset = current.elapsed_ms / 1000;
          source.start(0, sourceOffset);
          this.sourceStarted = true;
          this.lastSequence = state.sequence;
          if (this.diagnostics.isRecording()) {
            this.diagnostics.recordSource(
              this.surface, 'source_started', state.sequence, true, current.elapsed_ms, this.diagnosticContextTime(),
              decodeMs, buffer.duration, buffer.sampleRate, sourceOffset,
            );
          }
        } else if (!current.active || current.sequence !== state.sequence || current.elapsed_ms / 1000 >= buffer.duration) {
          const reason: VrmSourceReason = !current.active
            ? 'inactive'
            : current.sequence !== state.sequence ? 'sequence_change' : 'source_offset_exhausted';
          this.clearSource(reason, current.sequence, current.elapsed_ms);
          this.lastSequence = state.sequence;
        }
      }
    } catch (error) {
      const isAbort = (error instanceof Error || (typeof DOMException !== 'undefined' && error instanceof DOMException)) && error.name === 'AbortError';
      const isTransient = error instanceof Error && (
        error.message.includes('(404)')
        || error.message.includes('(409)')
        || error.message.includes('(502)')
        || error.message.includes('(503)')
        || error.message.includes('(504)')
      );
      const resetReason: VrmSourceReason = this.context.state !== 'running'
        ? 'context_suspended'
        : isAbort ? 'request_abort' : isTransient ? 'transient_api_error' : 'request_error';
      if (!this.stopped && generation === this.generation) this.clearSource(resetReason);
      if (!this.stopped && generation === this.generation && !isAbort && !isTransient) {
        this.stopped = true;
        this.onError(error instanceof Error ? error.message : 'Audio analysis unavailable');
      }
    } finally {
      if (!this.stopped && generation === this.generation) this.timer = setTimeout(() => void this.poll(generation), 100);
    }
  }
  dispose() {
    this.stopped = true; this.generation++; this.controller?.abort();
    clearTimeout(this.timer); clearTimeout(this.watchdog); this.clearSource('dispose');
    void this.context.close().catch(() => undefined);
  }
}
