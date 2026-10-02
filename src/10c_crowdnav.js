/* =====================================================================================
   CROWD NAV — the pedestrian roadmap of the scan map (seed MAN).
   Data: tools/scan/crowd_nav.py -> extra/crowd_nav.json + crowd_nav.bin.gz
     nodes  [x, z, clearance]   edges (a, b) with clearance    crossings (kerb-to-kerb edges tied to a traffic junction)
     seats  (benches, stoops, steps)   carts   districts + 20 m density grid
   TL.CrowdNav   graph queries: nearest node, A*, random walk step, density / district mix at a point
   Registers into TL.ScanHooks: data is decoded at load, the instance is published as world.crowdNav.
   ===================================================================================== */
'use strict';

TL.CrowdNav = class {
  constructor(meta, buf) {
    this.meta = meta;
    const T = { float32: Float32Array, uint32: Uint32Array, int16: Int16Array, uint8: Uint8Array, int32: Int32Array };
    const part = (k) => { const p = meta.parts[k]; return new T[p.t](buf, p.o, p.n); };
    this.nodes = part('nodes'); this.flag = part('nflag'); this.edges = part('edges'); this.eclr = part('eclr'); this.exw = part('exw'); this.dens = part('dens');
    this.N = this.nodes.length / 3; this.M = this.edges.length / 2;
    const N = this.N, M = this.M;
    // CSR adjacency
    const deg = new Int32Array(N + 1);
    for (let e = 0; e < M; e++) { deg[this.edges[e * 2] + 1]++; deg[this.edges[e * 2 + 1] + 1]++; }
    for (let i = 0; i < N; i++) deg[i + 1] += deg[i];
    this.adjStart = deg; this.adjNode = new Int32Array(M * 2); this.adjEdge = new Int32Array(M * 2);
    const fill = deg.slice(0, N);
    this.len = new Float32Array(M);
    for (let e = 0; e < M; e++) {
      const a = this.edges[e * 2], b = this.edges[e * 2 + 1];
      this.adjNode[fill[a]] = b; this.adjEdge[fill[a]++] = e; this.adjNode[fill[b]] = a; this.adjEdge[fill[b]++] = e;
      this.len[e] = Math.hypot(this.nodes[a * 3] - this.nodes[b * 3], this.nodes[a * 3 + 1] - this.nodes[b * 3 + 1]);
    }
    // spatial hash (12 m cells)
    this.cs = 12; this.hash = new Map();
    for (let i = 0; i < N; i++) { const k = this.key(this.nodes[i * 3], this.nodes[i * 3 + 1]); let l = this.hash.get(k); if (!l) this.hash.set(k, l = []); l.push(i); }
    this.cw = meta.crosswalks;
    for (const c of this.cw) {
      const a = c.a, b = c.b, dx = this.nodes[b * 3] - this.nodes[a * 3], dz = this.nodes[b * 3 + 1] - this.nodes[a * 3 + 1], l = Math.hypot(dx, dz) || 1;
      c.len = l; c.dx = dx / l; c.dz = dz / l; c.mx = (this.nodes[a * 3] + this.nodes[b * 3]) / 2; c.mz = (this.nodes[a * 3 + 1] + this.nodes[b * 3 + 1]) / 2;
      c.waiting = [[], []];                     // queued walkers at the a / b kerb
    }
    this.seats = meta.seats; this.carts = meta.carts; this.stoops = meta.stoops || []; this.shelters = meta.shelters || [];
    for (const s of this.seats) { s.taken = [null, null]; if (s.y === undefined) s.y = 0; }
    for (const s of this.stoops) s.taken = [null, null, null];
    this.districts = meta.districts;
    // A* scratch
    this._g = new Float32Array(N); this._stamp = new Int32Array(N); this._from = new Int32Array(N); this._closed = new Int32Array(N); this._gen = 0;
    this.zoneOf = (i) => this.flag[i] & 3;           // 1 sidewalk 2 plaza 3 park
    this.nearWater = (i) => (this.flag[i] & 4) !== 0;
  }
  key(x, z) { return Math.floor(x / this.cs) * 4096 + Math.floor(z / this.cs); }
  nearest(x, z, maxR) {
    maxR = maxR || 30;
    let best = -1, bd = maxR * maxR;
    const r = Math.ceil(maxR / this.cs), cx = Math.floor(x / this.cs), cz = Math.floor(z / this.cs);
    for (let i = -r; i <= r; i++) for (let j = -r; j <= r; j++) {
      const l = this.hash.get((cx + i) * 4096 + cz + j); if (!l) continue;
      for (const n of l) { const dx = this.nodes[n * 3] - x, dz = this.nodes[n * 3 + 1] - z, d = dx * dx + dz * dz; if (d < bd) { bd = d; best = n; } }
    }
    return best;
  }
  /* node ids within radius r (not sorted) */
  within(x, z, r, out) {
    out = out || []; out.length = 0;
    const c = Math.ceil(r / this.cs), cx = Math.floor(x / this.cs), cz = Math.floor(z / this.cs), r2 = r * r;
    for (let i = -c; i <= c; i++) for (let j = -c; j <= c; j++) {
      const l = this.hash.get((cx + i) * 4096 + cz + j); if (!l) continue;
      for (const n of l) { const dx = this.nodes[n * 3] - x, dz = this.nodes[n * 3 + 1] - z; if (dx * dx + dz * dz < r2) out.push(n); }
    }
    return out;
  }
  x(n) { return this.nodes[n * 3]; }
  z(n) { return this.nodes[n * 3 + 1]; }
  clr(n) { return this.nodes[n * 3 + 2]; }
  dist(a, b) { return Math.hypot(this.nodes[a * 3] - this.nodes[b * 3], this.nodes[a * 3 + 1] - this.nodes[b * 3 + 1]); }
  edgeBetween(a, b) {
    for (let k = this.adjStart[a]; k < this.adjStart[a + 1]; k++) if (this.adjNode[k] === b) return this.adjEdge[k];
    return -1;
  }
  /* A*: array of node ids from..to (inclusive) or null. Crossings cost extra (waiting); `avoid` is an optional node predicate. */
  path(from, to, maxExpand) {
    if (from === to) return [from];
    maxExpand = maxExpand || 3000;
    const g = this._g, st = this._stamp, fr = this._from, cl = this._closed, gen = ++this._gen;
    const tx = this.nodes[to * 3], tz = this.nodes[to * 3 + 1];
    const heap = [], push = (n, f) => { heap.push([f, n]); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
    const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { let l = 2 * i + 1, r = l + 1, m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
    g[from] = 0; st[from] = gen; fr[from] = -1; push(from, this.dist(from, to));
    let ex = 0;
    while (heap.length && ex++ < maxExpand) {
      const [, n] = pop();
      if (cl[n] === gen) continue; cl[n] = gen;
      if (n === to) { const out = []; for (let c = n; c >= 0; c = fr[c]) out.push(c); return out.reverse(); }
      for (let k = this.adjStart[n]; k < this.adjStart[n + 1]; k++) {
        const m = this.adjNode[k], e = this.adjEdge[k];
        let w = this.len[e];
        if (this.exw[e] >= 0) w += 12;                                     // waiting at the kerb: prefer crossing less
        else if (this.eclr[e] < 0.7) w *= 1.25;                            // squeezing along a wall
        const ng = g[n] + w;
        if (st[m] !== gen || ng < g[m]) { g[m] = ng; st[m] = gen; fr[m] = n; push(m, ng + Math.hypot(this.nodes[m * 3] - tx, this.nodes[m * 3 + 1] - tz)); }
      }
    }
    return null;
  }
  /* next node for a wandering walker: keep heading, rarely turn back, cross streets with probability pc */
  step(prev, cur, hx, hz, rng, pc) {
    let best = -1, bs = -1e9;
    for (let k = this.adjStart[cur]; k < this.adjStart[cur + 1]; k++) {
      const m = this.adjNode[k], e = this.adjEdge[k];
      if (m === prev && this.adjStart[cur + 1] - this.adjStart[cur] > 1) continue;
      const dx = this.nodes[m * 3] - this.nodes[cur * 3], dz = this.nodes[m * 3 + 1] - this.nodes[cur * 3 + 1], l = Math.hypot(dx, dz) || 1;
      let s = (dx * hx + dz * hz) / l + rng.next() * 0.9;
      if (this.exw[e] >= 0) s += rng.next() < pc ? 1.2 : -2;
      if (s > bs) { bs = s; best = m; }
    }
    return best >= 0 ? best : prev;
  }
  densityAt(x, z) {
    const G = this.meta.grid, i = Math.floor((x - G.x0) / G.cell), j = Math.floor((z - G.z0) / G.cell);
    if (i < 0 || j < 0 || i >= G.nx || j >= G.nz) return 0;
    return this.dens[j * G.nx + i] / 255;
  }
  /* district weights: { crowd, mix:{tourist,suit,local,jogger}, name } blended by distance */
  districtAt(x, z, out) {
    out = out || { crowd: 0, name: '', mix: { tourist: 0, suit: 0, local: 0, jogger: 0 } };
    let sw = 0; out.mix.tourist = out.mix.suit = out.mix.local = out.mix.jogger = 0; let bw = 0;
    for (const d of this.districts) {
      const dx = x - d.c[0], dz = z - d.c[1], w = Math.exp(-(dx * dx + dz * dz) / (2 * (d.r * 0.6) * (d.r * 0.6)));
      sw += w; for (const k in out.mix) out.mix[k] += d.mix[k] * w;
      if (w > bw) { bw = w; out.name = d.name; }
    }
    if (sw < 1e-4) { out.mix.local = 1; out.crowd = 0.6; return out; }
    for (const k in out.mix) out.mix[k] /= sw;
    out.crowd = Math.min(1.5, 0.6 + sw * 0.6);
    return out;
  }
};

if (TL.ScanHooks) {
  TL.ScanHooks.load.push(async (data) => {
    try {
      const X = TL.Extra;
      if (X && X.has('crowd_nav.json') && X.has('crowd_nav.bin.gz')) data.crowdNav = { meta: await X.json('crowd_nav.json'), buf: await X.buffer('crowd_nav.bin.gz') };
    } catch (e) { TL.logError ? TL.logError(e, 'crowd_nav') : console.error(e); data.crowdNav = null; }
  });
  TL.ScanHooks.build.push((world) => {
    const D = world.data.crowdNav; if (!D) return;
    try { world.crowdNav = new TL.CrowdNav(D.meta, D.buf); world.stats.crowdNodes = world.crowdNav.N; }
    catch (e) { TL.logError ? TL.logError(e, 'crowd_nav') : console.error(e); }
  });
}
