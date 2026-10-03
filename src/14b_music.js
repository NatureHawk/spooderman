/* =====================================================================================
   MusicPlayer — plays the user's soundtrack (every .mp3 in music/, embedded by tools/build.js as
   <script class="tl-music" data-name=...> base64) while the game runs. Tracks play in order and loop.
   The track has its own gain straight to the output (no glue compressor, no city reverb), so only
   Master x Music volume affect it — SFX / Ambience / UI sliders never touch it. While the playlist
   is on, the procedural adaptive pads/arpeggio in 14_audio.js are silenced so the two don't clash.
   Settings: s.musicTrack (on/off), s.vol.music (slider). Paused/menus duck the track.
   ===================================================================================== */
'use strict';

/* decoded once per page: [{ name, url }] (blob URLs, so WebAudio can tap the element without CORS taint) */
TL.musicTracks = function () {
  if (TL._musicTracks) return TL._musicTracks;
  const out = TL._musicTracks = [];
  for (const el of document.querySelectorAll('script.tl-music')) {
    try {
      const bin = atob(el.textContent.trim()), u8 = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      const raw = el.dataset.name || 'Track ' + (out.length + 1);
      const name = raw.replace(/\.mp3$/i, '').replace(/\s*\[[A-Za-z0-9_-]{6,}\]\s*$/, '').replace(/\s+_\s+/g, ' — ').trim();
      out.push({ name, url: URL.createObjectURL(new Blob([u8], { type: 'audio/mpeg' })) });
      el.remove();   // drop the ~1.3x base64 copy now that the blob holds the bytes
    } catch (e) { TL.logError(e, 'music-decode'); }
  }
  return out;
};

TL.MusicPlayer = class {
  constructor(audio) {
    this.audio = audio; this.tracks = TL.musicTracks(); this.i = 0; this.duckK = 1; this.wantPlay = false; this.el = null;
    if (!this.tracks.length || !audio.ctx) return;
    const c = audio.ctx, el = this.el = new Audio();
    el.preload = 'auto'; el.src = this.tracks[0].url;
    el.addEventListener('ended', () => this.next(true));
    this.src = c.createMediaElementSource(el);
    this.gain = c.createGain(); this.gain.gain.value = 0;
    this.src.connect(this.gain); this.gain.connect(c.destination);
    // autoplay can be refused if the start click is too far back: retry on the next input
    this.retry = () => { if (this.wantPlay && el.paused) this.play(); };
    for (const ev of ['pointerdown', 'keydown']) window.addEventListener(ev, this.retry, true);
    this.apply();
  }
  get ok() { return !!this.el; }
  get enabled() { const s = this.audio.game.settings; return s.musicTrack !== false; }
  get active() { return this.ok && this.enabled; }
  level() { const v = this.audio.game.settings.vol; return (v.master ?? 1) * (v.music ?? 1) * this.duckK; }
  apply() {
    if (!this.ok) return;
    const c = this.audio.ctx, mono = !!this.audio.game.settings.mono;
    this.gain.gain.setTargetAtTime(this.enabled ? this.level() : 0, c.currentTime, 0.12);
    this.gain.channelCount = mono ? 1 : 2; this.gain.channelCountMode = mono ? 'explicit' : 'max';
  }
  play() {
    if (!this.ok) return;
    this.wantPlay = true;
    if (!this.enabled || !this.el.paused) return;
    this.audio.resume();
    const p = this.el.play();
    if (p && p.then) p.then(() => this.announce()).catch(() => {});
  }
  stop() { if (!this.ok) return; this.wantPlay = false; this.el.pause(); }
  setEnabled(on) {
    this.audio.game.settings.musicTrack = !!on; this.apply();
    if (on) { if (this.wantPlay || this.audio.game.state === 'play' || this.audio.game.state === 'paused') this.play(); }
    else { const w = this.wantPlay; this.el && this.el.pause(); this.wantPlay = w; }
  }
  next(auto) {
    if (!this.ok) return;
    this.i = (this.i + 1) % this.tracks.length;
    if (this.tracks.length > 1 || !auto) { this.el.src = this.tracks[this.i].url; this._said = false; }
    else this.el.currentTime = 0;
    if (this.wantPlay && this.enabled) this.play();
  }
  announce() {
    if (this._said) return; this._said = true;
    const ui = this.audio.game.ui; if (ui && ui.toast) ui.toast('♪ ' + this.tracks[this.i].name);
  }
  duck(on) { this.duckK = on ? 0.4 : 1; this.apply(); }
};

/* hook into the existing AudioManager without touching its graph */
{
  const P = TL.AudioManager.prototype;
  const init = P.init, applyVolumes = P.applyVolumes, update = P.update, duck = P.duck, note = P.note;
  P.init = function () {
    init.call(this);
    if (this.ok && !this.music) { try { this.music = new TL.MusicPlayer(this); } catch (e) { TL.logError(e, 'music'); } }
  };
  P.applyVolumes = function () { applyVolumes.call(this); if (this.music) this.music.apply(); };
  P.duck = function (on) { duck.call(this, on); if (this.music) this.music.duck(on); };
  P.note = function (f, peak) { if (this.music && this.music.active) return; return note.call(this, f, peak); };
  P.update = function (dt) {
    update.call(this, dt);
    if (!this.ok || !this.music || !this.music.active) return;
    // playlist replaces the procedural score
    this.set(this.pad.g.gain, 0, 0.3); this.set(this.pad2.g.gain, 0, 0.3);
  };
  TL.bus.on('game:start', () => { const g = TL.game, a = g && g.audio; if (a && a.music) { a.music.duck(false); a.music.play(); } });
}
