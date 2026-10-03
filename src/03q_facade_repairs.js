/* Additive exterior repairs recovered from original roof/terrace profiles.
   Original scan geometry and intentional open construction floors stay intact. */
'use strict';
TL.FacadeRepairs={
 asset:null,
 async load(data){this.asset=null;if(data.nyc&&TL.Extra?.has('construction_facade_repairs.json.gz'))this.asset=await TL.Extra.json('construction_facade_repairs.json.gz');},
 build(world){
  if(world.facadeRepairState)return world.facadeRepairState;
  const S=world.facadeRepairState={meshes:[],colliders:[],buildings:[],triangles:0},lookup=new Map(world.data.nyc.buildings.map(b=>[b.id,b]));
  for(const row of this.asset?.buildings||[]){
   const source=lookup.get(row.bid);if(!source||!row.positions.length||world.replaced?.has(row.bid))continue;
   const g=new THREE.BufferGeometry(),P=new Float32Array(row.positions),n=P.length/9,count=P.length/3,UV=new Float32Array(count*2),C=new Float32Array(count*3).fill(1),Fa=new Float32Array(count*4),Tr=new Float32Array(count*3),trim=new THREE.Color(source.t);
   const originalUV=source.uo===undefined?null:new Float32Array(world.data.nycBin,source.uo,source.n*6);
   for(let k=0;k<n;k++){
    const donor=row.donorTriangles[k]||0,o=donor*6,u=originalUV?(originalUV[o]+originalUV[o+2]+originalUV[o+4])/3:0,v=originalUV?(originalUV[o+1]+originalUV[o+3]+originalUV[o+5])/3:0;
    for(let j=0;j<3;j++){const i=k*3+j;UV.set([u,v],i*2);Fa.set([source.st,source.fh,source.ww,source.sd],i*4);Tr.set([trim.r,trim.g,trim.b],i*3);}
   }
   for(const [key,data,size]of [['position',P,3],['uv',UV,2],['color',C,3],['aFac',Fa,4],['aTrim',Tr,3]])g.setAttribute(key,new THREE.BufferAttribute(data,size));
   g.computeVertexNormals();g.computeBoundingSphere();
   // Mark a vertical-only overlay as already analyzed; it is not a new rooftop.
   const descriptor={...source,n,_source:source,_triSource:row.donorTriangles,_constructionCut:row.cutY||row.top};
   TL.ScanHooks.nycTile?.(world,g,[descriptor]);
   // No measured photograph exists on an absent wall. Use this building's normal
   // rule-window fallback, not donor window records from an unrelated orientation.
   if(g.attributes.aFacRec)g.attributes.aFacRec.array.fill(0);
   const mesh=new THREE.Mesh(g,world.nycMat||world.mats.facade);mesh.name='Repaired exterior facade BID '+row.bid;mesh.userData.facadeRepairBid=row.bid;mesh.castShadow=mesh.receiveShadow=true;mesh.matrixAutoUpdate=false;world.scene.add(mesh);S.meshes.push(mesh);S.triangles+=n;S.buildings.push(row.bid);
   for(const edge of row.segments){
    const dx=edge.b[0]-edge.a[0],dz=edge.b[1]-edge.a[1],length=Math.hypot(dx,dz),height=edge.top-edge.bottom;if(length<.03||height<.03)continue;
    // Thin boundary faces, never an enclosing building AABB: setbacks and court
    // openings remain free. Existing coarse scan boxes may already cover them.
    const c=world.world.addStatic((edge.a[0]+edge.b[0])/2,(edge.bottom+edge.top)/2,(edge.a[1]+edge.b[1])/2,length/2,height/2,.04,Math.atan2(-dz,dx),{kind:'building',src:'facade_repair',bid:row.bid,climb:true,anchor:true});S.colliders.push(c);
   }
  }
  return S;
 },
 dispose(world){const S=world.facadeRepairState;if(!S)return;for(const m of S.meshes){world.scene.remove(m);m.geometry.dispose();}for(const c of S.colliders)world.world.removeStatic(c);world.facadeRepairState=null;}
};
if(TL.ScanHooks){TL.ScanHooks.load.push(data=>TL.FacadeRepairs.load(data));TL.ScanHooks.build.push(world=>TL.FacadeRepairs.build(world));}
