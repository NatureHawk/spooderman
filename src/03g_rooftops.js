/* Manhattan roof restoration. Uses the actual roof triangles, including setbacks and
   courtyards; never covers a footprint with a guessed rectangular slab. Roofs have
   their own physical materials rather than the photographed facade atlas.
   Material/roof-kit references: NYC CoolRoofs and NYC DOB mechanical roof equipment:
   https://nyc-business.nyc.gov/nycbusiness/business-services/incentives/nyc-coolroofs
   https://www.nyc.gov/site/buildings/industry/project-requirements-design-professional-mechanical.page */
'use strict';
TL.Rooftops = {
  procedural(world,ch) {
    // The generated city uses authored boxes instead of scan triangles. Feed the
    // same site descriptions and kits from those actual exposed mass tops.
    const R=world.roofState||(world.roofState={analyses:[],placements:[],colliders:[],revision:0});
    const faces=[];
    for(const m of ch.data.masses){if(m.kind!=='building')continue;const x=m.x-m.w/2,z=m.z-m.d/2,X=m.x+m.w/2,Z=m.z+m.d/2,y=m.y0+m.h;
      faces.push({p:[x,y,z,X,y,z,X,y,Z]},{p:[x,y,z,X,y,Z,x,y,Z]});}
    const A={b:{id:ch.key},faces};R.analyses.push(A);
    for(const p of ch.data.props)if(p.y>8&&/hvac|roof_hut|vent_stack|antenna|billboard/.test(p.a))R.placements.push({type:p.a==='P_hvac'?'hvac':'existing',bid:ch.key,x:p.x,y:p.y,z:p.z,hx:2,hz:2,yaw:p.yaw||0});
    R.colliders.push(...(ch.cols||[]));R.revision++;
    if(this.hash(ch.i*711+ch.j*317)>.24)return;
    const m=ch.data.masses.find(m=>m.kind==='building'&&m.w>16&&m.d>16&&m.h>15);if(!m)return;
    const type=this.hash(ch.i*97+ch.j)<.5?'service':'roofcap',hx=type==='service'?2.6:.7,hz=type==='service'?2.2:.7,y=m.y0+m.h;
    for(const sg of [-1,1]){
      const x=m.x+sg*(m.w/2-hx-2),z=m.z+m.d/2-hz-2;
      if(!this.fits(A,x,z,y,hx,hz,0,1)||ch.data.props.some(p=>Math.abs(p.y-y)<2&&Math.hypot(p.x-x,p.z-z)<5))continue;
      const kits=world.activityKits||(world.activityKits=this.kits());world.activityBatches=world.activityBatches||{};
      const batches=world.activityBatches[type]||(world.activityBatches[type]=kits[type].map(p=>new TL.InstanceBatch(world.scene,p.geometry,p.material,256,{})));
      const matrix=new THREE.Matrix4().makeTranslation(x,y,z);for(const batch of batches){const owner={idx:-1,batch:null};batch.alloc(owner,matrix);ch.props.push(owner);}
      const add=(cx,cy,cz,xx,yy,zz,kind)=>{const c=world.world.addStatic(cx,cy,cz,xx,yy,zz,0,{kind:'prop',chunk:ch.key,perch:true,supportType:kind});ch.cols.push(c);R.colliders.push(c);};
      if(type==='roofcap')add(x,y+.65,z,.65,.65,.65,'cap');
      else {add(x,y+1.4,z,2.4,.09,1.3,'platform');add(x,y+2.55,z-1.15,2.35,.06,.16,'rail');for(const u of [-2.15,2.15])for(const v of [-1.05,1.05])add(x+u,y+.7,z+v,.07,.7,.07,'pole');}
      R.placements.push({type,bid:ch.key,x,y,z,hx,hz,yaw:0});break;
    }
  },
  unloadProcedural(world,ch){const R=world.roofState;if(!R)return;R.analyses=R.analyses.filter(a=>a.b.id!==ch.key);R.placements=R.placements.filter(p=>p.bid!==ch.key);R.colliders=R.colliders.filter(c=>c.chunk!==ch.key);R.revision++;},
  hash(n) { let x=Math.imul(n|0,1597334677);x=Math.imul(x^(x>>>16),2246822507);return ((x^(x>>>13))>>>0)/4294967296; },
  analyze(b, P) {
    const faces=[], levels=new Map(); let longest=0,yaw=0;
    for(let k=0;k<b.n;k++) {
      const p=Array.from(P.subarray(k*9,k*9+9)),a=new THREE.Vector3(p[3]-p[0],p[4]-p[1],p[5]-p[2]),c=new THREE.Vector3(p[6]-p[0],p[7]-p[1],p[8]-p[2]);
      const n=a.cross(c),area=n.length()*.5,ny=Math.abs(n.y)/Math.max(area*2,1e-8),y=(p[1]+p[4]+p[7])/3;
      if(area<.01||y<3||ny<.35)continue;
      const flat=ny>.998 && Math.max(p[1],p[4],p[7])-Math.min(p[1],p[4],p[7])<.12;
      if(!flat && y<b.h*.65)continue;
      const f={k,p,area,y,flat,kind:flat?1:2};faces.push(f);
      if(flat) {
        const key=Math.round(y*10);if(!levels.has(key))levels.set(key,{y,area:0,faces:[],minX:Infinity,maxX:-Infinity,minZ:Infinity,maxZ:-Infinity});
        const L=levels.get(key);L.area+=area;L.faces.push(f);
        for(let i=0;i<3;i++){const j=(i+1)%3,dx=p[j*3]-p[i*3],dz=p[j*3+2]-p[i*3+2],len=dx*dx+dz*dz;
          L.minX=Math.min(L.minX,p[i*3]);L.maxX=Math.max(L.maxX,p[i*3]);L.minZ=Math.min(L.minZ,p[i*3+2]);L.maxZ=Math.max(L.maxZ,p[i*3+2]);
          if(len>longest){longest=len;yaw=-Math.atan2(dz,dx);}
        }
      }
    }
    const sorted=[...levels.values()].sort((a,c)=>c.area-a.area),bulk=[];
    // Small, low structures sitting on a roof are utility housings, not another facade.
    for(const cap of sorted) {
      if(cap.area>100||cap.area<3)continue;
      const base=sorted.find(l=>l.area>cap.area*2&&cap.y-l.y>.8&&cap.y-l.y<5.5);
      if(!base)continue;
      for(let k=0;k<b.n;k++) {
        if(faces.some(f=>f.k===k))continue;
        const p=P.subarray(k*9,k*9+9);
        if([0,3,6].every(i=>p[i+1]>=base.y-.12&&p[i+1]<=cap.y+.12&&p[i]>=cap.minX-.12&&p[i]<=cap.maxX+.12&&p[i+2]>=cap.minZ-.12&&p[i+2]<=cap.maxZ+.12))bulk.push(k);
      }
    }
    return {b,faces,levels:sorted,yaw,bulk};
  },
  topAt(A,x,z) {
    let top=-Infinity;
    for(const f of A.faces) {
      const p=f.p,ax=p[0],az=p[2],bx=p[3],bz=p[5],cx=p[6],cz=p[8];
      const d=(bz-cz)*(ax-cx)+(cx-bx)*(az-cz);if(Math.abs(d)<1e-7)continue;
      const u=((bz-cz)*(x-cx)+(cx-bx)*(z-cz))/d,v=((cz-az)*(x-cx)+(ax-cx)*(z-cz))/d;
      if(u>=-1e-5&&v>=-1e-5&&u+v<=1.00001)top=Math.max(top,u*p[1]+v*p[4]+(1-u-v)*p[7]);
    }
    return top;
  },
  fits(A,x,z,y,hx,hz,yaw,margin=.6) {
    const c=Math.cos(yaw),s=Math.sin(yaw);
    // Corners, edge midpoints and centre all need the same exposed roof under them.
    for(const u of [-hx-margin,0,hx+margin])for(const v of [-hz-margin,0,hz+margin])
      if(Math.abs(this.topAt(A,x+u*c+v*s,z-u*s+v*c)-y)>.13)return false;
    return true;
  },
  mergeEdges(edges) {
    // The scan subdivides straight roof edges into many triangle fragments. One
    // continuous parapet needs one collider, not a collider for every fragment.
    const lines=new Map();
    for(const e of edges){
      let dx=e.b[0]-e.a[0],dz=e.b[2]-e.a[2],len=Math.hypot(dx,dz);if(len<.05)continue;
      dx/=len;dz/=len;if(dx<-.0001||(Math.abs(dx)<.0001&&dz<0)){dx=-dx;dz=-dz;}
      const off=-dz*e.a[0]+dx*e.a[2],angle=Math.atan2(dz,dx),key=Math.round(angle*1000)+','+Math.round(off*10);
      let L=lines.get(key);if(!L){L={dx,dz,off,y:e.a[1],spans:[]};lines.set(key,L);}
      const a=L.dx*e.a[0]+L.dz*e.a[2],b=L.dx*e.b[0]+L.dz*e.b[2];L.spans.push([Math.min(a,b),Math.max(a,b)]);
    }
    const result=[];for(const L of lines.values()){
      L.spans.sort((a,b)=>a[0]-b[0]);const merged=[];
      for(const span of L.spans){const p=merged[merged.length-1];if(p&&span[0]<=p[1]+.055)p[1]=Math.max(p[1],span[1]);else merged.push(span.slice());}
      for(const [a,b]of merged)result.push({a:[a*L.dx-L.off*L.dz,L.y,a*L.dz+L.off*L.dx],b:[b*L.dx-L.off*L.dz,L.y,b*L.dz+L.off*L.dx]});
    }return result;
  },
  material(world) {
    const m=new THREE.MeshStandardMaterial({color:0xffffff,roughness:.88,metalness:.04,side:THREE.DoubleSide});
    m.onBeforeCompile=sh=>{
      sh.uniforms.uRoofWet=world.mats.uniforms.uWet;
      sh.vertexShader=sh.vertexShader.replace('#include <common>','#include <common>\nattribute vec4 aRoof;\nflat varying vec4 vRoof;\nvarying vec3 vRoofP;')
        .replace('#include <begin_vertex>','#include <begin_vertex>\nvRoof=aRoof;vRoofP=(modelMatrix*vec4(position,1.0)).xyz;');
      sh.fragmentShader=sh.fragmentShader.replace('#include <common>',`#include <common>
        flat varying vec4 vRoof; varying vec3 vRoofP; uniform float uRoofWet;
        float roofHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
        float roofNoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(roofHash(i),roofHash(i+vec2(1,0)),f.x),mix(roofHash(i+vec2(0,1)),roofHash(i+1.0),f.x),f.y);}
        float roofLine(float x,float period,float width){float d=abs(mod(x+period*.5,period)-period*.5),fw=max(fwidth(x),.0001);return clamp((min(d+fw*.5,width*.5)-max(d-fw*.5,-width*.5))/fw,0.0,1.0);}
        float roofRough;`)
        .replace('#include <color_fragment>',`#include <color_fragment>
          vec2 p=vec2(vRoofP.x*vRoof.x-vRoofP.z*vRoof.y,vRoofP.x*vRoof.y+vRoofP.z*vRoof.x);
          float mottling=roofNoise(p*.48),grain=roofNoise(p*28.0)-.5;
          float fine=1.0-smoothstep(.015,.12,max(fwidth(p.x),fwidth(p.y)));
          vec3 roofColor;
          if(vRoof.w<1.5){
            // Charcoal bitumen, warm gravel and pale membrane, with metre-scale roll seams.
            float light=step(.77,vRoof.z);
            roofColor=mix(vec3(.032,.04,.045),vec3(.075,.085,.09),step(.34,vRoof.z));
            roofColor=mix(roofColor,vec3(.25,.265,.26),light);
            roofColor+=vec3((mottling-.5)*.034+grain*.018*fine);
            float seam=max(roofLine(p.x,1.15,.023),roofLine(p.y+floor(p.x/1.15)*.9,7.0,.025));
            roofColor*=1.0-seam*.27;
            float repairMark=step(.965,roofHash(floor(p/vec2(3.45,7.0))));roofColor*=1.0-repairMark*.12;
            roofRough=mix(.95,.56,uRoofWet);
          }else if(vRoof.w<2.5){
            // Patinated copper/green tile on existing pitched crowns only.
            float seam=roofLine(p.x,.58,.027),lap=roofLine(vRoofP.y,.44,.012);
            roofColor=mix(vec3(.07,.16,.13),vec3(.15,.29,.225),mottling);
            roofColor*=1.0-seam*.35-lap*.14;roofRough=mix(.72,.38,uRoofWet);
          }else{
            // Rooftop utility housings: coated metal panels instead of smeared aerial photos.
            roofColor=vec3(.235,.25,.255)*(0.94+mottling*.12);
            float joint=max(roofLine(p.x+p.y,1.25,.02),roofLine(vRoofP.y,1.4,.015));
            roofColor*=1.0-joint*.25;roofRough=.7;
          }
          diffuseColor.rgb*=roofColor*(1.0-uRoofWet*.15);`)
        .replace('#include <roughnessmap_fragment>','float roughnessFactor=roofRough;');
    };
    m.customProgramCacheKey=()=> 'tl-manhattan-roofs-1';return m;
  },
  tile(world,g,list) {
    if(!world.roofState)world.roofState={analyses:[],meshes:[],placements:[],colliders:[],roofTriangles:0,pitchedTriangles:0,buckets:new Map(),material:this.material(world)};
    const R=world.roofState,P=g.attributes.position.array,roof=[],wall=[],attr=new Float32Array(g.attributes.position.count*4);let offset=0;
    for(const b of list){
      const A=this.analyze(b,P.subarray(offset*9,(offset+b.n)*9)),kinds=new Map(A.faces.map(f=>[f.k,f.kind]));
      for(const k of A.bulk)kinds.set(k,3);R.analyses.push(A);
      for(let k=0;k<b.n;k++) {
        const kind=kinds.get(k)||0,tri=offset+k;(kind?roof:wall).push(tri*3,tri*3+1,tri*3+2);
        if(kind){R.roofTriangles++;if(kind===2)R.pitchedTriangles++;for(let j=0;j<3;j++)attr.set([Math.cos(A.yaw),Math.sin(A.yaw),this.hash(b.id),kind],(tri*3+j)*4);}
      }
      offset+=b.n;
    }
    g.setIndex(wall);if(!roof.length)return;
    const rg=new THREE.BufferGeometry();rg.setAttribute('position',g.attributes.position);rg.setAttribute('normal',g.attributes.normal);rg.setAttribute('aRoof',new THREE.BufferAttribute(attr,4));rg.setIndex(roof);rg.computeBoundingSphere();
    const mesh=new THREE.Mesh(rg,R.material);mesh.name='Manhattan roof surfaces';mesh.castShadow=mesh.receiveShadow=true;mesh.matrixAutoUpdate=false;world.scene.add(mesh);R.meshes.push(mesh);
  },
  // Assemble each kit once, then instance its material parts across the city.
  kits() {
    const mats={steel:new THREE.MeshStandardMaterial({color:0x899396,roughness:.62,metalness:.5}),dark:new THREE.MeshStandardMaterial({color:0x242d30,roughness:.8,metalness:.25}),stone:new THREE.MeshStandardMaterial({color:0x96958e,roughness:.92}),wood:new THREE.MeshStandardMaterial({color:0x78563c,roughness:.92}),cap:new THREE.MeshStandardMaterial({color:0x596b63,roughness:.64,metalness:.35})};
    for(const [name,m]of Object.entries(mats)){
      m.onBeforeCompile=sh=>{sh.vertexShader=sh.vertexShader.replace('#include <common>','#include <common>\nvarying vec2 kitUv;').replace('#include <begin_vertex>','#include <begin_vertex>\nkitUv=uv;');
        sh.fragmentShader=sh.fragmentShader.replace('#include <common>','#include <common>\nvarying vec2 kitUv;').replace('#include <color_fragment>',`#include <color_fragment>
          float grain=fract(sin(dot(floor(kitUv*vec2(300.0,180.0)),vec2(12.9898,78.233)))*43758.5453);
          float fade=1.0-smoothstep(.001,.018,max(fwidth(kitUv.x),fwidth(kitUv.y)));
          diffuseColor.rgb*=.98+(grain-.5)*.065*fade;
          ${name==='steel'?'float streak=fract(sin(floor(kitUv.x*41.0)*63.71)*317.3);float dirt=smoothstep(.68,.95,streak)*(1.0-smoothstep(.0,.55,kitUv.y));float rim=min(min(kitUv.x,1.0-kitUv.x),min(kitUv.y,1.0-kitUv.y));diffuseColor.rgb*=1.0-dirt*.1-(1.0-smoothstep(.0,.035,rim))*.065;':''}
          ${name==='wood'?'float board=floor(kitUv.x*32.0);float stave=abs(fract(kitUv.x*32.0)-.5);diffuseColor.rgb*=.84+.25*fract(sin(board*127.1)*43758.5453);diffuseColor.rgb*=1.0-.3*smoothstep(.45,.5,stave);':''}`);};m.customProgramCacheKey=()=> 'roof-kit-'+name;
    }
    const kits={};
    const make=(name,fn)=>{
      const parts={};
      const add=(mat,geo,x=0,y=0,z=0,rx=0,ry=0,rz=0)=>{geo.rotateX(rx);geo.rotateY(ry);geo.rotateZ(rz);geo.translate(x,y,z);(parts[mat]||(parts[mat]=[])).push(geo);};
      const box=(m,w,h,d,x=0,y=0,z=0,ry=0)=>add(m,new THREE.BoxGeometry(w,h,d),x,y,z,0,ry);
      const cyl=(m,r,h,x,y,z,rt=r)=>add(m,new THREE.CylinderGeometry(rt,r,h,16),x,y,z);
      const ring=(m,r,t,x,y,z)=>add(m,new THREE.TorusGeometry(r,t,5,20),x,y,z,Math.PI/2);
      fn({add,box,cyl,ring});
      kits[name]=Object.entries(parts).map(([mat,gs])=>{
        const data={position:[],normal:[],uv:[]};for(const raw of gs){const g=raw.index?raw.toNonIndexed():raw;for(const k of Object.keys(data))data[k].push(...g.attributes[k].array);if(g!==raw)g.dispose();raw.dispose();}
        const g=new THREE.BufferGeometry();for(const[k,a]of Object.entries(data))g.setAttribute(k,new THREE.Float32BufferAttribute(a,k==='uv'?2:3));g.computeBoundingSphere();return {geometry:g,material:mats[mat]};
      });
    };
    make('hvac',({box,cyl,ring})=>{
      box('dark',3.7,.2,2.45,0,.1,0);box('steel',3.35,1.13,2.1,0,.765,0);box('steel',3.48,.1,2.22,0,1.38,0);
      for(const x of [-.85,.85]){
        cyl('dark',.43,.035,x,1.445,0);ring('steel',.45,.028,x,1.46,0);cyl('steel',.09,.035,x,1.475,0);
        for(let j=0;j<6;j++){const a=j*Math.PI/3;box('steel',.33,.018,.065,x+Math.cos(a)*.18,1.47,Math.sin(a)*.18,-a);}
        for(let j=-4;j<=4;j++){const z=j*.09;box('dark',2*Math.sqrt(.43*.43-z*z),.02,.018,x,1.5,z);}
      }
      for(const z of [-1.065,1.065]){box('dark',2.75,.74,.018,0,.83,z);for(let j=0;j<10;j++)box('steel',2.78,.024,.05,0,.51+j*.069,z);}
      box('dark',.018,.7,1.3,1.683,.83,0);for(let j=0;j<8;j++)box('steel',.045,.027,1.34,1.695,.54+j*.08,0);
      box('steel',.75,.48,.65,-1.0,.45,1.4);box('dark',.65,.025,.04,-1.0,.7,1.4);
      for(const x of [-1.58,1.58])for(const z of [-.98,.98])cyl('dark',.035,.015,x,1.44,z);
    });
    make('vent',({box,cyl})=>{box('dark',.9,.18,.9,0,.09,0);cyl('steel',.22,1.05,0,.7,0);cyl('dark',.23,.08,0,1.19,0);cyl('steel',.39,.22,0,1.38,0,.28);});
    make('hatch',({box})=>{box('dark',1.65,.18,2.05,0,.09,0);box('steel',1.45,.12,1.85,0,.23,0);for(const x of [-.58,.58])box('dark',.035,.035,1.66,x,.305,0);box('dark',.3,.09,.045,.35,.32,.55);});
    make('tank',({box,cyl,ring,add})=>{
      for(const x of [-1.2,1.2])for(const z of [-1.2,1.2])box('dark',.13,2.4,.13,x,1.2,z);
      box('dark',3.1,.18,3.1,0,2.3,0);cyl('wood',1.55,3.05,0,3.88,0);cyl('cap',1.72,.7,0,5.74,0,.07);
      cyl('steel',.42,.10,0,6.12,0); // circular maintenance cap over the cone's apex
      for(const y of [2.45,3.2,4.15,5.3])ring('dark',1.56,.045,0,y,0);
      // Cross-bracing and the side service ladder are part of the silhouette.
      for(const z of [-1.2,1.2])for(const sign of [-1,1])add('dark',new THREE.BoxGeometry(.08,3.05,.08),0,1.22,z,0,0,sign*.8);
      for(const x of [-.26,.26])box('dark',.04,5.7,.045,x,2.9,1.67);
      for(let y=.25;y<5.6;y+=.32)box('steel',.56,.025,.035,0,y,1.68);
    });
    make('tankdeck',({box})=>{box('dark',2.7,.18,.9,0,2.365,2.05);for(const x of [-1.2,1.2])box('dark',.1,2.35,.1,x,1.175,2.35);});
    make('parapet',({box})=>{box('stone',1,.42,.28,0,.21,0);box('steel',1,.065,.38,0,.455,0);});
    make('antenna',({box,cyl,ring,add})=>{
      box('stone',3.0,.28,3.0,0,.14,0);box('stone',2.35,.32,2.35,0,.44,0);
      box('stone',1.65,.4,1.65,0,.8,0);box('steel',1.05,.8,1.05,0,1.4,0);
      box('dark',1.15,.12,1.15,0,1.85,0);
      cyl('steel',.2,3.4,0,3.6,0,.145);cyl('steel',.14,2.3,0,6.4,0,.08);cyl('dark',.065,1.6,0,8.35,0,.025);
      for(const y of [2,3.4,5.25,7.5])ring('dark',y<5?.205:.145,.028,0,y,0);
      for(const y of [3.2,4.4]){box('steel',1.6,.065,.065,0,y,0);for(const x of [-.68,.68])box('steel',.07,.72,.09,x,y+.24,0);}
      for(const x of [-1.05,1.05])for(const z of [-1.05,1.05]){
        const a=new THREE.Vector3(x,.64,z),b=new THREE.Vector3(0,4.8,0),d=b.clone().sub(a),geo=new THREE.CylinderGeometry(.012,.012,d.length(),6);
        geo.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),d.clone().normalize()));
        const mid=a.add(b).multiplyScalar(.5);add('dark',geo,mid.x,mid.y,mid.z);
      }
    });
    make('cornice',({box})=>{box('stone',1,.16,.42,0,-.08,0);box('stone',1,.1,.58,0,.035,0);});
    make('service',({box})=>{
      box('dark',4.8,.18,2.6,0,1.4,0);
      for(const x of [-2.15,2.15])for(const z of [-1.05,1.05])box('steel',.14,1.4,.14,x,.7,z);
      for(const x of [-2.3,2.3]){box('steel',.08,1.1,.08,x,1.99,-1.15);box('steel',.08,1.1,.08,x,1.99,1.15);}
      box('steel',4.7,.12,.32,0,2.55,-1.15);
      for(let k=0;k<4;k++)box('dark',1.1,.12,.35,0,.2+k*.32,1.9-k*.15);
    });
    make('signframe',({box})=>{
      for(const x of [-2.2,2.2]){box('stone',.7,.25,.8,x,.125,0);box('dark',.14,3.5,.14,x,1.85,0);box('dark',.14,2,.14,x,1,1.5);}
      box('dark',5,.18,.6,0,3.6,0);box('steel',4.6,1.45,.14,0,2.6,0);
      // A restrained industrial sign with individual inset bars, no floating text labels.
      for(let k=0;k<7;k++)box('stone',.34,.75,.035,-1.8+k*.6,2.6,-.09);
    });
    make('roofcap',({box})=>{box('stone',1.1,1.15,1.1,0,.575,0);box('steel',1.3,.14,1.3,0,1.22,0);});
    return kits;
  },
  build(world) {
    const R=world.roofState;if(!R)return;const kits=this.kits();R.kits=kits;
    const place=(name,x,y,z,yaw=0,sx=1,sz=1)=>{
      const a=R.buckets.get(name)||[];a.push(new THREE.Matrix4().compose(new THREE.Vector3(x,y,z),new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),yaw),new THREE.Vector3(sx,1,sz)));R.buckets.set(name,a);
    };
    const collider=(x,y,z,hx,hy,hz,yaw,bid)=>{const c=world.world.addStatic(x,y,z,hx,hy,hz,yaw,{kind:'building',src:'rooftop',bid,climb:true,anchor:true,perch:true});R.colliders.push(c);return c;};
    for(const A of R.analyses){
      const b=A.b,used=[];let seed=b.id*101+7,units=0,tank=false;
      const crown=A.levels.find(L=>L.y>=b.h-.18&&L.area>=22&&L.area<=150&&Math.max(L.maxX-L.minX,L.maxZ-L.minZ)<=17);
      if(crown&&b.h>32&&this.hash(b.id+313)<.8){
        const x=(crown.minX+crown.maxX)*.5,z=(crown.minZ+crown.maxZ)*.5,y=crown.y;
        if(this.fits(A,x,z,y,1.5,1.5,A.yaw,1.0)){
          place('antenna',x,y,z,A.yaw);used.push({x,z,y,r:2.25});
          R.placements.push({type:'antenna',bid:b.id,x,y,z,hx:1.5,hz:1.5,yaw:A.yaw});
          for(const [w,cy,h]of [[3,.14,.28],[2.35,.44,.32],[1.65,.8,.4],[1.05,1.4,.8],[.4,3.6,3.4],[.28,6.4,2.3],[.13,8.35,1.6]])collider(x,y+cy,z,w*.5,h*.5,w*.5,A.yaw,b.id);
        }
      }
      for(const L of A.levels){
        if(L.area<14)continue;
        const edges=new Map(),key=(p,i)=>[p[i],p[i+1],p[i+2]].map(v=>Math.round(v*40)).join(',');
        for(const f of L.faces)for(let i=0;i<3;i++){const j=(i+1)%3,a=key(f.p,i*3),c=key(f.p,j*3),k=a<c?a+'|'+c:c+'|'+a;const e=edges.get(k);if(e)e.n++;else edges.set(k,{n:1,a:f.p.slice(i*3,i*3+3),b:f.p.slice(j*3,j*3+3)});}
        const exposed=[];
        for(const e of edges.values()){
          if(e.n!==1)continue;const dx=e.b[0]-e.a[0],dz=e.b[2]-e.a[2],len=Math.hypot(dx,dz);if(len<.1)continue;
          const x=(e.a[0]+e.b[0])*.5,z=(e.a[2]+e.b[2])*.5,nx=-dz/len,nz=dx/len;
          const p=this.topAt(A,x+nx*.24,z+nz*.24),m=this.topAt(A,x-nx*.24,z-nz*.24);
          const plus=Math.abs(p-L.y)<.15,minus=Math.abs(m-L.y)<.15;
          if(plus===minus || (plus?m:p)>L.y-.5)continue; // internal triangulation or edge against a taller bulkhead
          exposed.push(e);
        }
        for(const e of this.mergeEdges(exposed)){
          const dx=e.b[0]-e.a[0],dz=e.b[2]-e.a[2],len=Math.hypot(dx,dz);if(len<1.1)continue;
          const x=(e.a[0]+e.b[0])*.5,z=(e.a[2]+e.b[2])*.5,nx=-dz/len,nz=dx/len;
          const sign=Math.abs(this.topAt(A,x+nx*.24,z+nz*.24)-L.y)<.15?1:-1,cx=x+nx*.13*sign,cz=z+nz*.13*sign,yaw=-Math.atan2(dz,dx);
          place('parapet',cx,L.y,cz,yaw,len);place('cornice',x,L.y,z,yaw,len);
          collider(cx,L.y+.25,cz,len*.5,.25,.19,yaw,b.id);
        }
        if(L.area<65 || units>=3)continue;
        const desired=Math.min(3-units,Math.max(1,Math.floor(L.area/260))),c=Math.cos(A.yaw),s=Math.sin(A.yaw);
        const types=[];
        if(!tank&&b.h>22&&b.h<150&&L.area>240&&this.hash(b.id+17)<.19){types.push('tank');tank=true;}
        for(let j=0;j<desired;j++)types.push('hvac');types.push('vent','hatch');
        if(L.area>350&&this.hash(b.id+431)<.22)types.push(this.hash(b.id+111)<.55?'service':'signframe');
        else if(L.area>120&&this.hash(b.id+743)<.14)types.push('roofcap');
        for(const type of types){
          const hx=['service','signframe'].includes(type)?2.6:type==='hvac'?1.95:type==='tank'?1.85:type==='hatch'?.9:type==='roofcap'?.7:.6,hz=type==='service'?2.2:type==='signframe'?1.8:type==='hvac'?1.9:type==='tank'?2.55:type==='hatch'?1.1:type==='roofcap'?.7:.6;
          for(let attempt=0;attempt<55;attempt++){
            const x=L.minX+this.hash(seed++)*(L.maxX-L.minX),z=L.minZ+this.hash(seed++)*(L.maxZ-L.minZ);
            const dx=x-(L.minX+L.maxX)*.5,dz=z-(L.minZ+L.maxZ)*.5;
            if(Math.abs(dx*c-dz*s)<hx+1.4 || Math.abs(dx*s+dz*c)<hz+1.4)continue; // clear crossing routes
            if(!this.fits(A,x,z,L.y,hx,hz,A.yaw,1.0)||used.some(u=>Math.abs(u.y-L.y)<2&&Math.hypot(x-u.x,z-u.z)<Math.hypot(hx,hz)+u.r+1))continue;
            place(type,x,L.y+.015,z,A.yaw);used.push({x,z,y:L.y,r:Math.hypot(hx,hz)});
            R.placements.push({type,bid:b.id,x,y:L.y,z,hx,hz,yaw:A.yaw});
            if(type==='service'||type==='signframe'){
              const part=(u,v,cy,hx,hy,hz,kind)=>{const col=collider(x+u*c+v*s,L.y+cy+.015,z-u*s+v*c,hx,hy,hz,A.yaw,b.id);col.supportType=kind;return col;};
              if(type==='service'){
                part(0,0,1.4,2.4,.09,1.3,'platform');part(0,-1.15,2.55,2.35,.06,.16,'rail');
                for(const u of [-2.15,2.15])for(const v of [-1.05,1.05])part(u,v,.7,.07,.7,.07,'pole');
                for(let k=0;k<4;k++)part(0,1.9-k*.15,.2+k*.32,.55,.06,.175,'rail');
              }else{
                part(0,0,3.6,2.5,.09,.3,'rail');part(0,0,2.6,2.3,.725,.07,'rail');
                for(const u of [-2.2,2.2]){part(u,0,1.85,.07,1.75,.07,'pole');part(u,1.5,1,.07,1,.07,'pole');}
              }
            }else if(type==='roofcap'){const col=collider(x,L.y+.65,z,.65,.65,.65,A.yaw,b.id);col.supportType='cap';
            }else if(type==='tank'){
              const body=collider(x,L.y+3.89,z,1.55,1.53,1.55,A.yaw,b.id);body.perch=false;
              const cap=collider(x,L.y+6.135,z,.42,.05,.42,A.yaw,b.id);cap.supportType='rounded';cap.supportRadius=.42;
              // Existing ladder-side maintenance deck is extended to usable width.
              place('tankdeck',x,L.y+.015,z,A.yaw);
              const deck=collider(x+2.05*s,L.y+2.38,z+2.05*c,1.35,.09,.45,A.yaw,b.id);deck.supportType='platform';
              for(const u of [-1.2,1.2])for(const v of [-1.2,1.2])collider(x+u*c+v*s,L.y+1.2,z-u*s+v*c,.09,1.2,.09,A.yaw,b.id);
            }else if(type==='hvac'){
              collider(x,L.y+.75,z,1.85,.75,1.23,A.yaw,b.id);
              collider(x-c+1.4*s,L.y+.45,z+s+1.4*c,.375,.24,.325,A.yaw,b.id);
            }else{const h=type==='hatch'?.36:1.52;collider(x,L.y+h*.5,z,hx,h*.5,hz,A.yaw,b.id);}
            if(type==='hvac')units++;break;
          }
        }
      }
    }
    for(const[name,matrices]of R.buckets)for(const part of kits[name]){
      const m=new THREE.InstancedMesh(part.geometry,part.material,matrices.length);matrices.forEach((matrix,i)=>m.setMatrixAt(i,matrix));m.instanceMatrix.needsUpdate=true;m.frustumCulled=false;m.castShadow=m.receiveShadow=true;m.name='Rooftop '+name;world.scene.add(m);R.meshes.push(m);
    }
  },
};
{
  const previous=TL.ScanHooks.nycTile;
  TL.ScanHooks.nycTile=(world,g,list)=>{if(previous)previous(world,g,list);TL.Rooftops.tile(world,g,list);};
  TL.ScanHooks.build.push(world=>TL.Rooftops.build(world));
}
