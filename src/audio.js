// The n-back's audio: clips decoded once, played with the Web Audio API at times given on the performance.now
// clock (the clock the frames and key presses use). AudioContext.getOutputTimestamp() relates the two clocks at
// the output device, so a clip is scheduled to be *heard* at the time asked, and its logged onset is when the
// browser expects it to leave the output (its estimate of the output latency included).

export class AudioCues {
  constructor() {
    this.ctx = new AudioContext({ latencyHint: "interactive" });
    this.buffers = new Map();
    this.manifest = null;
    this.sources = new Set();
  }

  /** Fetch and decode every clip of `language` (assets/audio/<language>/manifest.json). */
  async load(language, base = "assets/audio") {
    const manifest = await (await fetch(`${base}/${language}/manifest.json`)).json();
    const entries = await Promise.all(Object.entries(manifest.clips).map(async ([id, clip]) => {
      const data = await (await fetch(`${base}/${language}/${clip.file}`)).arrayBuffer();
      return [id, await this.ctx.decodeAudioData(data)];
    }));
    this.buffers = new Map(entries);
    this.manifest = manifest;
  }

  /** Browsers start audio only after a click or key press in the page: call this from one. */
  unlock() { return this.ctx.resume(); }

  get running() { return this.ctx.state === "running"; }
  get ready() { return this.running && this.buffers.size > 0; }

  /** [contextTime, performanceTime] of the same output instant. */
  #anchor() {
    const ts = this.ctx.getOutputTimestamp?.();
    if (ts && ts.performanceTime > 0) return [ts.contextTime, ts.performanceTime];
    // before the first output timestamp: the current time, plus the latency still to come
    const latency = this.ctx.outputLatency || this.ctx.baseLatency || 0;
    return [this.ctx.currentTime, performance.now() + latency * 1000];
  }

  /** Context time at which a sound starting then is heard at performance time `perfMs`. */
  toContext(perfMs) { const [c, p] = this.#anchor(); return c + (perfMs - p) / 1000; }
  /** Performance time at which a sound started at context time `when` is heard. */
  toPerf(when) { const [c, p] = this.#anchor(); return p + (when - c) * 1000; }

  /** Play clip `id` to be heard at `perfMs` (or as soon as possible if that has passed). Returns a handle with
   *  the expected onset (`onsetPerf`) and the clip's length (`duration`, s). */
  play(id, perfMs) {
    const buffer = this.buffers.get(id);
    if (!buffer) throw new Error(`No audio clip "${id}"`);
    const when = Math.max(this.toContext(perfMs), this.ctx.currentTime + 0.005);
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(this.ctx.destination);
    source.start(when);
    this.sources.add(source);
    source.onended = () => this.sources.delete(source);
    return { source, id, onsetPerf: this.toPerf(when), late: when > this.toContext(perfMs) + 0.001, duration: buffer.duration };
  }

  stop(handle) { try { handle.source.stop(); } catch { /* already ended */ } this.sources.delete(handle.source); }
  stopAll() { for (const s of this.sources) { try { s.stop(); } catch { /* ended */ } } this.sources.clear(); }

  info() {
    return { state: this.ctx.state, sample_rate: this.ctx.sampleRate, base_latency_s: this.ctx.baseLatency ?? null,
      output_latency_s: this.ctx.outputLatency ?? null, voice: this.manifest?.voice ?? null, model: this.manifest?.model ?? null,
      training_data: this.manifest?.training_data ?? null, generated: this.manifest?.generated ?? null };
  }
}
