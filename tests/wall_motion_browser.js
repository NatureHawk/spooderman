'use strict';
// Reuse the actual textured-character preview setup, then render facade traversal.
const fs=require('fs'),path=require('path'),Module=require('module');
const prefix=fs.readFileSync(path.join(__dirname,'motion_browser.js'),'utf8').split('    if(process.env.TL_PREVIEW_FLOW_ONLY){')[0]
  .replace("headless:true,pipe:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']", "headless:'new',timeout:120000,protocolTimeout:180000,args:['--use-angle=d3d11','--enable-gpu','--ignore-gpu-blocklist']")
  .replace("await page.goto(", "page.setDefaultTimeout(120000);await page.goto(");
const cases=`
    const samples=[];
    for(const mode of ['crawl','run','web'])for(const mechanical of [false,true]){
      const result=await page.evaluate(({mode,mechanical})=>{
        probe.reset();const {g,h}=probe;const a=g.hero.anim;
        h.world=new TL.CollisionWorld();h.world.groundFn=()=>0;
        h.wallCol=h.world.addStatic(0,100,1.2,50,50,.5,0,{kind:'building',climb:true});
        h.wallN.set(0,0,-1);h.wallMode=mode==='crawl'?'up':'side';h.pos.set(0,100,.7-TL.C.CAP_R);h.prevPos.copy(h.pos);
        h.swingWall=mode==='web';h.fsm.set(mode==='web'?TL.TS.SWING:mode==='crawl'?TL.TS.CRAWL:TL.TS.WALL);
        h.vel.set(mode==='crawl'?0:mode==='web'?28:10,mode==='crawl'?2:0,0);
        a.arms?.setRetracted(!mechanical,true);
        const r=h.tether.main;if(mode==='web'){r.active=r.attached=true;r.kind='swing';r.hand='L';r.anchor.set(14,112,-3);r.L=h.pos.distanceTo(r.anchor);r.tension=80;}
        if(!probe.wall){probe.wall=new THREE.Mesh(new THREE.BoxGeometry(100,100,1),new THREE.MeshStandardMaterial({color:0x596873,roughness:.9}));probe.wall.position.set(0,100,1.2);g.scene.add(probe.wall);}
        if(!probe.web){probe.web=new THREE.Line(new THREE.BufferGeometry(),new THREE.LineBasicMaterial({color:0xffffff}));g.scene.add(probe.web);}
        probe.web.visible=mode==='web';
        for(let n=0;n<80;n++){h.pos.addScaledVector(h.vel,1/120);h.prevPos.copy(h.pos);probe.tick(1/120);}
        if(mode==='web'){probe.web.geometry.dispose();probe.web.geometry=new THREE.BufferGeometry().setFromPoints([a.handWorld.L,r.anchor]);}
        g.camera.position.copy(h.pos).add(new THREE.Vector3(3.4,1.3,-5));g.camera.lookAt(h.pos);
        probe.label.textContent=mode+' / spider legs '+(mechanical?'on':'off');g.renderer.render(g.scene,g.camera);
        for(const b of a.rig.order)if(!a.rig.cur[b].toArray().every(Number.isFinite))throw Error('Invalid bone '+b);
        return{mode,mechanical,state:h.state,swingWall:h.swingWall,wallGait:a.wallGait,errors:TL.errors};
      },{mode,mechanical});
      await page.screenshot({path:path.join(out,'wall_'+mode+'_'+(mechanical?'legs':'human')+'.png')});
      assert.deepEqual(result.errors,[]);samples.push(result);
    }
    assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'wall_metrics.json'),JSON.stringify(samples,null,2));
    console.log('PASS six actual-character wall crawl/run/web-run previews, finite bones, no runtime errors');
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
`;
const preview=new Module(__filename,module);preview.filename=__filename;preview.paths=module.paths;preview._compile(prefix+cases,__filename);
