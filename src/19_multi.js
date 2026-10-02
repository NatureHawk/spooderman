/* =====================================================================================
   Multiplayer (THREADLINE_multi.html only — built by tools/build_multi.js, not part of THREADLINE.html).
   The room creator's browser IS the server: every joiner opens one WebRTC peer connection to the host
   (star topology); the host relays each player's state to everyone else. The Vercel function
   /api/signal (hosting/threadline_multi/api/signal.js) is only used for the handshake.
   Each client simulates only its own hero; remote heroes are TL.Hero puppets whose controller state is
   written from interpolated network snapshots (rendered ~120 ms behind), animated by the normal
   HeroAnimator so swings, dives, wall runs and glides read exactly like the local hero.
   ===================================================================================== */
'use strict';

TL.NET = { MAX: 8, SEND_MS: 50, DELAY_MS: 120, EXTRAP_MS: 250, STALE_MS: 6000 };

TL.NetSignal = {
  endpoint() { return new URLSearchParams(location.search).get('signal') || TL.NET_ENDPOINT || '/api/signal'; },
  async call(body) {
    if (location.protocol === 'file:' && !new URLSearchParams(location.search).get('signal'))
      throw new Error('Multiplayer needs the page opened from its Vercel URL, not as a local file');
    let r;
    try { r = await fetch(this.endpoint(), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); }
    catch (e) { throw new Error('Signaling server unreachable'); }
    let j = null; try { j = await r.json(); } catch (e) { /* non-JSON error page */ }
    if (!r.ok) throw new Error((j && j.error) || ('signaling error ' + r.status));
    return j;
  },
};

TL.netIceDone = (pc, ms) => new Promise((res) => {
  if (pc.iceGatheringState === 'complete') { res(); return; }
  const t = setTimeout(res, ms);
  pc.addEventListener('icegatheringstatechange', () => { if (pc.iceGatheringState === 'complete') { clearTimeout(t); res(); } });
});
TL.netName = (s) => String(s || '').replace(/[^\w \-.]/g, '').trim().slice(0, 16) || 'Player';
// avoids the minimap's own colours (second hero cyan/orange, missions yellow, crimes red, activities blue)
TL.NET_COLORS = ['#ff6090', '#90ff60', '#b48cff', '#ff8040', '#f0f0f0', '#ff9ad0', '#c0ff40', '#7fe8ff'];

/* ------------------------------------------------------------------ remote player (puppet hero) */
TL.RemotePlayer = class {
  constructor(net, id, name) {
    this.net = net; this.id = id; this.name = name;
    this.buf = []; this.off = null; this.lastRecv = TL.now();
    this.hero = null; this.safeT = 0; this.errs = 0;
    this.evq = []; this.seen = new Set(); this.renderT = 0; this.lastSteps = 0; this.onScreen = false;
    this.tag = document.createElement('div'); this.tag.className = 'mp-tag';
    this.tagArrow = document.createElement('i'); this.tagArrow.textContent = '▲';
    this.tagName = document.createElement('b'); this.tagDist = document.createElement('span');
    this.tag.append(this.tagArrow, this.tagName, this.tagDist); this.tagName.textContent = name;
    this.setColor(net.colorOf(id));
    net.tagsEl().appendChild(this.tag);
    this._p = new THREE.Vector3(); this._v = new THREE.Vector3();
  }
  setName(n) { this.name = n; this.tagName.textContent = n; }
  setColor(c) { this.color = c; this.tag.style.borderColor = c; this.tagArrow.style.color = c; }
  push(m) {
    const now = TL.now(), off = now - m.ts;
    // sender clock -> local clock: the smallest observed offset, creeping up slowly so clock drift heals
    this.off = this.off === null ? off : Math.min(this.off + 0.05, off);
    this.lastRecv = now;
    // one-shot events ride on the next two snapshots (unreliable channel); dedupe by sequence number
    if (Array.isArray(m.ev)) for (const ev of m.ev) {
      if (!ev || typeof ev.q !== 'number' || this.seen.has(ev.q)) continue;
      this.seen.add(ev.q); this.evq.push(ev);
      if (this.seen.size > 256) this.seen.delete(this.seen.values().next().value);
    }
    if (this.evq.length > 64) this.evq.splice(0, this.evq.length - 64);
    const b = this.buf; let i = b.length;
    while (i > 0 && b[i - 1].ts > m.ts) i--;
    if (i > 0 && b[i - 1].ts === m.ts) return;
    b.splice(i, 0, m);
    if (b.length > 40) b.shift();
  }
  ensureHero(name) {
    const g = this.net.game;
    if (this.hero && this.hero.name === name) return this.hero;
    this.disposeHero();
    if (!g.world || !TL.HERO_STATS[name]) return null;
    const h = new TL.Hero(g, name);
    h.ctrl.frozen = true; h.ctrl.onEvent = null; h.remote = true;
    this.hero = h;
    return h;
  }
  disposeHero() {
    const h = this.hero; if (!h) return;
    const s = this.net.game.scene;
    try { h.anim.dispose(s); s.remove(h.sk.mesh); for (const r of h.ropes) { r.hide(); if (r.mesh) s.remove(r.mesh); } } catch (e) { TL.logError(e, 'net'); }
    this.hero = null;
  }
  dispose() { this.disposeHero(); this.tag.remove(); }
  /* sample the snapshot buffer at (now - delay) in the sender's clock */
  sample() {
    const b = this.buf; if (!b.length) return null;
    const t = this.renderT = TL.now() - this.off - TL.NET.DELAY_MS;
    let i = 0; while (i < b.length && b[i].ts <= t) i++;
    const P = this._p, V = this._v;
    if (i === 0) { const s = b[0]; P.set(s.x, s.y, s.z); V.set(s.vx, s.vy, s.vz); return { s, f: s.f }; }
    if (i >= b.length) {
      const s = b[b.length - 1], dt = Math.min(t - s.ts, TL.NET.EXTRAP_MS) / 1000;
      V.set(s.vx, s.vy, s.vz);
      // extrapolate only while airborne-ish; ground/wall players hold position
      const k = s.st === TL.TS.GROUND || s.st === TL.TS.PERCH || s.st === TL.TS.WALL || s.st === TL.TS.CRAWL ? 0 : dt;
      P.set(s.x + s.vx * k, s.y + s.vy * k, s.z + s.vz * k);
      if (b.length > 2) b.splice(0, b.length - 2);
      return { s, f: s.f };
    }
    const a = b[i - 1], c = b[i], k = TL.clamp((t - a.ts) / Math.max(1, c.ts - a.ts), 0, 1);
    P.set(TL.lerp(a.x, c.x, k), TL.lerp(a.y, c.y, k), TL.lerp(a.z, c.z, k));
    V.set(TL.lerp(a.vx, c.vx, k), TL.lerp(a.vy, c.vy, k), TL.lerp(a.vz, c.vz, k));
    if (i > 1) b.splice(0, i - 1);
    return { s: k < 0.5 ? a : c, f: a.f + TL.wrapAngle(c.f - a.f) * k };
  }
  update(dt) {
    const g = this.net.game;
    const stale = TL.now() - this.lastRecv > TL.NET.STALE_MS;
    const smp = stale ? null : this.sample();
    if (!smp) { if (this.hero) this.hero.setVisible(false); this.tag.style.display = 'none'; return; }
    const s = smp.s, h = this.ensureHero(s.h);
    if (!h) return;
    if (h.outfit !== s.o || h.palette !== s.p) h.setOutfit(s.o | 0, s.p | 0);
    const c = h.ctrl;
    c.pos.copy(this._p); c.prevPos.copy(this._p); c.vel.copy(this._v); c.facing = smp.f;
    // states whose animation needs simulation-only objects (launch/zip/sling/bridge) are shown as airborne
    const S = TL.TS;
    let st = s.st;
    if (this.safeT > 0 || st === S.LAUNCH || st === S.ZIP || st === S.SLING || st === S.BRIDGE || !st) st = S.AIR;
    this.safeT = Math.max(0, this.safeT - dt);
    const F = c.fsm;
    if (F.state !== st) { F.log.push({ from: F.state, to: st, reason: '' }); if (F.log.length > 40) F.log.shift(); F.prev = F.state; F.state = st; F.t = 0; }
    else F.t += dt;
    c.grounded = st === S.GROUND; c.inWater = !!s.w; c.recoverT = 0.4; c.singleHandSwing = !!s.sh; c.sprinting = !!s.sp;
    if (s.wn) c.wallN.set(s.wn[0], s.wn[1], s.wn[2]);
    c.wallMode = s.wm || 'up';
    c.glide.roll = s.gr || 0; c.glide.pitch = s.gp || 0;
    for (let i = 0; i < 2; i++) {
      const R = c.tether.ropes[i], q = s.r && s.r[i];
      R.bends.length = 0; R.bendLen = 0;
      if (!q) { R.active = false; R.attached = false; R.tension = 0; continue; }
      R.active = true; R.attached = q[0] === 1;
      R.anchor.set(q[1], q[2], q[3]); R.hand = q[4] ? 'R' : 'L'; R.tension = q[5];
      if (R.attached) { R.shotDur = 0; R.shotT = 0; } else { R.shotDur = 1; R.shotT = TL.clamp(q[6], 0, 1); }
      R.L = Math.max(R.minL, R.anchor.distanceTo(c.pos));
    }
    // one-shot events play when the delayed render time reaches them, so sound and pose line up with the body
    if (this.evq.length) {
      this.evq.sort((x, y) => x.ts - y.ts);
      let n = 0;
      while (n < this.evq.length && this.evq[n].ts <= this.renderT) {
        const ev = this.evq[n++];
        if (this.renderT - ev.ts < 1500) { try { this.playEvent(ev, h); } catch (e) { TL.logError(e, 'net-event'); } }
      }
      if (n) this.evq.splice(0, n);
    }
    const far = this._p.distanceToSquared(g.camera.position) > 1400 * 1400;
    h.setVisible(!far);
    if (!far) {
      try { h.renderUpdate(dt, 1); }
      catch (e) { if (this.errs++ < 3) TL.logError(e, 'net-remote'); this.safeT = 1; }
      const an = h.anim;   // footsteps from the animator's stride counter, like the local hero
      if (an.steps !== this.lastSteps) { this.lastSteps = an.steps; this.net.sfxAt(this._p, 'step', an.stepSpeed, { surf: an.stepSurf }); }
    }
    this.updateTag(g);
  }
  /* name tag over the head; when the player is off-screen it slides to the screen edge as an arrow */
  updateTag(g) {
    const head = this._p.clone(); head.y += 1.35;
    const d = head.distanceTo(g.camera.position);
    if (g.photoMode) { this.tag.style.display = 'none'; this.onScreen = false; return; }
    head.project(g.camera);
    const W = innerWidth, H = innerHeight, behind = head.z > 1;
    let x = head.x, y = head.y;
    if (behind) { x = -x; y = -y; }
    const inView = !behind && Math.abs(x) <= 1 && Math.abs(y) <= 1;
    this.onScreen = inView;
    this.tag.style.display = 'block';
    this.tagDist.textContent = d > 40 ? ' ' + Math.round(d) + 'm' : '';
    if (inView) {
      this.tag.classList.remove('edge');
      this.tag.style.transform = 'translate(' + ((x * 0.5 + 0.5) * W).toFixed(1) + 'px,' + ((-y * 0.5 + 0.5) * H).toFixed(1) + 'px) translate(-50%,-100%) scale(' + TL.clamp(30 / Math.max(d, 1), 0.65, 1).toFixed(2) + ')';
      return;
    }
    // edge arrow: push the direction out to the screen border (behind the camera reads as "below")
    let dx = x * W * 0.5, dy = -y * H * 0.5;
    if (behind && Math.abs(dx) < 1 && Math.abs(dy) < 1) dy = 1;
    if (behind) dy = Math.max(dy, Math.abs(dx) * 0.35);
    const m = 46, k = Math.min((W * 0.5 - m) / Math.max(Math.abs(dx), 1e-3), (H * 0.5 - m) / Math.max(Math.abs(dy), 1e-3));
    const sx = W * 0.5 + dx * k, sy = H * 0.5 + dy * k;
    this.tag.classList.add('edge');
    const ang = behind ? Math.atan2(Math.abs(dx) * 0.4 + H * 0.5, dx * 0.4) : Math.atan2(dy, dx);   // behind: point down, leaning to the side
    this.tagArrow.style.transform = 'rotate(' + (ang + Math.PI / 2).toFixed(3) + 'rad)';
    this.tag.style.transform = 'translate(' + sx.toFixed(1) + 'px,' + sy.toFixed(1) + 'px) translate(-50%,-50%)';
  }
  playEvent(ev, h) {
    const net = this.net, g = net.game, P = g.particles, p = this._p, d = ev.d, c = h.ctrl;
    const v = (a) => a ? new THREE.Vector3(a[0], a[1], a[2]) : null;
    switch (ev.e) {
      case 'webshot': {
        net.sfxAt(p, 'thwip', 1);
        const anchor = v(d && d.p); if (!anchor) break;
        if (c.singleHandSwing) h.anim.startWebShot({ hand: d.h, anchor }); else h.anim.startAction('shoot', 0.3, anchor, d.h === 'L' ? 1 : -1);
        break;
      }
      case 'attach': {
        const anchor = v(d && d.p);
        net.sfxAt(p, 'attach', d ? d.L : 20);
        if (anchor && P) P.burst(anchor, 10, 1, 6, 0.4, 0.25, [0.8, 0.9, 1]);
        h.ropes[0].pluck(0.6);
        break;
      }
      case 'release': net.sfxAt(p, 'release', d); break;
      case 'releaseboost': net.sfxAt(p, 'boost'); break;
      case 'launchboost': net.sfxAt(p, 'pointpush', d ? 1.15 : 1, { perfect: !!d }); if (P) P.launchBurst(p, this._v, d ? 1.2 : 1); break;
      case 'slingfire': net.sfxAt(p, 'pointpush', 1.1); break;
      case 'sling': case 'pointlaunch': net.sfxAt(p, 'thwip'); break;
      case 'zipgrip': net.sfxAt(p, 'attach', 16); h.ropes.forEach((r) => r.pluck(0.4)); break;
      case 'zippull': net.sfxAt(p, 'zippull'); break;
      case 'pointcatch': net.sfxAt(p, 'pointcatch'); break;
      case 'land': case 'hardland': {
        const kind = d.k || 'crouch', imp = +d.i || 0;
        c.landing = { kind, impact: imp, hs: +d.hs || 0, surf: d.s, t: 0, id: (c.landing ? c.landing.id : 0) + 1 };
        const feet = new THREE.Vector3(p.x, p.y - TL.C.FEET + 0.02, p.z), col = [0.6, 0.58, 0.55];
        switch (kind) {
          case 'gentle': if (imp > 9) net.sfxAt(p, 'land', imp * 0.6); break;
          case 'run': net.sfxAt(p, 'step', 9, { surf: 'ground' }); break;
          case 'narrow': net.sfxAt(p, 'land', imp * 0.45); break;
          case 'roll': net.sfxAt(p, 'land', imp * 0.7); net.sfxAt(p, 'roll', 1); if (P) P.burst(feet, 8, 1, 2.6, 0.45, 0.28, col, { up: 0.7, grav: 3 }); break;
          case 'heavy': net.sfxAt(p, 'impact', imp); if (P) P.burst(feet, 22, 1, 6, 0.7, 0.42, col, { up: 1.6, grav: 6 }); break;
          default: net.sfxAt(p, 'land', imp); if (P) P.burst(feet, imp > 15 ? 11 : 6, 1, 3.2, 0.5, 0.3, col, { up: 0.9, grav: 3 });
        }
        break;
      }
      case 'handplant': net.sfxAt(p, 'plant', d ? 1 : 0.75); break;
      case 'wall': net.sfxAt(p, 'wallgrab'); break;
      case 'wallimpact': net.sfxAt(p, 'impact', d); break;
      case 'glide': net.sfxAt(p, 'wingsnap', d); break;
      case 'splash': net.sfxAt(p, 'splash', 1); break;
      case 'skim': net.sfxAt(p, 'splash', 0.5); break;
    }
  }
};

/* ------------------------------------------------------------------ network session */
TL.Net = class {
  constructor(game) {
    this.game = game;
    this.role = null;                 // null | 'host' | 'joiner'
    this.room = null; this.myId = null; this.name = 'Player';
    this.peers = new Map();           // host: joinerId -> peer; joiner: 'host' -> peer
    this.players = new Map();         // id -> name (everyone in the room, including me)
    this.remotes = new Map();         // id -> TL.RemotePlayer
    this.ice = null; this.pendingHost = false; this.spawn = null;
    this.panelT = 0; this._timers = [];
    this.sendTimer = setInterval(() => this.sendState(), TL.NET.SEND_MS);
    addEventListener('pagehide', () => this.leave(true));
    TL.bus.on('game:start', () => this.onGameStart());
    try { this.name = TL.netName(localStorage.getItem('tl-mp-name') || ''); } catch (e) { /* storage blocked */ }
  }
  tagsEl() {
    let e = document.getElementById('mpTags');
    if (!e) { e = document.createElement('div'); e.id = 'mpTags'; document.body.appendChild(e); }
    return e;
  }
  panelEl() {
    let e = document.getElementById('mpPanel');
    if (!e) { e = document.createElement('div'); e.id = 'mpPanel'; document.body.appendChild(e); }
    return e;
  }
  toast(m) { if (this.game.ui) this.game.ui.toast(m); }
  inviteLink() { return location.origin + location.pathname + '?room=' + this.room; }
  /* join order is the same on every client (host first, then the welcome list + joins), so colours agree */
  colorOf(id) {
    const ids = [...this.players.keys()].filter((k) => k !== this.myId), i = ids.indexOf(id);
    if (i >= 0) return TL.NET_COLORS[i % TL.NET_COLORS.length];
    let hsh = 0; for (const ch of String(id)) hsh = (hsh * 31 + ch.charCodeAt(0)) | 0;
    return TL.NET_COLORS[Math.abs(hsh) % TL.NET_COLORS.length];
  }
  /* a one-shot sound at a world position: distance gain + air-absorption low-pass + stereo pan from the camera.
     The audio manager has no per-call gain, so its sfx bus and reverb send are swapped for this call only
     (sfx() builds its node graph synchronously). Captions are suppressed for other players' sounds. */
  sfxAt(pos, name, a, o) {
    const g = this.game, au = g.audio;
    if (!au || !au.ok || !au.ch || !au.ch.sfx || g.state !== 'play') return;
    const cam = g.camera, d = pos.distanceTo(cam.position), gain = 1 / (1 + (d / 14) * (d / 14));
    if (gain < 0.012) return;
    const c = au.ctx, dir = pos.clone().sub(cam.position).normalize();
    const right = this._right || (this._right = new THREE.Vector3());
    right.set(1, 0, 0).applyQuaternion(cam.quaternion);
    const pan = TL.clamp(dir.dot(right) * 0.85, -0.95, 0.95) || 0.001;
    const gS = c.createGain(), lp = c.createBiquadFilter(), gV = c.createGain();
    gS.gain.value = gain; lp.type = 'lowpass'; lp.frequency.value = TL.clamp(18000 / (1 + d / 20), 900, 18000);
    gV.gain.value = Math.sqrt(gain) * 0.8;                  // distant sounds keep relatively more room
    gS.connect(lp); lp.connect(au.ch.sfx);
    const sfx = au.ch.sfx, vin = au.verbIn, ui = g.ui, ownCap = ui && Object.prototype.hasOwnProperty.call(ui, 'caption');
    if (vin) gV.connect(vin);
    au.ch.sfx = gS; if (vin) au.verbIn = gV; if (ui) ui.caption = () => {};
    try { au.sfx(name, a, Object.assign({}, o, { pan })); }
    finally { au.ch.sfx = sfx; if (vin) au.verbIn = vin; if (ui && !ownCap) delete ui.caption; }
    setTimeout(() => { try { gS.disconnect(); lp.disconnect(); gV.disconnect(); } catch (e) { /* gone */ } }, 5000);
  }
  /* local hero event -> compact network event (sent on the next two snapshots) */
  queueEvent(e, a, b) {
    const q = (x) => Math.round((+x || 0) * 100) / 100, v3 = (v) => v ? [q(v.x), q(v.y), q(v.z)] : null;
    let d;
    switch (e) {
      case 'webshot': d = a ? { h: a.hand, p: v3(a.anchor) } : null; break;
      case 'attach': d = a ? { L: q(a.L), h: a.hand, p: v3(a.anchor) } : null; break;
      case 'land': case 'hardland': d = { i: q(a), k: b && b.kind, hs: q(b && b.hs), s: b && b.surf }; break;
      case 'launchboost': d = a && a.perfect ? 1 : 0; break;
      case 'handplant': d = a === 'vault2' || a === 'climb' || a === 'mantle' ? 1 : 0; break;
      case 'release': case 'wallimpact': case 'glide': d = q(a); break;
      case 'releaseboost': case 'slingfire': case 'sling': case 'pointlaunch': case 'zipgrip': case 'zippull':
      case 'pointcatch': case 'wall': case 'splash': case 'skim': d = 0; break;
      default: return;
    }
    this.evSeq = (this.evSeq || 0) + 1;
    (this.evOut || (this.evOut = [])).push({ q: this.evSeq, ts: Math.round(TL.now()), e, d, n: 0 });
    if (this.evOut.length > 24) this.evOut.shift();
  }

  /* ---------------- host */
  async host() {
    this.leave(false);
    this.role = 'host'; this.myId = 'host';
    try {
      const [c, ice] = await Promise.all([TL.NetSignal.call({ op: 'create' }), TL.NetSignal.call({ op: 'ice' })]);
      if (this.role !== 'host') return;
      this.room = c.room; this.ice = ice.iceServers;
      this.players.set('host', this.name);
      this.lastJoinT = TL.now();
      this.pollHost();
      if (navigator.clipboard) navigator.clipboard.writeText(this.inviteLink()).catch(() => {});   // needs page focus; best effort
      this.toast('Hosting room <b>' + this.room + '</b> on this PC — friends join with the code (invite link copied)');
      if (c.store === 'memory') this.toast('Signaling has no Redis store: joins only work under vercel dev');
    } catch (e) { this.role = null; this.toast('Could not create a room: ' + e.message); }
  }
  async pollHost() {
    if (this.role !== 'host') return;
    try {
      const r = await TL.NetSignal.call({ op: 'recv', room: this.room, id: 'host' });
      for (const m of r.msgs) if (m.type === 'offer' && typeof m.sdp === 'string' && /^[a-z0-9]{4,16}$/.test(m.from)) this.acceptOffer(m).catch((e) => TL.logError(e, 'net'));
    } catch (e) { /* transient; keep polling */ }
    // quick polling while people are arriving, slower once the room settles (fewer function/Redis calls)
    const ms = TL.now() - this.lastJoinT < 180000 ? 1500 : 4000;
    if (this.role === 'host') this._timers.push(setTimeout(() => this.pollHost(), ms));
  }
  async acceptOffer(m) {
    if (this.peers.has(m.from)) return;
    if (this.peers.size >= TL.NET.MAX - 1) { TL.NetSignal.call({ op: 'send', room: this.room, to: m.from, msg: { type: 'full' } }).catch(() => {}); return; }
    this.lastJoinT = TL.now();
    const pc = new RTCPeerConnection({ iceServers: this.ice });
    const peer = { id: m.from, name: 'Player', pc, rel: null, unr: null, ready: false };
    this.peers.set(peer.id, peer);
    pc.ondatachannel = (e) => { const ch = e.channel; if (ch.label === 'r') peer.rel = ch; else peer.unr = ch; this.wire(peer, ch); };
    this.watch(peer);
    await pc.setRemoteDescription({ type: 'offer', sdp: m.sdp });
    await pc.setLocalDescription(await pc.createAnswer());
    await TL.netIceDone(pc, 2500);
    await TL.NetSignal.call({ op: 'send', room: this.room, to: peer.id, msg: { type: 'answer', sdp: pc.localDescription.sdp } });
    this._timers.push(setTimeout(() => { if (!peer.ready && this.peers.get(peer.id) === peer) this.drop(peer.id, null); }, 25000));
  }

  /* ---------------- joiner: resolves once the host has welcomed us (seed + spawn known) */
  async join(code) {
    this.leave(false);
    code = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (code.length !== 5) throw new Error('Room codes are 5 characters');
    this.role = 'joiner'; this.room = code;
    this.myId = Math.random().toString(36).slice(2, 10).padEnd(8, '0');
    const ice = await TL.NetSignal.call({ op: 'ice' });
    const pc = new RTCPeerConnection({ iceServers: ice.iceServers });
    const peer = { id: 'host', name: 'Host', pc, rel: pc.createDataChannel('r', { ordered: true }), unr: pc.createDataChannel('u', { ordered: false, maxRetransmits: 0 }), ready: false };
    this.peers.set('host', peer);
    this.wire(peer, peer.rel); this.wire(peer, peer.unr);
    peer.rel.addEventListener('open', () => this.send(peer, { t: 'hello', name: this.name }, true));
    const welcomed = new Promise((res, rej) => { this._welcome = res; this._welcomeFail = rej; });
    this.watch(peer);
    await pc.setLocalDescription(await pc.createOffer());
    await TL.netIceDone(pc, 2500);
    await TL.NetSignal.call({ op: 'send', room: code, to: 'host', msg: { type: 'offer', from: this.myId, sdp: pc.localDescription.sdp } });
    // wait for the host's answer
    const t0 = TL.now();
    for (;;) {
      if (this.role !== 'joiner') throw new Error('Cancelled');
      if (TL.now() - t0 > 25000) throw new Error('The host did not answer (is their game still open?)');
      await new Promise((r) => setTimeout(r, 800));
      const r = await TL.NetSignal.call({ op: 'recv', room: code, id: this.myId });
      if (!r.alive) throw new Error('Room ' + code + ' not found');
      const full = r.msgs.find((m) => m.type === 'full'); if (full) throw new Error('Room is full (' + TL.NET.MAX + ' players)');
      const ans = r.msgs.find((m) => m.type === 'answer');
      if (ans) { await pc.setRemoteDescription({ type: 'answer', sdp: ans.sdp }); break; }
    }
    const to = new Promise((_, rej) => setTimeout(() => rej(new Error('Could not connect directly to the host — a strict network/NAT is in the way (configure a TURN server)')), 20000));
    await Promise.race([welcomed, to]);
  }

  /* ---------------- transport */
  wire(peer, ch) {
    ch.onmessage = (e) => { let m; try { m = JSON.parse(e.data); } catch (err) { return; } if (m && typeof m === 'object') this.onMsg(peer, m); };
    if (ch.label === 'r') ch.onclose = () => this.drop(peer.id, 'left');
  }
  watch(peer) {
    const pc = peer.pc;
    pc.onconnectionstatechange = () => {
      const s = pc.connectionState;
      if (s === 'failed' || s === 'closed') this.drop(peer.id, 'lost connection');
      else if (s === 'disconnected') this._timers.push(setTimeout(() => { if (pc.connectionState === 'disconnected') this.drop(peer.id, 'lost connection'); }, 6000));
    };
  }
  send(peer, m, reliable) {
    const ch = reliable || !peer.unr || peer.unr.readyState !== 'open' ? peer.rel : peer.unr;
    if (ch && ch.readyState === 'open') { try { ch.send(JSON.stringify(m)); } catch (e) { /* buffer full: drop */ } }
  }
  broadcast(m, reliable, except) { for (const p of this.peers.values()) if (p.ready && p.id !== except) this.send(p, m, reliable); }
  onMsg(peer, m) {
    if (this.role === 'host') {
      switch (m.t) {
        case 'hello': {
          if (peer.ready) return;
          peer.ready = true; peer.name = TL.netName(m.name);
          this.players.set(peer.id, peer.name);
          const c = this.game.hero && this.game.hero.ctrl;
          this.send(peer, { t: 'welcome', id: peer.id, seed: this.game.seed, players: [...this.players], spawn: c ? { x: c.pos.x, y: c.pos.y, z: c.pos.z } : null }, true);
          this.broadcast({ t: 'join', id: peer.id, name: peer.name }, true, peer.id);
          this.toast(peer.name + ' joined');
          break;
        }
        case 's': if (peer.ready) { m.id = peer.id; this.onState(m); this.broadcast(m, false, peer.id); } break;
        case 'bye': this.drop(peer.id, 'left'); break;
      }
      return;
    }
    switch (m.t) {
      case 'welcome':
        peer.ready = true; this.myId = m.id; this.seed = m.seed; this.spawn = m.spawn;
        this.players = new Map(m.players.map(([id, n]) => [id, TL.netName(n)]));
        if (this._welcome) { this._welcome(); this._welcome = null; }
        break;
      case 'join': this.players.set(m.id, TL.netName(m.name)); this.toast(TL.netName(m.name) + ' joined'); break;
      case 'leave': this.removePlayer(m.id, true); break;
      case 's': if (m.id !== this.myId) this.onState(m); break;
      case 'close': this.toast('The host closed the room'); this.leave(false); break;
    }
  }
  onState(m) {
    if (typeof m.ts !== 'number' || !Number.isFinite(m.x + m.y + m.z + m.vx + m.vy + m.vz + m.f)) return;
    let r = this.remotes.get(m.id);
    if (!r) { r = new TL.RemotePlayer(this, m.id, this.players.get(m.id) || 'Player'); this.remotes.set(m.id, r); }
    r.push(m);
  }
  removePlayer(id, announce) {
    const n = this.players.get(id);
    this.players.delete(id);
    const r = this.remotes.get(id); if (r) { r.dispose(); this.remotes.delete(id); }
    if (announce && n) this.toast(n + ' left');
  }
  drop(id, reason) {
    const peer = this.peers.get(id); if (!peer) return;
    this.peers.delete(id);
    try { peer.pc.close(); } catch (e) { /* already closed */ }
    if (this.role === 'host') {
      if (peer.ready) this.broadcast({ t: 'leave', id }, true);
      this.removePlayer(id, !!reason && peer.ready);
    } else if (this.role === 'joiner' && id === 'host') {
      if (this._welcomeFail) { this._welcomeFail(new Error('Connection to the host failed')); this._welcomeFail = null; }
      if (peer.ready) this.toast('Disconnected from the host');
      this.leave(false);
    }
  }
  leave(unloading) {
    if (this.role === 'host' && this.room) {
      this.broadcast({ t: 'close' }, true);
      const body = JSON.stringify({ op: 'close', room: this.room });
      if (unloading && navigator.sendBeacon) navigator.sendBeacon(TL.NetSignal.endpoint(), body);
      else TL.NetSignal.call({ op: 'close', room: this.room }).catch(() => {});
    } else if (this.role === 'joiner') { const h = this.peers.get('host'); if (h) this.send(h, { t: 'bye' }, true); }
    this.role = null; this.room = null; this._welcome = null; this._welcomeFail = null;
    for (const t of this._timers) clearTimeout(t); this._timers = [];
    for (const p of this.peers.values()) { try { p.pc.close(); } catch (e) { /* closed */ } }
    this.peers.clear();
    for (const r of this.remotes.values()) r.dispose();
    this.remotes.clear(); this.players.clear();
    const pe = document.getElementById('mpPanel'); if (pe) pe.style.display = 'none';
  }

  /* ---------------- local state out (20 Hz; setInterval keeps the host relaying with the tab in the background) */
  snapshot() {
    const h = this.game.hero, c = h.ctrl, q = (v) => Math.round(v * 100) / 100;
    const ropes = c.tether.ropes.map((R) => R.active ? [R.attached ? 1 : 2, q(R.anchor.x), q(R.anchor.y), q(R.anchor.z), R.hand === 'L' ? 0 : 1, q(R.tension), R.attached ? 1 : q(R.shotDur > 0 ? R.shotT / R.shotDur : 1)] : 0);
    const st = c.state, wall = st === TL.TS.WALL || st === TL.TS.CRAWL || st === TL.TS.CEIL;
    return {
      t: 's', id: this.myId, ts: Math.round(TL.now()), h: h.name, o: h.outfit, p: h.palette,
      x: q(c.pos.x), y: q(c.pos.y), z: q(c.pos.z), vx: q(c.vel.x), vy: q(c.vel.y), vz: q(c.vel.z), f: q(c.facing), st,
      wn: wall ? [q(c.wallN.x), q(c.wallN.y), q(c.wallN.z)] : undefined, wm: wall ? c.wallMode : undefined,
      gr: st === TL.TS.GLIDE ? q(c.glide.roll) : undefined, gp: st === TL.TS.GLIDE ? q(c.glide.pitch) : undefined,
      w: c.inWater ? 1 : undefined, sh: c.singleHandSwing ? 1 : undefined, sp: c.sprinting ? 1 : undefined, r: ropes,
      ev: this.takeEvents(),
    };
  }
  takeEvents() {
    const o = this.evOut; if (!o || !o.length) return undefined;
    const out = o.map(({ q, ts, e, d }) => ({ q, ts, e, d }));
    for (const ev of o) ev.n++;
    this.evOut = o.filter((ev) => ev.n < 2);
    return out;
  }
  sendState() {
    const g = this.game;
    if (!this.role || !g.hero || !g.world || (g.state !== 'play' && g.state !== 'paused')) return;
    if (this.role === 'joiner' && !(this.peers.get('host') || {}).ready) return;
    const m = this.snapshot();
    if (this.role === 'host') this.broadcast(m, false); else this.send(this.peers.get('host'), m, false);
  }

  /* ---------------- per frame (inside TL.Game.tick) */
  frame(dt) {
    for (const r of this.remotes.values()) r.update(dt);
    this.panelT -= dt;
    if (this.panelT <= 0) { this.panelT = 0.5; this.renderPanel(); }
  }
  renderPanel() {
    const e = this.panelEl();
    if (!this.role || !this.room || this.game.photoMode) { e.style.display = 'none'; return; }
    e.style.display = 'block'; e.textContent = '';
    const hd = document.createElement('div'); hd.className = 'mp-hd';
    hd.textContent = (this.role === 'host' ? 'HOSTING · ' : 'ROOM · ') + this.room + ' · ' + Math.max(1, this.players.size) + '/' + TL.NET.MAX;
    e.appendChild(hd);
    for (const [id, n] of this.players) {
      const d = document.createElement('div');
      d.textContent = (id === this.myId ? '▸ ' : '') + n + (id === 'host' ? ' (host)' : '');
      if (id !== this.myId) { d.style.color = this.colorOf(id); const r = this.remotes.get(id); if (r && r.color !== d.style.color) r.setColor(this.colorOf(id)); }
      e.appendChild(d);
    }
  }
  onGameStart() {
    for (const r of this.remotes.values()) r.disposeHero();   // a new world: rebuild puppets lazily
    const g = this.game;
    if (this.pendingHost) { this.pendingHost = false; this.host(); return; }
    if (this.role === 'joiner' && this.spawn) {
      const s = this.spawn, a = Math.random() * Math.PI * 2; this.spawn = null;
      g.hero.ctrl.teleport(s.x + Math.cos(a) * 4, s.y + 1.5, s.z + Math.sin(a) * 4);
      g.streamer.forceLoadAround(g.hero.ctrl.pos, 100);
      g.rig.smoothT.copy(g.hero.ctrl.pos);
      this.toast('Joined room <b>' + this.room + '</b> — you spawned next to the host');
    }
  }
};

/* ------------------------------------------------------------------ hooks: game loop + title menu */
{
  // local hero events go out with the snapshots so other players hear and see them
  const onHeroEvent = TL.Game.prototype.onHeroEvent;
  TL.Game.prototype.onHeroEvent = function (hero, e, a, b) {
    onHeroEvent.call(this, hero, e, a, b);
    if (this.net && this.net.role && hero === this.hero) this.net.queueEvent(e, a, b);
  };
  // other players on the minimap: a coloured dot, or a rim arrow pointing at them when out of range
  const drawMinimap = TL.UIManager.prototype.drawMinimap;
  TL.UIManager.prototype.drawMinimap = function () {
    drawMinimap.call(this);
    const g = this.game, net = g.net;
    if (!net || !net.remotes.size) return;
    const cv = this.$('minimap'), ctx = cv.getContext('2d'), W = cv.width, H = cv.height, sc = 0.55, h = g.hero.ctrl;
    const cs = Math.cos(g.rig.yaw), sn = Math.sin(g.rig.yaw), R = W / 2 - 7;
    for (const r of net.remotes.values()) {
      if (!r.hero || TL.now() - r.lastRecv > TL.NET.STALE_MS) continue;
      const dx = r._p.x - h.pos.x, dz = r._p.z - h.pos.z;
      let x = (dx * cs - dz * sn) * sc, y = (dx * sn + dz * cs) * sc;    // same transform as the map canvas
      const len = Math.hypot(x, y);
      ctx.save(); ctx.translate(W / 2, H / 2);
      ctx.fillStyle = r.color; ctx.strokeStyle = 'rgba(0,0,0,0.75)'; ctx.lineWidth = 1.5;
      if (len <= R) {
        ctx.beginPath(); ctx.arc(x, y, 4.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.font = 'bold 9px sans-serif'; ctx.textAlign = 'center'; ctx.lineWidth = 3; ctx.strokeText(r.name.slice(0, 8), x, y - 7); ctx.fillText(r.name.slice(0, 8), x, y - 7);
      } else {
        x *= R / len; y *= R / len;
        ctx.rotate(Math.atan2(y, x)); ctx.translate(R, 0);
        ctx.beginPath(); ctx.moveTo(5, 0); ctx.lineTo(-5, -5); ctx.lineTo(-2, 0); ctx.lineTo(-5, 5); ctx.closePath(); ctx.fill(); ctx.stroke();
      }
      ctx.restore();
    }
  };
  const tick = TL.Game.prototype.tick;
  TL.Game.prototype.tick = function (dt) { tick.call(this, dt); if (this.net) this.net.frame(dt); };
  const boot = TL.Game.prototype.boot;
  TL.Game.prototype.boot = function () { this.net = new TL.Net(this); return boot.call(this); };
  const showTitle = TL.UIManager.prototype.showTitle;
  TL.UIManager.prototype.showTitle = function () {
    showTitle.call(this);
    const g = this.game, net = g.net, box = this.$('titleMenu');
    if (net.role) net.leave(false);                                 // Quit to Title leaves the room
    const newBtn = box.querySelector('button.primary');            // "New Game": reuse its seed/quality/loading flow
    const sec = this.el('div', { class: 'mp-sec' });
    sec.appendChild(this.el('div', { class: 'mp-title' }, 'MULTIPLAYER <small>the host\'s PC runs the room · max ' + TL.NET.MAX + '</small>'));
    const nameIn = this.el('input', { type: 'text', maxlength: 16, spellcheck: 'false', placeholder: 'Your name', 'aria-label': 'Player name' });
    nameIn.value = net.name === 'Player' ? '' : net.name;
    const r1 = this.el('div', { class: 'row' }); r1.appendChild(this.el('label', {}, 'Name')); r1.appendChild(nameIn); sec.appendChild(r1);
    const status = this.el('p', { class: 'small mp-status' });
    const setName = () => { net.name = TL.netName(nameIn.value); try { localStorage.setItem('tl-mp-name', net.name); } catch (e) { /* storage blocked */ } };
    const r2 = this.el('div', { class: 'row' });
    r2.appendChild(this.btn('Host Room', () => { setName(); net.pendingHost = true; newBtn.click(); }, 'primary'));
    r2.appendChild(this.el('small', {}, 'uses the seed above'));
    sec.appendChild(r2);
    const codeIn = this.el('input', { type: 'text', maxlength: 5, spellcheck: 'false', placeholder: 'CODE', 'aria-label': 'Room code', class: 'mp-code' });
    const urlRoom = new URLSearchParams(location.search).get('room'); if (urlRoom) codeIn.value = urlRoom.toUpperCase().slice(0, 5);
    codeIn.oninput = () => { codeIn.value = codeIn.value.toUpperCase(); };
    let joining = false;
    const join = async () => {
      if (joining) return; joining = true; setName();
      status.textContent = 'Connecting to room ' + codeIn.value.toUpperCase() + '…';
      try {
        await net.join(codeIn.value);
        status.textContent = 'Connected — loading the host\'s world…';
        this.$('seedIn').value = net.seed;
        newBtn.click();
      } catch (e) { status.textContent = e.message; net.leave(false); }
      joining = false;
    };
    codeIn.onkeydown = (e) => { if (e.key === 'Enter') join(); };
    const r3 = this.el('div', { class: 'row' }); r3.appendChild(this.el('label', {}, 'Room')); r3.appendChild(codeIn); r3.appendChild(this.btn('Join', join, 'primary')); sec.appendChild(r3);
    sec.appendChild(status);
    if (urlRoom) status.textContent = 'Invite link: enter your name and press Join';
    const ctl = [...box.querySelectorAll('button')].find((b) => /Controls/.test(b.textContent));
    box.insertBefore(sec, ctl || null);
  };
  const css = document.createElement('style');
  css.textContent = `
    .mp-sec { margin: 8px 0 4px; padding: 10px 10px 4px; border: 1px solid rgba(64,240,224,0.35); border-radius: 8px; background: rgba(64,240,224,0.05); }
    .mp-title { font-weight: 700; letter-spacing: 0.12em; color: #7fe8de; margin-bottom: 4px; }
    .mp-title small { font-weight: 400; letter-spacing: 0; opacity: 0.7; margin-left: 6px; }
    .mp-sec .row small { opacity: 0.6; }
    .mp-code { width: 90px; text-transform: uppercase; letter-spacing: 0.25em; font-weight: 700; }
    .mp-status { min-height: 1.2em; color: #ffd27f; }
    #mpTags { position: fixed; inset: 0; pointer-events: none; z-index: 5; overflow: hidden; }
    .mp-tag { position: absolute; left: 0; top: 0; white-space: nowrap; font: 600 13px/1.2 system-ui, sans-serif; color: #fff; padding: 2px 7px; border-radius: 10px;
      background: rgba(10,14,20,0.55); border: 1px solid rgba(64,240,224,0.55); text-shadow: 0 1px 2px #000; transform-origin: 50% 100%; will-change: transform; }
    .mp-tag span { font-weight: 400; opacity: 0.7; }
    .mp-tag i { display: none; font-style: normal; }
    .mp-tag.edge { padding: 3px 8px 3px 6px; font-size: 12px; background: rgba(10,14,20,0.7); }
    .mp-tag.edge i { display: inline-block; margin-right: 5px; font-size: 11px; }
    #mpPanel { position: fixed; top: 12px; left: 50%; transform: translateX(-50%); z-index: 6; pointer-events: none; display: none; text-align: center;
      font: 12px/1.45 system-ui, sans-serif; color: #dfe; background: rgba(8,12,18,0.6); border: 1px solid rgba(64,240,224,0.35); border-radius: 8px; padding: 5px 12px; }
    #mpPanel .mp-hd { font-weight: 700; letter-spacing: 0.1em; color: #7fe8de; }`;
  document.head.appendChild(css);
}
