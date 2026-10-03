'use strict';
// Extract the actual former assembly, preserving pipe collider indices after removal.
function splitTower(input){
 const M=JSON.parse(JSON.stringify(input));if(!M.tower)return {siteModel:M,towerModel:null};
 const [x,y,z]=M.tower,base=y,within=(p)=>{
  if(p.shape==='beam')return Math.min(p.a[1],p.b[1])>=base-.04&&[p.a,p.b].every(v=>Math.abs(v[0]-x)<=3.05&&Math.abs(v[2]-z)<=3.05);
  const bottom=p.y-(p.hy??(p.height?p.height/2:p.radius||0));
  return bottom>=base-.07&&Math.abs((p.x||0)-x)+(p.hx||p.radius||0)<=3.06&&Math.abs((p.z||0)-z)+(p.hz||0)<=3.06;
 };
 const partTower=M.parts.filter(within),oldIndices=[];M.solids.forEach((b,i)=>{if(within(b))oldIndices.push(i);});
 const keep=new Map(),solids=[];M.solids.forEach((b,i)=>{if(!oldIndices.includes(i)){keep.set(i,solids.length);solids.push(b);}});
 const movePart=p=>{const q=JSON.parse(JSON.stringify(p));if(q.shape==='beam'){q.a=q.a.map((v,i)=>v-[x,base,z][i]);q.b=q.b.map((v,i)=>v-[x,base,z][i]);}else{q.x-=x;q.y-=base;q.z-=z;}return q;};
 const towerModel={parts:partTower.map(movePart),solids:oldIndices.map(i=>movePart(M.solids[i])),legs:M.legs.map(i=>oldIndices.indexOf(i)),gate:{center:[0,1.65,0],axis:[0,0,1],length:4.8,radius:2.05,height:3.65}};
 if(towerModel.legs.some(i=>i<0)||towerModel.parts.filter(p=>p.shape==='tank').length!==1)throw Error('Incomplete tank extraction');
 M.parts=M.parts.filter(p=>!within(p));M.solids=solids;M.pipeSolids=M.pipeSolids.map(i=>keep.get(i));M.tower=null;M.legs=[];
 if(M.pipeSolids.some(i=>i===undefined))throw Error('Pipe collider removed while extracting tank');
 return {siteModel:M,towerModel};
}
module.exports={splitTower};
