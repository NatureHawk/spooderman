/* =====================================================================================
   EXTRAS — systems layered on top of CORE without touching its logic:
   * PartnerAI      — the inactive hero joins selected crimes as an AI partner (CORE requirement)
   * FastTravel     — (stretch) in-engine overview flight to a map waypoint, no loading screen
   * NewGamePlus    — (stretch) replay the story with kept progression and tougher Meridian
   * Radio          — (stretch) reactive procedural "City Radio" commentary as captions + CITYLINK feed
   * Haptics        — (stretch) gamepad rumble on hits, impacts, parries
   * Storm weather  — (stretch) fog storms and snow reuse the weather/rain pipeline
   STUBS (clearly not implemented; no dead buttons reference them):
   // STUB: Replay editor / cinematic paths — record hero transforms per tick into a ring buffer and
   //        play them back with a spline camera editor in photo mode.
   // STUB: Optional local ZIP loader for user-supplied original assets — parse a user-selected .zip
   //        (JSZip from cdnjs) of GLB files and swap asset geometries by name.
   // STUB: WebXR spectator mode — navigator.xr.requestSession('immersive-vr') with a spectator rig
   //        following the hero's camera; disabled by default.
   // STUB: Fire/rescue simulation and destructible set pieces — cellular fire spread on building
   //        faces with carry-out rescues; breakable scaffold pieces as rigid bodies.
   // STUB: Additional interiors, bosses and advanced partner combos beyond the WARDEN fight.
   ===================================================================================== */
'use strict';

TL.PartnerAI = class {
  constructor(game) { this.game = game; this.active = false; this.hero = null; this.t = 0; this.atkT = 0; }
  maybeJoin(crime) {
    const g = this.game;
    if (!crime || crime.group === undefined || !(crime.type === 'assault' || crime.type === 'drones' || crime.type === 'theft')) return;
    if (Math.random() > 0.55) return;
    this.hero = g.heroes[g.heroName === 'WEAVER' ? 'PULSE' : 'WEAVER'];
    this.home = this.hero.ctrl.pos.clone();
    const p = crime.p.clone().add(new THREE.Vector3(-6, 0, -4));
    this.hero.ctrl.teleport(p.x, p.y + 12, p.z);
    this.active = true; this.crime = crime; this.t = 0;
    g.ui.caption((this.hero.name === 'PULSE' ? 'PULSE' : 'WEAVER') + ': "I\'m nearby — moving in!"', this.hero.name);
    g.missions.pushFeed(this.hero.name + ' joined the response as your partner', 'crime');
  }
  update(dt) {
    if (!this.active) return;
    const g = this.game, c = this.hero.ctrl;
    this.t += dt; this.atkT -= dt;
    if (!g.missions.crime || g.missions.crime !== this.crime || this.hero.active) { this.leave(); return; }
    // simple partner brain: approach the nearest hostile, strike with its hero-specific moves
    const e = g.ai.nearestEnemy(c.pos, 60);
    const intent = { move: new THREE.Vector3(), moveLocal: { x: 0, y: 0 }, camFwd: new THREE.Vector3(0, 0, 1), camRight: new THREE.Vector3(1, 0, 0), jump: false, swing: false, dive: false, sling: false, reelIn: 0, reelOut: 0 };
    if (e) {
      const to = e.pos.clone().sub(c.pos); to.y = 0; const d = to.length();
      if (d > 2.6) { intent.move.copy(to.normalize()); intent.sprint = d > 10; }
      if (d < 3.2 && this.atkT <= 0) {
        this.atkT = this.hero.name === 'PULSE' ? 0.8 : 1.1;
        const kb = to.clone().normalize().multiplyScalar(6).setY(3);
        e.hit(this.hero.name === 'PULSE' ? 11 : 15, kb, 'light');
        if (this.hero.name === 'PULSE' && Math.random() < 0.3) e.stun(1.0);
        this.hero.anim.startAction(Math.random() < 0.5 ? 'jab' : 'kick', 0.4, e.pos, Math.random() < 0.5 ? 1 : -1);
        g.audio.sfx('punch');
      }
    }
    c.step(dt, intent);
  }
  leave() {
    if (!this.active) return;
    this.active = false;
    if (!this.hero.active) this.hero.ctrl.teleport(this.home.x, this.home.y, this.home.z);
  }
};

TL.Radio = class {
  constructor(game) {
    this.game = game; this.cool = 30;
    this.lines = {
      crime: ['City Radio: reports of a masked figure stopping trouble downtown.', 'City Radio: another Meridian crew webbed up for the police. Nice.', 'City Radio: listeners say the filament hero was "surprisingly polite."'],
      mission: ['City Radio: the Tension Bridge is open again after this morning\'s scare.', 'City Radio: Lumen Campus confirms a break-in was stopped overnight.', 'City Radio: power is returning to the core. Whoever did that — thank you.'],
      trustLow: ['City Radio: residents are split on the vigilantes swinging over their roofs.'],
      trustHigh: ['City Radio: trust in the city\'s new protectors is at an all-time high.'],
      rain: ['City Radio: heavy rain tonight — careful out there, and that goes for anyone swinging between towers.'],
      idle: ['City Radio: traffic is heavy on the avenues, smooth on the rooftops.', 'City Radio: Meridian Construction denies any wrongdoing. Again.'],
    };
    TL.bus.on('crime:end', (ok) => ok && this.say('crime'));
    TL.bus.on('mission:complete', () => this.say('mission'));
  }
  say(kind) {
    const g = this.game, arr = this.lines[kind]; if (!arr || this.cool > 0 && kind === 'idle') return;
    const line = arr[Math.floor(Math.random() * arr.length)];
    g.ui.caption(line, 'City Radio'); g.missions.pushFeed(line, 'story'); this.cool = 60;
  }
  update(dt) {
    const g = this.game;
    this.cool -= dt;
    if (this.cool <= 0) {
      const t = g.progress.trustAt(g.hero.ctrl.pos);
      this.say(g.env.rain > 0.5 ? 'rain' : t > 70 ? 'trustHigh' : t < 25 ? 'trustLow' : 'idle');
      this.cool = 90 + Math.random() * 60;
    }
  }
};

TL.Haptics = {
  pulse(strength, ms) {
    try {
      const g = TL.game; if (!g || !g.input) return;
      const p = g.input.padState(); if (!p || !p.vibrationActuator || !p.vibrationActuator.playEffect) return;
      p.vibrationActuator.playEffect('dual-rumble', { duration: ms || 80, strongMagnitude: TL.clamp(strength, 0, 1), weakMagnitude: TL.clamp(strength * 0.6, 0, 1) });
    } catch (e) { /* haptics unsupported */ }
  },
};

/* ------------------------------------------------------------------ install hooks */
TL.installExtras = function (g) {
  g.partner = new TL.PartnerAI(g);
  g.radio = new TL.Radio(g);
  // partner joins selected crimes
  const startCrime = g.missions.startCrime.bind(g.missions);
  g.missions.startCrime = (type) => { startCrime(type); g.partner.maybeJoin(g.missions.crime); };
  const endCrime = g.missions.endCrime.bind(g.missions);
  g.missions.endCrime = (ok, silent) => { const had = !!g.missions.crime; endCrime(ok, silent); if (had && !silent) TL.bus.emit('crime:end', ok); g.partner.leave(); };
  const complete = g.missions.completeMission.bind(g.missions);
  g.missions.completeMission = () => { complete(); TL.bus.emit('mission:complete'); };
  // haptics on combat feedback
  const hitLanded = g.combat.onHitLanded.bind(g.combat);
  g.combat.onHitLanded = (t, stop, dmg) => { hitLanded(t, stop, dmg); TL.Haptics.pulse(dmg > 18 ? 0.6 : 0.3, 60); };
  const hurt = g.combat.hurtHero.bind(g.combat);
  g.combat.hurtHero = (dmg, warn, from, kb) => { const r = hurt(dmg, warn, from, kb); if (r === 'hit') TL.Haptics.pulse(0.8, 140); if (r === 'parried') TL.Haptics.pulse(0.5, 60); return r; };
  TL.bus.on('hero:hardland', () => TL.Haptics.pulse(0.9, 180));
  // New Game+: tougher Meridian when enabled
  const spawnGroup = g.ai.spawnGroup.bind(g.ai);
  g.ai.spawnGroup = (types, at, opts) => { const id = spawnGroup(types, at, opts); if (g.ngPlus) { const G = g.ai.groups.get(id); if (G) for (const e of G.members) { e.hp *= 1.5; e.maxHp *= 1.5; } } return id; };
};

TL.FastTravel = {
  go(g, p) {
    if (!p || g.switching || g.missions.active) { g.ui.toast(g.missions.active ? 'Fast travel is unavailable during missions' : 'Set a waypoint first'); return; }
    const hit = g.world.raycast(p.x, 420, p.z, 0, -1, 0, 430, null);
    const dest = new THREE.Vector3(p.x, (hit ? hit.y : 0) + 2, p.z);
    g.switching = true;
    g.rig.startOverview(g.hero.ctrl.pos.clone(), dest, () => { g.switching = false; g.hero.ctrl.teleport(dest.x, dest.y, dest.z); g.streamer.forceLoadAround(dest, 90); g.ui.toast('Arrived'); });
  },
};

TL.NewGamePlus = {
  available(g) { return g.missions.completed.size >= 3; },
  start(g) {
    g.ngPlus = (g.ngPlus || 0) + 1;
    g.missions.completed.clear();
    g.missions.pushFeed('NEW GAME+ ' + g.ngPlus + ': the story restarts; skills kept; Meridian is tougher.', 'story');
    g.ui.toast('NEW GAME+ ' + g.ngPlus + ' started');
  },
};

/* storm weather: fog and snow reuse the weather pipeline (rain system renders snow as slow white flakes) */
TL.installWeatherExtras = function (g) {
  const env = g.env;
  const upd = env.update.bind(env);
  env.update = (dt, focus) => {
    upd(dt, focus);
    if (env.weather === 'fog') { env.fog.near = 20; env.fog.far = TL.lerp(env.fog.far, 180, 0.05); env.sun.intensity *= 0.5; }
    if (env.weather === 'snow') { env.fog.far = Math.min(env.fog.far, 320); }
  };
  const rain = g.rain; const rupd = rain.update.bind(rain);
  rain.update = (dt, cam, wind, intensity) => {
    const snow = env.weather === 'snow';
    rupd(dt, cam, wind, snow ? (g.quality === 'low' ? 0.32 : 0.8) : intensity, snow);
  };
  const origPick = () => { const r = Math.random(); return r < 0.22 ? 'rain' : r < 0.3 ? 'fog' : r < 0.34 ? 'snow' : 'clear'; };
  const eu = env.update;
  env.weatherPicker = origPick;
  void eu;
};
