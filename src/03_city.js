/* =====================================================================================
   CITY — CityLayout (global deterministic functions), CityGenerator (per-chunk data from the seed),
   WorldStreamer (meshes, instanced props, colliders, streaming/LOD), facade/ground/water materials.
   Grid: road centerlines every 80 m (x = 80k, z = 80k), 16 m roads, 3 m sidewalks, blocks 64x64.
   Districts: Manhattan-style CORE (x < 160) | river (168..312) | BROOKLYN (x > 320, z < 0) |
              QUEENS (x > 320, z >= 0). Suspension bridge on the z = -160 road.
   ===================================================================================== */
'use strict';

TL.CityLayout = class {
  constructor(seed) {
    this.seed = seed >>> 0;
    const C = TL.C;
    this.cell = C.CELL; this.half = C.CITY_HALF; this.roadW = C.ROAD_W;
    this.rx0 = C.RIVER_X0; this.rx1 = C.RIVER_X1; this.bridgeZ = C.BRIDGE_Z;
    this.park = { i0: -6, i1: -4, j0: -1, j1: 3 };        // central park blocks (core)
    this.special = {
      wardenSite: { i: -2, j: 1 },     // construction site: WARDEN phases 1 & 3
      campus: { i: 6, j: 4 },          // research campus (SILENT FREQUENCY)
      warehouse: { i: 7, j: 2 },       // mission interior
      tallest: { i: -4, j: -3 },       // skyscraper for WARDEN phase 2 / rooftop battle
      spawn: { i: -3, j: -4 },         // spawn rooftop (mid-rise among downtown towers)
      depot: { i: 9, j: 6 },
    };
    this.railX = 480; this.railZ0 = -760; this.railZ1 = -80;       // Brooklyn elevated rail
    this.hwyZ = 240; this.hwyX0 = 336; this.hwyX1 = 800;           // Queens elevated highway
  }
  district(x, z) {
    if (x < this.rx0 - 8) return 'core';
    if (x <= this.rx1 + 8) return 'river';
    return z < 0 ? 'brooklyn' : 'queens';
  }
  blockOf(x, z) { return { i: Math.floor(x / this.cell), j: Math.floor(z / this.cell) }; }
  blockCenter(i, j) { return { x: (i + 0.5) * this.cell, z: (j + 0.5) * this.cell }; }
  isRiverX(x) { return x > this.rx0 && x < this.rx1; }
  onBridge(x, z) { return x >= this.rx0 - 2 && x <= this.rx1 + 2 && Math.abs(z - this.bridgeZ) < 13; }
  isWater(x, z) {
    if (Math.abs(x) > this.half + 20 || Math.abs(z) > this.half + 20) return true;   // harbor around the city
    return this.isRiverX(x) && !this.onBridge(x, z);
  }
  inPark(i, j) { const p = this.park; return i >= p.i0 && i <= p.i1 && j >= p.j0 && j <= p.j1; }
  isBlockWater(i, j) { const c = this.blockCenter(i, j); return this.isRiverX(c.x) || Math.abs(c.x) > this.half || Math.abs(c.z) > this.half; }
  ground(x, z) { return this.isWater(x, z) ? TL.C.WATER_Y - 14 : 0; }
  /* does a road exist along x = X between z0..z1 (north-south avenue) */
  roadNS(X) { return !this.isRiverX(X) && Math.abs(X) <= this.half; }
  roadEW(Z, x) {
    if (Math.abs(Z) > this.half) return false;
    if (this.isRiverX(x)) return Math.abs(Z - this.bridgeZ) < 1;
    return true;
  }
  /* lane graph helpers for traffic: is the road segment between two intersections drivable */
  segOK(ax, az, bx, bz) {
    const mx = (ax + bx) / 2, mz = (az + bz) / 2;
    if (Math.abs(ax) > this.half || Math.abs(bx) > this.half || Math.abs(az) > this.half || Math.abs(bz) > this.half) return false;
    if (ax === bx) { // NS segment at x = ax
      if (this.isRiverX(ax)) return false;
      // park: interior roads removed
      const i = Math.floor(ax / this.cell);
      if (this.inPark(i, Math.floor(mz / this.cell)) && this.inPark(i - 1, Math.floor(mz / this.cell))) return false;
      return true;
    }
    if (this.isRiverX(mx)) return Math.abs(az - this.bridgeZ) < 1;
    const j = Math.floor(az / this.cell);
    if (this.inPark(Math.floor(mx / this.cell), j) && this.inPark(Math.floor(mx / this.cell), j - 1)) return false;
    return true;
  }
  /* skyline height field for the core: downtown + midtown clusters */
  coreHeight(x, z, r) {
    const d1 = Math.hypot(x + 300, z + 420), d2 = Math.hypot(x + 220, z - 300), d3 = Math.hypot(x + 320, z + 240);
    const peak = Math.max(1 - d1 / 330, 1 - d2 / 300, (1 - d3 / 160) * 1.2, 0);
    return 45 + peak * 200 * (0.55 + 0.45 * r);
  }
};

/* ------------------------------------------------------------------ building styles */
TL.FACADE = {
  GLASS: 0, STONE: 1, BRICK: 2, INDUSTRIAL: 3, BROWNSTONE: 4, OFFICE: 5,
  colors: {
    0: [0x5a7890, 0x46637a, 0x6a8aa0, 0x3f5a70, 0x7a9aa8],
    1: [0xb8ad98, 0xa89c86, 0xc7bca6, 0x9c9282, 0xd0c8b8],
    2: [0x8a4a36, 0x7a3e2e, 0x9a5842, 0x6e3a2c, 0xa06048],
    3: [0x8d8b86, 0x7a7870, 0x9a968a, 0x6f6c66, 0xa39e92],
    4: [0x6e4636, 0x5e3a2e, 0x7a5040, 0x8a5a44],
    5: [0xa3a39c, 0x8f9194, 0xb6b2a8, 0x7d8286],
  },
};

TL.CityGenerator = class {
  constructor(layout) { this.L = layout; }
  rng(i, j, salt) { return new TL.RNG(TL.hash2(i * 7 + (salt | 0), j * 13 - (salt | 0), this.L.seed)); }
  /* Returns chunk data (pure data, no THREE objects): buildings (mass boxes), props, special structures. */
  chunk(i, j) {
    const L = this.L, C = L.cell;
    const out = { i, j, masses: [], props: [], cranes: [], updrafts: [], extra: [], district: '', blockX0: i * C + 8, blockZ0: j * C + 8, landmark: null, lots: [] };
    const cx = (i + 0.5) * C, cz = (j + 0.5) * C;
    out.district = L.district(cx, cz);
    out.cx = cx; out.cz = cz;
    if (Math.abs(cx) > L.half || Math.abs(cz) > L.half) { out.empty = true; return out; }
    // river blocks: bridge pieces are added by the special-structure pass
    if (L.isRiverX(cx)) { this.riverChunk(out, i, j); return out; }
    const rng = this.rng(i, j, 1);
    this.streetProps(out, i, j, rng);
    const sp = L.special;
    if (L.inPark(i, j)) { this.parkBlock(out, i, j, rng); }
    else if (i === sp.wardenSite.i && j === sp.wardenSite.j) this.constructionBlock(out, i, j, rng, true);
    else if (i === sp.campus.i && j === sp.campus.j) this.campusBlock(out, i, j, rng);
    else if (i === sp.warehouse.i && j === sp.warehouse.j) this.warehouseBlock(out, i, j, rng);
    else if (out.district === 'core') this.coreBlock(out, i, j, rng);
    else if (out.district === 'brooklyn') this.brooklynBlock(out, i, j, rng);
    else this.queensBlock(out, i, j, rng);
    // riverside esplanade details
    if (i === Math.floor(L.rx1 / C) + 0 && out.district === 'brooklyn') this.boardwalk(out, i, j, rng);
    this.elevated(out, i, j);
    return out;
  }
  /* ---------------------------------------------------------------- building masses
     mass: {x,z,w,d,y0,h, style, color, floorH, seed, kind:'building', crown?, roofProps?, litGroup} */
  addTower(out, x, z, w, d, h, style, rng, opts) {
    opts = opts || {};
    const col = TL.FACADE.colors[style][rng.int(0, TL.FACADE.colors[style].length - 1)];
    const trim = style === TL.FACADE.GLASS ? 0x9aa4ac : style === TL.FACADE.BRICK ? 0xc8bcaa : 0x6e6a62;
    const seed = rng.int(1, 9999);
    const floorH = style === TL.FACADE.BROWNSTONE ? 3.3 : style === TL.FACADE.INDUSTRIAL ? 5.0 : 3.6;
    const parts = [];
    let y0 = 0;
    // podium
    if (h > 60 && !opts.noPodium) {
      const ph = rng.int(3, 5) * floorH;
      parts.push({ x, z, w, d, y0: 0, h: ph, style: style === TL.FACADE.GLASS ? TL.FACADE.STONE : style, color: style === TL.FACADE.GLASS ? 0xa89c86 : col });
      y0 = ph; w -= rng.range(3, 7); d -= rng.range(3, 7);
    }
    // shaft + setbacks
    const tiers = h > 140 ? rng.int(2, 3) : h > 70 ? rng.int(1, 2) : 1;
    let remain = h - y0;
    for (let t = 0; t < tiers; t++) {
      const th = t === tiers - 1 ? remain : remain * rng.range(0.45, 0.62);
      parts.push({ x, z, w, d, y0, h: th, style, color: col });
      y0 += th; remain -= th;
      if (t < tiers - 1) { w *= rng.range(0.72, 0.86); d *= rng.range(0.72, 0.86); }
    }
    for (const p of parts) { p.floorH = floorH; p.seed = seed; p.trim = trim; p.kind = 'building'; out.masses.push(p); }
    const top = parts[parts.length - 1];
    const roofY = top.y0 + top.h;
    // crowns and roof equipment
    if (h > 110 && rng.chance(0.75)) {
      const cr = rng.pick(['C_crown_deco', 'C_crown_pyramid', 'C_crown_slant', 'C_crown_mech', 'C_crown_dome']);
      out.props.push({ a: cr, x, y: roofY, z, sx: top.w / 20, sy: Math.min(top.w, top.d) / 20, sz: top.d / 20, yaw: rng.int(0, 3) * Math.PI / 2, crown: true, slotCol: col, trimCol: trim, col: true });
    } else this.roofKit(out, top, roofY, rng, style);
    return { parts, roofY, top };
  }
  roofKit(out, top, roofY, rng, style) {
    const n = Math.floor(top.w * top.d / 250) + 1;
    const hx = top.w / 2 - 3, hz = top.d / 2 - 3;
    if (hx < 2 || hz < 2) return;
    const used = [];
    const place = (a, r) => {
      for (let k = 0; k < 6; k++) {
        const px = top.x + rng.range(-hx, hx), pz = top.z + rng.range(-hz, hz);
        if (used.every((u) => Math.hypot(u[0] - px, u[1] - pz) > u[2] + r)) { used.push([px, pz, r]); out.props.push({ a, x: px, y: roofY, z: pz, yaw: rng.int(0, 3) * Math.PI / 2, col: true }); return { x: px, z: pz }; }
      }
      return null;
    };
    if (style !== TL.FACADE.GLASS && rng.chance(0.55)) place('P_water_tower', 3);
    place('P_roof_hut', 3);
    for (let k = 0; k < Math.min(4, n); k++) place(rng.chance(0.7) ? 'P_hvac' : 'P_vent_stack', 2.2);
    if (rng.chance(0.3)) place('P_antenna', 1);
    if (rng.chance(0.25)) place('C_roof_garden', 3.5);
    const v = out.props.filter((p) => p.a === 'P_vent_stack' && p.y === roofY);
    for (const p of v) out.updrafts.push({ x: p.x, z: p.z, r: 7, h0: roofY, h1: roofY + 45, s: 14, kind: 'vent' });
    if (rng.chance(0.18) && top.w > 16) {
      // rooftop billboard facing the street
      out.props.push({ a: 'P_billboard', x: top.x, y: roofY, z: top.z + top.d / 2 - 2, yaw: 0, col: true, billboard: rng.int(0, 7) });
    }
  }
  coreBlock(out, i, j, rng) {
    const L = this.L, C = L.cell;
    const x0 = i * C + 11, z0 = j * C + 11, S = C - 22;       // lot area inside sidewalks (58 m)
    const cx = x0 + S / 2, cz = z0 + S / 2;
    const isTall = i === L.special.tallest.i && j === L.special.tallest.j;
    const isSpawn = i === L.special.spawn.i && j === L.special.spawn.j;
    if (isTall) {
      const t = this.addTower(out, cx, cz, 44, 44, 300, TL.FACADE.GLASS, rng);
      out.landmark = { name: 'Meridian Spire', x: cx, y: t.roofY, z: cz };
      return;
    }
    if (isSpawn) {
      // spawn: a mid-rise with a flat textured roof overlooking the core, neighbors lower
      const t = this.addTower(out, cx - 12, cz, 30, 50, 46, TL.FACADE.STONE, rng, { noPodium: true });
      out.spawn = { x: cx - 12, y: t.roofY + 1.2, z: cz };
      this.addTower(out, cx + 17, cz - 12, 22, 26, 150, TL.FACADE.GLASS, rng);
      this.addTower(out, cx + 17, cz + 17, 22, 20, 95, TL.FACADE.STONE, rng);
      return;
    }
    const r = rng.next();
    const hBase = L.coreHeight(cx, cz, rng.next());
    if (rng.chance(0.08) && i !== L.special.wardenSite.i) { this.constructionBlock(out, i, j, rng, false); return; }
    if (rng.chance(0.07)) { this.plaza(out, cx, cz, S, rng); this.addTower(out, cx + S / 4, cz, S / 2 - 2, S - 4, hBase * 1.1, TL.FACADE.GLASS, rng); return; }
    if (r < 0.3) {
      this.addTower(out, cx, cz, S - rng.range(0, 6), S - rng.range(0, 6), hBase * rng.range(0.9, 1.3), rng.chance(0.55) ? TL.FACADE.GLASS : TL.FACADE.STONE, rng);
    } else if (r < 0.65) {
      const w = S / 2 - 1;
      this.addTower(out, x0 + w / 2, cz, w, S - 2, hBase * rng.range(0.6, 1.2), rng.pick([0, 1, 5]), rng);
      this.addTower(out, x0 + S - w / 2, cz, w, S - 2, hBase * rng.range(0.4, 1.0), rng.pick([0, 1, 2, 5]), rng);
    } else {
      const w = S / 2 - 1;
      for (const [ox, oz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        const hh = hBase * rng.range(0.25, 0.9);
        this.addTower(out, cx + ox * (w / 2 + 0.5), cz + oz * (w / 2 + 0.5), w - rng.range(0, 3), w - rng.range(0, 3), Math.max(18, hh), rng.pick([1, 2, 5, hh > 60 ? 0 : 2]), rng);
      }
    }
  }
  plaza(out, cx, cz, S, rng) {
    for (let k = 0; k < 6; k++) out.props.push({ a: 'P_tree_a', x: cx - S / 4 + rng.range(-8, 8), y: 0, z: cz + rng.range(-S / 2 + 4, S / 2 - 4), yaw: rng.range(0, 6.28), col: true });
    for (let k = 0; k < 4; k++) out.props.push({ a: 'P_bench', x: cx - S / 4 + rng.range(-10, 10), y: 0, z: cz + rng.range(-20, 20), yaw: rng.int(0, 3) * 1.57, col: true, noAnchor: true });
  }
  brooklynBlock(out, i, j, rng) {
    const L = this.L, C = L.cell;
    const x0 = i * C + 11, z0 = j * C + 11, S = C - 22;
    const cx = x0 + S / 2, cz = z0 + S / 2;
    const nearWater = cx < 440;
    if (nearWater && rng.chance(0.6)) {
      // warehouses by the waterfront
      this.addTower(out, cx - 13, cz, 28, S - 6, rng.range(12, 20), TL.FACADE.INDUSTRIAL, rng, { noPodium: true });
      this.addTower(out, cx + 16, cz + 10, 22, 30, rng.range(14, 24), TL.FACADE.BRICK, rng, { noPodium: true });
      for (let k = 0; k < 3; k++) out.props.push({ a: 'P_container', x: cx + 16, y: k === 2 ? 2.6 : 0, z: cz - 14 - (k % 2) * 3, yaw: Math.PI / 2, col: true });
      if (rng.chance(0.5)) out.props.push({ a: 'P_market_stall', x: cx + rng.range(-10, 10), y: 0, z: z0 - 1.5, yaw: 0, col: true, noAnchor: true });
      return;
    }
    if (rng.chance(0.55)) {
      // brownstone rows along the north & south block edges with backyards
      for (const side of [-1, 1]) {
        let x = x0 + 1;
        while (x < x0 + S - 6) {
          const w = rng.range(6.5, 8.5), h = rng.range(12, 17);
          const m = this.addTower(out, x + w / 2, cz + side * (S / 2 - 7), w - 0.2, 14, h, TL.FACADE.BROWNSTONE, rng, { noPodium: true });
          out.props.push({ a: 'F_stoop', x: x + w / 2, y: 0, z: cz + side * (S / 2 - 0.2), yaw: side > 0 ? 0 : Math.PI, facade: true });
          void m; x += w;
        }
      }
      for (let k = 0; k < 4; k++) out.props.push({ a: 'P_tree_b', x: cx + rng.range(-20, 20), y: 0, z: cz + rng.range(-8, 8), yaw: rng.range(0, 6), col: true });
    } else {
      // brick apartments with fire escapes
      const n = rng.int(2, 3);
      for (let k = 0; k < n; k++) {
        const w = S / n - 2;
        const t = this.addTower(out, x0 + w / 2 + k * (w + 2) + 1, cz, w, S - 8, rng.range(20, 36), TL.FACADE.BRICK, rng, { noPodium: true });
        t.parts[0].fireEscape = true;
      }
    }
  }
  queensBlock(out, i, j, rng) {
    const L = this.L, C = L.cell;
    const x0 = i * C + 11, z0 = j * C + 11, S = C - 22;
    const cx = x0 + S / 2, cz = z0 + S / 2;
    const r = rng.next();
    if (i === L.special.depot.i && j === L.special.depot.j || r < 0.2) {
      // depot yard: stacked containers + pipe racks (broad glide gaps)
      for (let a = 0; a < 3; a++) for (let b = 0; b < 4; b++) {
        const stack = rng.int(1, 3);
        for (let s = 0; s < stack; s++) out.props.push({ a: 'P_container', x: cx - 16 + a * 16, y: s * 2.6, z: cz - 20 + b * 9, yaw: 0, col: true });
      }
      out.props.push({ a: 'P_pipe_rack', x: cx, y: 0, z: cz + 22, yaw: 0, col: true });
      return;
    }
    if (r < 0.55) {
      // factory with sawtooth roof band + chimney
      const t = this.addTower(out, cx - 4, cz, S - 12, S - 10, rng.range(10, 16), TL.FACADE.INDUSTRIAL, rng, { noPodium: true });
      t.parts[0].sawtooth = true;
      out.props.push({ a: 'P_chimney', x: cx + S / 2 - 5, y: 0, z: cz + S / 2 - 6, yaw: 0, col: true });
      out.updrafts.push({ x: cx + S / 2 - 5, z: cz + S / 2 - 6, r: 9, h0: 20, h1: 90, s: 16, kind: 'chimney' });
      out.props.push({ a: 'P_pipe_rack', x: cx - 4, y: t.roofY, z: cz, yaw: 0, col: true });
      return;
    }
    // mid-rise tech / office
    const n = rng.int(1, 2);
    for (let k = 0; k < n; k++) {
      const w = S / n - 3;
      this.addTower(out, x0 + w / 2 + k * (w + 3) + 1.5, cz, w, S - 6, rng.range(22, 60), rng.pick([0, 5, 3]), rng);
    }
  }
  campusBlock(out, i, j, rng) {
    const C = this.L.cell, x0 = i * C + 11, z0 = j * C + 11, S = C - 22, cx = x0 + S / 2, cz = z0 + S / 2;
    const a = this.addTower(out, cx - 14, cz - 12, 24, 26, 42, TL.FACADE.GLASS, rng, { noPodium: true });
    const b = this.addTower(out, cx + 14, cz + 12, 24, 26, 34, TL.FACADE.GLASS, rng, { noPodium: true });
    out.props.push({ a: 'C_crown_dome', x: cx + 14, y: b.roofY, z: cz + 12, sx: 1.1, sy: 1.1, sz: 1.1, yaw: 0, col: true, crown: true, slotCol: 0x9aa4ac, trimCol: 0x5a6068 });
    out.landmark = { name: 'Lumen Research Campus', x: cx, y: 45, z: cz };
    out.campus = { a: a.top, b: b.top, roofA: a.roofY, roofB: b.roofY };
    for (let k = 0; k < 6; k++) out.props.push({ a: 'P_tree_b', x: cx + rng.range(-24, 24), y: 0, z: cz + rng.range(-24, 24), yaw: 0, col: true });
  }
  warehouseBlock(out, i, j, rng) {
    // hollow warehouse: walls + roof slabs with a skylight gap -> a real interior space
    const C = this.L.cell, x0 = i * C + 11, z0 = j * C + 11, S = C - 22, cx = x0 + S / 2, cz = z0 + S / 2;
    const W = 46, D = 40, H = 16, t = 1.0, style = TL.FACADE.INDUSTRIAL, col = 0x7a7870;
    const wall = (x, z, w, d, h, y0) => out.masses.push({ x, z, w, d, y0: y0 || 0, h, style, color: col, floorH: 5, seed: 77, trim: 0x55524c, kind: 'building' });
    wall(cx, cz - D / 2, W, t, H); wall(cx - W / 2, cz, t, D, H); wall(cx + W / 2, cz, t, D, H);
    wall(cx - 13, cz + D / 2, W / 2 - 4, t, H); wall(cx + 13, cz + D / 2, W / 2 - 4, t, H); wall(cx, cz + D / 2, 10, t, H - 7, 7);   // door gap
    wall(cx - 12, cz, W / 2 - 1, D, 1, H); wall(cx + 16, cz, W / 2 - 9, D, 1, H);                                               // roof with skylight slot
    for (let k = 0; k < 6; k++) out.props.push({ a: 'P_crate', x: cx - 15 + k * 5, y: 0, z: cz - 12 + (k % 2) * 4, yaw: 0, col: true });
    for (let k = 0; k < 3; k++) out.props.push({ a: 'P_container', x: cx + 8, y: 0, z: cz - 10 + k * 8, yaw: 0, col: true });
    out.interior = { x: cx, z: cz, w: W, d: D, h: H };
  }
  constructionBlock(out, i, j, rng, boss) {
    const C = this.L.cell, x0 = i * C + 11, z0 = j * C + 11, S = C - 22, cx = x0 + S / 2, cz = z0 + S / 2;
    // partial steel frame + scaffolds + cranes (moving anchors: slewing jibs)
    const fh = boss ? 48 : rng.range(30, 70);
    const cols = 4;
    for (let a = 0; a < cols; a++) for (let b = 0; b < cols; b++) {
      out.masses.push({ x: cx - 18 + a * 12, z: cz - 18 + b * 12, w: 0.8, d: 0.8, y0: 0, h: fh, style: TL.FACADE.INDUSTRIAL, color: 0x6a5a3a, floorH: 4, seed: 1, trim: 0x6a5a3a, kind: 'frame' });
    }
    for (let f = 1; f <= Math.floor(fh / 8); f++) {
      out.masses.push({ x: cx, z: cz, w: 38, d: 38, y0: f * 8 - 0.5, h: 0.5, style: TL.FACADE.INDUSTRIAL, color: 0x8d8b86, floorH: 4, seed: 1, trim: 0x8d8b86, kind: 'slab', slab: f % 2 === 0 });
    }
    for (let k = 0; k < 5; k++) out.props.push({ a: 'P_scaffold', x: cx - 16 + k * 8, y: 0, z: cz - 20.5, yaw: 0, col: true });
    out.cranes.push({ x: cx + 26, z: cz + 24, yaw0: rng.range(0, 6.28), speed: rng.range(0.05, 0.12) * (rng.chance(0.5) ? 1 : -1), boss: !!boss });
    if (boss) out.cranes.push({ x: cx - 27, z: cz - 26, yaw0: 1.2, speed: -0.07, boss: true });
    out.construction = { x: cx, z: cz, top: fh, boss: !!boss };
    for (let k = 0; k < 4; k++) out.props.push({ a: rng.chance(0.5) ? 'P_barrier' : 'P_crate', x: cx + rng.range(-22, 22), y: 0, z: cz + 22 + rng.range(-2, 2), yaw: rng.range(0, 3), col: true, throwable: true });
  }
  parkBlock(out, i, j, rng) {
    const C = this.L.cell, cx = (i + 0.5) * C, cz = (j + 0.5) * C;
    out.park = true;
    const center = i === -5 && j === 1;
    for (let k = 0; k < 26; k++) {
      const x = cx + rng.range(-36, 36), z = cz + rng.range(-36, 36);
      if (center && Math.hypot(x - cx, z - cz) < 16) continue;
      if (Math.abs(x - cx) < 3 || Math.abs(z - cz) < 3) continue;      // paths
      out.props.push({ a: rng.chance(0.6) ? 'P_tree_a' : 'P_tree_b', x, y: 0, z, yaw: rng.range(0, 6.28), s: rng.range(0.9, 1.5), col: true });
    }
    for (let k = 0; k < 8; k++) out.props.push({ a: 'P_park_lamp', x: cx + (k % 2 ? 3.5 : -3.5), y: 0, z: cz - 36 + k * 10, yaw: 0, col: true });
    for (let k = 0; k < 6; k++) out.props.push({ a: 'P_bench', x: cx + (k % 2 ? 5 : -5), y: 0, z: cz - 30 + k * 12, yaw: k % 2 ? Math.PI / 2 : -Math.PI / 2, col: true, noAnchor: true });
    if (center) { out.pond = { x: cx, z: cz, r: 14 }; out.landmark = { name: 'Commons Fountain', x: cx, y: 2, z: cz }; }
  }
  streetProps(out, i, j, rng) {
    const C = this.L.cell, x0 = i * C, z0 = j * C;
    const park = this.L.inPark(i, j);
    // streetlamps along the four sidewalks (sidewalk band 8..11 m from the cell edge)
    for (let k = 0; k < 3; k++) {
      const t = 18 + k * 22;
      out.props.push({ a: park ? 'P_park_lamp' : 'P_streetlamp', x: x0 + t, y: 0, z: z0 + 9.2, yaw: -Math.PI / 2, col: true, light: true });
      out.props.push({ a: park ? 'P_park_lamp' : 'P_streetlamp', x: x0 + t, y: 0, z: z0 + C - 9.2, yaw: Math.PI / 2, col: true, light: true });
      out.props.push({ a: park ? 'P_park_lamp' : 'P_streetlamp', x: x0 + 9.2, y: 0, z: z0 + t, yaw: Math.PI, col: true, light: true });
      out.props.push({ a: park ? 'P_park_lamp' : 'P_streetlamp', x: x0 + C - 9.2, y: 0, z: z0 + t, yaw: 0, col: true, light: true });
    }
    // traffic light at the SW corner of each block (covers every intersection once)
    if (!park) out.props.push({ a: 'P_traffic_light', x: x0 + 9.5, y: 0, z: z0 + 9.5, yaw: -Math.PI / 4, col: true, signal: { ix: x0, iz: z0 } });
    if (park) return;
    const pick = ['P_hydrant', 'P_trash_bin', 'P_bench', 'P_bollard', 'P_street_sign', 'P_bus_stop', 'P_vendor_cart', 'P_tree_b'];
    const n = rng.int(4, 9);
    for (let k = 0; k < n; k++) {
      const side = rng.int(0, 3), t = rng.range(14, C - 14);
      const a = rng.pick(pick);
      let x, z, yaw;
      if (side === 0) { x = x0 + t; z = z0 + 10.2; yaw = 0; } else if (side === 1) { x = x0 + t; z = z0 + C - 10.2; yaw = Math.PI; }
      else if (side === 2) { x = x0 + 10.2; z = z0 + t; yaw = Math.PI / 2; } else { x = x0 + C - 10.2; z = z0 + t; yaw = -Math.PI / 2; }
      out.props.push({ a, x, y: 0, z, yaw, col: true, noAnchor: a !== 'P_tree_b' && a !== 'P_bus_stop', throwable: a === 'P_trash_bin' || a === 'P_street_sign' });
    }
  }
  riverChunk(out, i, j) {
    const L = this.L, C = L.cell, x0 = i * C, z0 = j * C;
    out.river = true;
    // embankment walls on each bank chunk edge
    if (Math.abs(x0 - 160) < 1) out.masses.push({ x: L.rx0 - 1, z: z0 + C / 2, w: 2, d: C, y0: TL.C.WATER_Y - 12, h: 12 - TL.C.WATER_Y * 0 + (-TL.C.WATER_Y) , style: TL.FACADE.STONE, color: 0x6f6c66, floorH: 50, seed: 3, trim: 0x6f6c66, kind: 'embank' });
    if (Math.abs(x0 + C - 320) < 1) out.masses.push({ x: L.rx1 + 1, z: z0 + C / 2, w: 2, d: C, y0: TL.C.WATER_Y - 12, h: 12 - TL.C.WATER_Y * 0 + (-TL.C.WATER_Y), style: TL.FACADE.STONE, color: 0x6f6c66, floorH: 50, seed: 3, trim: 0x6f6c66, kind: 'embank' });
    // bridge (built by the chunk that contains its z)
    if (L.bridgeZ >= z0 && L.bridgeZ < z0 + C) out.bridge = { x0: L.rx0 - 8, x1: L.rx1 + 8, z: L.bridgeZ, i };
    // piers on the Brooklyn side
    if (i === Math.floor((L.rx1 - 1) / C) && z0 < 0 && (j % 2 === 0)) out.props.push({ a: 'S_pier', x: L.rx1 - 5, y: 0, z: z0 + 40, yaw: 0, col: true });
  }
  boardwalk(out, i, j, rng) {
    const C = this.L.cell, z0 = j * C;
    for (let k = 0; k < 20; k++) out.props.push({ a: 'P_railing', x: this.L.rx1 + 1.5, y: 0, z: z0 + 2 + k * 4, yaw: Math.PI / 2, col: true, noAnchor: true });
  }
  elevated(out, i, j) {
    const L = this.L, C = L.cell, x0 = i * C, z0 = j * C;
    // elevated rail (Brooklyn) along x = 480 road
    if (L.railX >= x0 && L.railX < x0 + C) {
      for (let z = z0 + 10; z < z0 + C; z += 20) if (z > L.railZ0 && z < L.railZ1) out.props.push({ a: 'S_rail_el', x: L.railX, y: 0, z, yaw: Math.PI / 2, col: true, rail: true });
    }
    // elevated highway (Queens) along z = 240 road
    if (L.hwyZ >= z0 && L.hwyZ < z0 + C && x0 >= L.hwyX0 - C) {
      for (let x = x0 + 10; x < x0 + C; x += 20) if (x > L.hwyX0 && x < L.hwyX1) out.props.push({ a: 'S_highway_el', x, y: 0, z: L.hwyZ, yaw: 0, col: true });
    }
  }
};

/* ------------------------------------------------------------------ materials: facade, ground, water */
TL.CityMaterials = class {
  constructor() {
    this.uniforms = {
      uTime: { value: 0 }, uNight: { value: 0 }, uWet: { value: 0 }, uLit: { value: 1 }, uBlackout: { value: new THREE.Vector4(-9999, -9999, 0, 0) },
      uSkyH: { value: new THREE.Color(0.7, 0.78, 0.86) }, uSkyZ: { value: new THREE.Color(0.35, 0.5, 0.72) }, uSunDir: { value: new THREE.Vector3(0.4, 0.8, 0.3) },
    };
    this.facade = this.makeFacade();
    this.ground = this.makeGround();
  }
  /* opts.map: scan-coloured variant (seed MAN) — the map (baked scan atlas, sampled soft) is the wall base
     colour under the procedural windows; roofs keep the map's photo detail; double-sided */
  makeFacade(opts) {
    const U = this.uniforms, scan = !!(opts && opts.map);
    const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0.0 });
    if (scan) { m.map = opts.map; m.defines = { SCAN_BASE: 1 }; m.side = THREE.DoubleSide; }
    m.shadowSide = THREE.BackSide;               // closed boxes: back faces cast -> no self-shadow acne on facades
    m.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, U);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec4 aFac;\nattribute vec3 aTrim;\nvarying vec4 vFac;\nvarying vec3 vTrim;\nvarying vec3 vWP;\nvarying vec3 vWN;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFac = aFac; vTrim = aTrim;\nvWP = (modelMatrix * vec4(position,1.0)).xyz; vWN = normalize(mat3(modelMatrix) * normal);');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
          varying vec4 vFac; varying vec3 vTrim; varying vec3 vWP; varying vec3 vWN;
          uniform float uTime, uNight, uWet, uLit; uniform vec4 uBlackout; uniform vec3 uSkyH, uSkyZ, uSunDir;
          // integer-lattice hash (inputs are small integers -> identical results for every pixel of a cell)
          float h21(vec2 p){ p = mod(p, 4096.0); vec3 q = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973)); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
          float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f); return mix(mix(h21(i), h21(i+vec2(1,0)), f.x), mix(h21(i+vec2(0,1)), h21(i+vec2(1,1)), f.x), f.y); }
          float band(float x, float a, float b, float e){ return smoothstep(a - e, a + e, x) * (1.0 - smoothstep(b - e, b + e, x)); }
          float facWin; float facLit; float facRough; vec3 facEmit;`)
        .replace('#include <color_fragment>', `#include <color_fragment>
          {
            float style = floor(vFac.x + 0.5); float fh = vFac.y; float ww = vFac.z;
            float seed = floor(mod(floor(vFac.w + 0.5), 251.0));      // sanitized: interpolation noise can't leak into hashes
            vec3 n = normalize(vWN);
            if (!gl_FrontFacing) n = -n;
            facWin = 0.0; facLit = 0.0; facRough = 0.85; facEmit = vec3(0.0);
            if (n.y > 0.6) {
              // roof: tar membrane with soft seams + gravel grain
              float g = vnoise(vWP.xz * 1.7) * 0.05 + h21(floor(vWP.xz * 0.35)) * 0.03;
              float seam = band(fract(vWP.x * 0.5), 0.965, 1.0, 0.004) + band(fract(vWP.z * 0.5), 0.965, 1.0, 0.004);
              #ifdef SCAN_BASE
              diffuseColor.rgb = texture2D(map, vUv).rgb * vColor * (0.95 + g * 2.0);
              #else
              diffuseColor.rgb = vec3(0.075, 0.075, 0.08) + g - seam * 0.012;
              #endif
            } else if (n.y > -0.6 && fh < 500.0) {
              vec2 t2 = normalize(vec2(-n.z, n.x));
              vec3 T = vec3(t2.x, 0.0, t2.y);
              float u = dot(vWP.xz, t2), v = vWP.y;
              float col = floor(u / ww), row = floor(v / fh);
              float fx = fract(u / ww), fy = fract(v / fh);
              float mx = 0.16, y0 = 0.28, y1 = 0.86, pil = 4.0;
              if (style < 0.5)      { mx = 0.025; y0 = 0.12; y1 = 0.97; pil = 0.0; }   // glass curtain wall
              else if (style < 1.5) { mx = 0.22; y0 = 0.25; y1 = 0.82; pil = 3.0; }    // stone
              else if (style < 2.5) { mx = 0.3;  y0 = 0.25; y1 = 0.78; pil = 0.0; }    // brick
              else if (style < 3.5) { mx = 0.06; y0 = 0.45; y1 = 0.85; pil = 5.0; }    // industrial strip windows
              else if (style < 4.5) { mx = 0.28; y0 = 0.22; y1 = 0.8;  pil = 0.0; }    // brownstone
              else                  { mx = 0.05; y0 = 0.3;  y1 = 0.88; pil = 4.0; }    // office ribbons
              bool shop = row < 0.5 && style > 0.5 && style < 4.5;
              if (shop) { mx = 0.05; y0 = 0.06; y1 = 0.8; }
              // pixel footprint -> anti-aliasing everywhere
              float fw = max(fwidth(u / ww), fwidth(v / fh));
              float e = clamp(fw * 1.2, 0.002, 0.2);
              float aa = smoothstep(0.2, 0.65, fw);
              float win = band(fx, mx, 1.0 - mx, e) * band(fy, y0, y1, e);
              float inner = band(fx, mx + 0.04, 1.0 - mx - 0.04, e) * band(fy, y0 + 0.045, y1 - 0.04, e);
              float frame = clamp(win - inner, 0.0, 1.0);
              // mullions / transoms
              float mull = 0.0;
              if (style < 0.5 || style > 4.5 || shop) mull = band(fx, 0.495, 0.505, e) * inner;
              if (style < 0.5 || style > 4.5) mull = max(mull, band(fy, y0 + (y1 - y0) * 0.72, y0 + (y1 - y0) * 0.72 + 0.012, e) * inner);
              // wall material: brick coursing / stone joints / panel lines, faded out at distance
              vec3 wall = diffuseColor.rgb;
              float detail = 1.0 - aa;
              if (style > 1.5 && style < 2.5 || style > 3.5 && style < 4.5) {
                float by = fract(v * 3.3), bx = fract(u * 1.6 + floor(v * 3.3) * 0.5);
                wall *= 1.0 - 0.1 * detail * (1.0 - band(by, 0.1, 1.0, 0.02) * band(bx, 0.06, 1.0, 0.02));
                wall *= 0.92 + 0.16 * h21(floor(vec2(u * 1.6 + floor(v * 3.3) * 0.5, v * 3.3)));
              } else if (style > 0.5 && style < 1.5) {
                wall *= 1.0 - 0.06 * detail * (1.0 - band(fract(v / fh * 2.0), 0.03, 1.0, 0.02));
              }
              // pilasters every few bays (lighter, with soft side shading = reads as relief)
              if (pil > 0.5) {
                float pc = mod(col, pil);
                float p = (pc < 0.5) ? 1.0 - smoothstep(0.1, 0.16, fx) : 0.0;
                wall = mix(wall, vTrim * 1.05, p * 0.55);
                wall *= 1.0 - 0.12 * detail * band(fx, 0.16, 0.2, e) * step(pc, 0.5);
              }
              // floor band / spandrel under each window row
              float spand = band(fy, 0.0, 0.06, e);
              wall = mix(wall, vTrim * 0.8, spand * 0.5);
              // sills + lintel shadow (recessed windows)
              float sill = band(fx, mx - 0.03, 1.0 - mx + 0.03, e) * band(fy, y0 - 0.05, y0, e);
              float sillShadow = band(fx, mx - 0.03, 1.0 - mx + 0.03, e) * band(fy, y0 - 0.1, y0 - 0.05, e);
              wall = mix(wall, vTrim * 1.15, sill * detail);
              wall *= 1.0 - 0.25 * sillShadow * detail;
              // grime streaks running down from sills
              float grime = vnoise(vec2(u * 1.3, v * 0.08)) * band(fx, mx, 1.0 - mx, 0.05) * (1.0 - fy) * 0.18;
              wall *= 1.0 - grime * detail;
              // ---------------- windows: interior mapping (fake rooms behind the glass)
              vec3 V = normalize(vWP - cameraPosition);
              vec3 Vt = vec3(dot(V, T), V.y, dot(V, -n));               // tangent space: x along wall, y up, z into building
              float rx = fx * ww, ry = fy * fh, D = ww * 1.4;
              float tX = (Vt.x > 0.0 ? (ww - rx) : -rx) / (abs(Vt.x) < 1e-4 ? 1e-4 : Vt.x);
              float tY = (Vt.y > 0.0 ? (fh - ry) : -ry) / (abs(Vt.y) < 1e-4 ? 1e-4 : Vt.y);
              float tZ = D / max(Vt.z, 1e-3);
              float tm = min(min(tX, tY), tZ);
              vec3 hp = vec3(rx, ry, 0.0) + Vt * tm;
              float rnd = h21(vec2(col, row) + seed * 7.0);
              float rnd2 = h21(vec2(row, col) + seed * 3.0 + 17.0);
              vec3 roomCol = mix(vec3(0.55, 0.5, 0.42), vec3(0.42, 0.48, 0.55), rnd2) * (0.6 + 0.4 * rnd);
              vec3 room;
              if (tm == tZ) {                                         // back wall with a picture/cabinet block
                room = roomCol * 0.8;
                float art = band(hp.x / ww, 0.3, 0.7, 0.01) * band(hp.y / fh, 0.35, 0.6, 0.01);
                room = mix(room, vec3(0.2, 0.25, 0.3) + rnd * 0.3, art * step(0.5, rnd2));
              } else if (tm == tY) room = Vt.y > 0.0 ? roomCol * 1.1 + 0.05 : roomCol * 0.45;   // ceiling / floor
              else room = roomCol * 0.62;                              // side walls
              float depthShade = 1.0 - clamp(tm / (D * 1.6), 0.0, 0.6);
              room *= depthShade;
              // blinds on some windows
              float blindFrac = step(0.55, rnd) * (0.3 + 0.6 * rnd2);
              float wy = (fy - y0) / max(y1 - y0, 0.01);
              float blind = step(1.0 - blindFrac, wy) * (1.0 - step(0.999, blindFrac));
              vec3 blindsCol = vec3(0.78, 0.74, 0.66) * (0.85 + 0.15 * step(0.5, fract(wy * 40.0)));
              // lights: night + blackout
              float bo = uBlackout.z > 0.5 ? step(length(vWP.xz - uBlackout.xy), uBlackout.w) : 0.0;
              float litP = mix(0.1, 0.6, uNight) * uLit * (1.0 - bo);
              float lit = step(rnd2 * 0.97 + rnd * 0.03, litP);
              vec3 lamp = mix(vec3(1.0, 0.8, 0.52), vec3(0.8, 0.88, 1.0), step(0.75, rnd));
              vec3 dayRoom = room * mix(0.35, 0.16, uNight);
              vec3 interior = mix(dayRoom, room * lamp * 1.1, lit * uNight);
              interior = mix(interior, blindsCol * mix(0.5, 0.12, uNight) + lamp * lit * uNight * 0.55, blind);
              // glass reflection (fresnel), curtain walls reflect more
              vec3 R = reflect(V, n);
              float fres = pow(1.0 - max(dot(-V, n), 0.0), 4.0);
              vec3 sky = mix(uSkyH, uSkyZ, clamp(R.y * 1.4, 0.0, 1.0));
              float reflAmt = (style < 0.5 ? 0.35 : 0.18) + 0.6 * fres;
              reflAmt *= 1.0 - 0.6 * uNight * lit;
              vec3 glass = mix(interior, sky, reflAmt);
              // distance: rooms collapse to an average tone (no shimmer)
              vec3 avgGlass = mix(vec3(0.07, 0.08, 0.09) + sky * 0.25, lamp * 0.35, litP * uNight);
              glass = mix(glass, avgGlass, aa);
              float cover = (1.0 - 2.0 * mx) * (y1 - y0);
              float glassMask = clamp(inner - mull, 0.0, 1.0);
              glassMask = mix(glassMask, cover, aa);
              vec3 frameCol = mix(vTrim * 0.55, vTrim * 0.85, band(fy, y1 - 0.06, y1, e));  // lit top edge = bevel
              vec3 c = wall;
              c = mix(c, frameCol, clamp(frame + mull, 0.0, 1.0) * (1.0 - aa));
              c = mix(c, glass, glassMask);
              diffuseColor.rgb = c;
              facWin = glassMask;
              facRough = mix(0.85, 0.08, glassMask);
              float emitMask = glassMask * (1.0 - blind * 0.5);
              facLit = mix(lit * emitMask, litP * cover, aa) * uNight;
              facEmit = mix(room * lamp * 1.2, lamp * 0.9, aa) * facLit;
            }
            // rain wetness darkens porous surfaces
            diffuseColor.rgb *= 1.0 - 0.28 * uWet * (1.0 - facWin);
          }`)
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = facRough;\nroughnessFactor = mix(roughnessFactor, 0.35, uWet * (1.0 - facWin));')
        .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = facWin * 0.2;')
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += facEmit * 1.3;');
    };
    if (scan) {
      const prev = m.onBeforeCompile;
      m.onBeforeCompile = (sh) => {
        prev(sh);
        // soft (mip-biased) sample: the scan gives the colour and weathering, the shader draws the architecture
        sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>',
          `#ifdef USE_MAP
            vec4 sampledDiffuseColor = texture2D(map, vUv, 2.2);
            diffuseColor *= vec4(pow(sampledDiffuseColor.rgb, vec3(0.92)) * 1.12, sampledDiffuseColor.a);
          #endif`);
      };
    }
    m.customProgramCacheKey = () => 'tl-facade-2' + (scan ? '-scan' : '');
    return m;
  }
  makeGround() {
    const U = this.uniforms;
    const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, metalness: 0 });
    m.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, U);
      sh.uniforms.uRiver = { value: new THREE.Vector2(TL.C.RIVER_X0, TL.C.RIVER_X1) };
      sh.uniforms.uBridgeZ = { value: TL.C.BRIDGE_Z };
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWP;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWP = (modelMatrix * vec4(position,1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
          varying vec3 vWP; uniform float uWet, uNight; uniform vec2 uRiver; uniform float uBridgeZ;
          float h21(vec2 p){ p = fract(p*vec2(123.34, 456.21)); p += dot(p, p+45.32); return fract(p.x*p.y); }
          float gRoad;`)
        .replace('#include <color_fragment>', `#include <color_fragment>
          {
            if (vWP.x > uRiver.x && vWP.x < uRiver.y) discard;                          // river cut-out
            if (abs(vWP.x) > 820.0 || abs(vWP.z) > 820.0) discard;                       // harbor
            vec2 c = mod(vWP.xz, 80.0);
            vec2 d = min(c, 80.0 - c);                                                   // distance to road centerlines
            float road = step(min(d.x, d.y), 8.0);
            float side = (1.0 - road) * step(min(d.x, d.y), 11.0);
            vec2 blk = floor(vWP.xz / 80.0);
            bool park = blk.x >= -6.0 && blk.x <= -4.0 && blk.y >= -1.0 && blk.y <= 3.0;
            vec3 asphalt = vec3(0.1, 0.1, 0.105) * (0.85 + 0.3 * h21(floor(vWP.xz * 1.5)));
            vec3 walk = vec3(0.46, 0.45, 0.43) * (0.9 + 0.1 * step(0.06, fract(vWP.x * 0.5)) * step(0.06, fract(vWP.z * 0.5)));
            vec3 lot = park ? vec3(0.2, 0.33, 0.14) * (0.8 + 0.4 * h21(floor(vWP.xz * 0.7))) : vec3(0.36, 0.35, 0.33);
            vec3 col = mix(lot, walk, side);
            gRoad = road;
            if (road > 0.5) {
              col = asphalt;
              bool ns = d.x < d.y;                                  // on a north-south road
              float across = ns ? (c.x > 40.0 ? c.x - 80.0 : c.x) : (c.y > 40.0 ? c.y - 80.0 : c.y);
              float along = ns ? vWP.z : vWP.x;
              float nearX = min(d.x, d.y) , other = max(d.x, d.y);
              // center double yellow, dashed white lanes
              float yl = step(abs(abs(across) - 0.18), 0.07);
              float wl = step(abs(abs(across) - 4.0), 0.08) * step(0.5, fract(along / 6.0));
              // crosswalk zebra where the road meets the intersection
              float xw = step(other, 14.0) * step(8.5, other) * step(0.5, fract(along * 0.0 + (ns ? vWP.x : vWP.z) * 0.9));
              float stop = step(abs(other - 15.0), 0.25);
              if (other > 8.0) {
                col = mix(col, vec3(0.8, 0.62, 0.12), yl);
                col = mix(col, vec3(0.75), max(wl, stop * step(0.0, across * 0.0 + 1.0)));
                col = mix(col, vec3(0.8), xw);
              }
            }
            // bridge deck lane over water handled by deck mesh; curbs
            float curb = (1.0 - road) * step(min(d.x, d.y), 8.3);
            col = mix(col, vec3(0.55), curb);
            col *= 1.0 - 0.35 * uWet * (1.0 - side * 0.5);
            diffuseColor.rgb = col;
          }`)
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(0.95, 0.18, uWet * (0.6 + 0.4 * gRoad));');
    };
    m.customProgramCacheKey = () => 'tl-ground';
    return m;
  }
};

/* ------------------------------------------------------------------ world streamer */
TL.WorldStreamer = class {
  constructor(game) {
    this.game = game;
    this.scene = game.scene;
    this.world = game.world;
    this.layout = game.layout;
    this.gen = new TL.CityGenerator(this.layout);
    this.mats = new TL.CityMaterials();
    this.chunks = new Map();            // key -> chunk record
    this.queue = [];
    this.batches = new Map();           // asset|lod -> InstanceBatch
    this.cranes = [];
    this.lights = [];
    this.signals = [];
    this.landmarks = [];
    this.throwables = [];
    this.meshRadius = 520; this.propRadius = 230; this.colRadius = 240;
    this.quality = 'high';
    this.buildBudget = 2;
    this.stats = { chunks: 0, loaded: 0, props: 0 };
    this._m4 = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._s = new THREE.Vector3(); this._p = new THREE.Vector3();
    this.world.groundFn = (x, z) => this.layout.ground(x, z);
    this.world.waterFn = (x, z) => this.layout.isWater(x, z);
    this.bridgeBuilt = false;
    this.buildGlobal();
  }
  key(i, j) { return i * 1000 + j; }
  setQuality(q, dist) {
    this.quality = q; this.meshRadius = dist;
    this.propRadius = q === 'low' ? 150 : q === 'medium' ? 200 : q === 'high' ? 240 : 300;
    this.buildBudget = q === 'low' ? 1 : 2;
  }
  /* ground, water, sky are global single meshes */
  buildGlobal() {
    const g = new THREE.PlaneGeometry(1700, 1700, 8, 8); g.rotateX(-Math.PI / 2);
    this.groundMesh = new THREE.Mesh(g, this.mats.ground);
    this.groundMesh.receiveShadow = true;
    this.scene.add(this.groundMesh);
  }
  batch(asset, lod, opts) {
    const key = asset + '|' + lod + (opts && opts.tag ? '|' + opts.tag : '');
    let b = this.batches.get(key);
    if (!b) {
      const geo = TL.Assets.geo(asset, lod); if (!geo) return null;
      const cap = (opts && opts.cap) || (asset.startsWith('P_street') || asset === 'P_streetlamp' ? 1600 : asset.startsWith('F_') ? 6000 : 700);
      let mat;
      if (opts && opts.mat) mat = opts.mat;
      else mat = TL.Assets.shared('world', {});
      b = new TL.InstanceBatch(this.scene, geo, mat, cap, { color: !!(opts && opts.color), noShadow: opts && opts.noShadow });
      this.batches.set(key, b);
    }
    return b;
  }
  /* ---------------------------------------------------------------- streaming update */
  update(focus, vel, dt, overview) {
    const C = this.layout.cell;
    // preload ahead in the velocity direction
    const ax = focus.x + TL.clamp(vel.x * 2.5, -160, 160), az = focus.z + TL.clamp(vel.z * 2.5, -160, 160);
    const R = this.meshRadius;
    const i0 = Math.floor((ax - R) / C), i1 = Math.floor((ax + R) / C), j0 = Math.floor((az - R) / C), j1 = Math.floor((az + R) / C);
    const want = new Set();
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const cx = (i + 0.5) * C, cz = (j + 0.5) * C;
      const d = Math.min(Math.hypot(cx - focus.x, cz - focus.z), Math.hypot(cx - ax, cz - az));
      if (d > R + 60) continue;
      if (Math.abs(cx) > this.layout.half + C || Math.abs(cz) > this.layout.half + C) continue;
      const k = this.key(i, j); want.add(k);
      const level = d < this.propRadius && !overview ? 2 : 1;    // 2 = full (props + colliders), 1 = masses only (and during the hero-switch flyover)
      let ch = this.chunks.get(k);
      if (!ch) { ch = { i, j, key: k, level: 0, want: level, data: null, d }; this.chunks.set(k, ch); }
      ch.want = level; ch.d = d;
    }
    // unload
    for (const [k, ch] of this.chunks) if (!want.has(k)) { this.unload(ch); this.chunks.delete(k); }
    // collisions near the hero are mandatory: build synchronously so fast traversal never outruns collision
    const pend = [];
    for (const ch of this.chunks.values()) {
      if (ch.level !== ch.want && !(overview && ch.level > ch.want)) {
        const urgent = !overview && ch.want === 2 && ch.d < this.colRadius * 0.55;
        if (urgent) this.buildLevel(ch, ch.want); else pend.push(ch);
      }
    }
    pend.sort((a, b) => a.d - b.d);
    let budget = this.buildBudget;
    for (const ch of pend) { if (budget-- <= 0) break; this.buildLevel(ch, ch.want); }
    this.updateAnimated(dt);
    this.stats.chunks = this.chunks.size;
  }
  forceLoadAround(p, r) {
    const C = this.layout.cell;
    for (let i = Math.floor((p.x - r) / C); i <= Math.floor((p.x + r) / C); i++) for (let j = Math.floor((p.z - r) / C); j <= Math.floor((p.z + r) / C); j++) {
      const k = this.key(i, j); let ch = this.chunks.get(k);
      if (!ch) { ch = { i, j, key: k, level: 0, want: 2, data: null, d: 0 }; this.chunks.set(k, ch); }
      if (ch.level < 2) this.buildLevel(ch, 2);
    }
  }
  buildLevel(ch, level) {
    try {
      if (!ch.data) ch.data = this.gen.chunk(ch.i, ch.j);
      if (ch.level < 1 && level >= 1) this.buildMasses(ch);
      if (ch.level < 2 && level >= 2) this.buildDetail(ch);
      if (ch.level === 2 && level === 1) this.unloadDetail(ch);
      ch.level = level;
    } catch (e) { TL.logError(e, 'chunk ' + ch.i + ',' + ch.j); ch.level = level; }
  }
  /* ---------------------------------------------------------------- merged building geometry (one draw per chunk) */
  buildMasses(ch) {
    const D = ch.data;
    if (D.bridge && !this.bridgeBuilt) this.buildBridge(D.bridge);
    if (!D.masses.length) return;
    const P = [], N = [], Cc = [], F = [], T = [], I = [];
    const col = new THREE.Color(), trim = new THREE.Color();
    const pushQuad = (a, b, c, d, n, fac, cl, tr) => {
      const base = P.length / 3;
      for (const v of [a, b, c, d]) { P.push(v[0], v[1], v[2]); N.push(n[0], n[1], n[2]); Cc.push(cl.r, cl.g, cl.b); F.push(fac[0], fac[1], fac[2], fac[3]); T.push(tr.r, tr.g, tr.b); }
      I.push(base, base + 1, base + 2, base, base + 2, base + 3);
    };
    for (const m of D.masses) {
      col.set(m.color); trim.set(m.trim || 0x777777);
      const x0 = m.x - m.w / 2, x1 = m.x + m.w / 2, z0 = m.z - m.d / 2, z1 = m.z + m.d / 2, y0 = m.y0, y1 = m.y0 + m.h;
      const ww = m.style === TL.FACADE.GLASS ? 1.6 : m.style === TL.FACADE.INDUSTRIAL ? 4.0 : m.style === TL.FACADE.BROWNSTONE ? 2.4 : 3.0;
      const fac = [m.kind === 'building' || m.kind === 'embank' ? m.style : 3, m.kind === 'building' ? m.floorH : 100, ww, m.seed || 1];
      if (m.kind !== 'building') { fac[1] = 1000; fac[2] = 1000; }
      pushQuad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1], fac, col, trim);
      pushQuad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1], fac, col, trim);
      pushQuad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [1, 0, 0], fac, col, trim);
      pushQuad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0], fac, col, trim);
      pushQuad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], [0, 1, 0], fac, col, trim);
      if (y0 > 0.5) pushQuad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [0, -1, 0], fac, col, trim);
      // colliders are always registered with the masses (they are cheap boxes) so rays/anchors see the skyline
      const c = this.world.addStatic(m.x, (y0 + y1) / 2, m.z, m.w / 2, (y1 - y0) / 2, m.d / 2, 0,
        { kind: m.kind === 'frame' ? 'frame' : 'building', chunk: ch.key, climb: true, perch: m.kind === 'frame' });
      (ch.cols || (ch.cols = [])).push(c);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(Cc, 3));
    g.setAttribute('aFac', new THREE.Float32BufferAttribute(F, 4));
    g.setAttribute('aTrim', new THREE.Float32BufferAttribute(T, 3));
    g.setIndex(I);
    g.computeBoundingSphere();
    const mesh = new THREE.Mesh(g, this.mats.facade);
    mesh.castShadow = true; mesh.receiveShadow = true;
    this.scene.add(mesh);
    ch.massMesh = mesh;
    if (D.landmark) this.landmarks.push(Object.assign({ chunk: ch.key }, D.landmark));
    for (const u of D.updrafts) { const w = this.game.wind.add(u.x, u.z, u.r, u.h0, u.h1, u.s, u.kind); w.tag = ch.key; }
  }
  /* ---------------------------------------------------------------- props, facade modules, cranes */
  buildDetail(ch) {
    const D = ch.data, q = this.quality;
    ch.props = [];
    const m4 = this._m4, qu = this._q, sc = this._s, po = this._p;
    const colC = new THREE.Color();
    const hd = q !== 'low';
    for (const p of D.props) {
      const lowName = p.a.replace(/^(P_|S_|C_|F_)/, '');
      // repeated street furniture uses the decimated LOD below Ultra (hundreds of instances)
      const repeated = /streetlamp|park_lamp|traffic_light|railing|bollard|hydrant|trash_bin|bench|tree_/.test(p.a);
      let asset = p.a, lod = TL.Assets.pickLod(p.a, q, repeated && q !== 'ultra');
      if (q === 'low' && TL.Assets.has(lowName, 'lo')) { asset = lowName; lod = 'lo'; }
      if (!TL.Assets.has(asset)) continue;
      if (!hd && p.facade) continue;
      po.set(p.x, p.y, p.z); qu.setFromAxisAngle(TL._UP || (TL._UP = new THREE.Vector3(0, 1, 0)), p.yaw || 0);
      const s = p.s || 1; sc.set(p.sx || s, p.sy || s, p.sz || s);
      m4.compose(po, qu, sc);
      const owner = { idx: -1, batch: null };
      const b = this.batch(asset, lod, p.crown ? { tag: 'crown' + (p.slotCol || 0), mat: this.crownMat(p.slotCol, p.trimCol), cap: 64 } : null);
      if (!b) continue;
      b.alloc(owner, m4, null);
      ch.props.push(owner);
      // colliders from the Blender-authored proxies (asset-local boxes, scaled + rotated)
      if (p.col) {
        const info = TL.Assets.info(lowName) || {};
        const cols = info.cols || [];
        for (const c of cols) {
          const lx = c[0] * sc.x, ly = c[1] * sc.y, lz = c[2] * sc.z;
          const cs = Math.cos(p.yaw || 0), sn = Math.sin(p.yaw || 0);
          const wx = p.x + lx * cs + lz * sn, wz = p.z - lx * sn + lz * cs;
          const cc = this.world.addStatic(wx, p.y + ly, wz, c[3] * sc.x, c[4] * sc.y, c[5] * sc.z, p.yaw || 0,
            { kind: p.a.startsWith('S_') ? 'bridge' : 'prop', chunk: ch.key, anchor: !p.noAnchor, climb: !p.noAnchor, perch: !!(info.extra && info.extra.perch), tag: p.a });
          (ch.cols || (ch.cols = [])).push(cc);
          if (p.throwable) { cc.throwable = true; cc.asset = asset; cc.lod = lod; cc.owner = owner; this.throwables.push(cc); }
        }
      }
      if (p.light) this.lights.push({ x: p.x, y: 7, z: p.z, chunk: ch.key });
      if (p.signal) this.signals.push({ ix: p.signal.ix, iz: p.signal.iz, x: p.x, z: p.z, chunk: ch.key });
    }
    if (hd && ch.d < (this.quality === 'ultra' ? 190 : 115)) this.buildFacadeModules(ch);   // 3D facade kit only near the camera
    for (const cr of D.cranes) this.spawnCrane(ch, cr);
    if (D.pond) this.spawnPond(ch, D.pond);
    if(TL.Rooftops)TL.Rooftops.procedural(this,ch);
    this.stats.props += ch.props.length;
  }
  crownMat(slotCol, trimCol) {
    const key = 'crown' + slotCol + '_' + trimCol;
    return TL.Assets.shared(key, { slots: { 1: slotCol || 0x9aa4ac, 2: trimCol || 0x6e6a62 } });
  }
  /* Blender facade kit instanced along building faces near the street: storefronts at ground level,
     belt courses, cornices + parapets at roof lines, fire escapes on brick walk-ups, balconies. */
  buildFacadeModules(ch) {
    const D = ch.data, m4 = this._m4, qu = this._q, sc = this._s, po = this._p, up = TL._UP;
    const lod = TL.Assets.pickLod('F_storefront', this.quality);
    const add = (asset, x, y, z, yaw, sx, slot1, slot2) => {
      if (!TL.Assets.has(asset)) return;
      const key = 'fac_' + (slot1 || 0) + '_' + (slot2 || 0);
      const b = this.batch(asset, lod, { tag: key, mat: TL.Assets.shared(key, { slots: { 1: slot1 || 0x999999, 2: slot2 || 0x666666 } }), cap: 2500 });
      if (!b) return;
      po.set(x, y, z); qu.setFromAxisAngle(up, yaw); sc.set(sx || 1, 1, 1); m4.compose(po, qu, sc);
      const o = { idx: -1, batch: null }; b.alloc(o, m4, null); ch.props.push(o);
    };
    for (const m of D.masses) {
      if (m.kind !== 'building' || m.w < 4 || m.d < 4) continue;
      const top = m.y0 + m.h;
      const faces = [
        { nx: 0, nz: 1, cx: m.x, cz: m.z + m.d / 2, len: m.w, yaw: Math.PI },
        { nx: 0, nz: -1, cx: m.x, cz: m.z - m.d / 2, len: m.w, yaw: 0 },
        { nx: 1, nz: 0, cx: m.x + m.w / 2, cz: m.z, len: m.d, yaw: -Math.PI / 2 },
        { nx: -1, nz: 0, cx: m.x - m.w / 2, cz: m.z, len: m.d, yaw: Math.PI / 2 },
      ];
      const wallC = m.color, trimC = m.trim;
      for (const f of faces) {
        const n = Math.max(1, Math.floor(f.len / 4));
        const step = f.len / n, sx = step / 4;
        const tx = -f.nz, tz = f.nx;       // along-face tangent
        for (let k = 0; k < n; k++) {
          const off = -f.len / 2 + step * (k + 0.5);
          const x = f.cx + tx * off + f.nx * 0.02, z = f.cz + tz * off + f.nz * 0.02;
          // ground floor: shops on commercial styles
          if (m.y0 < 0.5 && (m.style === 1 || m.style === 2 || m.style === 5 || m.style === 0) && this.quality !== 'medium') add('F_storefront', x, 0, z, f.yaw, sx, wallC, trimC);
          // cornice + parapet at roof line of low/mid rises
          if (top < 45 || m.style === 4 || m.style === 2) { add('F_cornice', x, top - 0.7, z, f.yaw, sx, wallC, trimC); add('F_parapet', x - f.nx * 0.15, top, z - f.nz * 0.15, f.yaw, sx, wallC, trimC); }
          // belt course above the ground floor
          if (m.y0 < 0.5 && m.h > 10) add('F_band', x, m.floorH * 1.25, z, f.yaw, sx, wallC, trimC);
          // walk-up details: real 3D windows on the lowest floors
          if ((m.style === 2 || m.style === 4) && this.quality === 'ultra') for (let fl = 1; fl < Math.min(4, Math.floor(m.h / m.floorH)); fl++) add(m.style === 2 ? 'F_win_brick' : 'F_win_stone', x, fl * m.floorH, z, f.yaw, sx, wallC, trimC);
          // fire escapes zig-zag on brick apartments (street face)
          if (m.fireEscape && f.nz === 1 && k % 3 === 1) for (let fl = 1; fl < Math.floor(m.h / 3.4); fl++) add('P_fire_escape', x, fl * 3.4, z + 0.1, f.yaw, 1, 0, 0);
        }
      }
    }
  }
  spawnCrane(ch, cr) {
    const H = 63.0;
    const g = TL.Assets;
    const lodM = g.pickLod('S_crane_mast', this.quality), lodJ = g.pickLod('S_crane_jib', this.quality);
    const mast = g.mesh(this.quality === 'low' ? 'crane_mast' : 'S_crane_mast', this.quality === 'low' ? 'lo' : lodM, TL.Assets.shared('world'));
    const jib = g.mesh(this.quality === 'low' ? 'crane_jib' : 'S_crane_jib', this.quality === 'low' ? 'lo' : lodJ, TL.Assets.shared('world'));
    const hook = g.mesh(this.quality === 'low' ? 'crane_hook' : 'S_crane_hook', this.quality === 'low' ? 'lo' : g.pickLod('S_crane_hook', this.quality), TL.Assets.shared('world'));
    if (!mast || !jib) return;
    mast.position.set(cr.x, 0, cr.z); jib.position.set(cr.x, H, cr.z);
    this.scene.add(mast); this.scene.add(jib); if (hook) this.scene.add(hook);
    const cm = this.world.addStatic(cr.x, H / 2, cr.z, 1.3, H / 2, 1.3, 0, { kind: 'crane', chunk: ch.key });
    // jib: dynamic collider (moving anchor) rotating about the mast
    const jc = this.world.addDynamic(cr.x, H + 4.1, cr.z, 32, 1.2, 1.3, 0, { kind: 'crane', mass: Infinity, owner: null, anchor: true, climb: true });
    const hc = this.world.addDynamic(cr.x, H - 20, cr.z, 0.6, 0.9, 0.4, 0, { kind: 'crane', mass: 800, anchor: true, climb: false });
    const rec = { ch: ch.key, mast, jib, hook, cm, jc, hc, x: cr.x, z: cr.z, yaw: cr.yaw0, speed: cr.speed, boss: cr.boss, hookDrop: 24, H, hookVel: new THREE.Vector3(), hookPos: new THREE.Vector3(cr.x + 40, H - 20, cr.z) };
    hc.owner = { applyImpulse: (x, y, z) => { rec.hookVel.x += x; rec.hookVel.y += y; rec.hookVel.z += z; } };
    (ch.cranes || (ch.cranes = [])).push(rec);
    this.cranes.push(rec);
  }
  spawnPond(ch, pond) {
    const g = new THREE.CircleGeometry(pond.r, 32); g.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(g, this.game.waterMat || new THREE.MeshStandardMaterial({ color: 0x224455, roughness: 0.1 }));
    m.position.set(pond.x, 0.05, pond.z); this.scene.add(m);
    (ch.extraMeshes || (ch.extraMeshes = [])).push(m);
  }
  /* animated structures: slewing crane jibs (moving anchors) + swinging hook blocks (pendulum) */
  updateAnimated(dt) {
    for (const c of this.cranes) {
      const yaw = c.yaw + c.speed * dt;
      c.yaw = yaw;
      c.jib.rotation.y = yaw;
      // jib box center is 25 m out along local +X (asset authored with jib along +X, counter-jib -X)
      const cx = c.x + Math.cos(yaw) * 18, cz = c.z - Math.sin(yaw) * 18;
      this.world.moveDynamic(c.jc, cx, c.H + 4.1, cz, yaw, dt);
      // hook: pendulum under the trolley (40 m out), physically integrated
      const tx = c.x + Math.cos(yaw) * 40, tz = c.z - Math.sin(yaw) * 40, ty = c.H + 2.4;
      const hp = c.hookPos, hv = c.hookVel;
      hv.y -= TL.C.G * dt; hv.multiplyScalar(1 - 0.3 * dt);
      hp.addScaledVector(hv, dt);
      const dx = hp.x - tx, dy = hp.y - ty, dz = hp.z - tz, d = Math.hypot(dx, dy, dz) || 1;
      if (d > c.hookDrop) { const k = c.hookDrop / d; hp.set(tx + dx * k, ty + dy * k, tz + dz * k); const vr = (hv.x * dx + hv.y * dy + hv.z * dz) / d; if (vr > 0) { hv.x -= dx / d * vr; hv.y -= dy / d * vr; hv.z -= dz / d * vr; } }
      if (c.hook) { c.hook.position.copy(hp); c.hook.position.y -= 1.0; }
      this.world.moveDynamic(c.hc, hp.x, hp.y, hp.z, 0, dt);
      c.trolley = { x: tx, y: ty, z: tz };
    }
  }
  /* ---------------------------------------------------------------- suspension bridge (global, built once) */
  buildBridge(B) {
    this.bridgeBuilt = true;
    const q = this.quality, A = TL.Assets, W = this.world;
    const mat = A.shared('world');
    const deckName = q === 'low' ? 'bridge_deck' : 'S_bridge_deck', towerName = q === 'low' ? 'bridge_tower' : 'S_bridge_tower';
    const deckLod = q === 'low' ? 'lo' : A.pickLod('S_bridge_deck', q), towerLod = q === 'low' ? 'lo' : A.pickLod('S_bridge_tower', q);
    this.bridge = { meshes: [], x0: B.x0, x1: B.x1, z: B.z };
    for (let x = B.x0 + 10; x < B.x1; x += 20) {
      const m = A.mesh(deckName, deckLod, mat); if (!m) break;
      m.position.set(x, 0, B.z); this.scene.add(m); this.bridge.meshes.push(m);
    }
    W.addStatic((B.x0 + B.x1) / 2, -2, B.z, (B.x1 - B.x0) / 2, 2, 13, 0, { kind: 'bridge' });
    W.addStatic((B.x0 + B.x1) / 2, 0.65, B.z - 12.9, (B.x1 - B.x0) / 2, 0.65, 0.15, 0, { kind: 'bridge', anchor: false });
    W.addStatic((B.x0 + B.x1) / 2, 0.65, B.z + 12.9, (B.x1 - B.x0) / 2, 0.65, 0.15, 0, { kind: 'bridge', anchor: false });
    const towers = [200, 280];
    const info = A.info('bridge_tower');
    for (const tx of towers) {
      const m = A.mesh(towerName, towerLod, mat); if (m) { m.position.set(tx, 0, B.z); m.rotation.y = 0; this.scene.add(m); this.bridge.meshes.push(m); }
      for (const c of info.cols || []) W.addStatic(tx + c[0], c[1], B.z + c[2], c[3], c[4], c[5], 0, { kind: 'bridge', climb: true });
      this.game.wind.add(tx, B.z, 20, 20, 130, 10, 'bridge');
    }
    this.landmarks.push({ name: 'Tension Bridge', x: 240, y: 104, z: B.z });
    // main cables (catenary between anchorages and tower saddles) + vertical suspenders.
    // Cables are real colliders (chains of short boxes) so they can be swung from and landed on.
    const cableMat = new THREE.MeshStandardMaterial({ color: 0x3a3f45, roughness: 0.5, metalness: 0.6 });
    const topY = 102, deckY = 1.0;
    const cablePts = (side) => {
      const pts = [];
      const spans = [[150, 200, deckY + 2, topY], [200, 280, topY, topY], [280, 330, topY, deckY + 2]];
      for (const [xa, xb, ya, yb] of spans) {
        for (let k = 0; k <= 20; k++) {
          const t = k / 20, x = xa + (xb - xa) * t;
          let y;
          if (ya === yb) { const s = (t - 0.5) * 2; y = topY - (topY - 14) * (1 - s * s); }
          else y = ya + (yb - ya) * Math.pow(t, ya < yb ? 1.6 : 0.6);
          pts.push(new THREE.Vector3(x, y, B.z + side * 13));
        }
      }
      return pts;
    };
    for (const side of [-1, 1]) {
      const pts = cablePts(side);
      const curve = new THREE.CatmullRomCurve3(pts);
      const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 160, 0.45, 8, false), cableMat);
      tube.castShadow = true; this.scene.add(tube); this.bridge.meshes.push(tube);
      for (let k = 0; k < pts.length - 1; k++) {
        const a = pts[k], b = pts[k + 1];
        if (a.distanceTo(b) < 0.1) continue;
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        W.addStatic(mx, my, a.z, Math.abs(b.x - a.x) / 2 + 0.3, Math.abs(b.y - a.y) / 2 + 0.4, 0.4, 0, { kind: 'cable', climb: true });
      }
      // suspenders
      const sg = new THREE.CylinderGeometry(0.06, 0.06, 1, 5);
      for (let x = 206; x < 280; x += 8) {
        const s = (x - 240) / 40; const y = topY - (topY - 14) * (1 - s * s);
        const m = new THREE.Mesh(sg, cableMat); m.scale.y = y - deckY; m.position.set(x, (y + deckY) / 2, B.z + side * 13); this.scene.add(m); this.bridge.meshes.push(m);
      }
    }
  }
  /* ---------------------------------------------------------------- unload */
  unloadDetail(ch) {
    if(TL.Rooftops)TL.Rooftops.unloadProcedural(this,ch);
    if (ch.props) for (const o of ch.props) if (o.batch) o.batch.free(o);
    ch.props = null;
    // prop colliders keep only building masses: rebuild collider list
    if (ch.cols) {
      const keep = [];
      for (const c of ch.cols) { if (c.kind === 'building' || c.kind === 'frame') keep.push(c); else { if (c.throwable) this.throwables = this.throwables.filter((t) => t !== c); this.world.removeStatic(c); } }
      ch.cols = keep;
    }
    this.lights = this.lights.filter((l) => l.chunk !== ch.key);
    this.signals = this.signals.filter((l) => l.chunk !== ch.key);
    if (ch.cranes) {
      for (const c of ch.cranes) {
        this.scene.remove(c.mast); this.scene.remove(c.jib); if (c.hook) this.scene.remove(c.hook);
        this.world.removeStatic(c.cm); this.world.removeDynamic(c.jc); this.world.removeDynamic(c.hc);
        this.cranes = this.cranes.filter((x) => x !== c);
      }
      ch.cranes = null;
    }
    if (ch.extraMeshes) { for (const m of ch.extraMeshes) this.scene.remove(m); ch.extraMeshes = null; }
  }
  unload(ch) {
    if (ch.level >= 2) this.unloadDetail(ch);
    if (ch.massMesh) { this.scene.remove(ch.massMesh); ch.massMesh.geometry.dispose(); ch.massMesh = null; }
    if (ch.cols) { for (const c of ch.cols) this.world.removeStatic(c); ch.cols = null; }
    this.landmarks = this.landmarks.filter((l) => l.chunk !== ch.key);
    this.game.wind.updrafts = this.game.wind.updrafts.filter((u) => u.tag !== ch.key);
    ch.level = 0;
  }
  /* spawn point: the designated rooftop */
  spawnPoint() {
    const s = this.layout.special.spawn;
    const d = this.gen.chunk(s.i, s.j);
    return d.spawn || { x: (s.i + 0.5) * 80, y: 80, z: (s.j + 0.5) * 80 };
  }
  chunkData(i, j) { const ch = this.chunks.get(this.key(i, j)); return ch && ch.data ? ch.data : this.gen.chunk(i, j); }
};
