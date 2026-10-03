/* Ten separately specified architectural plans for the scanned buildings below.
   Coordinates are metres in each building's own footprint; no random layout generator.
   Shared helpers only describe construction materials and reusable lifting equipment. */
'use strict';
const fs=require('fs'),path=require('path');
const manifest=require('../evidence/construction/building_manifest.json');
// Every floor is explicitly laid out. Rectangles are [left,right,back,front].
const designs={
  178:{name:'Franklin Bridge Loft',note:'Compact four-storey twin lofts joined by two narrow timber bridges; rear concrete service core and a blue east weather screen.',
    floors:[ [[-9.5,-2.7,-9.7,9.7],[2.7,9.5,-9.7,9.7],[-2.7,2.7,-9.7,-6.4]], [[-9.5,-2.7,-9.7,7],[2.7,9.5,-7,9.7]], [[-9.5,-2.7,-7,9.7],[2.7,9.5,-9.7,6.6],[-2.7,2.7,6.6,9.7]], [[-9.5,-2.7,-5.7,5.7],[2.7,9.5,-8.5,5.7]] ],
    core:[-5.3,-8.1,2.1,1.2,12.2],planks:[[0,8.67,-6.8,3.1,.62],[0,12.87,6.7,3.1,.62]],tarps:[[9.45,6.7,3.2,.04,2.1,3.8]],finish:[6.1,8.6,5.8],shutters:[[-9.45,15.1,-.5,.05,1.7,4.6]]},
  697:{name:'Canal Foundry Court',note:'A broad low-rise foundry with a large rectangular court, a south loading apron, paired east core walls and a long plank gantry across its north void.',
    floors:[ [[-19.2,-6,-18.7,18.7],[6,19.2,-18.7,18.7],[-6,6,-18.7,-10],[-6,6,11.5,18.7]], [[-19.2,-3,-18.7,6],[3,19.2,-7,18.7],[-3,3,-18.7,-11.5]] ],
    core:[15.5,-13.9,2.4,2.2,7.9],planks:[[0,4.47,12.5,6.4,.75],[0,8.67,-12.6,3.5,.64]],tarps:[[-19.13,5.6,-8.7,.04,1.3,6],[12,6.6,18.6,5.5,1.6,.04]],finish:[14,4.4,11],shutters:[[-14,7.2,6,4.2,1.2,.055]]},
  418:{name:'Bowery Stair Galleries',note:'Five progressively offset galleries rise around an open spine. A projecting west stair core, staggered timber landings and a single narrow upper transfer bridge distinguish this slender block.',
    floors:[ [[-9.5,-2.6,-9.7,9.7],[2.6,9.5,-9.7,9.7]], [[-9.5,-2.6,-9.7,6],[2.6,9.5,-6,9.7],[-2.6,2.6,6.7,9.7]], [[-9.5,-2.6,-6,9.7],[2.6,9.5,-9.7,5.8]], [[-9.5,-2.6,-9.7,5.8],[2.6,9.5,-4.5,9.7]], [[-9.5,-2.6,-5,6.8],[2.6,9.5,-7,5.8]] ],
    core:[-6.5,-8.1,2.1,1.25,17.1],planks:[[0,12.87,6.8,3,.6],[5.8,16.99,-6.2,2.5,.7]],tarps:[[9.42,11.1,5.5,.04,2.5,3.7]],finish:[6.1,16.999999999999996,5.5],shutters:[[-9.4,19.4,1.4,.06,1.6,3.8]]},
  127:{name:'Nassau Twin Bars',note:'A long office floor is split into two parallel concrete bars, a western lift core and a timber transfer bay. The eastern top bay is still plywood shuttering with exposed rebar.',
    floors:[ [[-19.2,-3,-9.7,9.7],[3,19.2,-9.7,9.7]], [[-19.2,-3,-9.7,7.2],[3,19.2,-7.2,9.7],[-3,3,-9.7,-6.8]], [[-19.2,-3,-9.7,9.7],[3,15,-9.7,9.7]], [[-19.2,-3,-7,7],[3,19.2,-5.8,5.8]] ],
    core:[-15.2,-7.6,2.9,1.65,15.5],planks:[[0,8.67,7.5,3.6,.62],[15.7,12.87,0,3.2,.7]],tarps:[[19.1,14.2,1.5,.04,2.1,3.6],[-10.5,6.3,9.6,5.5,1.7,.04]],finish:[10.8,12.8,6.9],shutters:[[15.8,15.5,-5.8,3,1.3,.055]]},
  228:{name:'Summit Needle Works',note:'High above the street, three compact crown floors step inward around a rear lift core. A short scaffold balcony and one blue wind shield preserve the narrow summit silhouette.',
    floors:[ [[-11.7,-2.6,-8.2,8.2],[2.6,11.7,-8.2,8.2],[-2.6,2.6,-8.2,-6.1]], [[-11.7,-2.6,-7,7],[2.6,11.7,-6.3,8.2]], [[-10.3,-2.6,-4.7,5.5],[2.6,10.3,-5.5,4.7]] ],
    core:[-6.4,-6.7,1.7,1.1,10.7],planks:[[0,8.67,6.8,3.1,.55],[10.65,8.67,-1,1.05,3]],tarps:[[11.5,6.4,4.3,.04,2.1,2.8]],finish:[7.6,8.6,4.1],shutters:[[-8.3,11.4,5.2,2.1,1.1,.05]]},
  425:{name:'Hudson Loading Hall',note:'A low industrial shell with a full-depth loading aisle, a west concrete stair box, east mezzanines and a cantilevered timber loading platform.',
    floors:[ [[-14,-3,-9.7,9.7],[3,14,-9.7,9.7],[-3,3,6.8,9.7]], [[-14,-3,-9.7,9.7],[3,14,-9.7,4.2]], [[-14,-3,-5.7,9.7],[3,14,-9.7,7.5]], [[-12,-3,-5.5,5.5],[3,14,-6,6]] ],
    core:[-10.3,-7.6,2.7,1.7,12.8],planks:[[0,8.67,7,3.6,.78],[11.4,12.87,7.7,2.5,1.35]],tarps:[[-13.9,6.8,3.7,.04,2.6,4.8],[9.5,2.1,9.6,3.1,1.8,.04]],finish:[8.2,12.8,5.7],shutters:[[13.8,15.5,.2,.065,1.3,5.5]]},
  472:{name:'Vestry Assembly Yard',note:'Two large open factory storeys with a central assembly court and a separate rear concrete utility core. The east wing has a temporary timber catwalk instead of a completed front slab.',
    floors:[ [[-19.2,-5.5,-12,12],[5.5,19.2,-12,12],[-5.5,5.5,-12,-7.8]], [[-19.2,-2.7,-12,5.5],[2.7,19.2,-7.5,12],[-2.7,2.7,-12,-8.5]] ],
    core:[-15.4,-8.9,2.3,2.2,7.9],planks:[[0,4.47,8.8,6,.68],[11.3,8.67,-9,6.1,.7]],tarps:[[-19.1,6.1,0,.04,1.8,5.2],[10.8,6.5,11.9,6.2,1.8,.04]],finish:[12.5,4.4,6.2],shutters:[[-10.5,7.3,5.4,4.2,1.1,.05]]},
  242:{name:'Mercer Long Gallery',note:'An elongated narrow warehouse with two long galleries, alternating north and south timber transfer bridges, and a compact core at the far end.',
    floors:[ [[-8.7,-2.6,-15.7,15.7],[2.6,8.7,-15.7,15.7],[-2.6,2.6,-15.7,-11.4]], [[-8.7,-2.6,-12,15.7],[2.6,8.7,-15.7,11.4]], [[-8.7,-2.6,-8.2,9.2],[2.6,8.7,-10.5,8.2]] ],
    core:[-5.8,-13.2,1.85,1.9,11.1],planks:[[0,4.47,12.5,3.2,.63],[0,8.67,-12,3.2,.63]],tarps:[[8.62,6.7,-3.2,.04,2.6,6.2]],finish:[5.7,8.6,8.8],shutters:[[-8.6,11.4,2.1,.05,1.1,4.6]]},
  124:{name:'Battery Formwork Court',note:'A wide three-storey courtyard project: four corner work zones, exposed concrete core walls, a timber falsework bay and a pair of unequal crossing plank paths.',
    floors:[ [[-19.2,-5,-18.7,18.7],[5,19.2,-18.7,18.7],[-5,5,-18.7,-11.2],[-5,5,12,18.7]], [[-19.2,-3,-18.7,9],[3,19.2,-9,18.7],[-3,3,-18.7,-12]], [[-17,-3,-9,9],[3,19.2,-12,10]] ],
    core:[-14,-14,3.1,3.1,11.7],planks:[[0,4.47,13,5.6,.75],[0,8.67,-12.8,3.6,.65],[13.5,12.87,12,4.7,1.1]],tarps:[[-19.1,6.8,3,.04,2.6,5.3],[13,7.2,18.6,5.8,2.1,.04]],finish:[13,8.6,13.2],shutters:[[18.9,10.8,2.5,.07,1.65,6.1]]},
  118:{name:'Pearl Pocket Core',note:'A compact four-storey pocket building with a prominent rear service core, alternating landing shelves, projecting timber edge shutters and a narrow top work deck.',
    floors:[ [[-8.7,-2.6,-8.2,8.2],[2.6,8.7,-8.2,8.2]], [[-8.7,-2.6,-8.2,6],[2.6,8.7,-6,8.2],[-2.6,2.6,6.2,8.2]], [[-8.7,-2.6,-5.4,8.2],[2.6,8.7,-8.2,5.4]], [[-8.7,-2.6,-4.4,5],[2.6,8.7,-5,4.4]] ],
    core:[-5.5,-6.6,2.1,1.25,15.5],planks:[[0,8.67,6.9,3.1,.53],[0,12.87,-6.4,3.1,.53]],tarps:[[8.6,10.8,3.5,.04,2.4,3.2]],finish:[5.8,8.6,4.5],shutters:[[8.55,15.1,-.2,.055,1.55,4.3]]}
};
function author(site){
 const D=designs[site.roofBid];if(!D)throw Error('Missing individual plan '+site.roofBid);
 const parts=[],solids=[],decks=[],hx=site.hx,hz=site.hz,stories=site.stories,top=stories*4.2;
 function box(mat,x,y,z,xx,yy,zz,solid=true,kind='beam'){parts.push({shape:'box',mat,x,y,z,hx:xx,hy:yy,hz:zz,bevel:mat==='concrete'?.035:mat==='timber'?.018:.012});if(solid)solids.push({x,y,z,hx:xx,hy:yy,hz:zz,kind,mat});}
 function beam(mat,a,b,r=.06,solid=false){parts.push({shape:'beam',mat,a,b,r});if(solid){const length=Math.hypot(...a.map((v,i)=>b[i]-v)),n=Math.ceil(length/.7);for(let k=0;k<n;k++){const lo=a.map((v,i)=>v+(b[i]-v)*k/n),hi=a.map((v,i)=>v+(b[i]-v)*(k+1)/n);solids.push({x:(lo[0]+hi[0])/2,y:(lo[1]+hi[1])/2,z:(lo[2]+hi[2])/2,hx:Math.abs(hi[0]-lo[0])/2+r,hy:Math.abs(hi[1]-lo[1])/2+r,hz:Math.abs(hi[2]-lo[2])/2+r,kind:'brace',mat});}}}
 function slab(rect,y,l){const [a,b,c,d]=rect,x=(a+b)/2,z=(c+d)/2,xx=(b-a)/2,zz=(d-c)/2;box('concrete',x,y,z,xx,.2,zz,true,'platform');decks.push({x,y,z,hx:xx,hz:zz,l});for(const X of [a+.35,b-.35])for(const Z of [c+.35,d-.35])box('concrete',X,y-2.1,Z,.24,1.9,.24,true,'column');box('timber',x,y-.03,c,xx,.28,.045,false);}
 box('concrete',0,-.2,0,hx,.2,hz,true,'platform');
 if(D.floors.length!==stories)throw Error('Story mismatch '+site.roofBid);
 D.floors.forEach((floor,l)=>floor.forEach(rect=>slab(rect,(l+1)*4.2,l)));
 // The exposed core has three separate walls and a real doorway on its front face.
 const [cx,cz,chx,chz,height]=D.core;
 box('concrete',cx,height/2,cz-chz,chx,height/2,.19,true,'core');
 for(const sign of [-1,1])box('concrete',cx+sign*chx,height/2,cz,.19,height/2,chz,true,'core');
 for(const sign of [-1,1])box('timber',cx+sign*(chx+.08),height/2,cz,.045,height/2,chz+.05,false);
 for(let y=.8;y<height;y+=1.25)for(const z of [cz-chz+.3,cz+chz-.3])beam('steel',[cx-chx-.12,y,z],[cx+chx+.12,y,z],.018);
 // Individual plank crossings use several boards, separated by visible joints.
 for(const [x,y,z,xx,zz]of D.planks){const n=Math.max(3,Math.ceil(zz*2/.22));for(let j=0;j<n;j++)box('timber',x,y,z-zz+(j+.5)*zz*2/n,xx,.065,zz/n-.009,true,'platform');for(const X of [x-xx+.2,x+xx-.2]){beam('steel',[X,y,z-zz],[X,y+1,z-zz],.035);beam('steel',[X,y,z+zz],[X,y+1,z+zz],.035);}}
 for(const [x,y,z,xx,yy,zz]of D.tarps)box('tarp',x,y,z,xx,yy,zz,false);
 for(const [x,y,z,xx,yy,zz]of D.shutters){box('timber',x,y,z,xx,yy,zz,false);for(let j=0;j<5;j++)box('rust',x+(xx>.2?(j-2)*xx*.42:0),y,z+(zz>.2?(j-2)*zz*.42:0),xx>.2?.035:.1,yy+.16,zz>.2?.035:.1,false);}
 // Rebar starters stand only at the outer perimeter, outside the open spine.
 for(const X of [-hx+.8,hx-.8])for(const Z of [-hz+.8,hz-.8])for(const dx of [-.11,.11])for(const dz of [-.11,.11])beam('rust',[X+dx,top+.2,Z+dz],[X+dx,top+1.5,Z+dz],.021);
 // Outer access scaffold is a narrow boardwalk with sparse posts, not a cage.
 for(const X of [-hx-.15,hx+.15]){box('timber',X,4.48,0,.45,.06,hz-.9,true,'platform');for(const Z of [-hz+.8,0,hz-.8]){beam('steel',[X,.1,Z],[X,5.55,Z],.055,true);}beam('steel',[X,5.5,-hz+.8],[X,5.5,hz-.8],.035);}
 // Formwork bundles occupy one explicitly chosen rear-side work bay.
 for(let j=0;j<5;j++)box('timber',cx,4.6+j*.11,Math.min(hz-1.4,cz+chz+2),Math.min(chx-.2,1.6),.045,.58,true,'cargo');
 // Reusable lifting equipment: supported top deck pads, real hollow pipe and open tank legs.
 const wing=2.5+(hx-2.5)/2,tower=[-wing,top+.2,0],pipe=[wing,top+3.4,0],pipeSolids=[],legs=[],inner=1.9,radius=2.12,half=3.5;
 for(const x of [-wing,wing]){box('concrete',x,top,0,3.05,.2,3.4,true,'platform');decks.push({x,y:top,z:0,hx:3.05,hz:3.4,l:stories-1});for(const dx of [-2.7,2.7])for(const z of [-3,3])box('concrete',x+dx,top/2,z,.22,top/2,.22,true,'column');}
 for(const x of [-2.4,2.4])for(const z of [-2.4,2.4]){legs.push(solids.length);box('steel',tower[0]+x,top+2.1,z,.13,1.9,.13,true,'column');}
 for(const x of [-2.4,2.4]){beam('steel',[tower[0]+x,top+.45,-2.4],[tower[0]+x,top+3.8,2.4],.065,true);beam('steel',[tower[0]+x,top+.45,2.4],[tower[0]+x,top+3.8,-2.4],.065,true);}
 box('steel',tower[0],top+4.1,0,2.8,.15,2.8,true,'platform');parts.push({shape:'tank',mat:'wood',x:tower[0],y:top+6.3,z:0,radius:2.6,height:4.1});solids.push({x:tower[0],y:top+6.3,z:0,hx:2.45,hy:2.05,hz:2.45,kind:'tank',mat:'wood'});
 for(const y of [4.6,5.7,7.2,8.2])parts.push({shape:'hoop',mat:'steel',x:tower[0],y:top+y,z:0,radius:2.63,r:.045});parts.push({shape:'cap',mat:'steel',x:tower[0],y:top+8.65,z:0,radius:2.8,height:.65});
 parts.push({shape:'pipe',mat:'concrete',x:pipe[0],y:pipe[1],z:0,inner,radius,half});
 for(let i=0;i<20;i++){const a=(i-.5)*Math.PI/10,b=(i+.5)*Math.PI/10,pts=[];for(const r of [inner,radius])for(const q of [a,(a+b)/2,b])pts.push([Math.cos(q)*r,Math.sin(q)*r]);const xs=pts.map(v=>v[0]),ys=pts.map(v=>v[1]),lx=Math.min(...xs),ux=Math.max(...xs),ly=Math.min(...ys),uy=Math.max(...ys);pipeSolids.push(solids.length);solids.push({x:pipe[0]+(lx+ux)/2,y:pipe[1]+(ly+uy)/2,z:0,hx:(ux-lx)/2,hy:(uy-ly)/2,hz:half,kind:'pipe',mat:'concrete'});}
 for(const z of [-2.6,2.6]){parts.push({shape:'ring',mat:'steel',x:pipe[0],y:pipe[1],z,radius:2.16,r:.05});for(const sign of [-1,1]){box('orange',pipe[0]+sign*2.7,top+3.5,z,.12,3.3,.12,true,'column');beam('steel',[pipe[0]+sign*1.7,pipe[1]+1.2,z],[pipe[0],top+6.8,z],.035);}box('orange',pipe[0],top+6.9,z,2.85,.14,.14,true,'beam');}
 return {index:site.variant,id:site.id,bid:site.roofBid,name:D.name,designNotes:D.note,model:{parts,solids,decks,stories,top,hx,hz,variant:site.variant,pipe,pipeSolids,pipeHalf:half,pipeInner:inner,tower,legs,finish:D.finish,authored:true}};
}
const output=manifest.sites.slice(10,20).map(author);
const target=path.resolve(__dirname,'../evidence/construction/blueprints_10_19.json');
if(require.main===module){fs.writeFileSync(target,JSON.stringify({version:1,authoring:'Ten explicit site plans; local Y-up coordinates; Blender applies site transform.',sites:output}));console.log(output.map(s=>({index:s.index,bid:s.bid,name:s.name,parts:s.model.parts.length,solids:s.model.solids.length})));}
module.exports={author,output};
