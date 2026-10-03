/* =====================================================================================
   SaveManager — localStorage persistence with JSON export/import fallback (file:// storage can be
   blocked in some browsers). Saves: seed, hero positions + selection, story/missions, activities,
   crimes, trust, XP/skills, gadgets, outfits, time/weather, settings, controls, accessibility.
   ===================================================================================== */
'use strict';

TL.SaveManager = class {
  constructor(game) { this.game = game; this.KEY = 'threadline_save_v1'; this.SKEY = 'threadline_settings_v1'; this.autoT = 60; this.available = this.test(); }
  test() { try { localStorage.setItem('__tl', '1'); localStorage.removeItem('__tl'); return true; } catch (e) { return false; } }
  hasSave() { if (!this.available) return false; try { return !!localStorage.getItem(this.KEY); } catch (e) { return false; } }
  loadSettings() {
    if (!this.available) return;
    try {
      const s = JSON.parse(localStorage.getItem(this.SKEY) || 'null');
      if (s) this.game.settings = Object.assign(TL.defaultSettings(), s, { vol: Object.assign(TL.defaultSettings().vol, s.vol || {}), holdToggle: Object.assign(TL.defaultSettings().holdToggle, s.holdToggle || {}) });
    } catch (e) { TL.logError(e, 'settings'); }
  }
  saveSettings() {
    const g = this.game;
    if (g.input) { g.settings.bindings = g.input.bindings; g.settings.padBindings = g.input.padBindings; }
    if (!this.available) return;
    try { localStorage.setItem(this.SKEY, JSON.stringify(g.settings)); } catch (e) { TL.logError(e, 'settings-save'); }
  }
  snapshot() {
    const g = this.game;
    const hp = (h) => ({ x: +h.ctrl.pos.x.toFixed(2), y: +h.ctrl.pos.y.toFixed(2), z: +h.ctrl.pos.z.toFixed(2), health: h.ctrl.health, outfit: h.outfit, palette: h.palette });
    return {
      v: 1, t: Date.now(), seed: g.seed, hero: g.heroName,
      heroes: { WEAVER: hp(g.heroes.WEAVER), PULSE: hp(g.heroes.PULSE) },
      time: g.env ? g.env.hour : 16.5, weather: g.env ? g.env.weather : 'clear',
      progress: g.progress ? g.progress.serialize() : null,
      missions: g.missions ? g.missions.serialize() : null,
      routes: g.routes ? g.routes.serialize() : null,
      encounters: g.encounters ? g.encounters.serialize() : null,
      combat: g.combat ? g.combat.serialize() : null,
      settings: g.settings, ngPlus: g.ngPlus || 0,
    };
  }
  save(silent) {
    const data = this.snapshot();
    this.saveSettings();
    if (!this.available) { if (!silent) this.game.ui.toast('Browser storage unavailable — use Export Save'); return false; }
    try { localStorage.setItem(this.KEY, JSON.stringify(data)); if (!silent) this.game.ui.toast('Game saved'); return true; }
    catch (e) { TL.logError(e, 'save'); if (!silent) this.game.ui.toast('Save failed — use Export Save'); return false; }
  }
  load() { try { return JSON.parse(localStorage.getItem(this.KEY) || 'null'); } catch (e) { return null; } }
  apply(d) {
    const g = this.game;
    if (!d) return;
    for (const n of ['WEAVER', 'PULSE']) {
      const h = d.heroes && d.heroes[n]; if (!h) continue;
      g.heroes[n].ctrl.teleport(h.x, h.y + 0.5, h.z); g.heroes[n].ctrl.health = h.health || 100;
      g.heroes[n].setOutfit(h.outfit || 0, h.palette || 0);
    }
    if (d.hero && d.hero !== g.heroName) g.setActiveHero(d.hero, true);
    if (g.env) { g.env.hour = d.time || 16.5; g.env.weather = d.weather || 'clear'; }
    if (d.progress && g.progress) g.progress.deserialize(d.progress);
    if (d.missions && g.missions) g.missions.deserialize(d.missions);
    if (d.routes && g.routes) g.routes.deserialize(d.routes);
    if (d.encounters && g.encounters) g.encounters.deserialize(d.encounters);
    if (d.combat && g.combat) g.combat.deserialize(d.combat);
    if (d.settings) { g.settings = Object.assign(TL.defaultSettings(), d.settings); }
    g.ngPlus = d.ngPlus || 0;
  }
  reset() { try { localStorage.removeItem(this.KEY); } catch (e) { /* ignore */ } }
  exportJSON() {
    const blob = new Blob([JSON.stringify(this.snapshot(), null, 1)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'threadline_save.json';
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  importJSON(cb) {
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'application/json,.json';
    inp.onchange = () => {
      const f = inp.files[0]; if (!f) return;
      const r = new FileReader();
      r.onload = () => { try { const d = JSON.parse(r.result); if (!d || !d.heroes) throw new Error('Not a THREADLINE save'); if (this.available) localStorage.setItem(this.KEY, JSON.stringify(d)); cb && cb(d); } catch (e) { this.game.ui.toast('Import failed: ' + e.message); } };
      r.readAsText(f);
    };
    inp.click();
  }
  update(dt) {
    if (this.game.state !== 'play') return;
    this.autoT -= dt;
    if (this.autoT <= 0) { this.autoT = 60; this.save(true); this.game.ui.autosaveBlip(); }
  }
};
