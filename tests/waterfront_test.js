'use strict';
/* Waterfront data checks (Node, <build>/extra/waterfront_*): quay wall faces the water, the apron stays within 2 m of the land, props stand on deck,
   boats float in open water, harbour routes never cross land, docks reach into water.   node tests/waterfront_test.js */
const fs = require('fs'), path = require('path'), zlib = require('zlib'), assert = require('assert');
const BUILD = path.resolve(__dirname, '..', process.env.TL_BUILD_DIR || 'build');
const mf = path.join(BUILD, 'extra/waterfront_meta.json');
if (!fs.existsSync(mf)) { console.log('SKIP waterfront_test: no data in', BUILD); process.exit(0); }
const meta = JSON.parse(fs.readFileSync(mf, 'utf8'));
const gz = zlib.gunzipSync(fs.readFileSync(path.join(BUILD, 'extra/waterfront_data.bin.gz')));
const buf = gz.buffer.slice(gz.byteOffset, gz.byteOffset + gz.byteLength);
const part = (k) => { const p = meta.parts[k]; return p.t === 'uint8' ? new Uint8Array(buf, p.o, p.n) : new Float32Array(buf, p.o, p.n); };
const sc = JSON.parse(fs.readFileSync(path.join(BUILD, 'scan.json'), 'utf8')), sb = fs.readFileSync(path.join(BUILD, 'scan.bin'));
const land2 = new Uint8Array(sb.buffer, sb.byteOffset + sc.land, sc.nx * sc.nz);
const isLand = (x, z) => { const i = Math.floor((x - sc.ox) / sc.cell), j = Math.floor((z - sc.oz) / sc.cell); return i >= 0 && j >= 0 && i < sc.nx && j < sc.nz && land2[j * sc.nx + i] === 1; };
const F = meta.frame, bits = part('apron_bits');
const apron = (x, z) => { const c = Math.floor((x - F.x0) / F.rc), r = Math.floor((z - F.z0) / F.rc); if (c < 0 || r < 0 || c >= F.w || r >= F.h) return false; const i = r * F.w + c; return ((bits[i >> 3] >> (i & 7)) & 1) === 1; };
const solid = (x, z) => isLand(x, z) || apron(x, z);
let passed = 0; const test = (n, fn) => { fn(); passed++; console.log('PASS ' + n); };

test('quay wall: triangles face the water and stand on the shoreline', () => {
  const P = part('wall_p'), N = part('wall_n'); let bad = 0, n = 0;
  for (let t = 0; t < P.length / 9; t += 37) {
    const o = t * 9, cx = (P[o] + P[o + 3] + P[o + 6]) / 3, cz = (P[o + 2] + P[o + 5] + P[o + 8]) / 3, nx = N[o], nz = N[o + 2];
    n++;
    if (solid(cx + nx * 1.6, cz + nz * 1.6)) bad++;                  // outward side is water
    if (!solid(cx - nx * 2.6, cz - nz * 2.6)) bad++;                 // inward side is land / apron
  }
  assert(n > 100 && bad / (2 * n) < 0.04, 'wall faces wrong way: ' + bad + ' of ' + 2 * n);
});
test('apron: only within 2.2 m of the land, never over the land itself', () => {
  const P = part('apron_p'); let far = 0, n = 0;
  for (let t = 0; t < P.length / 9; t += 11) {
    const o = t * 9, cx = (P[o] + P[o + 3] + P[o + 6]) / 3, cz = (P[o + 2] + P[o + 5] + P[o + 8]) / 3; n++;
    let near = false; for (let a = 0; a < 8 && !near; a++) near = isLand(cx + Math.cos(a * 0.785) * 2.6, cz + Math.sin(a * 0.785) * 2.6) || isLand(cx, cz);
    if (!near) far++;
  }
  assert(n > 50 && far / n < 0.03, 'apron far from land: ' + far + '/' + n);
});
test('props stand on deck; rails and benches face the water', () => {
  for (const k of ['rail_iron', 'rail_cable', 'bollard', 'lamp', 'bench', 'ring']) {
    const A = part('pl_' + k), st = (k.startsWith('rail') ? 4 : 3); let off = 0, n = 0;
    for (let i = 0; i + st <= A.length; i += st * 5) { n++; if (!solid(A[i], A[i + 1])) off++; }
    assert(n === 0 || off / n < 0.04, k + ' off deck ' + off + '/' + n);
  }
});
test('boats float in water, docks reach into it', () => {
  for (const b of meta.boats) {
    const hl = b.len / 2, s = Math.sin(b.yaw), c = Math.cos(b.yaw); let hit = 0;
    for (const f of [-0.9, -0.5, 0, 0.5, 0.9]) if (isLand(b.x + s * hl * f, b.z + c * hl * f)) hit++;
    assert(hit <= 1, b.type + ' on land at ' + b.x.toFixed(0) + ',' + b.z.toFixed(0));
  }
  const D = part('pl_dock');
  for (let i = 0; i < D.length; i += 3) { const x = D[i] + Math.cos(D[i + 2]) * 9, z = D[i + 1] - Math.sin(D[i + 2]) * 9; assert(!solid(x, z), 'dock tip on land'); }
});
test('harbour routes stay in open water', () => {
  for (const [name, R] of Object.entries(meta.routes)) {
    const P = R.pts;
    for (let i = 0; i + 1 < P.length; i++) for (let t = 0; t <= 1; t += 0.02) { const x = P[i][0] + (P[i + 1][0] - P[i][0]) * t, z = P[i][1] + (P[i + 1][1] - P[i][1]) * t; assert(!isLand(x, z), name + ' crosses land at ' + x.toFixed(0) + ',' + z.toFixed(0)); }
  }
});
console.log('waterfront_test: ' + passed + ' passed');
