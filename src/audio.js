'use strict';
// Tiny synthesized sound engine (WebAudio). No audio files needed.
const Snd = {
  ctx: null, master: null, muted: false, noise: null,
  scrape: null, scrapeGain: null, scrapeFilter: null,
  engine: null, engineGain: null,

  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      const c = this.ctx = new AC();
      this.master = c.createGain(); this.master.gain.value = this.muted ? 0 : 0.6; this.master.connect(c.destination);
      const len = c.sampleRate * 2, buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.noise = buf;
      // continuous runner scrape
      const src = c.createBufferSource(); src.buffer = buf; src.loop = true;
      this.scrapeFilter = c.createBiquadFilter(); this.scrapeFilter.type = 'bandpass'; this.scrapeFilter.frequency.value = 1400; this.scrapeFilter.Q.value = 0.7;
      this.scrapeGain = c.createGain(); this.scrapeGain.gain.value = 0;
      src.connect(this.scrapeFilter).connect(this.scrapeGain).connect(this.master); src.start();
      // plow engine: two detuned saws through a lowpass
      this.engineGain = c.createGain(); this.engineGain.gain.value = 0;
      const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 380;
      this.engine = [c.createOscillator(), c.createOscillator()];
      this.engine[0].type = 'sawtooth'; this.engine[0].frequency.value = 46;
      this.engine[1].type = 'square'; this.engine[1].frequency.value = 23.4;
      for (const o of this.engine) { o.connect(lp); o.start(); }
      lp.connect(this.engineGain).connect(this.master);
    } catch (e) { this.ctx = null; }
  },
  setMuted(m) { this.muted = m; if (this.master) this.master.gain.value = m ? 0 : 0.6; },

  tone(f0, f1, dur, type = 'square', vol = 0.15, delay = 0) {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime + delay;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    o.connect(g).connect(this.master); o.start(t); o.stop(t + dur + 0.02);
  },
  burst(dur, vol, f, q = 1, type = 'lowpass', delay = 0) {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime + delay;
    const s = c.createBufferSource(); s.buffer = this.noise;
    const fl = c.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q;
    const g = c.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    s.connect(fl).connect(g).connect(this.master); s.start(t, Math.random()); s.stop(t + dur + 0.02);
  },

  crash()  { this.burst(0.45, 0.5, 900); this.tone(140, 40, 0.3, 'sine', 0.5); },
  thud()   { this.burst(0.2, 0.35, 600); this.tone(110, 50, 0.18, 'sine', 0.35); },
  splat()  { this.burst(0.35, 0.5, 2200, 0.8, 'bandpass'); this.tone(300, 90, 0.2, 'triangle', 0.2); },
  hop()    { this.tone(300, 520, 0.12, 'square', 0.07); },
  jump()   { this.burst(0.5, 0.18, 1800, 0.6, 'bandpass'); this.tone(220, 660, 0.25, 'triangle', 0.12); },
  land()   { this.burst(0.15, 0.3, 700); },
  gate()   { this.tone(988, 988, 0.08, 'square', 0.08); this.tone(1319, 1319, 0.14, 'square', 0.08, 0.07); },
  miss()   { this.tone(160, 120, 0.3, 'sawtooth', 0.12); },
  trick(n = 1) { const notes = [523, 659, 784, 1047, 1319]; for (let i = 0; i < Math.min(5, 2 + n); i++) this.tone(notes[i], notes[i], 0.1, 'square', 0.07, i * 0.06); },
  bark()   { this.tone(620, 300, 0.08, 'sawtooth', 0.12); this.tone(600, 280, 0.09, 'sawtooth', 0.12, 0.13); },
  horn()   { for (const d of [0, 0.42]) { this.tone(233, 230, 0.34, 'sawtooth', 0.18, d); this.tone(294, 290, 0.34, 'sawtooth', 0.14, d); } },
  select() { this.tone(660, 660, 0.05, 'square', 0.06); },
  start()  { this.tone(523, 523, 0.08, 'square', 0.08); this.tone(784, 784, 0.16, 'square', 0.08, 0.08); },
  finish() { [523, 659, 784, 1047, 784, 1047].forEach((f, i) => this.tone(f, f, 0.14, 'square', 0.08, i * 0.1)); },
  over()   { [392, 330, 262, 196].forEach((f, i) => this.tone(f, f * 0.98, 0.25, 'triangle', 0.14, i * 0.18)); },
  gulp()   { this.tone(400, 80, 0.5, 'sawtooth', 0.15); this.burst(0.6, 0.4, 500); },

  update(scrapeAmt, brakeAmt, engineAmt, enginePitch) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.scrapeGain.gain.setTargetAtTime(scrapeAmt * 0.09 + brakeAmt * 0.12, t, 0.05);
    this.scrapeFilter.frequency.setTargetAtTime(900 + scrapeAmt * 900 + brakeAmt * 1600, t, 0.05);
    this.engineGain.gain.setTargetAtTime(engineAmt * 0.22, t, 0.1);
    this.engine[0].frequency.setTargetAtTime(42 + enginePitch * 20, t, 0.1);
    this.engine[1].frequency.setTargetAtTime(21.3 + enginePitch * 10, t, 0.1);
  },
};
