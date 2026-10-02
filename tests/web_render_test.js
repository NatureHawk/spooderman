'use strict';
require('./hand_swing_test.js');
const assert=require('assert'),fs=require('fs'),vm=require('vm');
vm.runInThisContext(fs.readFileSync('src/07_vfx.js','utf8'));
const scene=new THREE.Scene(),view=new TL.RopeRenderer(scene,0xffffff),rope=new TL.Rope();
const from=new THREE.Vector3(0,0,0);rope.active=true;rope.anchor.set(0,10,10);rope.L=15;rope.shotT=.1;
view.update(1/60,from,rope,.6);
assert(view.pos.length===(view.segs+1)*view.radial*4*3,'four rendered filaments');
assert(Array.from(view.pos).every(Number.isFinite));
rope.attached=true;rope.tension=120;view.update(1/60,from,rope,1);
const fresh=view.pts.map((p,i)=>p.distanceTo(from.clone().lerp(rope.anchor,i/view.segs))).reduce((a,b)=>Math.max(a,b),0);
for(let i=0;i<60;i++)view.update(1/60,from,rope,1);
const settled=view.pts.map((p,i)=>p.distanceTo(from.clone().lerp(rope.anchor,i/view.segs))).reduce((a,b)=>Math.max(a,b),0);
assert(fresh>.08&&settled<.005,'firing ripple settles under load');
assert(view.pts[0].distanceTo(from)<1e-6&&view.pts[view.segs].distanceTo(rope.anchor)<1e-6);
assert.equal(rope.L,15);assert.equal(rope.tension,120);
for(const p of [new THREE.Vector3(0,10,0),from.clone()]){
  rope.anchor.copy(p);view.update(1/60,from,rope,1);
  assert(Array.from(view.pos).every(Number.isFinite));assert(Array.from(view.mesh.geometry.attributes.normal.array).every(Number.isFinite));
}
rope.release();view.update(1/60,from,rope,1);assert(!view.mesh.visible);
assert(!fs.readFileSync('src/13_ui.js','utf8').includes("'SPACE ↑'"));
console.log('PASS silk filaments, settling shot ripple, anchored endpoints, vertical/zero-length lines, release cleanup, removed text prompt');
