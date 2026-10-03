/* =====================================================================================
   UIManager — title screen, HUD (health/Focus/abilities/gadgets, objective, warnings, minimap, hero,
   combo/style, FPS/XYZ/speed/district/weather/time), full map with filters + waypoint, CITYLINK,
   pause menus (skills, gadgets, suits, mission log, districts, settings, controls remap,
   accessibility, save/load), photo mode, captions, telegraph glyphs (shape-coded), physics debug
   overlay + perf panel. Keyboard, mouse and gamepad navigation; every button does something.
   ===================================================================================== */
'use strict';

TL.UIManager = class {
  constructor(game) {
    this.game = game;
    this.$ = (id) => document.getElementById(id);
    this.hud = this.$('hud'); this.modal = null; this.telegraphs = new Map();
    this.toasts = []; this.lastScanT = 0; this.scanUntil = 0; this.promptText = ''; this.promptT = 0;
    this.waypoint = null; this.objective = '';
    this.mapFilters = { story: true, crimes: true, activities: true, caches: true, landmarks: true, worksites: true };
    this.debugObjs = null;
    this.bindGlobal();
    this.padNavT = 0;
  }
  el(tag, attrs, html) { const e = document.createElement(tag); if (attrs) for (const k in attrs) { if (k === 'onclick') e.onclick = attrs[k]; else if (k === 'class') e.className = attrs[k]; else e.setAttribute(k, attrs[k]); } if (html !== undefined) e.innerHTML = html; return e; }
  btn(label, fn, cls) { const b = this.el('button', { class: 'btn ' + (cls || ''), 'aria-label': label.replace(/<[^>]+>/g, '') }, label); b.onclick = (e) => { e.stopPropagation(); this.game.audio && this.game.audio.sfx('ui'); fn(); }; b.onmouseenter = () => this.game.audio && this.game.audio.sfx('hover'); return b; }
  bindGlobal() {
    const g = this.game;
    document.addEventListener('keydown', (e) => {
      if (this.modal && e.code === 'Escape' && g.state !== 'title') { e.preventDefault(); }
    });
  }
  applyAccessibility() {
    const s = this.game.settings, b = document.body;
    b.classList.toggle('hc', !!s.highContrast);
    document.documentElement.style.setProperty('--ui', s.uiScale);
    document.documentElement.style.setProperty('--sub', s.subSize);
    document.documentElement.style.setProperty('--subbg', s.subBg);
    this.$('crosshair').classList.toggle('dot', !!s.centerDot);
  }
  /* ---------------------------------------------------------------- boot / title */
  bootProgress(p, msg) { const b = this.$('bootbar'); if (b) b.style.width = Math.round(p * 100) + '%'; const m = this.$('bootmsg'); if (m) m.textContent = msg || ''; }
  showTitle() {
    const g = this.game;
    this.$('boot').style.display = 'none';
    const t = this.$('title'); t.style.display = 'flex';
    this.applyAccessibility();
    const box = this.$('titleMenu'); box.innerHTML = '';
    const seedIn = this.el('input', { type: 'text', id: 'seedIn', value: g.seed, maxlength: 12, spellcheck: 'false', 'aria-label': 'World seed (a number, or MAN for the Manhattan scan)', title: 'A number generates a city · MAN loads the Lower Manhattan scan' });
    const q = this.el('select', { id: 'qSel', 'aria-label': 'Graphics quality' });
    for (const k of ['low', 'medium', 'high', 'ultra']) { const o = this.el('option', { value: k }, k[0].toUpperCase() + k.slice(1) + (k === 'low' ? ' (original low-poly set)' : '')); if (k === g.settings.quality) o.selected = true; q.appendChild(o); }
    const has = g.save.hasSave();
    const start = (data) => {
      g.settings.quality = q.value; g.seed = TL.parseSeed(data ? data.seed : seedIn.value);
      g.save.saveSettings();
      t.style.display = 'none';
      const ld = this.$('loading'), msg = ld.querySelector('p'), scan = g.seed === TL.SCAN_SEED;
      if (msg) msg.textContent = scan ? 'LOADING THE LOWER MANHATTAN SCAN…' : 'GENERATING THE CITY FROM YOUR SEED…';
      ld.style.display = 'flex';
      setTimeout(async () => {
        try {
          if (scan) await TL.ScanData.load((p, m) => { if (msg) msg.textContent = m.toUpperCase() + '…'; });
          g.startGame({ seed: g.seed, data });
        } catch (e) { TL.logError(e, 'start'); TL.fatal('Failed to start: ' + e.message); }
        ld.style.display = 'none';
      }, 50);
    };
    box.appendChild(this.btn('New Game', () => start(null), 'primary'));
    const cont = this.btn('Continue' + (has ? '' : ' (no save)'), () => { const d = g.save.load(); if (d) { seedIn.value = d.seed; start(d); } else this.toast('No saved game found — import one or start new'); });
    if (!has) cont.classList.add('dim');
    box.appendChild(cont);
    const row = this.el('div', { class: 'row' });
    row.appendChild(this.el('label', {}, 'Seed')); row.appendChild(seedIn);
    row.appendChild(this.btn('Random', () => { seedIn.value = Math.floor(Math.random() * 99999); }));
    box.appendChild(row);
    const row2 = this.el('div', { class: 'row' }); row2.appendChild(this.el('label', {}, 'Quality')); row2.appendChild(q); box.appendChild(row2);
    box.appendChild(this.btn('Controls', () => this.openHelp(true)));
    box.appendChild(this.btn('Import Save JSON', () => g.save.importJSON((d) => { seedIn.value = d.seed; start(d); })));
    box.appendChild(this.btn('Start', () => start(null), 'primary big'));
    box.appendChild(this.el('p', { class: 'small' }, 'Click Start to capture the mouse and enable audio. Original characters and city — assets modeled in Blender and embedded in this file.'));
  }
  showHUD() { this.hud.style.display = 'block'; this.applyAccessibility(); this.buildHUD(); }
  buildHUD() {
    const g = this.game;
    this.$('abilities').innerHTML = '';
    const list = TL.ABILITIES[g.heroName];
    for (const a of list) {
      if (a.key === 'D') continue;
      const d = this.el('div', { class: 'ab', title: a.name + ' — ' + a.desc, 'aria-label': a.name }, '<b>' + (typeof a.key === 'number' ? a.key : 'Aim+' + String(a.key).slice(1)) + '</b><span>' + a.name + '</span><i></i>');
      d.dataset.id = a.id; this.$('abilities').appendChild(d);
    }
  }
  onHeroChanged(name) {
    const e = this.$('heroName'); if (e) { e.textContent = name; e.className = 'hero-' + name.toLowerCase(); }
    if (this.hud.style.display === 'block') this.buildHUD();
  }
  /* ---------------------------------------------------------------- messages */
  toast(msg) {
    const box = this.$('toasts'); if (!box) return;
    const d = this.el('div', { class: 'toast', role: 'status' }, msg); box.appendChild(d);
    setTimeout(() => d.classList.add('out'), 3200); setTimeout(() => d.remove(), 3800);
    while (box.children.length > 5) box.firstChild.remove();
  }
  hint(msg) { const h = this.$('hint'); h.textContent = msg; h.style.opacity = 1; clearTimeout(this._hintT); this._hintT = setTimeout(() => (h.style.opacity = 0), 2800); }
  prompt(t) { this.promptText = t; this.promptT = 0.15; }
  /* click-to-resume overlay: shown when the browser won't re-capture the mouse automatically */
  showResume(on) {
    let el = this.$('resume');
    if (!el) {
      el = this.el('div', { id: 'resume', role: 'button', 'aria-label': 'Click to resume' }, '<div>Click to resume</div><small>the browser needs a click to capture the mouse again</small>');
      el.onclick = () => { this.game.input.lock(); };
      document.body.appendChild(el);
    }
    el.style.display = on ? 'flex' : 'none';
  }
  get promptActive() { return this.promptT > 0; }
  caption(txt, speaker) {
    const s = this.game.settings; if (!s.subtitles) return;
    const c = this.$('captions');
    const text = speaker && !s.speakerLabels ? txt.replace(/^[^:]+:\s*/, '') : txt;
    const d = this.el('div', { class: 'cap' }, text.replace(/</g, '&lt;')); c.appendChild(d);
    setTimeout(() => d.remove(), 3500); while (c.children.length > 3) c.firstChild.remove();
  }
  flash(color) { if (this.game.settings.reducedFlashes) return; const f = this.$('flash'); f.style.background = color; f.style.opacity = 0.25; setTimeout(() => (f.style.opacity = 0), 90); }
  flashDamage() { const f = this.$('dmg'); f.style.opacity = this.game.settings.reducedFlashes ? 0.25 : 0.6; setTimeout(() => (f.style.opacity = 0), 250); }
  xpToast(n, why) { if (!n) return; const d = this.el('div', { class: 'xp' }, '+' + n + ' XP' + (why ? ' · ' + why : '')); this.$('xpbox').appendChild(d); setTimeout(() => d.remove(), 2200); }
  styleBlip(text, n) { const s = this.$('style'); s.innerHTML = '<b>' + Math.round(this.game.progress.styleMeter) + '</b> STYLE<br><span>' + text + ' +' + n + '</span>'; s.style.opacity = 1; clearTimeout(this._stT); this._stT = setTimeout(() => (s.style.opacity = 0), 2400); }
  setObjective(t) { this.objective = t; this.$('objective').textContent = t; this.$('objective').style.display = t ? 'block' : 'none'; }
  setWaypoint(p) { this.waypoint = p ? p.clone() : null; }
  missionBanner(title, brief) { const b = this.$('banner'); b.innerHTML = '<h2>' + title + '</h2><p>' + brief + '</p>'; b.style.opacity = 1; setTimeout(() => (b.style.opacity = 0), 5000); this.caption('CITYLINK: ' + brief, 'CITYLINK'); }
  missionComplete(title, xp) { const b = this.$('banner'); b.innerHTML = '<h2>MISSION COMPLETE</h2><p>' + title + ' · +' + xp + ' XP</p>'; b.style.opacity = 1; setTimeout(() => (b.style.opacity = 0), 4500); }
  crimeAlert(title, opt) { this.toast('⚠ ' + title + (opt ? ' — optional: ' + opt : '')); this.caption('CITYLINK: ' + title + ' reported nearby.', 'CITYLINK'); }
  crimeResult(ok, title, bonus) { this.toast((ok ? '✔ Resolved: ' : '✖ Failed: ') + title + (ok && bonus ? ' (bonus)' : '')); }
  autosaveBlip() { const a = this.$('autosave'); a.style.opacity = 1; setTimeout(() => (a.style.opacity = 0), 1500); }
  bossBar(title, frac) {
    const b = this.$('boss');
    if (frac < 0) { b.style.display = 'none'; return; }
    b.style.display = 'block'; if (title) b.querySelector('span').textContent = title;
    b.querySelector('i').style.width = Math.round(frac * 100) + '%';
  }
  /* shape-coded warnings: ◆ dodge, ▲ parry, ● ranged, ✖ unblockable */
  telegraph(e, warn) {
    let d = this.telegraphs.get(e);
    if (!d) { d = this.el('div', { class: 'tg', role: 'img' }); this.$('telegraphs').appendChild(d); this.telegraphs.set(e, d); }
    const map = { dodge: ['◆', 'dodge', 'Dodge'], parry: ['▲', 'parry', 'Parry'], ranged: ['●', 'ranged', 'Ranged — dodge'], unblockable: ['✖', 'unblock', 'Unblockable — dodge'] };
    const m = map[warn] || map.dodge;
    d.innerHTML = m[0] + '<small>' + m[2] + '</small>'; d.className = 'tg ' + m[1]; d.setAttribute('aria-label', m[2]);
    d.dataset.t = TL.now();
  }
  clearTelegraph(e) { const d = this.telegraphs.get(e); if (d) { d.remove(); this.telegraphs.delete(e); } }
  scanReveal(p) {
    this.lastScanT = this.game.time; this.scanUntil = this.game.time + 8;
    const g = this.game;
    for (const c of g.missions.caches) if (c.obj && !c.found && c.p.distanceTo(p) < 150) c.obj.mesh.visible = true;
    let n = 0; for (const e of g.ai.enemies) if (e.alive && e.pos.distanceTo(p) < 120) n++;
    this.hint('Scan: ' + n + ' hostiles · ' + g.missions.caches.filter((c) => c.obj && c.obj.mesh.visible && !c.found).length + ' tech caches' + (g.missions.crime ? ' · crime marked' : ''));
  }
  /* ---------------------------------------------------------------- per-frame HUD */
  update(dt) {
    const g = this.game; if (!g.hero) return;
    const h = g.hero.ctrl, c = g.combat, s = g.settings;
    this.promptT -= dt;
    this.$('prompt').textContent = this.promptT > 0 ? this.promptText : '';
    this.$('hp').style.width = (h.health / h.maxHealth * 100) + '%';
    const fb = this.$('focus').children;
    for (let i = 0; i < 3; i++) fb[i].style.width = (TL.clamp(c.focus - i, 0, 1) * 100) + '%';
    this.$('charge').style.width = c.charge + '%';
    this.$('charge').parentElement.classList.toggle('full', c.charge >= 100);
    const gd = TL.GADGETS[c.gadgetIdx];
    this.$('gadget').innerHTML = '<b>R</b> ' + gd.name + ' <span>' + (c.gadgetCharges[gd.id] || 0) + '/' + c.gadgetCap(gd.id) + '</span> <small>Tab: cycle</small>';
    for (const d of this.$('abilities').children) {
      const id = d.dataset.id, ab = TL.ABILITIES[g.heroName].find((a) => a.id === id);
      const cd = c.cd[id] || 0;
      const frac = ab.ult ? c.charge / 100 : cd > 0 ? 1 - cd / ab.cd : 1;
      d.querySelector('i').style.height = (100 - frac * 100) + '%';
      d.classList.toggle('ready', frac >= 1);
    }
    // debug line
    const dbg = this.$('dbgline');
    if (s.showFps) {
      const d = g.layout.district(h.pos.x, h.pos.z);
      dbg.textContent = Math.round(g.fps) + ' FPS · ' + h.pos.x.toFixed(0) + ', ' + h.pos.y.toFixed(0) + ', ' + h.pos.z.toFixed(0) + ' · ' + Math.round(h.vel.length() * 3.6) + ' km/h · ' + d.toUpperCase() + ' · ' + g.env.weather + ' · ' + TL.fmtTime(g.env.hour) + ' · ' + h.state;
    } else dbg.textContent = TL.fmtTime(g.env.hour) + ' · ' + g.layout.district(h.pos.x, h.pos.z).toUpperCase();
    // waypoint distance
    const wp = this.$('wpdist');
    if (this.waypoint) { wp.style.display = 'block'; wp.textContent = Math.round(this.waypoint.distanceTo(h.pos)) + ' m'; this.projectMarker(this.$('wpmark'), this.waypoint, true); }
    else { wp.style.display = 'none'; this.$('wpmark').style.display = 'none'; }
    // point-launch target
    const launch=h.launch,mark=this.$('ltmark');
    if (g.state==='play' && (launch||g._lt)) {
      this.projectMarker(mark,launch?launch.point:g._lt.point,false);
      const ready=launch&&(launch.window||launch.arrived);
      mark.textContent='◇';mark.style.color=ready?'#9affdf':'';
      mark.style.textShadow=ready?'0 0 10px #36c9ac':'';
    } else mark.style.display='none';
    // telegraphs follow their enemies
    for (const [e, d] of this.telegraphs) {
      if (!e.atk || !e.alive) { if (TL.now() - (+d.dataset.t) > 400) this.clearTelegraph(e); continue; }
      this.projectMarker(d, e.pos.clone().setY(e.pos.y + (e.type === 'boss' ? 8 : 2.4)), true);
    }
    this.drawMinimap();
    this.debugPhysics(s.debugPhysics);
    this.perfPanel(s.debugPerf);
    // gamepad menu navigation
    if (this.modal || g.state === 'paused') this.padNav(dt);
  }
  projectMarker(el, p, clampEdge) {
    const v = p.clone().project(this.game.camera);
    let x = (v.x * 0.5 + 0.5) * window.innerWidth, y = (-v.y * 0.5 + 0.5) * window.innerHeight;
    const behind = v.z > 1;
    if (behind) { x = window.innerWidth - x; y = window.innerHeight - 30; }
    if (!clampEdge && (behind || x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight)) { el.style.display = 'none'; return; }
    x = TL.clamp(x, 30, window.innerWidth - 30); y = TL.clamp(y, 30, window.innerHeight - 30);
    el.style.display = 'block'; el.style.transform = 'translate(' + x + 'px,' + y + 'px)';
  }
  /* ---------------------------------------------------------------- minimap */
  drawMinimap() {
    const cv = this.$('minimap'); const ctx = cv.getContext('2d'); const g = this.game, h = g.hero.ctrl;
    const W = cv.width, H = cv.height, sc = 0.55;
    ctx.save(); ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(12,16,22,0.8)'; ctx.beginPath(); ctx.arc(W / 2, H / 2, W / 2, 0, Math.PI * 2); ctx.fill(); ctx.clip();
    ctx.translate(W / 2, H / 2); ctx.rotate(g.rig.yaw); ctx.scale(sc, sc); ctx.translate(-h.pos.x, -h.pos.z);
    if (g.scanMode) {
      const M = TL.ScanData.meta.map;
      ctx.fillStyle = '#18384a'; ctx.fillRect(h.pos.x - 400, h.pos.z - 400, 800, 800);
      ctx.drawImage(TL.ScanData.mapImg, M.min[0], M.min[1], M.w * M.mpp, M.h * M.mpp);
    } else {
    // water
    ctx.fillStyle = '#18384a'; ctx.fillRect(g.layout.rx0, h.pos.z - 400, g.layout.rx1 - g.layout.rx0, 800);
    // roads
    ctx.strokeStyle = '#3a4048'; ctx.lineWidth = 16;
    const x0 = Math.floor((h.pos.x - 300) / 80) * 80, z0 = Math.floor((h.pos.z - 300) / 80) * 80;
    for (let x = x0; x < h.pos.x + 300; x += 80) { if (g.layout.isRiverX(x)) continue; ctx.beginPath(); ctx.moveTo(x, h.pos.z - 300); ctx.lineTo(x, h.pos.z + 300); ctx.stroke(); }
    for (let z = z0; z < h.pos.z + 300; z += 80) { ctx.beginPath(); ctx.moveTo(h.pos.x - 300, z); ctx.lineTo(h.pos.x + 300, z); ctx.stroke(); }
    // buildings from loaded chunks
    ctx.fillStyle = '#56606c';
    for (const ch of g.streamer.chunks.values()) { if (!ch.data || Math.abs(ch.data.cx - h.pos.x) > 300 || Math.abs(ch.data.cz - h.pos.z) > 300) continue; for (const m of ch.data.masses) if (m.y0 < 1 && m.kind === 'building') ctx.fillRect(m.x - m.w / 2, m.z - m.d / 2, m.w, m.d); if (ch.data.park) { ctx.fillStyle = '#2f4a2a'; ctx.fillRect(ch.data.cx - 32, ch.data.cz - 32, 64, 64); ctx.fillStyle = '#56606c'; } }
    }
    const dot = (p, col, r) => { ctx.fillStyle = col; ctx.beginPath(); ctx.arc(p.x, p.z, r / sc, 0, Math.PI * 2); ctx.fill(); };
    for (const e of g.ai.enemies) if (e.alive && (e.state === 'alert' || g.time < this.scanUntil)) dot(e.pos, '#ff5040', 3);
    for (const v of g.traffic.vehicles) if (v.runaway) dot(v.pos, '#ffb040', 4);
    if (g.missions.crime && g.missions.crime.p) dot(g.missions.crime.p, '#ff3030', 6);
    for (const a of g.missions.activities) if (!g.missions.activityDone.has(a.id)) dot(a.p, '#40c0ff', 3.5);
    if (!g.missions.active) for (const d of g.missions.available()) dot(d.start, '#ffd040', 6);
    if (this.mapFilters.worksites) for (const d of this.worksiteRoutes()) {
      const p=d.start, r=4/sc; ctx.fillStyle='#ffad50'; ctx.beginPath();
      ctx.moveTo(p.x,p.z-r);ctx.lineTo(p.x+r,p.z);ctx.lineTo(p.x,p.z+r);ctx.lineTo(p.x-r,p.z);ctx.closePath();ctx.fill();
    }
    if (this.waypoint) dot(this.waypoint, '#ffffff', 5);
    const other = g.heroes[g.heroName === 'WEAVER' ? 'PULSE' : 'WEAVER'];
    dot(other.ctrl.pos, g.heroName === 'WEAVER' ? '#40f0e0' : '#ffb030', 4);
    ctx.restore();
    // player arrow (always up = camera forward)
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.moveTo(W / 2, H / 2 - 7); ctx.lineTo(W / 2 - 5, H / 2 + 5); ctx.lineTo(W / 2 + 5, H / 2 + 5); ctx.fill();
    ctx.fillStyle = '#ccd'; ctx.font = '10px sans-serif'; ctx.textAlign = 'center';
    const nx = W / 2 + Math.sin(-g.rig.yaw + Math.PI) * (W / 2 - 8), ny = H / 2 - Math.cos(-g.rig.yaw + Math.PI) * (H / 2 - 8);
    ctx.fillText('N', nx, ny + 3);
  }
  /* ---------------------------------------------------------------- physics debug overlay (3D lines + text) */
  debugPhysics(on) {
    const g = this.game, panel = this.$('physdbg');
    if (!on) { panel.style.display = 'none'; if (this.debugObjs) { this.debugObjs.group.visible = false; } return; }
    panel.style.display = 'block';
    if (!this.debugObjs) {
      const group = new THREE.Group(); g.scene.add(group);
      const mk = (c) => { const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 1, 0)]), new THREE.LineBasicMaterial({ color: c, depthTest: false })); l.renderOrder = 999; l.frustumCulled = false; group.add(l); return l; };
      const cap = new THREE.Mesh(new THREE.CapsuleGeometry ? new THREE.CapsuleGeometry(TL.C.CAP_R, 0.99, 4, 8) : new THREE.CylinderGeometry(TL.C.CAP_R, TL.C.CAP_R, 1.75, 8), new THREE.MeshBasicMaterial({ color: 0x40ff80, wireframe: true, depthTest: false }));
      group.add(cap);
      const cands = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial({ size: 6, sizeAttenuation: false, vertexColors: true, depthTest: false }));
      cands.frustumCulled = false; group.add(cands);
      const chosen = new THREE.Mesh(new THREE.SphereGeometry(0.5, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffff00, wireframe: true, depthTest: false })); group.add(chosen);
      const normals = []; for (let i = 0; i < 8; i++) normals.push(mk(0xff40ff));
      this.debugObjs = { group, vel: mk(0x40a0ff), grav: mk(0xffffff), rope: mk(0xffb040), ten: mk(0xff4040), vr: mk(0x00ffff), vt: mk(0x80ff40), cap, cands, chosen, normals };
    }
    const D = this.debugObjs, h = g.hero.ctrl, P = g.hero.renderPos;
    D.group.visible = true;
    const setL = (l, a, b) => { const p = l.geometry.attributes.position; p.setXYZ(0, a.x, a.y, a.z); p.setXYZ(1, b.x, b.y, b.z); p.needsUpdate = true; l.visible = true; };
    setL(D.vel, P, P.clone().addScaledVector(h.vel, 0.15));
    setL(D.grav, P, P.clone().add(new THREE.Vector3(0, -TL.C.G * 0.08, 0)));
    const r = h.tether.main;
    if (r.attached) {
      const pv = r.pivot();
      setL(D.rope, P, pv);
      const n = pv.clone().sub(P).normalize();
      setL(D.ten, P, P.clone().addScaledVector(n, r.tension * 0.02));
      const vr = n.clone().multiplyScalar(h.vel.dot(n));
      setL(D.vr, P, P.clone().addScaledVector(vr, 0.15));
      setL(D.vt, P, P.clone().addScaledVector(h.vel.clone().sub(vr), 0.15));
    } else { D.rope.visible = D.ten.visible = D.vr.visible = D.vt.visible = false; }
    D.cap.position.copy(P).add(new THREE.Vector3(0, -0.08, 0));
    const cs = h.tether.candidates;
    const arr = new Float32Array(cs.length * 3), col = new Float32Array(cs.length * 3);
    cs.forEach((c, i) => { arr[i * 3] = c.x; arr[i * 3 + 1] = c.y; arr[i * 3 + 2] = c.z; const ok = c.ok; col[i * 3] = ok ? 0.3 : 1; col[i * 3 + 1] = ok ? 1 : 0.3; col[i * 3 + 2] = 0.3; });
    D.cands.geometry.setAttribute('position', new THREE.BufferAttribute(arr, 3)); D.cands.geometry.setAttribute('color', new THREE.BufferAttribute(col, 3));
    if (h.tether.chosen) { D.chosen.visible = true; D.chosen.position.set(h.tether.chosen.x, h.tether.chosen.y, h.tether.chosen.z); } else D.chosen.visible = false;
    for (let i = 0; i < D.normals.length; i++) {
      const c = h.contacts[i];
      if (i < h.nContacts) setL(D.normals[i], P, P.clone().add(new THREE.Vector3(c.nx, c.ny, c.nz).multiplyScalar(1.5))); else D.normals[i].visible = false;
    }
    const db = h.debug;
    panel.innerHTML = '<b>PHYSICS DEBUG</b> (F3) · [ pause · ] step<br>' +
      'state: <b>' + h.state + '</b> (' + h.fsm.t.toFixed(2) + 's) prev ' + (h.fsm.prev || '-') + '<br>' +
      'timestep 1/' + TL.C.PHYS_HZ + ' · substeps ' + db.substeps + (g.physPaused ? ' · <b>PAUSED</b>' : '') + '<br>' +
      'pos ' + h.pos.x.toFixed(2) + ', ' + h.pos.y.toFixed(2) + ', ' + h.pos.z.toFixed(2) + '<br>' +
      'vel ' + h.vel.length().toFixed(2) + ' m/s (vr ' + db.vr.toFixed(2) + ' · vt ' + db.vt.toFixed(2) + ')<br>' +
      'gravity ' + TL.C.G + ' m/s² · rope ' + (r.attached ? db.dist.toFixed(2) + ' / L ' + db.ropeLen.toFixed(2) + ' / max ' + db.ropeMax.toFixed(0) : '—') + '<br>' +
      'tension ' + (r.attached ? (r.tension * h.mass / 1000).toFixed(2) + ' kN (' + (r.tension / TL.C.G).toFixed(1) + ' g)' : '—') + ' · bends ' + r.bends.length + '<br>' +
      'anchor ' + (r.attached ? (r.col ? r.col.kind + (r.col.dynamic ? ' (moving)' : '') : 'launch point') : '—') + ' · candidates ' + cs.length + '<br>' +
      'contacts ' + h.nContacts + ' · grounded ' + h.grounded + ' · NaN resets ' + h.nanResets + '<br>' +
      'glide aoa ' + (h.glide.aoa * 57.3).toFixed(1) + '° ' + (h.glide.stall ? 'STALL' : '') + '<br>' +
      '<span class="lg"><i style="background:#40a0ff"></i>velocity <i style="background:#fff"></i>gravity <i style="background:#ffb040"></i>rope <i style="background:#ff4040"></i>tension <i style="background:#0ff"></i>radial <i style="background:#80ff40"></i>tangential <i style="background:#ff40ff"></i>normals</span>';
  }
  perfPanel(on) {
    const g = this.game, p = this.$('perf');
    if (!on) { p.style.display = 'none'; return; }
    p.style.display = 'block';
    const info = g.renderer.info;
    const mem = performance.memory ? (performance.memory.usedJSHeapSize / 1048576).toFixed(0) + ' MB heap' : 'n/a';
    p.innerHTML = '<b>PERF</b> (F4)<br>' + g.fps.toFixed(0) + ' fps · ' + (1000 / Math.max(1, g.fps)).toFixed(1) + ' ms<br>draw calls ' + info.render.calls + ' · tris ' + (info.render.triangles / 1000).toFixed(0) + 'k<br>' +
      'chunks ' + g.streamer.chunks.size + ' · colliders ' + g.world.count + ' + ' + g.world.dynamics.length + ' dyn<br>' +
      'peds ' + g.crowd.count + ' · vehicles ' + g.traffic.count + ' · enemies ' + g.ai.enemies.length + '<br>' +
      'rope tension ' + (g.hero.ctrl.tether.main.tension / TL.C.G).toFixed(1) + ' g · rays/frame ' + g.world.rayBudget + '<br>' +
      'geometries ' + info.memory.geometries + ' · textures ' + info.memory.textures + ' · ' + mem + '<br>quality ' + g.quality + ' · render dist ' + g.streamer.meshRadius;
    g.world.rayBudget = 0;
  }
  /* ---------------------------------------------------------------- modals */
  modalOpen() { return !!this.modal; }
  openModal(title, build, opts) {
    this.closeModal(true);
    const g = this.game;
    if (g.state === 'play') { g.state = 'paused'; this._resumeOnClose = true; }
    try { document.exitPointerLock(); } catch (e) { /* ignore */ }
    const m = this.el('div', { class: 'modal', role: 'dialog', 'aria-label': title });
    const head = this.el('div', { class: 'mhead' }, '<h2>' + title + '</h2>');
    head.appendChild(this.btn('✕ Close', () => this.closeModal(), 'close'));
    m.appendChild(head);
    const body = this.el('div', { class: 'mbody' }); m.appendChild(body);
    this.$('modals').appendChild(m);
    this.modal = { el: m, body, title, opts: opts || {} };
    build(body);
    const first = m.querySelector('button:not(.close), input, select'); if (first) first.focus();
  }
  closeModal(silent) {
    if (!this.modal) return;
    this.modal.el.remove(); const back = this.modal.opts.back; this.modal = null;
    if (silent) return;
    if (back) { back(); return; }
    if (this._resumeOnClose) { this._resumeOnClose = false; this.game.pause(false); }
  }
  showPause() {
    const g = this.game;
    this.openModal('PAUSED', (b) => {
      const grid = this.el('div', { class: 'grid' });
      const items = [
        ['Resume', () => this.closeModal()], ['Map', () => this.openMap(true)], ['CITYLINK', () => this.openCityLink(true)],
        ['Skills', () => this.openSkills()], ['Gadgets', () => this.openGadgets()], ['Suits', () => this.openSuits()],
        ['Mission Log', () => this.openLog()], ['Districts', () => this.openDistricts()], ['Settings', () => this.openSettings()],
        ['Controls', () => this.openControls()], ['Accessibility', () => this.openAccess()], ['Save / Load', () => this.openSave()],
        ['Photo Mode', () => { this.closeModal(true); this._resumeOnClose = false; g.state = 'play'; g.enterPhotoMode(); }],
        ...(g.routes && g.routes.active ? [['Restart route', () => { this.closeModal(true); this._resumeOnClose = false; g.pause(false); g.routes.restart(); }], ['Exit route', () => { this.closeModal(true); this._resumeOnClose = false; g.pause(false); g.routes.exit(); }]] : []),
        ...(g.encounters?.active ? [['Cancel encounter',()=>{g.encounters.cancel();this.closeModal();}]] : g.encounters?.lastResult ? [['Retry encounter',()=>{this.closeModal(true);this._resumeOnClose=false;g.pause(false);g.encounters.retry();}]] : []),
        ['Help', () => this.openHelp()], ['Quit to Title', () => { g.save.save(true); location.reload(); }],
      ];
      for (const [l, f] of items) grid.appendChild(this.btn(l, f));
      b.appendChild(grid);
      const p = g.progress;
      b.appendChild(this.el('p', { class: 'small' }, 'Level ' + p.level + ' · ' + p.xp + ' XP · ' + p.points + ' upgrade points · crimes stopped ' + g.missions.crimesDone + ' · distance ' + (p.stats.distance / 1000).toFixed(1) + ' km'));
    });
    this._resumeOnClose = true;
  }
  hidePause() { if (this.modal && this.modal.title === 'PAUSED') { this.modal.el.remove(); this.modal = null; } }
  sub(title, build) { this.openModal(title, build, { back: () => this.showPause() }); }
  /* ---------------------------------------------------------------- map */
  openMap(fromPause) {
    const g = this.game;
    const build = (b) => {
      const filters = this.el('div', { class: 'row wrap' });
      for (const k in this.mapFilters) { const t = this.btn((this.mapFilters[k] ? '☑ ' : '☐ ') + k, () => { this.mapFilters[k] = !this.mapFilters[k]; this.openMap(fromPause); }); filters.appendChild(t); }
      filters.appendChild(this.btn('Clear waypoint', () => { this.setWaypoint(null); this.openMap(fromPause); }));
      filters.appendChild(this.btn('Fast travel to waypoint', () => { const wp = this.waypoint; if (!wp) { this.toast('Click the map to set a waypoint first'); return; } this.closeModal(true); this._resumeOnClose = false; g.state = 'play'; g.input.lock(); TL.FastTravel.go(g, wp); }));
      b.appendChild(filters);
      const cv = this.el('canvas', { width: 720, height: 720, class: 'map', 'aria-label': 'City map — click to set a waypoint' });
      b.appendChild(cv);
      const M = g.missions, done = M.activityDone.size, tot = M.activities.length + g.streamer.landmarks.length;
      b.appendChild(this.el('p', { class: 'small' }, 'Story ' + M.completed.size + '/3 · activities ' + done + '/' + tot + ' · caches ' + M.cacheFound.size + '/' + M.caches.length + ' · crimes ' + M.crimesDone + '. Click the map to set a waypoint.'));
      this.drawMap(cv);
      cv.onclick = (e) => {
        const r = cv.getBoundingClientRect(), E = this.mapExtent(); const x = (e.clientX - r.left) / r.width * E - E / 2, z = (e.clientY - r.top) / r.height * E - E / 2;
        const site=this.worksiteAtMapPoint(x,z,18/720*E);
        this.setWaypoint(site ? new THREE.Vector3(site.start.x,site.start.y,site.start.z) : new THREE.Vector3(x, 30, z));
        this.drawMap(cv); this.toast(site ? site.name+' · waypoint set' : 'Waypoint set');
      };
    };
    if (fromPause) this.sub('CITY MAP', build); else this.openModal('CITY MAP', build);
  }
  mapExtent() { return this.game.scanMode ? 1960 : 1700; }
  worksiteRoutes() { return this.game.routes ? this.game.routes.defs.filter(d=>d.kind==='worksite') : []; }
  worksiteAtMapPoint(x,z,radius) {
    if(!this.mapFilters.worksites)return null;
    let nearest=null,dist=radius*radius;
    for(const d of this.worksiteRoutes()) { const dd=(d.start.x-x)**2+(d.start.z-z)**2;if(dd<=dist){nearest=d;dist=dd;} }
    return nearest;
  }
  drawMap(cv) {
    const g = this.game, ctx = cv.getContext('2d'), E = this.mapExtent(), S = cv.width / E, L = g.layout;
    const X = (x) => (x + E / 2) * S, Z = (z) => (z + E / 2) * S;
    ctx.fillStyle = '#0e2a38'; ctx.fillRect(0, 0, cv.width, cv.height);
    if (g.scanMode) {
      const M = TL.ScanData.meta.map;
      ctx.drawImage(TL.ScanData.mapImg, X(M.min[0]), Z(M.min[1]), M.w * M.mpp * S, M.h * M.mpp * S);
      ctx.fillStyle = '#ccd'; ctx.font = 'bold 16px sans-serif'; ctx.fillText('LOWER MANHATTAN (SCAN)', X(-900), Z(-930) + 16);
    } else {
    ctx.fillStyle = '#2a2f36'; ctx.fillRect(X(-800), Z(-800), 1600 * S, 1600 * S);
    // districts
    ctx.globalAlpha = 0.35; ctx.fillStyle = '#6a7a9a'; ctx.fillRect(X(-800), Z(-800), (L.rx0 + 800) * S, 1600 * S);
    ctx.fillStyle = '#9a6a5a'; ctx.fillRect(X(L.rx1), Z(-800), (800 - L.rx1) * S, 800 * S);
    ctx.fillStyle = '#6a9a7a'; ctx.fillRect(X(L.rx1), Z(0), (800 - L.rx1) * S, 800 * S); ctx.globalAlpha = 1;
    ctx.fillStyle = '#0e2a38'; ctx.fillRect(X(L.rx0), Z(-800), (L.rx1 - L.rx0) * S, 1600 * S);
    ctx.strokeStyle = '#444b55'; ctx.lineWidth = 16 * S;
    for (let x = -800; x <= 800; x += 80) { if (L.isRiverX(x)) continue; ctx.beginPath(); ctx.moveTo(X(x), Z(-800)); ctx.lineTo(X(x), Z(800)); ctx.stroke(); }
    for (let z = -800; z <= 800; z += 80) { ctx.beginPath(); ctx.moveTo(X(-800), Z(z)); ctx.lineTo(X(L.rx0), Z(z)); ctx.moveTo(X(L.rx1), Z(z)); ctx.lineTo(X(800), Z(z)); ctx.stroke(); }
    ctx.strokeStyle = '#c8b890'; ctx.lineWidth = 26 * S; ctx.beginPath(); ctx.moveTo(X(L.rx0), Z(L.bridgeZ)); ctx.lineTo(X(L.rx1), Z(L.bridgeZ)); ctx.stroke();
    ctx.fillStyle = '#2f5a2a'; const p = L.park; ctx.fillRect(X(p.i0 * 80 + 8), Z(p.j0 * 80 + 8), ((p.i1 - p.i0 + 1) * 80 - 16) * S, ((p.j1 - p.j0 + 1) * 80 - 16) * S);
    ctx.fillStyle = '#ccd'; ctx.font = 'bold 16px sans-serif'; ctx.fillText('CORE', X(-600), Z(-700)); ctx.fillText('BROOKLYN', X(420), Z(-700)); ctx.fillText('QUEENS', X(450), Z(700)); ctx.fillText('RIVER', X(200), Z(600));
    }
    const icon = (pt, col, txt) => { ctx.fillStyle = col; ctx.beginPath(); ctx.arc(X(pt.x), Z(pt.z), 6, 0, Math.PI * 2); ctx.fill(); if (txt) { ctx.fillStyle = '#fff'; ctx.font = '11px sans-serif'; ctx.fillText(txt, X(pt.x) + 8, Z(pt.z) + 4); } };
    const M = g.missions, F = this.mapFilters;
    if (F.story) for (const d of Object.values(M.defs)) icon(d.start, M.completed.has(d.id) ? '#777' : '#ffd040', d.title + (M.completed.has(d.id) ? ' ✔' : ''));
    if (F.crimes && M.crime) icon(M.crime.p, '#ff3030', M.crime.title);
    if (F.activities) for (const a of M.activities) icon(a.p, M.activityDone.has(a.id) ? '#557' : '#40c0ff', M.activityDone.has(a.id) ? '' : a.name);
    if (F.caches) for (const c of M.caches) if (c.found) icon(c.p, '#40e0ff');
    if (F.landmarks) for (const lm of g.streamer.landmarks) icon(lm, '#ff80ff', '📷 ' + lm.name);
    if (F.worksites) for (const d of this.worksiteRoutes()) {
      const x=X(d.start.x),z=Z(d.start.z);ctx.fillStyle='#ffad50';ctx.beginPath();
      ctx.moveTo(x,z-7);ctx.lineTo(x+7,z);ctx.lineTo(x,z+7);ctx.lineTo(x-7,z);ctx.closePath();ctx.fill();
      ctx.fillStyle='#fff';ctx.font='11px sans-serif';ctx.fillText(d.name,x+10,z+4);
    }
    for (const n of ['WEAVER', 'PULSE']) icon(g.heroes[n].ctrl.pos, n === 'WEAVER' ? '#ffb030' : '#40f0e0', n);
    if (this.waypoint) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(X(this.waypoint.x), Z(this.waypoint.z), 10, 0, Math.PI * 2); ctx.stroke(); }
  }
  /* ---------------------------------------------------------------- CITYLINK */
  openCityLink(fromPause) {
    const g = this.game, M = g.missions, h = g.hero.ctrl;
    const build = (b) => {
      b.appendChild(this.el('h3', {}, 'Live incidents'));
      if (M.crime) { const r = this.el('div', { class: 'row' }, '<span class="crime">⚠ ' + M.crime.title + ' — ' + Math.round(M.crime.p.distanceTo(h.pos)) + ' m</span>'); r.appendChild(this.btn('Set waypoint', () => this.setWaypoint(M.crime.p))); b.appendChild(r); }
      else b.appendChild(this.el('p', { class: 'small' }, 'No active crime. The Incident Director reports new ones as you patrol.'));
      b.appendChild(this.el('h3', {}, 'Story'));
      for (const d of M.available()) { const r = this.el('div', { class: 'row' }, '<span>★ ' + d.title + ' — ' + d.brief + '</span>'); r.appendChild(this.btn('Set waypoint', () => this.setWaypoint(d.start))); b.appendChild(r); }
      if (M.active) b.appendChild(this.el('p', {}, 'Active: <b>' + M.active.def.title + '</b> — ' + this.objective));
      if(g.encounters){
        b.appendChild(this.el('h3',{},'City in motion'));
        for(const d of g.encounters.available()){
          const row=this.el('div',{class:'row'},'<span><b>'+d.name+'</b> — '+d.blurb+'</span>');
          row.appendChild(this.btn('Respond',()=>{this.closeModal(true);this._resumeOnClose=false;g.pause(false);g.encounters.start(d.id);}));b.appendChild(row);
        }
        if(g.encounters.active)b.appendChild(this.el('p',{class:'small'},'Responding: '+g.encounters.active.def.name+' · follow the objective marker.'));
        if(g.encounters.lastResult&&!g.encounters.active)b.appendChild(this.btn('Retry last encounter',()=>{this.closeModal(true);this._resumeOnClose=false;g.pause(false);g.encounters.retry();}));
      }
      if (g.routes && g.routes.defs.length) {
        b.appendChild(this.el('h3', {}, 'Traversal routes'));
        b.appendChild(this.el('p',{class:'small'},'Race your saved best: a pale ghost and split times appear after your first finish. Street Canyon offers cyan low gates or gold high gates. Either counts.'));
        const routeRow = (d) => {
          const best = g.routes.best[d.id], m = best && best.medal ? { gold: ' ★★★', silver: ' ★★', bronze: ' ★' }[best.medal] : '';
          const reward=d.kind==='worksite' && !(best&&best.rewarded) ? ' · first finish '+d.reward+' XP' : '';
          const r = this.el('div', { class: 'row' }, '<span>' + d.name + ' — ' + d.blurb + ' · ' + Math.round(new THREE.Vector3(d.start.x, d.start.y, d.start.z).distanceTo(h.pos)) + ' m' + (best ? ' · best ' + g.routes.fmt(best.time) + m : '') + reward + '</span>');
          r.appendChild(this.btn('Set waypoint', () => this.setWaypoint(new THREE.Vector3(d.start.x, d.start.y, d.start.z)))); b.appendChild(r);
        };
        for (const d of g.routes.defs) if(d.kind!=='worksite')routeRow(d);
        const sites=this.worksiteRoutes().sort((a,c)=>Math.hypot(a.start.x-h.pos.x,a.start.z-h.pos.z)-Math.hypot(c.start.x-h.pos.x,c.start.z-h.pos.z));
        if(sites.length){
          b.appendChild(this.el('h3',{},'Worksite runs'));
          b.appendChild(this.el('p',{class:'small'},'Find the orange diamonds on the map. Explore the cranes, open floors and pipe passages freely, or reach a start marker and press E to race. Your best run becomes a ghost to chase.'));
          for(const d of sites)routeRow(d);
        }
      }
      b.appendChild(this.el('h3', {}, 'Community requests & activities nearby'));
      const acts = M.activities.filter((a) => !M.activityDone.has(a.id)).sort((a, c) => a.p.distanceTo(h.pos) - c.p.distanceTo(h.pos)).slice(0, 8);
      for (const a of acts) { const r = this.el('div', { class: 'row' }, '<span>' + a.name + ' — ' + Math.round(a.p.distanceTo(h.pos)) + ' m</span>'); r.appendChild(this.btn('Set waypoint', () => this.setWaypoint(a.p))); b.appendChild(r); }
      b.appendChild(this.el('h3', {}, 'Feed'));
      const feed = this.el('div', { class: 'feed' }); for (const f of M.feed) feed.appendChild(this.el('div', { class: f.kind }, f.t + ' · ' + f.text)); b.appendChild(feed);
    };
    if (fromPause) this.sub('CITYLINK', build); else this.openModal('CITYLINK', build);
  }
  /* ---------------------------------------------------------------- progression menus */
  openSkills() {
    const g = this.game, P = g.progress;
    this.sub('SKILLS — ' + P.points + ' points', (b) => {
      const cols = this.el('div', { class: 'cols' });
      for (const [tree, list] of [['Shared traversal', TL.SKILLS.traversal], ['WEAVER', TL.SKILLS.WEAVER], ['PULSE', TL.SKILLS.PULSE]]) {
        const c = this.el('div', { class: 'col' }, '<h3>' + tree + '</h3>');
        for (const s of list) {
          const own = P.has(s.id);
          const bt = this.btn((own ? '✔ ' : '') + s.name + ' <small>(' + s.cost + ')</small><br><span class="small">' + s.desc + '</span>', () => { if (!own && !P.buy(s.id)) this.toast('Not enough points'); this.openSkills(); }, own ? 'owned' : '');
          c.appendChild(bt);
        }
        cols.appendChild(c);
      }
      b.appendChild(cols);
    });
  }
  openGadgets() {
    const g = this.game, P = g.progress, C = g.combat;
    this.sub('GADGETS — ' + P.points + ' points', (b) => {
      for (const gd of TL.GADGETS) {
        const lv = P.gadgetLv[gd.id] || 0;
        const r = this.el('div', { class: 'row' }, '<span><b>' + gd.name + '</b> Lv ' + lv + '/3 · capacity ' + gd.cap[lv] + '<br><small>' + gd.desc + '</small></span>');
        r.appendChild(this.btn(lv >= 3 ? 'Maxed' : (lv === 0 ? 'Unlock' : 'Upgrade') + ' (' + (lv + 1) + ')', () => { if (!P.upgradeGadget(gd.id)) this.toast(lv >= 3 ? 'Maxed' : 'Not enough points'); this.openGadgets(); }));
        r.appendChild(this.btn(C.gadgetIdx === TL.GADGETS.indexOf(gd) ? 'Equipped' : 'Equip', () => { C.gadgetIdx = TL.GADGETS.indexOf(gd); this.openGadgets(); }));
        b.appendChild(r);
      }
    });
  }
  openSuits() {
    const g = this.game, P = g.progress, name = g.heroName, H = g.hero;
    this.sub('SUITS — ' + name, (b) => {
      TL.Outfits.defs[name].forEach((o, oi) => {
        const unlocked = P.unlocked[name].indexOf(oi) >= 0;
        const r = this.el('div', { class: 'row' }, '<span><b>' + o.name + '</b>' + (unlocked ? '' : ' 🔒 (level ' + oi * 3 + ')') + '</span>');
        o.pal.forEach((pal, pi) => {
          const sw = this.btn('<i class="sw" style="background:#' + pal[0].toString(16).padStart(6, '0') + '"></i><i class="sw" style="background:#' + pal[1].toString(16).padStart(6, '0') + '"></i><i class="sw" style="background:#' + pal[4].toString(16).padStart(6, '0') + '"></i>' + (H.outfit === oi && H.palette === pi ? ' ✔' : ''), () => { if (!unlocked) { this.toast('Locked — reach level ' + oi * 3); return; } H.setOutfit(oi, pi); this.openSuits(); });
          if (!unlocked) sw.classList.add('dim');
          r.appendChild(sw);
        });
        b.appendChild(r);
      });
      b.appendChild(this.el('p', { class: 'small' }, 'Outfits are cosmetic only. Switch heroes [V] to edit the other hero.'));
    });
  }
  openLog() {
    const g = this.game, M = g.missions;
    this.sub('MISSION LOG', (b) => {
      for (const d of Object.values(M.defs)) {
        const st = M.completed.has(d.id) ? '✔ Complete' : M.active && M.active.id === d.id ? '▶ Active — ' + this.objective : M.available().includes(d) ? '★ Available' : '🔒 Locked';
        const r = this.el('div', { class: 'row' }, '<span><b>' + d.title + '</b> · ' + st + '<br><small>' + d.brief + '</small></span>');
        if (M.active && M.active.id === d.id) r.appendChild(this.btn('Abandon', () => { M.abandonMission(); this.openLog(); }));
        else if (M.completed.has(d.id)) r.appendChild(this.btn('Replay', () => { M.completed.delete(d.id); this.setWaypoint(d.start); this.toast('Replay: travel to the marker'); this.openLog(); }));
        else if (M.available().includes(d)) r.appendChild(this.btn('Waypoint', () => this.setWaypoint(d.start)));
        b.appendChild(r);
      }
      b.appendChild(this.el('h3', {}, 'Activities'));
      const box = this.el('div', { class: 'cols' });
      for (const a of M.activities) box.appendChild(this.el('div', { class: 'small' }, (M.activityDone.has(a.id) ? '✔ ' : '○ ') + a.name));
      b.appendChild(box);
      b.appendChild(this.el('p', { class: 'small' }, 'Crimes stopped: ' + M.crimesDone + ' · Tech caches: ' + M.cacheFound.size + '/' + M.caches.length + ' · Photos: ' + g.progress.stats.photos));
    });
  }
  openDistricts() {
    const g = this.game, T = g.progress.trust;
    const desc = { core: 'Manhattan-style core: towers, plazas, the park.', brooklyn: 'Brooklyn-style waterfront: brownstones, warehouses, the boardwalk, elevated rail.', queens: 'Queens-style industry & tech: factories, campus, depots, highway.' };
    this.sub('DISTRICTS — CITY TRUST', (b) => {
      for (const k of ['core', 'brooklyn', 'queens']) {
        const v = T[k];
        const eff = v > 65 ? 'Civilians cheer and help; Meridian activity rare; repairs underway.' : v > 35 ? 'Mixed reactions; occasional patrols.' : 'Wary civilians, frequent Meridian patrols and crimes.';
        b.appendChild(this.el('div', { class: 'trust' }, '<b>' + k.toUpperCase() + '</b> ' + Math.round(v) + '/100<div class="bar"><i style="width:' + v + '%"></i></div><small>' + desc[k] + ' ' + eff + '</small>'));
      }
    });
  }
  /* ---------------------------------------------------------------- settings / controls / accessibility */
  slider(label, get, set, min, max, step) {
    const r = this.el('div', { class: 'row' });
    const id = 'sl' + Math.random().toString(36).slice(2);
    r.appendChild(this.el('label', { for: id }, label));
    const s = this.el('input', { type: 'range', min, max, step: step || 0.05, value: get(), id, 'aria-label': label });
    const v = this.el('span', { class: 'val' }, String(get()));
    s.oninput = () => { set(parseFloat(s.value)); v.textContent = s.value; };
    r.appendChild(s); r.appendChild(v); return r;
  }
  toggle(label, get, set) { const r = this.el('div', { class: 'row' }); r.appendChild(this.el('label', {}, label)); const b = this.btn(get() ? 'On' : 'Off', () => { set(!get()); b.textContent = get() ? 'On' : 'Off'; }); r.appendChild(b); return r; }
  openSettings() {
    const g = this.game, s = g.settings;
    this.sub('SETTINGS', (b) => {
      const qr = this.el('div', { class: 'row' }, '<label>Quality</label>');
      for (const q of ['low', 'medium', 'high', 'ultra']) qr.appendChild(this.btn((s.quality === q ? '● ' : '') + q, () => { s.quality = q; g.applyQuality(q); g.save.saveSettings(); this.toast('Quality: ' + q + ' (new areas stream at the new detail)'); this.openSettings(); }));
      b.appendChild(qr);
      b.appendChild(this.slider('Render distance', () => s.renderDist, (v) => { s.renderDist = v; g.applyQuality(s.quality); }, 200, 900, 20));
      b.appendChild(this.slider('Mouse sensitivity', () => s.sensitivity, (v) => (s.sensitivity = v), 0.2, 3));
      b.appendChild(this.toggle('Invert Y', () => s.invertY, (v) => (s.invertY = v)));
      b.appendChild(this.slider('Base FOV', () => s.baseFov, (v) => (s.baseFov = v), 50, 95, 1));
      b.appendChild(this.slider('Speed FOV effect', () => s.fovEffect, (v) => (s.fovEffect = v), 0, 1.5));
      b.appendChild(this.slider('Camera shake', () => s.shake, (v) => (s.shake = v), 0, 1.5));
      b.appendChild(this.slider('Camera auto-follow', () => s.autoFollow, (v) => (s.autoFollow = v), 0, 1.5));
      b.appendChild(this.slider('Swing camera intensity', () => s.swingCam, (v) => (s.swingCam = v), 0, 1.5));
      b.appendChild(this.toggle('Single hand swinging (off = Multi hand)', () => s.swingMode === 'single', (v) => {
        s.swingMode = v ? 'single' : 'multi';
        if (g.input) { g.input.pendingSwingHand = null; g.input.toggles.swing = false; g.input.clearEdges(g.input.intent); g.input.pressed.delete('swing'); }
        for (const k in g.heroes) { const c = g.heroes[k].ctrl; c.singleHandSwing = v; if (c.tether.main.active && c.tether.main.kind === 'swing') c.releaseSwing(false); }
        g.save.saveSettings();
      }));
      b.appendChild(this.el('p', {}, 'Single hand: hold Shift, click left/right mouse to fire that hand. Release Shift to let go; Space releases with a boost. Multi hand: original Shift-only controls.'));
      b.appendChild(this.slider('Swing Assistance', () => s.swingAssist, (v) => { s.swingAssist = v; for (const k in g.heroes) g.heroes[k].ctrl.assist = v; }, 0, 100, 5));
      b.appendChild(this.slider('Aim / chase assist', () => s.aimAssist, (v) => (s.aimAssist = v), 0, 100, 5));
      b.appendChild(this.slider('Game speed', () => s.gameSpeed, (v) => (s.gameSpeed = v), 0.5, 1.0, 0.05));
      b.appendChild(this.el('h3', {}, 'Audio'));
      const mp = g.audio && g.audio.music;
      if (mp && mp.ok) {
        b.appendChild(this.toggle('Music playlist (your mp3)', () => s.musicTrack !== false, (v) => { mp.setEnabled(v); g.save.saveSettings(); }));
        if (mp.tracks.length > 1) b.appendChild(this.btn('Next song', () => mp.next(false)));
      }
      for (const k of ['master', 'music', 'sfx', 'ambience', 'ui']) b.appendChild(this.slider(k[0].toUpperCase() + k.slice(1) + ' volume', () => s.vol[k], (v) => { s.vol[k] = v; g.audio.applyVolumes(); g.save.saveSettings(); }, 0, 1));
      b.appendChild(this.toggle('Mono audio', () => s.mono, (v) => { s.mono = v; g.audio.applyVolumes(); }));
      b.appendChild(this.toggle('Show FPS / XYZ / speed', () => s.showFps, (v) => (s.showFps = v)));
      b.appendChild(this.toggle('Physics debug (F3)', () => s.debugPhysics, (v) => (s.debugPhysics = v)));
      b.appendChild(this.toggle('Performance panel (F4)', () => s.debugPerf, (v) => (s.debugPerf = v)));
      b.appendChild(this.btn('Save settings', () => { g.save.saveSettings(); this.toast('Settings saved'); }, 'primary'));
    });
  }
  openControls() {
    const g = this.game, I = g.input;
    const names = { moveF: 'Move forward', moveB: 'Move back', moveL: 'Move left', moveR: 'Move right', jump: 'Jump / point-launch timing', swing: 'Swing modifier / sprint', dive: 'Dive', glide: 'Glide', sling: 'Slingshot / Tension Bridge', attack: 'Attack / trick', heavy: 'Heavy attack', aim: 'Aim', dodge: 'Dodge', parry: 'Parry', tether: 'Tether / point launch / reel in', interact: 'Interact', gadget: 'Use gadget', gadgetCycle: 'Cycle gadget', scan: 'Scan', heroSwitch: 'Switch hero', map: 'Map', photo: 'Photo mode', pause: 'Pause', spiderJump: 'Spider-Jump (airborne)', spiderDash: 'Spider-Dash (airborne)', citylink: 'CITYLINK', ironArms: 'Iron Spider arms — retract / deploy', ability1: 'Ability 1', ability2: 'Ability 2', ability3: 'Ability 3', ultimate: 'Ultimate', heal: 'Heal (Focus)', finisher: 'Finisher (Focus)', lockOn: 'Target lock', reelIn: 'Reel in', reelOut: 'Reel out', help: 'Help', debugPhys: 'Physics debug', debugPerf: 'Perf panel', physPause: 'Pause physics', physStep: 'Step physics' };
    this.sub('CONTROLS — click a binding, then press a key / mouse button', (b) => {
      const cols = this.el('div', { class: 'cols' });
      for (const a in names) {
        const r = this.el('div', { class: 'row' }, '<label>' + names[a] + '</label>');
        const bt = this.btn((I.bindings[a] || []).join(' / ') || '—', () => { bt.textContent = 'press…'; I.startRebind(a, () => { g.save.saveSettings(); this.openControls(); }); });
        r.appendChild(bt); cols.appendChild(r);
      }
      b.appendChild(cols);
      b.appendChild(this.el('h3', {}, 'Gamepad (standard layout) — button index'));
      const pc = this.el('div', { class: 'cols' });
      for (const a in I.padBindings) {
        const r = this.el('div', { class: 'row' }, '<label>' + (names[a] || a) + '</label>');
        const bt = this.btn('Button ' + I.padBindings[a], () => { I.padBindings[a] = (I.padBindings[a] + 1) % 17; g.save.saveSettings(); this.openControls(); });
        r.appendChild(bt); pc.appendChild(r);
      }
      b.appendChild(pc);
      b.appendChild(this.btn('Reset to defaults', () => { I.bindings = TL.Input.defaults(); I.padBindings = TL.Input.padDefaults(); g.save.saveSettings(); this.openControls(); }));
    });
  }
  openAccess() {
    const g = this.game, s = g.settings;
    this.sub('ACCESSIBILITY', (b) => {
      b.appendChild(this.toggle('Multi hand: toggle Shift instead of hold', () => s.holdToggle.swing === 'toggle', (v) => (s.holdToggle.swing = v ? 'toggle' : 'hold')));
      b.appendChild(this.slider('Swing Assistance', () => s.swingAssist, (v) => { s.swingAssist = v; for (const k in g.heroes) g.heroes[k].ctrl.assist = v; }, 0, 100, 5));
      b.appendChild(this.slider('Dodge timing window', () => s.dodgeWindow, (v) => (s.dodgeWindow = v), 0.5, 2.5));
      b.appendChild(this.slider('Parry timing window', () => s.parryWindow, (v) => (s.parryWindow = v), 0.5, 2.5));
      b.appendChild(this.toggle('Quick-time events auto-complete', () => s.qteAuto, (v) => (s.qteAuto = v)));
      b.appendChild(this.toggle('Puzzle hints', () => s.puzzleHints, (v) => (s.puzzleHints = v)));
      b.appendChild(this.btn('Skip current puzzle objective', () => { const M = g.missions; if (M.active && M.active.steps[M.active.i].type === 'puzzle') { M.nextStep(); this.toast('Puzzle skipped'); } else this.toast('No puzzle active'); }));
      b.appendChild(this.slider('Game speed', () => s.gameSpeed, (v) => (s.gameSpeed = v), 0.5, 1.0, 0.05));
      b.appendChild(this.el('h3', {}, 'Subtitles & captions'));
      b.appendChild(this.toggle('Subtitles / captions', () => s.subtitles, (v) => (s.subtitles = v)));
      b.appendChild(this.slider('Subtitle size', () => s.subSize, (v) => { s.subSize = v; this.applyAccessibility(); }, 0.7, 2));
      b.appendChild(this.slider('Subtitle background', () => s.subBg, (v) => { s.subBg = v; this.applyAccessibility(); }, 0, 1));
      b.appendChild(this.toggle('Speaker labels', () => s.speakerLabels, (v) => (s.speakerLabels = v)));
      b.appendChild(this.el('h3', {}, 'Visual'));
      b.appendChild(this.toggle('High contrast UI', () => s.highContrast, (v) => { s.highContrast = v; this.applyAccessibility(); }));
      b.appendChild(this.toggle('Enemy outlines (glow)', () => s.outlines, (v) => (s.outlines = v)));
      b.appendChild(this.slider('UI scale', () => s.uiScale, (v) => { s.uiScale = v; this.applyAccessibility(); }, 0.7, 1.6));
      b.appendChild(this.toggle('Center dot', () => s.centerDot, (v) => { s.centerDot = v; this.applyAccessibility(); }));
      b.appendChild(this.toggle('Reduced motion (camera roll/FOV/shake)', () => s.reducedMotion, (v) => (s.reducedMotion = v)));
      b.appendChild(this.slider('Peripheral speed effects', () => s.speedEffects, v => s.speedEffects=v, 0, 1));
      b.appendChild(this.slider('Wind volume', () => s.windLevel, v => s.windLevel=v, 0, 1));
      b.appendChild(this.toggle('Reduced flashes', () => s.reducedFlashes, (v) => (s.reducedFlashes = v)));
      b.appendChild(this.el('p', { class: 'small' }, 'Warnings are shape-coded (◆ dodge · ▲ parry · ● ranged · ✖ unblockable) and never rely on colour alone. Audio channels and mono are in Settings.'));
      b.appendChild(this.btn('Save', () => { g.save.saveSettings(); this.toast('Saved'); }, 'primary'));
    });
  }
  openSave() {
    const g = this.game, S = g.save;
    this.sub('SAVE / LOAD', (b) => {
      b.appendChild(this.el('p', { class: 'small' }, S.available ? 'Browser storage available. Autosave every 60 s.' : 'Browser storage is blocked for this file — use Export/Import JSON.'));
      b.appendChild(this.btn('Save now', () => S.save(), 'primary'));
      b.appendChild(this.btn('Load last save', () => { const d = S.load(); if (!d) { this.toast('No save found'); return; } S.apply(d); this.toast('Loaded'); this.closeModal(); }));
      b.appendChild(this.btn('Export Save JSON', () => S.exportJSON()));
      b.appendChild(this.btn('Import Save JSON', () => S.importJSON((d) => { S.apply(d); this.toast('Imported'); })));
      if (TL.NewGamePlus && TL.NewGamePlus.available(g)) b.appendChild(this.btn('Start New Game+ (keep skills, tougher enemies)', () => { TL.NewGamePlus.start(g); this.openSave(); }, 'primary'));
      b.appendChild(this.btn('Reset World (delete save)', () => { if (confirm('Delete your saved game and restart?')) { S.reset(); location.reload(); } }, 'danger'));
    });
  }
  openHelp(fromTitle) {
    const build = (b) => {
      b.innerHTML = '<div class="cols small">' +
        '<div><h3>Traversal</h3>WASD move · Mouse look<br>Single hand: <b>Shift + LMB / RMB</b> fires left / right hand<br>Hold Shift to keep web; release Shift to let go<br>Multi hand: Shift <b>swing</b> (original)<br>Shift also sprints on ground<br>Space jump · jump at release = boost<br>Space on point-launch arrival = <b>launch</b><br>E point-launch to the ◇ edge marker<br>E (swinging) reel in · Wheel reel in/out<br>W while swinging = pump · A/D steer<br>Ctrl dive · Z glide (W/S pitch, A/D bank)<br>X slingshot (hold to pull back, release)<br>Sprint into walls to wall-run; Space leaps off<br>Attack in the air (no enemies) = tricks</div>' +
        '<div><h3>Combat</h3>LMB attack (chains) · T heavy / launcher<br>Ctrl+LMB in air = ground slam / Pulse Dive<br>Q dodge (perfect dodge) · F parry (perfect parry)<br>RMB aim · Aim+E tether pull / strike / disarm / throw<br>1-3 abilities · Aim+1/2 alt abilities · 4 ultimate<br>R gadget · Tab cycle · H heal · G finisher<br>MMB / L target lock<br>Stealth: attack an unaware enemy = takedown<br>X while perched = Tension Bridge</div>' +
        '<div><h3>World</h3>C scan · V switch hero · M map<br>B Spider-Jump · N Spider-Dash<br>Q wing dodge · E air zip / point zip<br>E + A/D while swinging: corner tether<br>Ctrl during a fast swing: loop reel<br>J retract / deploy arms · K CITYLINK<br>Routes: E at a route start · Backspace restart<br>P photo mode · Esc pause<br>F1 help · F3 physics debug · F4 perf<br>[ pause physics · ] step one tick<br><br><h3>Gamepad</h3>RT swing · A jump · X attack · B dodge<br>RB parry · Y tether · LB gadget · LT aim<br>L3 dive · R3 lock · D-pad: scan/switch/glide/sling<br>Start pause · Back map</div></div>';
    };
    const fullBuild=body=>{build(body);body.appendChild(this.el('p',{class:'small'},'Surface flow: keep steering along a wall to round clear corners. Fast upward runs carry over clear roof edges; overhead contact transitions into ceiling crawl. Holding your swing keeps the web on wall contact. Space pushes off. K → City in motion starts chases, vehicle interceptions and rescues; E acts when the nearby prompt appears.'));body.appendChild(this.el('p',{class:'small'},'Construction sites: orange diamonds on M, or K → Worksite runs. While airborne, face a clear pipe or water-tower opening and press E to zip through. Swing from crane beams, run the open floors, or press E at a nearby orange start marker to race.'));};
    if (fromTitle) this.openModal('CONTROLS', fullBuild, { back: () => {} });
    else this.openModal('HELP', fullBuild);
  }
  /* ---------------------------------------------------------------- photo mode */
  openPhoto() {
    const g = this.game, P = g.rig.photo;
    this.hud.classList.add('photo');
    const panel = this.$('photoPanel'); panel.style.display = 'block'; panel.innerHTML = '<h3>PHOTO MODE</h3>';
    try { document.exitPointerLock(); } catch (e) { /* ignore */ }
    const add = (n) => panel.appendChild(n);
    add(this.toggle('Orbit camera (off = free)', () => P.orbit, (v) => (P.orbit = v)));
    add(this.slider('FOV', () => P.fov, (v) => (P.fov = v), 20, 110, 1));
    add(this.slider('Roll', () => P.roll, (v) => (P.roll = v), -0.8, 0.8, 0.01));
    add(this.slider('Distance', () => P.dist, (v) => (P.dist = v), 2, 30, 0.5));
    add(this.slider('Exposure', () => g.expBase || 1, (v) => (g.expBase = v), 0.3, 2.5));
    add(this.slider('Focus blur (DOF approx.)', () => this._dof || 0, (v) => { this._dof = v; this.$('dof').style.backdropFilter = this.$('dof').style.webkitBackdropFilter = 'blur(' + v + 'px)'; this.$('dof').style.display = v > 0 ? 'block' : 'none'; }, 0, 8, 0.5));
    add(this.slider('Time of day preview', () => g.env.hour, (v) => { g.env.hour = v; g.env.update(0.0001, g.hero.ctrl.pos); }, 0, 23.9, 0.1));
    const fr = this.el('div', { class: 'row wrap' }, '<label>Filter</label>');
    const filters = { none: '', noir: 'grayscale(1) contrast(1.3)', warm: 'sepia(0.35) saturate(1.3)', cool: 'hue-rotate(-15deg) saturate(1.1) brightness(1.05)', vivid: 'saturate(1.6) contrast(1.1)', retro: 'sepia(0.6) contrast(0.9) brightness(1.05)' };
    for (const k in filters) fr.appendChild(this.btn(k, () => { g.canvas.style.filter = filters[k]; }));
    add(fr);
    const pr = this.el('div', { class: 'row wrap' }, '<label>Pose</label>');
    for (const k of ['heavy', 'kick', 'cast', 'parry', 'launcher']) pr.appendChild(this.btn(k, () => g.hero.anim.startAction(k, 99)));
    for (const k of ['flip', 'corkscrew']) pr.appendChild(this.btn(k, () => g.hero.anim.startTrick(k)));
    add(pr);
    add(this.btn('Hide / show HUD & panel [H]', () => { panel.classList.toggle('hidden'); }));
    add(this.btn('Take photo (PNG)', () => this.takePhoto(), 'primary'));
    add(this.btn('Exit photo mode [Esc]', () => g.exitPhotoMode()));
    add(this.el('p', { class: 'small' }, 'Drag to rotate · WASD/QE move (free cam) · wheel zoom'));
    this._photoDrag = (e) => { if (e.buttons & 1 && e.target === g.canvas) { P.yaw -= e.movementX * 0.005; P.pitch = TL.clamp(P.pitch - e.movementY * 0.005, -1.4, 1.4); } };
    this._photoWheel = (e) => { P.dist = TL.clamp(P.dist + e.deltaY * 0.01, 2, 30); };
    this._photoKey = (e) => { if (e.code === 'KeyH') panel.classList.toggle('hidden'); };
    window.addEventListener('mousemove', this._photoDrag); window.addEventListener('wheel', this._photoWheel); window.addEventListener('keydown', this._photoKey);
    this._photoMove = setInterval(() => {
      if (P.orbit) return; const I = g.input, sp = 0.4;
      const f = new THREE.Vector3(-Math.sin(P.yaw), 0, -Math.cos(P.yaw)), r = new THREE.Vector3(Math.cos(P.yaw), 0, -Math.sin(P.yaw));
      if (I.keys.has('KeyW')) P.pos.addScaledVector(f, sp); if (I.keys.has('KeyS')) P.pos.addScaledVector(f, -sp);
      if (I.keys.has('KeyD')) P.pos.addScaledVector(r, sp); if (I.keys.has('KeyA')) P.pos.addScaledVector(r, -sp);
      if (I.keys.has('KeyE')) P.pos.y += sp; if (I.keys.has('KeyQ')) P.pos.y -= sp;
    }, 16);
  }
  takePhoto() {
    const g = this.game;
    TL.Comic.render(g.renderer, g.scene, g.camera);
    const url = g.canvas.toDataURL('image/png');
    const a = document.createElement('a'); a.href = url; a.download = 'threadline_photo.png'; a.click();
    const lm = g.missions.photoTaken(g.camera.position);
    this.toast(lm ? 'Photo landmark captured: ' + lm : 'Photo saved');
  }
  closePhoto() {
    const g = this.game;
    this.hud.classList.remove('photo'); this.$('photoPanel').style.display = 'none'; g.canvas.style.filter = ''; this.$('dof').style.display = 'none';
    window.removeEventListener('mousemove', this._photoDrag); window.removeEventListener('wheel', this._photoWheel); window.removeEventListener('keydown', this._photoKey);
    clearInterval(this._photoMove);
    g.expBase = 1.0;
    g.hero.anim.action = null;
  }
  /* ---------------------------------------------------------------- gamepad menu navigation */
  padNav(dt) {
    const I = this.game.input; if (!I) return; const p = I.padState(); if (!p) return;
    this.padNavT -= dt; if (this.padNavT > 0) return;
    const root = this.modal ? this.modal.el : document;
    const items = Array.from(root.querySelectorAll('button, input, select')).filter((e) => e.offsetParent !== null);
    if (!items.length) return;
    let i = items.indexOf(document.activeElement);
    const up = p.buttons[12] && p.buttons[12].pressed || (p.axes[1] || 0) < -0.6, down = p.buttons[13] && p.buttons[13].pressed || (p.axes[1] || 0) > 0.6;
    if (down) { i = (i + 1) % items.length; items[i].focus(); this.padNavT = 0.18; }
    else if (up) { i = (i - 1 + items.length) % items.length; items[i].focus(); this.padNavT = 0.18; }
    else if (p.buttons[0] && p.buttons[0].pressed) { if (document.activeElement && document.activeElement.click) document.activeElement.click(); this.padNavT = 0.3; }
    else if (p.buttons[1] && p.buttons[1].pressed) { this.closeModal(); this.padNavT = 0.3; }
  }
};
