/* =====================================================================================
   AudioManager — fully procedural Web Audio (no audio files).
   Graph: sources -> channels (music / sfx / ambience / ui) -> master -> compressor -> out,
          with a synthetic city-reverb send (convolver, generated impulse response).
   Loops: wind (speed), suit flutter (airborne speed), rope strain creak (tension), traffic hum, rain,
          city bed, sirens, adaptive music (chord pads, combat pulse, speed-driven arpeggio).
   Event layers read from the game each frame: footsteps (animator foot plants), swing pass-by whoosh
   at the bottom of every arc.
   One-shots: layered synthesis (transient + body + tail), Karplus-Strong plucked rope twangs,
   soft saturation for weight, per-shot pitch jitter, optional stereo pan. Important sounds raise captions.
   ===================================================================================== */
'use strict';

TL.AudioManager = class {
  constructor(game) {
    this.game = game; this.ctx = null; this.ok = false; this.combat = 0; this.t = 0; this.sirenLevel = 0; this.trafficLevel = 0;
    this.prevVy = 0; this.swooshCD = 0; this.lastAnim = null; this.lastSteps = 0; this.arpT = 0; this.arpI = 0;
  }
  init() {
    if (this.ctx) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
      const c = this.ctx = new AC();
      // master bus: gentle glue compression keeps layered hits loud without clipping
      this.comp = c.createDynamicsCompressor();
      this.comp.threshold.value = -16; this.comp.knee.value = 12; this.comp.ratio.value = 4; this.comp.attack.value = 0.004; this.comp.release.value = 0.22;
      this.master = c.createGain(); this.master.connect(this.comp); this.comp.connect(c.destination);
      this.ch = {};
      for (const k of ['music', 'sfx', 'ambience', 'ui']) { const g = c.createGain(); g.connect(this.master); this.ch[k] = g; }
      // city reverb (post-fader sends from sfx / music; one-shots can add their own send)
      this.verb = c.createConvolver(); this.verb.buffer = this.makeIR(2.6, 3.2);
      this.verbIn = c.createGain(); const vOut = c.createGain(); vOut.gain.value = 0.55;
      this.verbIn.connect(this.verb); this.verb.connect(vOut); vOut.connect(this.master);
      for (const [k, v] of [['sfx', 0.12], ['music', 0.5]]) { const s = c.createGain(); s.gain.value = v; this.ch[k].connect(s); s.connect(this.verbIn); }
      this.shaper = this.makeShaper(2.2);
      this.noise = this.makeNoise(3, 'white'); this.brown = this.makeNoise(4, 'brown'); this.pink = this.makeNoise(3, 'pink');
      // plucked rope bodies (Karplus-Strong), replayed at rope-length-dependent rates
      this.twangLo = this.makePluck(98, 1.6, 0.9975); this.twangHi = this.makePluck(220, 0.7, 0.992);
      // wind loop
      this.wind = this.loopNoise(this.noise, 'bandpass', 600, 0.7, 'ambience');
      this.windHi = this.loopNoise(this.noise, 'highpass', 3000, 0.2, 'ambience');
      // suit flutter: low band of noise, amplitude-modulated faster as speed rises
      this.flap = this.loopNoise(this.pink, 'bandpass', 220, 0.9, 'ambience');
      this.flapLfo = this.lfo('triangle', 8, this.flap.g.gain);
      // rope strain: narrow band of noise with a creak LFO + a faint low hum of the loaded line
      this.rope = this.loopNoise(this.noise, 'bandpass', 500, 9, 'sfx');
      this.ropeLfo = this.lfo('sawtooth', 10, this.rope.g.gain);
      this.ropeHum = this.loopOsc(['sine', 'sine'], [58, 87.5], 'lowpass', 300, 0.7, 'sfx');
      this.launchStrain=this.loopNoise(this.pink,'bandpass',650,4,'sfx');
      this.traffic = this.loopNoise(this.brown, 'lowpass', 220, 0.5, 'ambience');
      this.city = this.loopNoise(this.pink, 'lowpass', 900, 0.3, 'ambience');
      this.rainL = this.loopNoise(this.noise, 'highpass', 1500, 0.5, 'ambience');
      this.siren = this.loopOsc(['triangle'], [700], 'lowpass', 2000, 1, 'sfx');
      // music: detuned-pair chord pad with a slow filter drift, root/fifth bass pulse (combat), arpeggio (speed)
      this.chords = [
        { bass: 55, pad: [220, 261.63, 329.63] },     // Am
        { bass: 43.65, pad: [220, 261.63, 349.23] },  // F
        { bass: 65.41, pad: [196, 261.63, 329.63] },  // C
        { bass: 49, pad: [196, 246.94, 293.66] },     // G
      ];
      const p0 = this.chords[0].pad;
      this.pad = this.loopOsc(['sawtooth', 'sawtooth', 'sawtooth', 'sawtooth', 'triangle', 'triangle'],
        [p0[0] * 0.996, p0[0] * 1.004, p0[1] * 0.996, p0[1] * 1.004, p0[2] * 0.997, p0[2] * 1.003], 'lowpass', 500, 0.8, 'music');
      this.padLfo = this.lfo('sine', 0.07, this.pad.f.frequency); this.padLfo.depth.gain.value = 180;
      this.pad2 = this.loopOsc(['sine', 'sine'], [55, 82.5], 'lowpass', 300, 1, 'music');
      this.chordT = 0; this.chord = 0;
      this.ok = true; this.applyVolumes();
    } catch (e) { TL.logError(e, 'audio'); }
  }
  resume() { if (this.ctx && this.ctx.state === 'suspended') return this.ctx.resume(); return Promise.resolve(); }
  duck(on) { if (!this.ok) return; this.ch.sfx.gain.setTargetAtTime(on ? 0.2 : this.vol('sfx'), this.ctx.currentTime, 0.1); this.ch.ambience.gain.setTargetAtTime(on ? 0.15 : this.vol('ambience'), this.ctx.currentTime, 0.1); }
  vol(k) { const v = this.game.settings.vol; return (v[k] !== undefined ? v[k] : 1); }
  applyVolumes() {
    if (!this.ok) return;
    const v = this.game.settings.vol, t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(v.master, t, 0.05);
    for (const k in this.ch) this.ch[k].gain.setTargetAtTime(v[k], t, 0.05);
    // mono: collapse every source to the center
    this.master.channelCount = this.game.settings.mono ? 1 : 2;
    this.master.channelCountMode = this.game.settings.mono ? 'explicit' : 'max';
  }
  /* ---------------------------------------------------------------- buffers */
  makeNoise(sec, type) {
    const c = this.ctx, n = c.sampleRate * sec, b = c.createBuffer(1, n, c.sampleRate), d = b.getChannelData(0);
    let last = 0, b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < n; i++) {
      const w = Math.random() * 2 - 1;
      if (type === 'brown') { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; }
      else if (type === 'pink') { b0 = 0.99765 * b0 + w * 0.099; b1 = 0.963 * b1 + w * 0.2965; b2 = 0.57 * b2 + w * 1.0527; d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.2; }
      else d[i] = w;
    }
    return b;
  }
  /* stereo impulse response: early reflections off nearby facades, then a decaying tail that darkens over time */
  makeIR(sec, decay) {
    const c = this.ctx, sr = c.sampleRate, n = Math.floor(sr * sec), b = c.createBuffer(2, n, sr);
    for (let ch = 0; ch < 2; ch++) {
      const d = b.getChannelData(ch); let y = 0;
      const pre = Math.floor(sr * 0.012);
      for (let i = pre; i < n; i++) {
        const u = (i - pre) / (n - pre);
        const a = 0.85 - 0.75 * u;                        // one-pole lowpass closing over the tail
        y += a * ((Math.random() * 2 - 1) - y);
        d[i] = y * Math.pow(1 - u, decay);
      }
      for (let k = 0; k < 6; k++) { const i = pre + Math.floor(sr * (0.018 + Math.random() * 0.07)); if (i < n) d[i] += (Math.random() < 0.5 ? -1 : 1) * (0.5 - k * 0.06); }
    }
    return b;
  }
  makeShaper(k) {
    const n = 1024, curve = new Float32Array(n), norm = Math.tanh(k);
    for (let i = 0; i < n; i++) { const x = i / (n - 1) * 2 - 1; curve[i] = Math.tanh(k * x) / norm; }
    return curve;
  }
  /* Karplus-Strong plucked string: a noise burst circulating in a damped delay line */
  makePluck(freq, sec, damp) {
    const c = this.ctx, sr = c.sampleRate, n = Math.floor(sr * sec), N = Math.max(2, Math.round(sr / freq));
    const b = c.createBuffer(1, n, sr), d = b.getChannelData(0), ring = new Float32Array(N);
    let prev = 0;
    for (let i = 0; i < N; i++) { const w = Math.random() * 2 - 1; prev = prev * 0.4 + w * 0.6; ring[i] = prev; }   // softened excitation
    let idx = 0, peak = 1e-6;
    for (let i = 0; i < n; i++) {
      const a = ring[idx], nx = ring[(idx + 1) % N];
      ring[idx] = (a + nx) * 0.5 * damp;
      d[i] = a; peak = Math.max(peak, Math.abs(a));
      idx = (idx + 1) % N;
    }
    const fade = Math.floor(sr * 0.05);
    for (let i = 0; i < n; i++) { d[i] /= peak; if (i > n - fade) d[i] *= (n - i) / fade; }
    return b;
  }
  /* ---------------------------------------------------------------- loops */
  loopNoise(buf, ftype, freq, q, ch) {
    const c = this.ctx, s = c.createBufferSource(); s.buffer = buf; s.loop = true;
    const f = c.createBiquadFilter(); f.type = ftype; f.frequency.value = freq; f.Q.value = q;
    const g = c.createGain(); g.gain.value = 0;
    s.connect(f); f.connect(g); g.connect(this.ch[ch]); s.start(0, Math.random() * buf.duration);
    return { s, f, g };
  }
  loopOsc(types, freqs, ftype, freq, q, ch) {
    const c = this.ctx, f = c.createBiquadFilter(); f.type = ftype; f.frequency.value = freq; f.Q.value = q;
    const g = c.createGain(); g.gain.value = 0; f.connect(g); g.connect(this.ch[ch]);
    const oscs = types.map((t, i) => { const o = c.createOscillator(); o.type = t; o.frequency.value = freqs[i]; o.connect(f); o.start(); return o; });
    return { oscs, f, g };
  }
  /* low-frequency modulator added onto an AudioParam (depth set per frame) */
  lfo(type, rate, param) {
    const c = this.ctx, o = c.createOscillator(); o.type = type; o.frequency.value = rate;
    const depth = c.createGain(); depth.gain.value = 0; o.connect(depth); depth.connect(param); o.start();
    return { o, depth };
  }
  set(p, v, tc) { if (this.ok) p.setTargetAtTime(v, this.ctx.currentTime, tc || 0.08); }
  /* per-frame continuous layers */
  update(dt) {
    if (!this.ok) return;
    this.t += dt;
    const g = this.game, h = g.hero && g.hero.ctrl; if (!h) return;
    const S = TL.TS, st = h.state;
    const sp = h.vel.length(), paused = g.state !== 'play';
    const k = paused ? 0 : 1;
    const motion=h.feedback,flow=motion?motion.energy:TL.clamp((sp-7)/55,0,1);
    const windGain=(g.settings.windLevel??.7)*k;
    const charge=st===S.SLING&&h.sling?TL.clamp(h.sling.pull/8,0,1):st===S.LAUNCH&&h.launch&&h.launch.arrived?.7:0;
    this.set(this.launchStrain.g.gain,paused?0:charge*.11,.035);
    this.set(this.launchStrain.f.frequency,500+charge*1700,.06);
    this.set(this.wind.g.gain, (.006*TL.clamp(sp/6,0,1)+flow*.22+Math.max(0,motion?motion.accel:0)*.025)*windGain);
    this.set(this.wind.f.frequency, 260 + flow * 1100);
    this.set(this.windHi.g.gain, flow*flow*.065*windGain);
    // suit flutter while airborne: faster and harder in a dive
    const an = g.hero.anim;
    const air = st === S.AIR || st === S.DIVE || st === S.GLIDE || st === S.SWING;
    const flap = air ? TL.clamp((sp - 14) / 45, 0, 1) * (1 + 0.6 * (an ? an.fall : 0)) : 0;
    const fb = flap * 0.11 * k;
    this.set(this.flap.g.gain, fb, 0.1); this.set(this.flapLfo.depth.gain, fb * 0.8, 0.1);
    this.set(this.flapLfo.o.frequency, 5 + sp * 0.32, 0.2);
    this.set(this.flap.f.frequency, 160 + sp * 3, 0.2);
    // rope strain: creak rate and pitch follow the load
    const r = h.tether.main, tn = r.attached ? TL.clamp((r.tension / TL.C.G - 0.8) / 3, 0, 1) : 0;
    const rb = tn * 0.07 * k;
    this.set(this.rope.g.gain, rb, 0.04); this.set(this.ropeLfo.depth.gain, rb * 0.8, 0.04);
    this.set(this.ropeLfo.o.frequency, 7 + tn * 20, 0.1);
    this.set(this.rope.f.frequency, 380 + tn * 900, 0.06);
    this.set(this.ropeHum.g.gain, tn * 0.035 * k, 0.06);
    this.set(this.ropeHum.oscs[0].frequency, 55 + tn * 30, 0.1); this.set(this.ropeHum.oscs[1].frequency, (55 + tn * 30) * 1.5, 0.1);
    // swing pass-by: a whoosh as the body sweeps through the bottom of the arc
    this.swooshCD -= dt;
    if (!paused && st === S.SWING && this.prevVy < 0 && h.vel.y >= 0 && sp > 12 && this.swooshCD <= 0) { this.sfx('swoosh', sp); this.swooshCD = 0.45; }
    this.prevVy = h.vel.y;
    // footsteps from the animator's foot plants (ground run / wall run)
    if (an) {
      if (an !== this.lastAnim) { this.lastAnim = an; this.lastSteps = an.steps; }
      if (an.steps !== this.lastSteps) { this.lastSteps = an.steps; if (!paused) this.sfx('step', an.stepSpeed, { surf: an.stepSurf }); }
    }
    const alt = h.pos.y;
    this.set(this.traffic.g.gain, TL.clamp(this.trafficLevel * (1 - alt / 150), 0, 0.35) * k);
    this.set(this.city.g.gain, TL.clamp(0.12 - alt / 2000, 0.03, 0.12) * k);
    this.set(this.rainL.g.gain, (g.env ? g.env.rain : 0) * 0.35 * k);
    // sirens: wobbling tone when emergency vehicles are near
    this.set(this.siren.g.gain, this.sirenLevel * 0.06 * k);
    this.set(this.siren.oscs[0].frequency, 650 + Math.sin(this.t * 5) * 180);
    // adaptive music: calm pad while traversing, driven pulse in combat, arpeggio builds with speed
    this.combat = TL.damp(this.combat, g.ai && g.ai.inCombat ? 1 : 0, 1.2, dt);
    this.chordT -= dt;
    if (this.chordT <= 0) {
      this.chordT = 4.8;
      this.chord = (this.chord + 1) % this.chords.length;
      const ch = this.chords[this.chord];
      ch.pad.forEach((f, i) => { this.set(this.pad.oscs[i * 2].frequency, f * (i === 2 ? 0.997 : 0.996), 0.5); this.set(this.pad.oscs[i * 2 + 1].frequency, f * (i === 2 ? 1.003 : 1.004), 0.5); });
      this.set(this.pad2.oscs[0].frequency, ch.bass, 0.5); this.set(this.pad2.oscs[1].frequency, ch.bass * 1.5, 0.5);
    }
    const speedMood = TL.clamp(sp / 50, 0, 1);
    this.set(this.pad.g.gain, (0.016 + 0.014 * speedMood + 0.03 * this.combat) * k, 0.6);
    this.set(this.pad.f.frequency, 420 + 700 * speedMood + 1100 * this.combat, 0.4);
    this.set(this.pad2.g.gain, (0.025 + 0.05 * this.combat * (0.5 + 0.5 * Math.sin(this.t * 9.4))) * k, 0.05);
    this.arpT -= dt;
    if (this.arpT <= 0) {
      this.arpT = Math.max(0, this.arpT) + 0.27;
      const drive = TL.clamp((sp - 18) / 35, 0, 1) * (1 - this.combat);
      if (drive > 0.05 && !paused) {
        const pat = [0, 1, 2, 1, 0, 2, 1, 2], pad = this.chords[this.chord].pad;
        const f = pad[pat[this.arpI++ % pat.length]] * 2;
        this.note(f, 0.03 * drive);
      }
    }
  }
  /* soft mallet note for the arpeggio (music bus, reverb via the music send) */
  note(f, peak) {
    const c = this.ctx, t = c.currentTime;
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2400;
    for (const [w, m, a] of [['triangle', 1, 1], ['sine', 2, 0.35]]) {
      const o = c.createOscillator(); o.type = w; o.frequency.value = f * m;
      const og = c.createGain(); og.gain.value = a; o.connect(og); og.connect(lp); o.start(t); o.stop(t + 0.6);
    }
    lp.connect(g); g.connect(this.ch.music);
  }
  /* one-shot synthesis. a: intensity / speed / rope length (per sound); o: { pan, surf } */
  sfx(name, a, o) {
    if (!this.ok) return;
    o = o || {};
    const c = this.ctx, t = c.currentTime;
    let out = this.ch[name === 'ui' || name === 'hover' ? 'ui' : 'sfx'];
    if (o.pan && c.createStereoPanner) { const p = c.createStereoPanner(); p.pan.value = TL.clamp(o.pan, -1, 1); p.connect(out); out = p; }
    const rnd = (k) => 1 + (Math.random() * 2 - 1) * k;
    const env = (g, peak, att, dec, t0) => { const s = t + t0; g.gain.setValueAtTime(0.0001, s); g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), s + att); g.gain.exponentialRampToValueAtTime(0.0001, s + att + dec); };
    // route: optional saturation, then the channel (or panner) plus an optional extra reverb send
    const route = (node, p) => {
      let n = node;
      if (p.sh) { const w = c.createWaveShaper(); w.curve = this.shaper; n.connect(w); n = w; }
      let destination=p.out||out;
      if(p.pan&&c.createStereoPanner){const pan=c.createStereoPanner();pan.pan.value=p.pan;pan.connect(destination);destination=pan;}
      n.connect(destination);
      if (p.verb) { const s = c.createGain(); s.gain.value = p.verb; n.connect(s); s.connect(this.verbIn); }
    };
    const noise = (ftype, f0, f1, q, dur, peak, p) => {
      p = p || {}; const t0 = p.t0 || 0, att = p.att || 0.004;
      const s = c.createBufferSource(); s.buffer = p.buf || this.noise;
      const f = c.createBiquadFilter(); f.type = ftype; f.Q.value = q;
      f.frequency.setValueAtTime(f0, t + t0); if (f1 !== f0) f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + t0 + att + dur);
      const g = c.createGain(); env(g, peak, att, dur, t0);
      s.connect(f); f.connect(g); route(g, p);
      const room = s.buffer.duration - (att + dur) - 0.1;
      s.start(t + t0, room > 0 ? Math.random() * room : 0); s.stop(t + t0 + att + dur + 0.05);
    };
    const tone = (type, f0, f1, dur, peak, p) => {
      p = p || {}; const t0 = p.t0 || 0, att = p.att || 0.004;
      const osc = c.createOscillator(); osc.type = type; osc.frequency.setValueAtTime(f0, t + t0); if (f1 !== f0) osc.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + t0 + att + dur);
      const g = c.createGain(); env(g, peak, att, dur, t0);
      if (p.lp) { const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = p.lp; osc.connect(f); f.connect(g); } else osc.connect(g);
      route(g, p); osc.start(t + t0); osc.stop(t + t0 + att + dur + 0.05);
    };
    const pluck = (buf, rate, peak, p) => {
      p = p || {}; const t0 = p.t0 || 0, dur = Math.min(p.dur || 9, buf.duration / rate);
      const s = c.createBufferSource(); s.buffer = buf; s.playbackRate.value = rate;
      const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = p.lp || 3000;
      const g = c.createGain(); g.gain.setValueAtTime(peak, t + t0); g.gain.exponentialRampToValueAtTime(0.0001, t + t0 + dur);
      s.connect(f); f.connect(g); route(g, p); s.start(t + t0); s.stop(t + t0 + dur + 0.05);
    };
    const ring = (f, partials, dur, peak, p) => partials.forEach((m, i) => tone('sine', f * m, f * m * 0.998, dur * (1 - i * 0.18), peak / (1 + i * 0.8), p));
    const debris = (n, spread, peak, p) => { for (let i = 0; i < n; i++) { const f = 1800 + Math.random() * 4200; noise('bandpass', f, f * 0.8, 3, 0.02 + Math.random() * 0.03, peak * (0.3 + Math.random() * 0.7), Object.assign({}, p, { t0: 0.04 + Math.random() * spread })); } };
    const cap = (txt) => this.game.ui && this.game.ui.caption(txt);
    switch (name) {
      case 'zippull':
        pluck(this.twangLo,.85,.22,{dur:.24,lp:2600});
        noise('bandpass',2200,450,2,.22,.17,{att:.025});
        break;
      case 'nearmiss': noise('bandpass',1500,480,.65,.23,.08+TL.clamp(a||0,0,1)*.05,{att:.03,buf:this.pink}); break;
      case 'pointcatch':
        // Two palms meet stone, then a short cloth scrape under compression.
        noise('bandpass',1400,480,1.2,.065,.22,{pan:-.25});
        noise('bandpass',1100,400,1.1,.065,.19,{pan:.25,t0:.018});
        tone('sine',150,65,.09,.16);
        noise('highpass',2600,1500,.7,.15,.05,{t0:.025});
        break;
      case 'pointpush': {
        const power=a||1;
        pluck(this.twangHi,1.3,.2,{dur:.2,lp:4800});
        noise('highpass',5200,2800,.7,.04,.23);
        tone('sine',115,38,.19,.32*power,{sh:true});
        noise('bandpass',320,2800,.8,.28,.3*power,{att:.018,verb:.1});
        noise('lowpass',2100,280,.8,.52,.13,{t0:.06,buf:this.pink});
        if(o.perfect){tone('sine',1046,1568,.17,.055,{t0:.065,verb:.18});cap('[perfect point launch]');}
        else cap('[launch whoosh]');
        break;
      }
      case 'thwip': {
        // Small dry click -> rounded descending "thwip" -> fine silk hiss.
        // Short and quiet enough that repeated shots do not mask traversal.
        const r = rnd(0.045);
        noise('highpass', 4800, 3800, .7, .008, .075);
        noise('bandpass', 3400*r, 750*r, 2.6, .085, .25, {att:.003,verb:.025});
        tone('sine', 1450*r, 390*r, .052, .035);
        noise('bandpass', 4200*r, 1900*r, 1.4, .13, .04, {t0:.025,att:.009});
        break;
      }
      case 'attach': {
        // the line bites (short sticky thock) then goes taut: plucked twang pitched by rope length
        const L = a || 20;
        noise('lowpass', 1600, 300, 0.8, 0.06, 0.14);
        tone('sine', 240, 110, 0.06, 0.08);
        pluck(this.twangLo, TL.clamp(22 / L, 0.55, 1.5) * rnd(0.05), 0.2, { t0: 0.02, lp: 2200, verb: 0.2 });
        break;
      }
      case 'release': {
        const k = TL.clamp((a || 15) / 30, 0.3, 1);
        noise('highpass', 2500, 5500, 0.7, 0.05, 0.09);
        pluck(this.twangHi, 1.6 * rnd(0.1), 0.06, { lp: 4000, dur: 0.3 });
        noise('bandpass', 700, 380, 1.2, 0.18, 0.06 * k, { buf: this.pink });
        break;
      }
      case 'boost': noise('bandpass', 300, 2600, 1.2, 0.36, 0.2, { att: 0.07, verb: 0.15 }); tone('sine', 70, 140, 0.3, 0.16, { att: 0.03 }); break;
      case 'sling':
        pluck(this.twangLo, 0.62, 0.38, { lp: 1800, verb: 0.3 });
        noise('bandpass', 250, 3000, 1, 0.5, 0.24, { att: 0.05 }); tone('triangle', 110, 440, 0.3, 0.06);
        cap('[slingshot launch]'); break;
      case 'swoosh': {
        // pass-by at the bottom of the arc: filter sweeps up then down while the image pans across
        const k = TL.clamp(((a || 20) - 12) / 40, 0.15, 1), d = 0.8;
        let dst = out;
        if (c.createStereoPanner) { const p = c.createStereoPanner(); p.pan.setValueAtTime(-0.45, t); p.pan.linearRampToValueAtTime(0.45, t + d); p.connect(out); dst = p; }
        for (const [buf, ftype, lo, hi, q, pk] of [[this.noise, 'bandpass', 380, 1500 + k * 900, 1.1, 0.2], [this.brown, 'lowpass', 180, 420, 0.7, 0.26]]) {
          const s = c.createBufferSource(); s.buffer = buf;
          const f = c.createBiquadFilter(); f.type = ftype; f.Q.value = q;
          f.frequency.setValueAtTime(lo, t); f.frequency.exponentialRampToValueAtTime(hi, t + d * 0.4); f.frequency.exponentialRampToValueAtTime(lo * 1.2, t + d);
          const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(pk * k, t + d * 0.38); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
          s.connect(f); f.connect(g); g.connect(dst);
          s.start(t, Math.random() * (buf.duration - d - 0.1)); s.stop(t + d + 0.05);
        }
        break;
      }
      case 'step': {
        const k = TL.clamp((a || 5) / 12, 0.25, 1), r = rnd(0.15);
        if (o.surf === 'wall') { noise('bandpass', 2300 * r, 1500, 2, 0.045, 0.12 * k); noise('bandpass', 3000, 2000, 0.8, 0.08, 0.025 * k, { t0: 0.01 }); }
        else { noise('bandpass', 1400 * r, 700, 1.3, 0.045, 0.16 * k); tone('sine', 120 * r, 60, 0.05, 0.12 * k); noise('highpass', 4200, 4200, 0.7, 0.025, 0.02 * k); }
        break;
      }
      case 'land': {
        const i = TL.clamp((a || 10) / 35, 0.15, 1);
        tone('sine', 110, 42, 0.2, 0.38 * i, { sh: true });
        noise('bandpass', 1300, 500, 1, 0.06, 0.26 * i);
        noise('highpass', 3500, 3500, 0.7, 0.14, 0.05 * i);
        if (i > 0.5) debris(4, 0.25, 0.04 * i);
        break;
      }
      case 'plant': {
        // palm meets stone: a dry slap with a little cloth on the push
        const k = TL.clamp(a || 0.8, 0.3, 1.2);
        noise('bandpass', 1700 * rnd(0.1), 650, 1.3, 0.05, 0.16 * k);
        tone('sine', 170, 85, 0.05, 0.07 * k);
        noise('highpass', 3000, 2200, 0.8, 0.09, 0.025 * k, { t0: 0.03 });
        break;
      }
      case 'roll': {
        // shoulder roll over a hard roof: two cloth scuffs and a soft body thump
        noise('bandpass', 900, 500, 1.1, 0.12, 0.09, { att: 0.02 });
        tone('sine', 95, 50, 0.12, 0.12, { t0: 0.09 });
        noise('bandpass', 1200, 700, 1.2, 0.16, 0.07, { t0: 0.2, att: 0.03 });
        break;
      }
      case 'catchload': {
        // the line takes the full weight: a low, short creak — never louder than the thwip
        const k = TL.clamp(a || 0.3, 0.15, 0.6);
        pluck(this.twangLo, 0.62 * rnd(0.05), 0.11 * k / 0.4, { lp: 1500, dur: 0.28 });
        noise('bandpass', 420, 300, 4, 0.16, 0.05 * k / 0.4, { att: 0.03 });
        break;
      }
      case 'impact': {
        const i = TL.clamp((a || 30) / 45, 0.45, 1);
        tone('sine', 78, 26, 0.7, 0.6 * i, { sh: true, verb: 0.2 });
        noise('lowpass', 3200, 150, 0.8, 0.45, 0.4 * i, { verb: 0.35 });
        noise('bandpass', 900, 300, 1, 0.12, 0.25 * i);
        debris(8, 0.55, 0.06 * i, { verb: 0.2 });
        cap('[heavy impact]'); break;
      }
      case 'wallgrab': noise('bandpass', 1100, 600, 3, 0.05, 0.2); noise('bandpass', 2800, 1800, 1, 0.08, 0.03, { t0: 0.01 }); tone('sine', 180, 90, 0.05, 0.05); break;
      case 'punch': {
        const r = rnd(0.1);
        noise('bandpass', 700, 2000, 1.2, 0.06, 0.06);
        tone('sine', 160 * r, 50, 0.15, 0.42, { t0: 0.01, sh: true });
        noise('bandpass', 1900 * r, 900, 1.3, 0.045, 0.3, { t0: 0.01 });
        noise('lowpass', 900, 200, 0.7, 0.12, 0.16, { t0: 0.01, verb: 0.1 });
        break;
      }
      case 'hit': tone('sine', 140, 55, 0.14, 0.3, { sh: true }); noise('bandpass', 1400, 500, 1.5, 0.1, 0.24); tone('square', 220, 80, 0.06, 0.035, { lp: 1500 }); break;
      case 'heavyhit': {
        const r = rnd(0.08);
        tone('sine', 95 * r, 30, 0.4, 0.5, { sh: true, verb: 0.2 });
        noise('bandpass', 1600 * r, 600, 1.2, 0.07, 0.34);
        noise('lowpass', 3500, 180, 0.8, 0.3, 0.3, { verb: 0.3 });
        debris(3, 0.2, 0.04);
        break;
      }
      case 'parry': noise('highpass', 5000, 5000, 0.7, 0.01, 0.2); ring(900 * rnd(0.03), [1, 2.76, 5.4, 8.93], 0.7, 0.14, { verb: 0.4 }); cap('[parry]'); break;
      case 'dodge': noise('bandpass', 500, 2200, 1.1, 0.2, 0.26, { att: 0.05, verb: 0.08 }); break;
      case 'perfect': tone('sine', 880, 880, 0.7, 0.07, { verb: 0.5 }); tone('sine', 1318.5, 1318.5, 0.6, 0.045, { verb: 0.5 }); noise('bandpass', 3000, 800, 1, 0.4, 0.07, { att: 0.05 }); break;
      case 'splash': {
        const k = a || 1;
        noise('lowpass', 2500, 300, 0.8, 0.6, 0.35 * k, { verb: 0.15 });
        noise('highpass', 2000, 2000, 0.7, 0.8, 0.1 * k, { att: 0.03 });
        for (let i = 0; i < 7; i++) { const f = 400 + Math.random() * 600; tone('sine', f, f * 1.4, 0.05, 0.035 * k, { t0: 0.08 + Math.random() * 0.45 }); }
        cap('[splash]'); break;
      }
      case 'wingsnap': {   // the web wing snapping open: cloth crack + air thump, then the glide whoosh settles in
        const k = TL.clamp((a || 5) / 6, 0.6, 1.4);
        noise('bandpass', 2400, 600, 1.1, 0.14, 0.5 * k, { att: 0.002 });
        noise('highpass', 3500, 3500, 0.6, 0.3, 0.07 * k, { att: 0.04 });
        noise('lowpass', 900, 160, 0.8, 0.5, 0.32 * k, { att: 0.01, buf: this.brown });
        tone('sine', 120, 42, 0.28, 0.22 * k);
        noise('bandpass', 500, 1100, 1.2, 0.5, 0.18, { t0: 0.12, att: 0.1 });
        cap('[wings snap open]'); break;
      }
      case 'glide': noise('bandpass', 500, 1100, 1.2, 0.08, 0.32); noise('bandpass', 350, 250, 0.9, 0.35, 0.09, { att: 0.04, buf: this.pink }); tone('sine', 130, 70, 0.12, 0.09); break;
      case 'scan': tone('sine', 520, 1040, 0.8, 0.12, { verb: 0.5 }); tone('sine', 780, 1560, 0.6, 0.06, { verb: 0.5 }); cap('[scan pulse]'); break;
      case 'zap': tone('square', 1200, 200, 0.18, 0.06, { lp: 4000 }); for (let i = 0; i < 5; i++) noise('highpass', 4000, 6000, 0.7, 0.015, 0.1, { t0: Math.random() * 0.15 }); break;
      case 'clank': ring(520 * rnd(0.1), [1, 2.3, 3.9], 0.28, 0.1, { verb: 0.15 }); noise('bandpass', 2500, 1500, 3, 0.05, 0.1); break;
      case 'ability': tone('sawtooth', 200, 800, 0.4, 0.08, { lp: 3000, verb: 0.3 }); noise('bandpass', 800, 3000, 2, 0.4, 0.12, { verb: 0.2 }); break;
      case 'ultimate': tone('sawtooth', 80, 640, 1.2, 0.16, { lp: 2500, verb: 0.5 }); tone('sine', 45, 90, 1.2, 0.3, { sh: true }); noise('lowpass', 200, 4000, 0.8, 1.2, 0.2, { verb: 0.4 }); cap('[ultimate]'); break;
      case 'gun': noise('highpass', 1500, 1500, 0.7, 0.03, 0.34); noise('lowpass', 4000, 250, 0.8, 0.16, 0.28, { verb: 0.45 }); tone('square', 140, 55, 0.06, 0.07, { lp: 1200 }); cap('[gunfire]'); break;
      case 'laser': tone('sawtooth', 1800, 300, 0.2, 0.07, { lp: 5000, verb: 0.25 }); break;
      case 'alert': tone('square', 600, 600, 0.12, 0.08); setTimeout(() => this.ok && this.sfx('alert2'), 150); cap('[alarm]'); break;
      case 'alert2': tone('square', 800, 800, 0.12, 0.08); break;
      case 'switch': noise('bandpass', 200, 4000, 1, 1.2, 0.12, { verb: 0.4 }); break;
      case 'ui': tone('sine', 900, 1200, 0.05, 0.06); break;
      case 'hover': tone('sine', 1400, 1400, 0.02, 0.02); break;
      case 'reward': [523, 659, 784].forEach((f, i) => tone('triangle', f, f, 0.25, 0.08, { t0: i * 0.09, verb: 0.3 })); break;
      case 'fail': tone('sawtooth', 300, 120, 0.6, 0.08, { lp: 1800 }); break;
      case 'explode':
        tone('sine', 65, 22, 1.3, 0.6, { sh: true, verb: 0.3 });
        noise('lowpass', 1500, 60, 0.8, 1.4, 0.48, { verb: 0.6 });
        debris(10, 1.0, 0.07, { verb: 0.3 });
        cap('[explosion]'); break;
      case 'horn': tone('sawtooth', 330, 330, 0.3, 0.05, { lp: 1400 }); tone('sawtooth', 415, 415, 0.3, 0.04, { lp: 1400 }); break;
    }
  }
};
