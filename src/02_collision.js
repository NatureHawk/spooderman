/* =====================================================================================
   CollisionWorld — yaw-oriented boxes (OBB rotated about Y only) in a 2D spatial hash.
   * Static colliders (buildings, props, bridge…) live in the hash; streamed per chunk.
   * Dynamic colliders (vehicles, drones, platforms, crane jib, boss parts) live in a list and
     carry velocity + yaw rate so tethers and the player can ride / swing from them.
   * Queries: capsule-sphere contact resolution, raycast (DDA over hash cells), overlap.
   Rotation convention (matches three.js rotation.y):
     world = (lx*c + lz*s,  -lx*s + lz*c)     local = (dx*c - dz*s,  dx*s + dz*c)
   ===================================================================================== */
'use strict';

TL.Collider = class {
  constructor() { this.reset(); }
  reset() {
    this.id = 0; this.cx = 0; this.cy = 0; this.cz = 0; this.hx = 1; this.hy = 1; this.hz = 1;
    this.yaw = 0; this.c = 1; this.s = 0;
    this.dynamic = false; this.kind = 'static'; this.owner = null; this.chunk = null;
    this.vx = 0; this.vy = 0; this.vz = 0; this.wy = 0; this.mass = Infinity;
    this.anchor = true; this.climb = true; this.perch = false; this.solid = true; this.walkTop = true;
    this.stamp = 0; this.cells = null; this.tag = null; this.supportType=null;this.supportRadius=0;
    return this;
  }
  set(cx, cy, cz, hx, hy, hz, yaw) {
    this.cx = cx; this.cy = cy; this.cz = cz; this.hx = hx; this.hy = hy; this.hz = hz;
    this.setYaw(yaw || 0); return this;
  }
  setYaw(y) { this.yaw = y; this.c = Math.cos(y); this.s = Math.sin(y); }
  // world-space XZ bounding radius
  get rxz() { return Math.sqrt(this.hx * this.hx + this.hz * this.hz); }
  toLocal(px, py, pz, out) {
    const dx = px - this.cx, dz = pz - this.cz;
    out.x = dx * this.c - dz * this.s; out.y = py - this.cy; out.z = dx * this.s + dz * this.c; return out;
  }
  toWorld(lx, ly, lz, out) {
    out.x = this.cx + lx * this.c + lz * this.s; out.y = this.cy + ly; out.z = this.cz - lx * this.s + lz * this.c; return out;
  }
  dirToWorld(lx, ly, lz, out) { out.x = lx * this.c + lz * this.s; out.y = ly; out.z = -lx * this.s + lz * this.c; return out; }
  // velocity of a world point riding this collider (linear + yaw rotation)
  pointVel(px, pz, out) {
    const rx = px - this.cx, rz = pz - this.cz;
    // d/dt of rotation about Y (three.js convention): v = w × r with w = (0, wy, 0)
    out.x = this.vx + this.wy * rz; out.y = this.vy; out.z = this.vz - this.wy * rx; return out;
  }
  get top() { return this.cy + this.hy; }
};

/* Static top supports share geometry-derived dimensions and bounded contact regions.
   Moving tops remain ordinary rideable surfaces; no world-space pinned perches. */
TL.PerchSupport = {
  describe(c,point,facing=0) {
    if(!c||c.dynamic||!c.walkTop||Math.min(c.hx,c.hz)<.14)return null;
    const short=Math.min(c.hx,c.hz),long=Math.max(c.hx,c.hz);
    const type=c.supportType||(short<.3?'rail':long<.85?'cap':short>1.5?'platform':'ledge');
    const yaw=type==='rail'?c.yaw+(c.hx>c.hz?Math.PI/2:0):facing;
    const p=c.toLocal(point.x,c.top,point.z,new THREE.Vector3());
    const margin=Math.min(.48,short*.65);
    p.x=TL.clamp(p.x,-c.hx+margin,c.hx-margin);p.z=TL.clamp(p.z,-c.hz+margin,c.hz-margin);p.y=c.hy;
    if(c.supportRadius){p.x=0;p.z=0;}
    return {col:c,id:c.id,type,width:c.hx*2,depth:c.hz*2,normal:new THREE.Vector3(0,1,0),yaw,center:c.toWorld(p.x,p.y,p.z,new THREE.Vector3()),clearance:1.8};
  },
  contact(s,x,y,z) {
    const c=s.col,cos=Math.cos(s.yaw),sin=Math.sin(s.yaw),p=new THREE.Vector3(s.center.x+x*cos+z*sin,c.top,s.center.z-x*sin+z*cos);
    const q=c.toLocal(p.x,p.y,p.z,new THREE.Vector3());
    // Reserve room for the full foot/palm, not just its ankle/wrist.
    const mx=Math.min(.13,c.hx*.42),mz=Math.min(.13,c.hz*.42);
    q.x=TL.clamp(q.x,-c.hx+mx,c.hx-mx);q.z=TL.clamp(q.z,-c.hz+mz,c.hz-mz);
    if(c.supportRadius){const r=Math.hypot(q.x,q.z),limit=c.supportRadius-.13;if(r>limit){q.x*=limit/r;q.z*=limit/r;}}
    return c.toWorld(q.x,c.hy+y,q.z,new THREE.Vector3());
  },
  enter(h,c,point,facing) {
    const s=this.describe(c,point,facing);if(!s)return false;
    const q=s.center;
    for(const x of [-.3,0,.3])for(const z of [-.3,0,.3])
      if(h.world.raycast(q.x+x,q.y+.08,q.z+z,0,1,0,1.8,o=>o!==c&&o.solid,{}, {noGround:true}))return false;
    h.perchSupport=s;h.perchFacing=s.yaw;h.perchPoint.copy(q).y+=TL.C.FEET+.02;h.pos.copy(h.perchPoint);h.vel.set(0,0,0);return true;
  }
};

TL.CollisionWorld = class {
  constructor() {
    this.CS = 16;                 // hash cell size (m)
    this.hash = new Map();
    this.dynamics = [];
    this.stampGen = 1;
    this.nextId = 1;
    this.pool = new TL.ObjectPool(() => new TL.Collider(), (c) => c.reset());
    this.count = 0;
    this._tmp = { x: 0, y: 0, z: 0 };
    this._tmp2 = { x: 0, y: 0, z: 0 };
    this._cand = [];
    this.rayBudget = 0;           // debug counter
    this.groundFn = null;         // (x,z) -> ground height (set by city)
    this.waterFn = null;          // (x,z) -> true if over water
  }
  key(ix, iz) { return (ix + 32768) * 65536 + (iz + 32768); }
  // ---------------------------------------------------------------- add / remove
  addStatic(cx, cy, cz, hx, hy, hz, yaw, props) {
    const c = this.pool.get();
    c.set(cx, cy, cz, hx, hy, hz, yaw); c.id = this.nextId++;
    if (props) Object.assign(c, props);
    const r = c.rxz;
    const x0 = Math.floor((cx - r) / this.CS), x1 = Math.floor((cx + r) / this.CS);
    const z0 = Math.floor((cz - r) / this.CS), z1 = Math.floor((cz + r) / this.CS);
    c.cells = [];
    for (let ix = x0; ix <= x1; ix++) for (let iz = z0; iz <= z1; iz++) {
      const k = this.key(ix, iz);
      let a = this.hash.get(k); if (!a) { a = []; this.hash.set(k, a); }
      a.push(c); c.cells.push(k);
    }
    this.count++;
    return c;
  }
  removeStatic(c) {
    if (!c.cells) return;
    for (const k of c.cells) {
      const a = this.hash.get(k); if (!a) continue;
      const i = a.indexOf(c); if (i >= 0) { a[i] = a[a.length - 1]; a.pop(); }
      if (!a.length) this.hash.delete(k);
    }
    c.cells = null; this.count--; this.pool.release(c);
  }
  addDynamic(cx, cy, cz, hx, hy, hz, yaw, props) {
    const c = this.pool.get();
    c.set(cx, cy, cz, hx, hy, hz, yaw); c.id = this.nextId++; c.dynamic = true;
    if (props) Object.assign(c, props);
    this.dynamics.push(c); return c;
  }
  removeDynamic(c) {
    const i = this.dynamics.indexOf(c); if (i >= 0) { this.dynamics[i] = this.dynamics[this.dynamics.length - 1]; this.dynamics.pop(); }
    this.pool.release(c);
  }
  // ---------------------------------------------------------------- broadphase
  query(minx, minz, maxx, maxz, out) {
    out.length = 0;
    const st = ++this.stampGen;
    const x0 = Math.floor(minx / this.CS), x1 = Math.floor(maxx / this.CS);
    const z0 = Math.floor(minz / this.CS), z1 = Math.floor(maxz / this.CS);
    for (let ix = x0; ix <= x1; ix++) for (let iz = z0; iz <= z1; iz++) {
      const a = this.hash.get(this.key(ix, iz)); if (!a) continue;
      for (let i = 0; i < a.length; i++) { const c = a[i]; if (c.stamp !== st) { c.stamp = st; out.push(c); } }
    }
    for (let i = 0; i < this.dynamics.length; i++) {
      const c = this.dynamics[i]; const r = c.rxz;
      if (c.cx + r >= minx && c.cx - r <= maxx && c.cz + r >= minz && c.cz - r <= maxz) out.push(c);
    }
    return out;
  }
  ground(x, z) { return this.groundFn ? this.groundFn(x, z) : 0; }
  // ---------------------------------------------------------------- closest point on OBB (world)
  closest(c, px, py, pz, out) {
    const L = c.toLocal(px, py, pz, this._tmp);
    const lx = TL.clamp(L.x, -c.hx, c.hx), ly = TL.clamp(L.y, -c.hy, c.hy), lz = TL.clamp(L.z, -c.hz, c.hz);
    return c.toWorld(lx, ly, lz, out);
  }
  /* Resolve a sphere against candidate colliders. Returns number of contacts written to `contacts`.
     Each contact: {nx,ny,nz, depth, col, vn}. Positions/velocities are mutated in-place (p, v are THREE.Vector3).
     yOff: sphere center offset from p. */
  resolveSphere(p, v, yOff, r, cands, contacts, ci) {
    const q = this._tmp2;
    for (let i = 0; i < cands.length; i++) {
      const c = cands[i]; if (!c.solid) continue;
      const sx = p.x, sy = p.y + yOff, sz = p.z;
      // quick reject
      const dxz = Math.abs(sx - c.cx) + Math.abs(sz - c.cz);
      if (dxz > c.hx + c.hz + r + c.rxz) continue;
      if (sy - r > c.cy + c.hy || sy + r < c.cy - c.hy) continue;
      const L = c.toLocal(sx, sy, sz, this._tmp);
      let lx = TL.clamp(L.x, -c.hx, c.hx), ly = TL.clamp(L.y, -c.hy, c.hy), lz = TL.clamp(L.z, -c.hz, c.hz);
      let nx, ny, nz, depth;
      const inside = (lx === L.x && ly === L.y && lz === L.z);
      if (inside) {
        // center inside box: push out along axis of least penetration (local), prefer up if near top
        const px_ = c.hx - Math.abs(L.x), py_ = c.hy - Math.abs(L.y), pz_ = c.hz - Math.abs(L.z);
        let lnx = 0, lny = 0, lnz = 0;
        if (py_ <= px_ && py_ <= pz_) { lny = L.y >= 0 ? 1 : -1; depth = py_ + r; }
        else if (px_ <= pz_) { lnx = L.x >= 0 ? 1 : -1; depth = px_ + r; }
        else { lnz = L.z >= 0 ? 1 : -1; depth = pz_ + r; }
        c.dirToWorld(lnx, lny, lnz, q); nx = q.x; ny = q.y; nz = q.z;
      } else {
        c.toWorld(lx, ly, lz, q);
        const dx = sx - q.x, dy = sy - q.y, dz = sz - q.z;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 >= r * r) continue;
        const d = Math.sqrt(d2) || 1e-6;
        nx = dx / d; ny = dy / d; nz = dz / d; depth = r - d;
      }
      p.x += nx * depth; p.y += ny * depth; p.z += nz * depth;
      // relative normal velocity (collider may move)
      let cvx = 0, cvy = 0, cvz = 0;
      if (c.dynamic) { const pv = c.pointVel(sx, sz, this._tmp); cvx = pv.x; cvy = pv.y; cvz = pv.z; }
      const vn = (v.x - cvx) * nx + (v.y - cvy) * ny + (v.z - cvz) * nz;
      if (vn < 0) { v.x -= nx * vn; v.y -= ny * vn; v.z -= nz * vn; }
      if (ci < contacts.length) {
        const k = contacts[ci++]; k.nx = nx; k.ny = ny; k.nz = nz; k.depth = depth; k.col = c; k.vn = vn; k.yOff = yOff;
      }
    }
    return ci;
  }
  // ---------------------------------------------------------------- ray vs OBB (slab test in local space)
  rayOBB(c, ox, oy, oz, dx, dy, dz, tmax, hit) {
    const L = c.toLocal(ox, oy, oz, this._tmp);
    // direction to local (rotation only)
    const ldx = dx * c.c - dz * c.s, ldz = dx * c.s + dz * c.c, ldy = dy;
    let t0 = 0, t1 = tmax, axis = -1, sign = 0;
    const o = [L.x, L.y, L.z], d = [ldx, ldy, ldz], h = [c.hx, c.hy, c.hz];
    for (let k = 0; k < 3; k++) {
      if (Math.abs(d[k]) < 1e-9) { if (o[k] < -h[k] || o[k] > h[k]) return false; continue; }
      const inv = 1 / d[k];
      let ta = (-h[k] - o[k]) * inv, tb = (h[k] - o[k]) * inv, sg = -1;
      if (ta > tb) { const t = ta; ta = tb; tb = t; sg = 1; }
      if (ta > t0) { t0 = ta; axis = k; sign = sg; }
      if (tb < t1) t1 = tb;
      if (t0 > t1) return false;
    }
    if (axis < 0) return false;            // origin inside the box: ignore (we want surfaces in front)
    if (t0 >= hit.t) return false;
    hit.t = t0; hit.col = c;
    const ln = [0, 0, 0]; ln[axis] = sign;
    c.dirToWorld(ln[0], ln[1], ln[2], this._tmp);
    hit.nx = this._tmp.x; hit.ny = this._tmp.y; hit.nz = this._tmp.z;
    return true;
  }
  /* Raycast against static hash (DDA over cells), dynamics, ground and water.
     filter(col) -> bool optional. Returns hit object (reuse `hit` if passed) or null. */
  raycast(ox, oy, oz, dx, dy, dz, maxDist, filter, hit, opts) {
    hit = hit || { t: 0, x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 0, col: null, ground: false, water: false };
    hit.t = maxDist; hit.col = null; hit.ground = false; hit.water = false;
    this.rayBudget++;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
    dx /= len; dy /= len; dz /= len;
    const st = ++this.stampGen;
    // DDA over XZ cells
    const CS = this.CS;
    let ix = Math.floor(ox / CS), iz = Math.floor(oz / CS);
    const stepX = dx > 0 ? 1 : -1, stepZ = dz > 0 ? 1 : -1;
    const tdx = Math.abs(dx) > 1e-9 ? CS / Math.abs(dx) : Infinity, tdz = Math.abs(dz) > 1e-9 ? CS / Math.abs(dz) : Infinity;
    let tmx = Math.abs(dx) > 1e-9 ? ((dx > 0 ? (ix + 1) * CS - ox : ox - ix * CS) / Math.abs(dx)) : Infinity;
    let tmz = Math.abs(dz) > 1e-9 ? ((dz > 0 ? (iz + 1) * CS - oz : oz - iz * CS) / Math.abs(dz)) : Infinity;
    let tcell = 0, guard = 0;
    while (tcell <= hit.t && guard++ < 400) {
      const a = this.hash.get(this.key(ix, iz));
      if (a) for (let i = 0; i < a.length; i++) {
        const c = a[i]; if (c.stamp === st) continue; c.stamp = st;
        if (filter && !filter(c)) continue;
        this.rayOBB(c, ox, oy, oz, dx, dy, dz, maxDist, hit);
      }
      if (tmx < tmz) { tcell = tmx; tmx += tdx; ix += stepX; } else { tcell = tmz; tmz += tdz; iz += stepZ; }
    }
    for (let i = 0; i < this.dynamics.length; i++) {
      const c = this.dynamics[i]; if (!c.solid && !c.anchor) continue;
      if (filter && !filter(c)) continue;
      this.rayOBB(c, ox, oy, oz, dx, dy, dz, maxDist, hit);
    }
    // ground / water planes
    if (!(opts && opts.noGround) && dy < -1e-6) {
      // march coarse along ray for ground height (ground is piecewise flat: evaluate at estimated hit)
      const gy0 = this.ground(ox, oz);
      let t = (gy0 - oy) / dy;
      if (t > 0 && t < hit.t) {
        const gx = ox + dx * t, gz = oz + dz * t;
        const gy = this.ground(gx, gz);
        t = (gy - oy) / dy;
        if (t > 0 && t < hit.t) {
          const water = this.waterFn && this.waterFn(ox + dx * t, oz + dz * t);
          hit.t = t; hit.col = null; hit.ground = !water; hit.water = !!water; hit.nx = 0; hit.ny = 1; hit.nz = 0;
        }
      }
    }
    if (hit.t >= maxDist) return null;
    hit.x = ox + dx * hit.t; hit.y = oy + dy * hit.t; hit.z = oz + dz * hit.t;
    return hit;
  }
  // segment clear test (true if nothing solid between a and b, ignoring `ignore`)
  segmentClear(a, b, ignore, margin) {
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
    const L = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (L < 1e-4) return true;
    const h = this.raycast(a.x, a.y, a.z, dx, dy, dz, L - (margin || 0), ignore ? (c) => c !== ignore : null, this._segHit || (this._segHit = {}), { noGround: false });
    return !h;
  }
  // ---------------------------------------------------------------- dynamic integration helpers
  moveDynamic(c, x, y, z, yaw, dt) {
    if (dt > 0) { c.vx = (x - c.cx) / dt; c.vy = (y - c.cy) / dt; c.vz = (z - c.cz) / dt; c.wy = TL.wrapAngle(yaw - c.yaw) / dt; }
    c.cx = x; c.cy = y; c.cz = z; c.setYaw(yaw);
  }
};
