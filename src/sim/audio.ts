/** Tiny Web Audio synth for retro SFX. Create lazily from a user gesture. */
export class RetroAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  volume = 0.5;
  muted = true;

  ensure() {
    if (typeof window === "undefined") return;
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.connect(this.ctx.destination);
    }
    void this.ctx.resume();
    this.apply();
  }
  apply() { if (this.master) this.master.gain.value = this.muted ? 0 : this.volume; }
  get ready() { return !!this.ctx && !this.muted; }

  private tone(freq: number, dur: number, type: OscillatorType, vol: number, when = 0, slideTo?: number) {
    const c = this.ctx!, t0 = c.currentTime + when;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t0);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    g.gain.setValueAtTime(vol, t0); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(this.master!); o.start(t0); o.stop(t0 + dur + 0.02);
  }
  private noise(dur: number, vol: number, freq: number, when = 0, type: BiquadFilterType = "lowpass", sweepTo?: number) {
    const c = this.ctx!, t0 = c.currentTime + when;
    const buf = c.createBuffer(1, Math.ceil(c.sampleRate * dur), c.sampleRate);
    const d = buf.getChannelData(0);
    let seed = 1234;
    for (let i = 0; i < d.length; i++) { seed = (seed * 16807) % 2147483647; d[i] = (seed / 2147483647) * 2 - 1; }
    const src = c.createBufferSource(); src.buffer = buf;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t0);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t0 + dur);
    const g = c.createGain(); g.gain.setValueAtTime(vol, t0); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f).connect(g).connect(this.master!); src.start(t0);
  }

  clink() { if (!this.ready) return; this.tone(1760, 0.07, "square", 0.08); this.tone(2637, 0.09, "triangle", 0.07, 0.03); }
  tick() { if (!this.ready) return; this.tone(180, 0.025, "square", 0.025); }
  bleep() { if (!this.ready) return; this.tone(660, 0.06, "square", 0.05); this.tone(880, 0.06, "square", 0.05, 0.06); }
  buzz() { if (!this.ready) return; this.tone(140, 0.18, "sawtooth", 0.06, 0, 90); }
  stamp() {
    if (!this.ready) return;
    this.noise(0.1, 0.35, 500); this.tone(120, 0.14, "sine", 0.5, 0, 45);
    this.tone(1318.5, 0.25, "triangle", 0.12, 0.12); this.tone(1760, 0.35, "triangle", 0.1, 0.2);
  }
  fanfare() {
    if (!this.ready) return;
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => this.tone(f, 0.12, "square", 0.07, i * 0.08));
    this.tone(1046.5, 0.35, "triangle", 0.08, 0.34); this.tone(1318.5, 0.35, "triangle", 0.06, 0.34);
  }
  splash() {
    if (!this.ready) return;
    this.tone(160, 0.2, "sine", 0.4, 0, 50);
    this.noise(0.45, 0.25, 2500, 0.05, "lowpass", 300);
  }
}
