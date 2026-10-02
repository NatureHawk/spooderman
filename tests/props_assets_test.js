'use strict';
const fs=require('fs'),assert=require('assert');const base=JSON.parse(fs.readFileSync('build/assets.json','utf8')).assets;let count=0;
for(const pack of ['people','props']){const man=JSON.parse(fs.readFileSync(`build/${pack}.json`,'utf8')),bin=fs.readFileSync(`build/${pack}.bin`),tex=JSON.parse(fs.readFileSync(`build/${pack}_tex.json`,'utf8'));
 if(pack==='people'){assert(man.people.length>=10&&man.people.length<=20);assert.equal(new Set(man.people.map(p=>p.name)).size,man.people.length);for(const p of man.people)for(const lod of ['hi','mid','lo'])assert.deepStrictEqual(man.assets[p.name][lod].bones,base['PED_'+p.variant].hi.bones,`${p.name} skeleton changed`);}
 for(const [name,lods]of Object.entries(man.assets))for(const [lod,e]of Object.entries(lods)){
  assert.equal(e.hb,pack==='people'?3:4);assert(e.vc>0&&e.ic>0&&e.ic%3===0);assert(e.ctr.concat(e.half).every(Number.isFinite));assert(e.half.every(n=>n>0));
  const bytes=e.big?4:2;assert(e.idx+e.ic*bytes<=bin.length);for(let i=0;i<e.ic;i++)assert((e.big?bin.readUInt32LE(e.idx+i*4):bin.readUInt16LE(e.idx+i*2))<e.vc,`${name} bad index`);
  for(let i=0;i<e.vc*2;i++){const v=bin.readFloatLE(e.uv+i*4);assert(Number.isFinite(v)&&v>=-.001&&v<=1.001,`${name} UV`);}
  if(e.bi!==undefined){assert.equal(e.bones.length,19);for(let i=0;i<e.vc;i++){let sum=0;for(let j=0;j<4;j++){assert(bin[e.bi+i*4+j]<19);sum+=bin[e.bw+i*4+j];}assert.equal(sum,255,`${name} weights`);}assert(e.half[1]*2<2.5,`${name} stretched rig`);}
  for(const s of e.tex||[])for(const k of ['d','n','o','e'])if(s[k])assert(tex[s[k]],`${name} missing texture ${s[k]}`);
  if(pack==='props'&&base[name]?.lo)for(const k of ['cols','socks','extra'])if(base[name].lo[k])assert.deepStrictEqual(e[k],base[name].lo[k],`${name} ${k} changed`);
  count++;
 }
}
console.log('PASS',count,'asset/LOD records: indices, UVs, weights, textures, exact existing NPC skeletons, collider/socket metadata');
