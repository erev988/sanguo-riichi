/**
 * 音效：Web Audio 现场合成（不依赖任何音频素材文件）
 * 音色取向与「竹简水墨」一致：木质敲击、磬、铃、钟——清冷、克制，不做电子音。
 */
export class Sfx {
  enabled = true;
  private ctx?: AudioContext;

  private ac(): AudioContext | null {
    if (!this.enabled) return null;
    if (!this.ctx) {
      const Ctor: typeof AudioContext | undefined =
        window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      this.ctx = new Ctor();
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  /** 单音（可叠泛音/延迟） */
  private tone(freq: number, dur: number, type: OscillatorType = 'sine', gain = 0.14, delay = 0): void {
    const ctx = this.ac();
    if (!ctx) return;
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.03);
  }

  /** 噪声脉冲（木质敲击感） */
  private knock(dur: number, gain = 0.09): void {
    const ctx = this.ac();
    if (!ctx) return;
    const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource();
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 1100;
    filter.Q.value = 0.9;
    const g = ctx.createGain();
    g.gain.value = gain;
    src.buffer = buf;
    src.connect(filter).connect(g).connect(ctx.destination);
    src.start();
  }

  /** 出牌：木牌落桌 */
  discard(): void {
    this.knock(0.055, 0.085);
    this.tone(185, 0.06, 'triangle', 0.06);
  }

  /** 吃碰杠：更实的一记 */
  call(): void {
    this.knock(0.08, 0.1);
    this.tone(240, 0.1, 'triangle', 0.07);
  }

  /** 立直：铃 */
  riichi(): void {
    this.tone(1046, 0.5, 'sine', 0.085);
    this.tone(1568, 0.4, 'sine', 0.045, 0.02);
  }

  /** 和牌：磬 */
  win(): void {
    this.tone(523, 0.9, 'sine', 0.12);
    this.tone(784, 0.7, 'sine', 0.07, 0.03);
  }

  /** 役满：磬 + 层叠泛音 */
  yakuman(): void {
    [523, 659, 784, 1046, 1318].forEach((f, i) => this.tone(f, 1.2, 'sine', 0.085, i * 0.07));
  }

  /** 流局：低钟 */
  ryukyoku(): void {
    this.tone(160, 0.85, 'sine', 0.095);
    this.tone(214, 0.6, 'sine', 0.05, 0.04);
  }
}
