'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm');
const {splitTower}=require('./construction_tower_tools');
const root=path.resolve(__dirname,'..'),manifest=require('../evidence/construction/building_manifest.json');
function setup(){
 const H=process.env.TL_HARNESS||path.join(process.env.LOCALAPPDATA,'Temp/claude/c--Users-PRIYANSHU-Pictures-spooderman/3daa858f-ae71-47ed-a4cc-f3ea76aee61c/scratchpad/harness');global.THREE=require(path.join(H,'node_modules/three/build/three.cjs'));
 for(const f of ['00_core.js','02_collision.js','04_physics.js','04b_contact.js'])vm.runInThisContext(fs.readFileSync(path.join(root,'src',f),'utf8'));
 TL.ScanHooks={build:[],preNYC:[],update:[],nycTile:null};
 for(const f of ['03g_rooftops.js','03h_roofobstacles.js','03i_traversal_supports.js','03n_construction.js','03p_finished_towers.js','12d_worksites.js'])vm.runInThisContext(fs.readFileSync(path.join(root,'src',f),'utf8'));
 const nyc=require('../build/nyc.json'),buf=fs.readFileSync(path.join(root,'build/nyc.bin')),world={world:new TL.CollisionWorld(),scene:new THREE.Scene(),mats:{uniforms:{uWet:{value:0}}},data:{nyc,nycBin:buf.buffer.slice(buf.byteOffset,buf.byteOffset+buf.byteLength)},replaced:new Set(),spawnPoint:()=>require('../build/scan.json').spawn};
 // Exclude authored replacements as well as all twenty unfinished building IDs.
 const repl=path.join(root,'build/extra/repl_meta.json');if(fs.existsSync(repl)){const r=JSON.parse(fs.readFileSync(repl));world.replaced=new Set((r.inst||[]).map(i=>i.bid));}
 TL.Construction.authored=new Map(manifest.sites.map(p=>[p.roofBid,{...p,model:{stories:p.stories,hx:p.hx,hz:p.hz}}]));TL.Construction.prepare(world);
 const B=nyc.boxes;for(let k=0;k<B.n;k++){const a=[];for(let j=0;j<B.stride;j++)a.push(buf.readFloatLE(B.o+(k*B.stride+j)*4));if(world.replaced.has(a[6]))continue;a[1]=Math.min(a[1],world.constructionCuts.get(a[6])?.cutY??Infinity);world.world.addStatic(a[0],(a[1]-1)/2,a[2],a[3],(a[1]+1)/2,a[4],a[5],{kind:'building',src:'nyc',bid:a[6]});}
 for(const original of nyc.buildings){if(world.replaced.has(original.id))continue;const b=world.constructionCuts.get(original.id)?.cut||original,P=b._P||new Float32Array(b.n*9);if(!b._P)for(let i=0;i<P.length;i++)P[i]=buf.readFloatLE(b.o+i*4);const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(P,3));g.computeVertexNormals();TL.Rooftops.tile(world,g,[b]);g.dispose();}
 TL.Rooftops.build(world);TL.RoofObstacles.build(world);TL.TraversalSupports.build(world);
 world.constructionState={sites:manifest.sites.map(s=>({...s,center:new THREE.Vector3(s.x,s.baseY,s.z),routePoints:[],gates:[],landmarks:{}}))};return world;
}
function relocate(){
 const world=setup(),templatePath=path.join(root,'evidence/construction/finished_tower_template.json');let model;
 if(fs.existsSync(templatePath))model=JSON.parse(fs.readFileSync(templatePath));else{const blueprint=require('../evidence/construction/blueprints_10_19.json').sites.find(s=>s.model.tower);if(!blueprint)throw Error('Original tower template missing');model=splitTower(blueprint.model).towerModel;fs.writeFileSync(templatePath,JSON.stringify(model));}
 const excluded=new Set(manifest.sites.map(s=>s.roofBid)),usedRoofs=new Set(),towers=[],siteLinks=[],skipped=[],state={meshes:[],colliders:[],gates:[],materials:TL.Construction.materials()};
 const originals=(world.world.referenceGates||[]).filter(g=>g.type==='water_tower'&&!excluded.has(g.anchors[0]?.col?.bid));
 for(const site of manifest.sites){
  const choices=[];
  for(const A of world.roofState.analyses){if(excluded.has(A.b.id)||usedRoofs.has(A.b.id)||world.roofState.placements.some(p=>p.bid===A.b.id&&p.type==='tank'))continue;
   for(const L of A.levels||[]){if(L.area<90||L.y<12||Math.abs(L.y-site.originalTop)>85)continue;
    for(const fx of [.3,.5,.7])for(const fz of [.3,.5,.7]){const x=L.minX+(L.maxX-L.minX)*fx,z=L.minZ+(L.maxZ-L.minZ)*fz,distance=Math.hypot(x-site.x,z-site.z);if(distance>200||distance<15)continue;
     if(!TL.Rooftops.fits(A,x,z,L.y,3.1,3.1,A.yaw,.5))continue;
     const hit=world.world.raycast(x,L.y+.5,z,0,-1,0,1.5,c=>c.bid===A.b.id&&c.src==='nyc',null,{noGround:true});if(!hit||hit.ny<.9)continue;
     for(const yaw of [A.yaw,A.yaw+Math.PI/2])choices.push({id:'finished-tank-'+site.id,sourceSiteId:site.id,roofBid:A.b.id,x,y:hit.y,z,yaw,model,distance,score:distance+Math.abs(hit.y-site.originalTop)*.45});
    }
   }
  }
  choices.sort((a,b)=>a.score-b.score);let placed=null;
  for(const candidate of choices){if(TL.FinishedTowers.validate(world,candidate)){placed=candidate;break;}}
  if(placed){const gate=TL.FinishedTowers.spawn(world,placed,state);if(!gate)throw Error('Verified placement failed');towers.push(placed);usedRoofs.add(placed.roofBid);siteLinks.push({siteId:site.id,towerId:placed.id,roofBid:placed.roofBid});}
  else{
   const gates=originals.map(g=>({g,d:Math.hypot(g.center.x-site.x,g.center.z-site.z)})).filter(q=>q.d<240).sort((a,b)=>a.d-b.d);
   const found=gates.find(q=>TL.WorksiteRuns.checkpoint(world.world,{center:q.g.center,axis:q.g.axis,radius:1.15,length:q.g.length,kind:'water_tower'}));
   if(found)siteLinks.push({siteId:site.id,existingCenter:found.g.center.toArray(),roofBid:found.g.anchors[0]?.col?.bid});else skipped.push(site.id);
  }
 }
 const output={version:1,note:'Tanks moved off all unfinished buildings onto verified finished NYC roofs; existing finished tanks reused if no suitable new position exists.',towers,siteLinks,skipped};
 fs.writeFileSync(path.join(root,'evidence/construction/relocated_towers.json'),JSON.stringify(output));console.log(JSON.stringify({towers:towers.length,links:siteLinks.length,skipped,roofs:towers.map(t=>({source:t.sourceSiteId,bid:t.roofBid,x:t.x,y:t.y,z:t.z,distance:Math.round(t.distance)}))},null,2));return output;
}
if(require.main===module)relocate();module.exports={setup,relocate};
