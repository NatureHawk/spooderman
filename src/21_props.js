/* Textured pedestrian and prop assets. Rendering only; existing NPC AI/animation and contact geometry remain authoritative. */
'use strict';
TL.People = {
 choose(variant,rng) {const options=(TL.Assets.people||[]).filter(p=>p.variant===variant);return options.length?options[((Math.imul(rng.s|0,1597334677)>>>0)%options.length)]:null;},
 dress(s,look,quality) {
  const name=look?look.name:'PED_'+s.v,lod=quality==='ultra'?'hi':quality==='low'?'lo':'mid';
  const geo=TL.Assets.geo(name,lod);if(!geo||s.sk.mesh.geometry===geo)return;
  s.sk.mesh.geometry=geo;s.sk.mesh.material=geo.userData.tex?TL.Assets.texMats(geo):s.mat;
 },
 batches(game,capacity) {
  const batches=new Map();
  const fallback=()=>TL.Assets.people[0];
  return {
   alloc(p,m) {const look=p.appearance||fallback();let batch=batches.get(look.name);
    if(!batch){const geo=TL.Assets.geo(look.far,'lo');batch=new TL.InstanceBatch(game.scene,geo,TL.Assets.texMats(geo),capacity,{noShadow:true});batches.set(look.name,batch);}
    return batch.alloc(p,m);
   },
   set(p,m){if(p.batch)p.batch.set(p,m);},
   dispose(scene){for(const b of batches.values())b.dispose(scene);batches.clear();}
  };
 }
};

/* Visual-only upgrades. Preserve the existing roof meshes where their exact bars,
   ladder rungs and top caps are used by traversal contacts. */
TL.PropArt = {
 surface(mat,kind) {
  if(!TL.Assets.texImgs['surface_'+kind])return mat;
  const m=mat.clone();m.onBeforeCompile=()=>{};m.customProgramCacheKey=()=>'';
  m.map=TL.Assets.texture('surface_'+kind,true);m.normalMap=TL.Assets.texture('surface_'+kind+'_n',false);m.normalScale=new THREE.Vector2(.32,-.32);m.roughness=kind==='wood'||kind==='tar'? .92:.68;
  m.color.lerp(new THREE.Color(0xffffff),.35);return m;
 },
 weather(kits) {
  const cache=new Map();
  for(const [name,parts]of Object.entries(kits))for(const part of parts){
   const old=part.material,c=old.color,kind=c&&c.r>c.g*1.2&&c.g>c.b*1.15?'wood':/cabinet|hatch/.test(name)?'paint':'galvanized';
   const key=old.uuid+'|'+kind;if(!cache.has(key))cache.set(key,this.surface(old,kind));part.material=cache.get(key);
  }return kits;
 },
 fit(name,lod,target) {
  const source=TL.Assets.geo(name,lod);if(!source)return null;
  const geo=source.clone();geo.userData=source.userData;source.computeBoundingBox();target.computeBoundingBox();const b=target.boundingBox,ts=b.getSize(new THREE.Vector3());let a=source.boundingBox,sz=a.getSize(new THREE.Vector3());if((sz.x>sz.z)!==(ts.x>ts.z)){geo.rotateY(Math.PI/2);geo.computeBoundingBox();a=geo.boundingBox;sz=a.getSize(new THREE.Vector3());}const c=a.getCenter(new THREE.Vector3()),tc=b.getCenter(new THREE.Vector3());
  geo.translate(-c.x,-c.y,-c.z);geo.scale(ts.x/Math.max(sz.x,.001),ts.y/Math.max(sz.y,.001),ts.z/Math.max(sz.z,.001));geo.translate(tc.x,tc.y,tc.z);geo.computeBoundingSphere();return geo;
 }
};
if(TL.Rooftops){const make=TL.Rooftops.kits;TL.Rooftops.kits=function(){const kits=TL.PropArt.weather(make.call(this));const lod=TL.game?.quality==='low'?'lo':TL.game?.quality==='ultra'?'hi':'mid';
 const geo=TL.Assets.geo('RK_hvac',lod);if(geo){for(const p of kits.hvac)p.geometry.dispose();kits.hvac=[{geometry:geo,material:TL.Assets.texMats(geo)}];}const sky=TL.Assets.geo('RK_skylight',lod);if(sky){for(const p of kits.hatch)p.geometry.dispose();kits.hatch=[{geometry:sky,material:TL.Assets.texMats(sky)}];}return kits;};}
if(TL.RoofObstacles){const make=TL.RoofObstacles.kits;TL.RoofObstacles.kits=function(){return TL.PropArt.weather(make.call(this));};}
if(TL.StreetWorld){const build=TL.StreetWorld.prototype.buildProps;TL.StreetWorld.prototype.buildProps=function(){build.call(this);
 const names={bench:'P_bench',hydrant:'P_hydrant',mailbox:'P_mailbox',trash_a:'P_trash_bin',trash_b:'P_newsbox',bollard:'P_bollard'};
 for(const ty of this.types){const asset=names[ty.name];if(!asset||!TL.Assets.has(asset))continue;
  const target=ty.lod0.geometry;const lod=TL.game?.quality==='low'?'lo':TL.game?.quality==='ultra'?'hi':'mid';const geo=TL.PropArt.fit(asset,lod,target);if(!geo)continue;
  ty.lod0.geometry=geo;ty.lod0.material=TL.Assets.texMats(geo);ty.T=Object.assign({},ty.T,{tris:geo.index.count/3});
  if(ty.lod1){const far=TL.PropArt.fit(asset,'lo',target);ty.lod1.geometry.dispose();ty.lod1.geometry=far;ty.lod1.material=TL.Assets.texMats(far);}target.dispose();
 }
};}

// Attribution travels with the single-file build and stays accessible from its title menu.
if(TL.UIManager){const title=TL.UIManager.prototype.showTitle;TL.UIManager.prototype.showTitle=function(){title.call(this);const node=document.getElementById('tl-props-credits');if(!node)return;const rows=JSON.parse(node.textContent);
 this.$('titleMenu').appendChild(this.btn('Asset credits',()=>this.openModal('ASSET CREDITS',body=>{for(const row of rows){const p=document.createElement('p'),a=document.createElement('a');a.textContent=row.name+' — '+row.author;a.href=row.url;a.target='_blank';a.rel='noopener noreferrer';p.appendChild(a);p.appendChild(document.createTextNode(' · '+row.license+'. '+row.changes));body.appendChild(p);}})));
};}
