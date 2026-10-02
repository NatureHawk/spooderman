'use strict';
const {launch,start,setScene}=require('./graphics_bench/lib');const fs=require('fs'),assert=require('assert');
(async()=>{const {browser,page}=await launch({headless:true,w:1400,h:900});try{
 await start(page,process.env.PROP_BASE?'evidence/BASELINE.html':'THREADLINE.html','medium');await setScene(page,'street');
 fs.mkdirSync('evidence/props',{recursive:true});
 const report=await page.evaluate(()=>{
  const g=TL.game,people=TL.Assets.people||[{name:'PED_m'},{name:'PED_f'},{name:'PED_h'}];
  window.gallery=new THREE.Scene();gallery.background=new THREE.Color(0x8b969d);gallery.add(new THREE.HemisphereLight(0xffffff,0x596574,2));const light=new THREE.DirectionalLight(0xffeedb,2);light.position.set(3,5,5);gallery.add(light);
  const ground=new THREE.Mesh(new THREE.PlaneGeometry(40,40),new THREE.MeshStandardMaterial({color:0x777d82,roughness:1}));ground.rotation.x=-Math.PI/2;gallery.add(ground);
  window.samples=people.map((p,i)=>{const sk=TL.Assets.skinned(p.name,'mid',TL.Assets.material({slots:{6:0xcba58d,7:0x4a5b70,2:0x363d46}}));gallery.add(sk.mesh);const anim=new TL.NPCAnimator(sk);const pos=new THREE.Vector3(i*1.5,0,0);for(let j=0;j<30;j++)anim.update(1/60,pos,0,1.2,'walk');return {sk,anim,pos,name:p.name};});
  return samples.map(s=>({name:s.name,triangles:s.sk.mesh.geometry.index.count/3,materials:Array.isArray(s.sk.mesh.material)?s.sk.mesh.material.length:1,bones:s.sk.list.length}));
 });console.log(JSON.stringify(report));
 for(let i=0;i<report.length;i+=2){await page.evaluate(i=>{const g=TL.game;g.camera.position.set(i*1.5+.65,1.15,3.2);g.camera.lookAt(i*1.5+.65,.9,0);g.camera.updateMatrixWorld();g.renderer.setRenderTarget(null);g.renderer.render(gallery,g.camera);},i);await page.screenshot({path:'evidence/props/'+(process.env.PROP_BASE?'before':'after')+'_people_'+i+'.png'});}
 assert.deepEqual(page.errors,[]);fs.writeFileSync('evidence/props/people_runtime.json',JSON.stringify(report,null,2));
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
