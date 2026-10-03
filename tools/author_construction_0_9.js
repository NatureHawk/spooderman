'use strict';
// Individually specified floor plans for the first ten original Manhattan buildings.
const fs=require('fs'),path=require('path'),vm=require('vm');const harness=process.env.TL_HARNESS||path.join(process.env.LOCALAPPDATA,'Temp/claude/c--Users-PRIYANSHU-Pictures-spooderman/3daa858f-ae71-47ed-a4cc-f3ea76aee61c/scratchpad/harness');global.THREE=require(path.join(harness,'node_modules/three/build/three.cjs'));global.TL={ScanHooks:{build:[],preNYC:[]}};vm.runInThisContext(fs.readFileSync('src/03n_construction.js','utf8'));
const manifest=require('../evidence/construction/building_manifest.json');
const designs=[
 {bid:117,name:'Dockside Sawtooth Works',floors:['ABC','ABCD','ABF','AB'],note:'Long twin structural wings, rear loading bridge, shuttered third-floor edge and a recessed twin crown.',tarp:[-1,-.55],staging:[-1,.7],plank:[1,.4]},
 {bid:147,name:'Liberty Courtyard Frame',floors:['ABCD','ABCD','AB'],note:'Four-sided open courtyard with stepped north gallery and two independent upper service decks.',tarp:[1,.6],staging:[-1,-.7],plank:[-1,.15]},
 {bid:130,name:'Civic Lantern Build',floors:['AB','ABC','ABCD','ABF','AB'],note:'Five-storey lantern profile: open first storey, braced rear terraces, alternating timber shutter bands.',tarp:[-1,.4],staging:[1,-.7],plank:[1,-.2]},
 {bid:169,name:'Pearl Split-Level Works',floors:['ABF','ABCD','AB'],note:'Split galleries leave broad cut-through space; rear service bay extends one floor higher.',tarp:[1,-.55],staging:[-1,.5],plank:[1,.6]},
 {bid:499,name:'Stone Street L-Frame',floors:['ABC','ABF','ABCD','AB'],note:'L-shaped staged decks open into a double-wing crown; unfinished edge beams project into the southern bay.',tarp:[-1,-.7],staging:[1,.5],plank:[-1,-.4]},
 {bid:173,name:'Fulton Timber Court',floors:['ABCD','AB'],note:'Broad two-storey court with timber centering, long external plank gallery and incomplete rebar column heads.',tarp:[1,.1],staging:[-1,.7],plank:[1,-.5]},
 {bid:598,name:'Hudson Offset Galleries',floors:['AB','ABCD','ABF','AB'],note:'Offset gallery stacks around a clear central chase, exposed lintel beams, a sheltered west casting yard.',tarp:[-1,.65],staging:[1,-.6],plank:[-1,.5]},
 {bid:212,name:'Trinity Loading Frames',floors:['ABC','ABCD','AB'],note:'Rear loading bridge and alternating shuttered floor edges frame the central open service passage.',tarp:[1,.4],staging:[-1,-.6],plank:[1,.3]},
 {bid:205,name:'Mercer Rebar Crown',floors:['ABCD','AB','ABC','ABF','AB'],note:'Five independently terraced floorplates, extended rebar crown and a narrow blue-covered exterior staging gallery.',tarp:[-1,-.2],staging:[1,.65],plank:[-1,-.5]},
 {bid:92,name:'Canal East Cantilever',floors:['ABF','ABCD','AB'],note:'East loading cantilever, twin upper decks and a short rear plank bridge distinguish this compact site.',tarp:[1,-.3],staging:[-1,.6],plank:[1,.7]}
];
const out=[];
for(let i=0;i<10;i++){
 const p=manifest.sites[i],d=designs[i];if(p.roofBid!==d.bid)throw Error('Manifest moved '+i);
 const M=TL.Construction.model(p.stories,p),old=M.solids,leg=old[M.legs[0]],pi=M.parts.findIndex(v=>v.shape==='box'&&v.mat==='steel'&&v.x===leg.x&&v.y===leg.y&&v.z===leg.z),offset=M.legs[0];
 M.parts=M.parts.slice(pi);M.solids=old.slice(offset);M.legs=M.legs.map(x=>x-offset);M.pipeSolids=M.pipeSolids.map(x=>x-offset);M.decks=[];
 const box=(mat,x,y,z,hx,hy,hz,solid=true,kind='beam')=>{M.parts.push({shape:'box',mat,x,y,z,hx,hy,hz});if(solid)M.solids.push({x,y,z,hx,hy,hz,mat,kind});};
 const beam=(mat,a,b,r=.055)=>M.parts.push({shape:'beam',mat,a,b,r});
 const hx=p.hx,hz=p.hz,gap=2.5,wx=(hx+gap)/2,ww=(hx-gap)/2;
 const rect={A:[-hx,-gap,-hz,hz],B:[gap,hx,-hz,hz],C:[-gap,gap,-hz,-hz+2.3],D:[-gap,gap,hz-2.3,hz],F:[-gap,gap,-hz,-hz+4]};
 // Closed datum follows the actual scanned footprint; upper floors are genuinely open.
 box('concrete',0,-.2,0,hx,.2,hz,true,'platform');
 const cap=[],c=Math.cos(p.yaw),s=Math.sin(p.yaw),P=p.original.positions;
 for(let k=0;k<P.length;k+=9){if(Math.max(P[k+1],P[k+4],P[k+7])-Math.min(P[k+1],P[k+4],P[k+7])>.06||P[k+1]<p.cutY)continue;for(let j=0;j<9;j+=3){const x=P[k+j]-p.x,z=P[k+j+2]-p.z;cap.push(x*c-z*s,0,x*s+z*c);}}
 M.parts.pop();M.parts.push({shape:'footprint',mat:'concrete',positions:cap});
 for(let l=0;l<p.stories;l++){
  const code=d.floors[l]||'AB',y=(l+1)*4.2;
  for(const key of code){let [x0,x1,z0,z1]=rect[key];if(l===p.stories-1){z0+=1.4+(i%3)*.35;z1-=1.4+(i%2)*.5;}
   const x=(x0+x1)/2,z=(z0+z1)/2,xx=(x1-x0)/2,zz=(z1-z0)/2;box('concrete',x,y,z,xx,.2,zz,true,'platform');M.decks.push({x,y,z,hx:xx,hz:zz,l});
   box('concrete',x,y-.35,z0+.22,xx,.16,.22,true,'beam');
   if((l+i)%2===0)box('timber',x,y-.02,z1,xx,.32,.065,false);
   if(key==='A'||key==='B')for(const X of [x0+.4,x1-.4])for(const Z of [z0+.45,z1-.45]){box('concrete',X,y-2.1,Z,.3,1.9,.3,true,'column');if(l===p.stories-1)for(const u of [-.14,.14])for(const v of [-.14,.14])beam('rust',[X+u,y+.2,Z+v],[X+u,y+1.25+(i%3)*.15,Z+v],.025);}
  }
  const side=(l+i)%2?1:-1,X=side*(hx+.25);box('timber',X,y+.07,0,.62,.06,hz-1,true,'platform');
  for(const Z of [-hz+1,hz-1]){box('rust',X,y+.58,Z,.045,.65,.045,true,'rail');beam('rust',[X,.1,Z],[X,y+1.25,Z],.055);}
  for(const H of [.65,1.16])box('steel',X,y+H,0,.032,.032,hz-1,true,'rail');
  box('net',X,y+.63,(i%2?1:-1)*hz*.35,.014,.43,hz*.3,false);
 }
 const tx=d.tarp[0]*(hx+.1),tz=d.tarp[1]*hz;box('tarp',tx,5.7,tz,.025,1.6,Math.min(2.8,hz*.24),false);
 for(const Z of [tz-2.9,tz+2.9])beam('steel',[tx,3.5,Z],[tx,7.5,Z],.045);
 // Individually located timber pallets, formwork stacks and loose casting remnants.
 const sx=d.staging[0]*wx,sz=d.staging[1]*hz;
 for(let n=0;n<6;n++)box('timber',sx,.18+n*.1,sz,Math.min(1.8,ww-.5),.045,.6,true,'cargo');
 for(let n=0;n<5;n++)box(n%2?'concrete':'rust',sx+(n%3-1)*.65,.13,sz-1.8-Math.floor(n/3)*.6,.2+n*.02,.13,.19,false);
 for(let n=0;n<4;n++)box('timber',d.plank[0]*wx,4.47+n*.085,d.plank[1]*hz,Math.min(2.2,ww-.3),.035,.38,false);
 const finishDeck=M.decks.find(v=>v.l===0&&v.x>0);M.finish=[finishDeck.x,finishDeck.y+.2,finishDeck.z];
 if(d.bid===92){
  // The east neighbour rises above this roof. Author the lifting station on the rear
  // cantilever so the full entry/exit lane opens into the street, not the neighbour.
  const dx=-2,dz=-4,pipeX=M.pipe[0];
  for(const v of M.parts){
   if(v.shape==='pipe'||(v.shape==='ring'&&Math.abs(v.x-pipeX)<.01)){v.x+=dx;v.z+=dz;}
   else if(v.shape==='box'&&v.mat==='orange'&&v.y>M.top+1&&Math.abs(v.x-pipeX)<3){v.x+=dx;v.z+=dz;}
   else if(v.shape==='beam'&&v.a[1]>M.top+1&&v.b[1]>M.top+1&&Math.abs(v.a[0]-pipeX)<2&&Math.abs(v.b[0]-pipeX)<2){v.a[0]+=dx;v.b[0]+=dx;v.a[2]+=dz;v.b[2]+=dz;}
  }
  for(const v of M.solids)if(v.kind==='pipe'||(v.mat==='orange'&&v.y>M.top+1&&Math.abs(v.x-pipeX)<3)){v.x+=dx;v.z+=dz;}
  M.pipe[0]+=dx;M.pipe[2]+=dz;box('concrete',pipeX+dx,M.top,-4,3.05,.2,3.45,true,'platform');
  box('concrete',pipeX+dx,M.top-.35,-6.85,3.05,.17,.3,true,'beam');
 }
 M.authoredBuilding=d.bid;M.designNotes=d.note;
 out.push({index:i,id:p.id,bid:d.bid,name:d.name,designNotes:d.note,model:M});
}
fs.writeFileSync('evidence/construction/blueprints_0_9.json',JSON.stringify(out));console.log('Authored ten building-specific blueprints',out.map(x=>x.bid));

