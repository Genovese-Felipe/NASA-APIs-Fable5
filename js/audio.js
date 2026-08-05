/* ── Cosmoscope · audio.js ──────────────────────────────────────────
   Fully procedural Web Audio soundscape — no samples, no downloads,
   royalty-free by construction. Deep-space drone + reverbed pad +
   solar-wind noise, UI blips, camera whoosh, and data sonification
   (each world sings its own orbital parameters).                    */

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.muted = true;
    this.vol = { master: 0.7, music: 0.8, fx: 0.6 };
    this._whooshTarget = 0;
  }

  get started() { return !!this.ctx; }

  /* Must be called from a user gesture (autoplay policy). */
  start(withSound) {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      const ctx = new AC();
      this.ctx = ctx;

      this.master = ctx.createGain();
      this.master.gain.value = 0;              /* faded in below */
      this.master.connect(ctx.destination);

      this.musicBus = ctx.createGain();
      this.fxBus = ctx.createGain();
      this.musicBus.connect(this.master);
      this.fxBus.connect(this.master);

      /* generated impulse-response reverb (5 s exponential decay) */
      this.reverb = ctx.createConvolver();
      this.reverb.buffer = this._impulse(5, 2.4);
      this.reverbGain = ctx.createGain();
      this.reverbGain.gain.value = 0.5;
      this.reverb.connect(this.reverbGain);
      this.reverbGain.connect(this.master);

      this._buildAmbient();
      this._buildWhoosh();

      document.addEventListener('visibilitychange', () => {
        if (!this.ctx) return;
        if (document.hidden) this.ctx.suspend();
        else if (!this.muted) this.ctx.resume();
      });
    }
    this.ctx.resume();
    this.setMuted(!withSound);
  }

  _impulse(seconds, decay) {
    const rate = this.ctx.sampleRate;
    const len = Math.floor(rate * seconds);
    const buf = this.ctx.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
      }
    }
    return buf;
  }

  _noiseSource(seconds = 2) {
    const rate = this.ctx.sampleRate;
    const buf = this.ctx.createBuffer(1, rate * seconds, rate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < d.length; i++) {          /* pinkish noise */
      const white = Math.random() * 2 - 1;
      last = (last + 0.03 * white) / 1.03;
      d[i] = last * 3.2;
    }
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    return src;
  }

  _buildAmbient() {
    const ctx = this.ctx;
    const t = ctx.currentTime;

    /* deep beating drone */
    const o1 = ctx.createOscillator(); o1.type = 'sine'; o1.frequency.value = 55;
    const o2 = ctx.createOscillator(); o2.type = 'sine'; o2.frequency.value = 55.4;
    const droneGain = ctx.createGain(); droneGain.gain.value = 0.12;
    const droneLP = ctx.createBiquadFilter(); droneLP.type = 'lowpass'; droneLP.frequency.value = 240;
    o1.connect(droneGain); o2.connect(droneGain);
    droneGain.connect(droneLP); droneLP.connect(this.musicBus);
    o1.start(t); o2.start(t);

    /* slow pad through reverb: airy fifth, breathing via LFO */
    const p1 = ctx.createOscillator(); p1.type = 'triangle'; p1.frequency.value = 164.81; /* E3 */
    const p2 = ctx.createOscillator(); p2.type = 'triangle'; p2.frequency.value = 246.94; /* B3 */
    const p3 = ctx.createOscillator(); p3.type = 'sine'; p3.frequency.value = 329.63;     /* E4 */
    p2.detune.value = 6; p3.detune.value = -5;
    const padGain = ctx.createGain(); padGain.gain.value = 0.0;
    const padBP = ctx.createBiquadFilter(); padBP.type = 'bandpass'; padBP.frequency.value = 500; padBP.Q.value = 0.6;
    p1.connect(padBP); p2.connect(padBP); p3.connect(padBP);
    padBP.connect(padGain);
    padGain.connect(this.reverb);
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.045;
    const lfoAmp = ctx.createGain(); lfoAmp.gain.value = 0.016;
    lfo.connect(lfoAmp); lfoAmp.connect(padGain.gain);
    padGain.gain.value = 0.02;
    p1.start(t); p2.start(t); p3.start(t); lfo.start(t);

    /* cosmic rumble + solar wind */
    const rumble = this._noiseSource(3);
    const rumbleLP = ctx.createBiquadFilter(); rumbleLP.type = 'lowpass'; rumbleLP.frequency.value = 90;
    const rumbleGain = ctx.createGain(); rumbleGain.gain.value = 0.05;
    rumble.connect(rumbleLP); rumbleLP.connect(rumbleGain); rumbleGain.connect(this.musicBus);
    rumble.start(t);

    const wind = this._noiseSource(2.3);
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'bandpass'; this.windFilter.frequency.value = 1800; this.windFilter.Q.value = 1.4;
    this.windGain = ctx.createGain(); this.windGain.gain.value = 0.0;
    wind.connect(this.windFilter); this.windFilter.connect(this.windGain); this.windGain.connect(this.musicBus);
    wind.start(t);
  }

  _buildWhoosh() {
    const ctx = this.ctx;
    const src = this._noiseSource(1.7);
    this.whooshFilter = ctx.createBiquadFilter();
    this.whooshFilter.type = 'bandpass'; this.whooshFilter.frequency.value = 420; this.whooshFilter.Q.value = 0.8;
    this.whooshGain = ctx.createGain(); this.whooshGain.gain.value = 0;
    src.connect(this.whooshFilter); this.whooshFilter.connect(this.whooshGain);
    this.whooshGain.connect(this.fxBus);
    src.start();
  }

  _applyVolumes() {
    if (!this.ctx) return;
    const m = this.muted ? 0 : this.vol.master;
    this.master.gain.setTargetAtTime(m, this.ctx.currentTime, 0.4);
    this.musicBus.gain.setTargetAtTime(this.vol.music, this.ctx.currentTime, 0.2);
    this.fxBus.gain.setTargetAtTime(this.vol.fx, this.ctx.currentTime, 0.2);
  }

  setVolumes(patch) {
    Object.assign(this.vol, patch);
    this._applyVolumes();
  }

  setMuted(muted) {
    this.muted = muted;
    if (this.ctx && !muted) this.ctx.resume();
    this._applyVolumes();
  }

  /* 0..1 — closeness to the Sun drives the solar-wind hiss */
  setSunProximity(x) {
    if (!this.ctx) return;
    const g = Math.pow(Math.max(0, Math.min(1, x)), 2.2) * 0.06;
    this.windGain.gain.setTargetAtTime(g, this.ctx.currentTime, 0.6);
    this.windFilter.frequency.setTargetAtTime(900 + 2600 * x, this.ctx.currentTime, 0.6);
  }

  /* camera speed 0..1 → doppler-ish whoosh */
  setSpeed(x) {
    if (!this.ctx) return;
    const v = Math.max(0, Math.min(1, x));
    if (Math.abs(v - this._whooshTarget) < 0.01) return;
    this._whooshTarget = v;
    this.whooshGain.gain.setTargetAtTime(v * 0.11, this.ctx.currentTime, 0.12);
    this.whooshFilter.frequency.setTargetAtTime(280 + 1400 * v, this.ctx.currentTime, 0.15);
  }

  _blip(freq0, freq1, dur, vol, type = 'sine') {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, freq1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    o.connect(g); g.connect(this.fxBus);
    o.start(t); o.stop(t + dur + 0.05);
  }

  ui(kind) {
    if (!this.ctx || this.muted) return;
    switch (kind) {
      case 'click': this._blip(660, 440, 0.09, 0.12); break;
      case 'select': this._blip(520, 780, 0.14, 0.11); break;
      case 'open': this._blip(340, 620, 0.12, 0.08); break;
      case 'close': this._blip(620, 340, 0.1, 0.07); break;
      case 'recStart': this._blip(440, 880, 0.22, 0.13, 'triangle'); break;
      case 'recStop': this._blip(880, 330, 0.25, 0.13, 'triangle'); break;
      case 'error': this._blip(220, 140, 0.3, 0.12, 'square'); break;
      case 'shutter': {
        const ctx = this.ctx, t = ctx.currentTime;
        const src = this._noiseSource(0.3);
        const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1500;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.18, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
        src.connect(hp); hp.connect(g); g.connect(this.fxBus);
        src.start(t); src.stop(t + 0.14);
        this._blip(1200, 900, 0.05, 0.1);
        break;
      }
    }
  }

  /* Sing a world: root note from orbital period, arpeggio span from
     radius, tremble from eccentricity. */
  sonify(data) {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx, t0 = ctx.currentTime;
    const penta = [0, 2, 4, 7, 9, 12, 14, 16];
    /* long periods → deep notes: Mercury sings high, Neptune deep */
    const periodY = Math.max(0.03, data.periodYears || 1);
    const root = 392 * Math.pow(2, -Math.log10(periodY * 10) / 1.4);
    const span = Math.max(3, Math.min(8, Math.round(Math.log10(data.radiusKm || 6000) * 2)));
    const wobble = (data.ecc || 0.02) * 60;
    for (let i = 0; i < span; i++) {
      const t = t0 + i * 0.16;
      const semis = penta[i % penta.length];
      const f = root * Math.pow(2, semis / 12);
      const o = ctx.createOscillator();
      o.type = i % 2 ? 'sine' : 'triangle';
      o.frequency.setValueAtTime(f, t);
      if (wobble > 0.5) {
        o.frequency.setValueAtTime(f * (1 + wobble / 1200), t + 0.05);
        o.frequency.exponentialRampToValueAtTime(f, t + 0.14);
      }
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.1, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
      o.connect(g); g.connect(this.reverb); g.connect(this.fxBus);
      o.start(t); o.stop(t + 0.6);
    }
  }
}
