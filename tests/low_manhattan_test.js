'use strict';
require('./hand_swing_test.js');
const fs=require('fs'),vm=require('vm'),assert=require('assert');
vm.runInThisContext(fs.readFileSync('src/03k_low_manhattan.js','utf8'));
let p=[];
for(let x=0;x<10;x++)for(let y=0;y<10;y++)p.push(x,y,0,x+1,y,0,x+1,y+1,0,x,y,0,x+1,y+1,0,x,y+1,0);
const f=TL.LowManhattan.flatten(p);assert.equal(f.p.length/9,2,'a subdivided flat rectangular wall becomes one quad');
function area(p){let sum=0;for(let i=0;i<p.length;i+=9){const a=new THREE.Vector3().fromArray(p,i),b=new THREE.Vector3().fromArray(p,i+3),c=new THREE.Vector3().fromArray(p,i+6);sum+=b.sub(a).cross(c.sub(a)).length()/2;}return sum;}
assert.equal(area(f.p),100);
// Concave roof footprint stays concave, without filling its missing corner.
const outline=[new THREE.Vector2(0,0),new THREE.Vector2(3,0),new THREE.Vector2(3,1),new THREE.Vector2(1,1),new THREE.Vector2(1,3),new THREE.Vector2(0,3)];
const concave=[];for(const tri of THREE.ShapeUtils.triangulateShape(outline,[]))for(const j of tri)concave.push(outline[j].x,0,outline[j].y);
assert(Math.abs(area(TL.LowManhattan.flatten(concave).p)-5)<1e-6);
for(const name of ['WEAVER','PULSE']){
 const g=TL.Assets.geo(name,'hi'),before=g.index.array.slice(),low=TL.LowManhattan.skinGeometry(g);
 assert(low.index.count<g.index.count*.8,'meaningful suit triangle reduction');assert.deepEqual(g.index.array,before);
 assert.equal(low.attributes.skinIndex.itemSize,4);assert.equal(low.attributes.skinWeight.itemSize,4);
 for(const attr of Object.values(low.attributes))assert(Array.from(attr.array).every(Number.isFinite));
 for(let i=0;i<low.attributes.skinWeight.count;i++){
  const a=low.attributes.skinWeight.array,sum=a[i*4]+a[i*4+1]+a[i*4+2]+a[i*4+3];assert(Math.abs(sum-1)<.025);
 }
 console.log(name,g.index.count/3,'→',low.index.count/3,'triangles; skin weights intact');
}
console.log('PASS flat-wall merging, concave roof outline, immutable source geometry, both skinned hero proxies');
