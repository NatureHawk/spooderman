'use strict';
const {launch}=require('./graphics_bench/lib'),fs=require('fs'),path=require('path');
(async()=>{const {browser,page}=await launch({headless:true,w:1280,h:700}),out=path.join(__dirname,'../evidence/construction/facade_audit');fs.mkdirSync(out,{recursive:true});try{
 await page.goto('data:text/html,<script src="https://cdn.jsdelivr.net/npm/three@0.149.0/build/three.min.js"></script>');await page.waitForFunction(()=>THREE?.Scene);
 await page.evaluate(()=>{const scene=new THREE.Scene();scene.background=new THREE.Color('#202b35');scene.add(new THREE.HemisphereLight(0xddeeff,0x777069,.9));const light=new THREE.DirectionalLight(0xffffff,1.2);light.position.set(4,8,6);scene.add(light);const renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});renderer.setSize(320,300);renderer.outputEncoding=THREE.sRGBEncoding;renderer.toneMapping=THREE.ACESFilmicToneMapping;window.FACADE={scene,renderer,source:new THREE.MeshStandardMaterial({color:0x9fa8ae,roughness:.9,side:THREE.DoubleSide}),repair:new THREE.MeshStandardMaterial({color:0xd99d59,roughness:.85,side:THREE.FrontSide}),objects:[],sheets:[]};});
 const rows=JSON.parse(fs.readFileSync(path.join(__dirname,'../evidence/construction/facade_preview.json'),'utf8'));
 for(let index=0;index<rows.length;index++){
  const result=await page.evaluate(({row,index})=>{const F=FACADE;for(const m of F.objects){F.scene.remove(m);m.geometry.dispose();}F.objects=[];
   function mesh(P,material){const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(P,3));g.computeVertexNormals();const m=new THREE.Mesh(g,material);F.scene.add(m);F.objects.push(m);return m;}
   const original=mesh(row.original,F.source),repair=mesh(row.repairs,F.repair),bounds=new THREE.Box3().setFromObject(original),center=bounds.getCenter(new THREE.Vector3()),size=bounds.getSize(new THREE.Vector3()),radius=size.length()*.5,extent=radius*1.12;
   const camera=new THREE.OrthographicCamera(-extent*320/300,extent*320/300,extent,-extent,.1,10000),canvas=document.createElement('canvas');canvas.width=1280;canvas.height=640;const cx=canvas.getContext('2d');cx.fillStyle='#202b35';cx.fillRect(0,0,1280,640);cx.fillStyle='white';cx.font='17px sans-serif';cx.fillText('BID '+row.bid+' | '+(row.construction?'retained lower construction shell':'finished tank support')+' | missing '+row.area.toFixed(1)+' m² | top: original; bottom: repaired (amber)',12,19);
   for(let pass=0;pass<2;pass++)for(let side=0;side<4;side++){
    const a=Math.PI*.25+side*Math.PI*.5;camera.position.copy(center).add(new THREE.Vector3(Math.cos(a),.3,Math.sin(a)).normalize().multiplyScalar(radius*3+10));camera.lookAt(center);camera.updateMatrixWorld();repair.visible=!!pass;F.renderer.render(F.scene,camera);cx.drawImage(F.renderer.domElement,side*320,25+pass*305);cx.fillStyle='white';cx.font='12px sans-serif';cx.fillText((pass?'repaired ':'original ')+Math.round(a*180/Math.PI)+'°',side*320+8,pass*305+42);
   }
   const batch=Math.floor(index/10),slot=index%10;if(!F.sheets[batch]){const c=document.createElement('canvas');c.width=1280;c.height=1600;F.sheets[batch]=c;}F.sheets[batch].getContext('2d').drawImage(canvas,(slot%2)*640,Math.floor(slot/2)*320,640,320);
   return{image:canvas.toDataURL('image/png'),stats:{bid:row.bid,missingArea:row.area,views:8,triangles:(row.original.length+row.repairs.length)/9}};
  },{row:rows[index],index});
  fs.writeFileSync(path.join(out,'bid_'+rows[index].bid+'.png'),Buffer.from(result.image.split(',')[1],'base64'));console.log('Captured',result.stats.bid,'eight sides before/after');
 }
 const sheets=await page.evaluate(()=>FACADE.sheets.map(c=>c.toDataURL('image/png')));for(let i=0;i<sheets.length;i++)fs.writeFileSync(path.join(out,'all_sides_'+(i+1)+'.png'),Buffer.from(sheets[i].split(',')[1],'base64'));
 if(page.errors.length)throw Error(JSON.stringify(page.errors));console.log('PASS rendered40 original/repaired shells across320 actual geometry views');
 }finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});

