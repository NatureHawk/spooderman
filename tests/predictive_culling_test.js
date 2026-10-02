'use strict';
require('./low_manhattan_test.js');
const assert=require('assert'),C=TL.LowManhattan;
let range=0;
for(const quality of ['low','medium','high','ultra']){
 const still=C.policy(quality,900,new THREE.Vector3()),fast=C.policy(quality,900,new THREE.Vector3(100,0,0));
 assert(still.range>range);range=still.range;assert.equal(still.lead.length(),0);assert(fast.lead.x>0);assert(fast.lead.length()<=C.budgets[quality].lead);
 const front=new THREE.Sphere(new THREE.Vector3(still.range+fast.lead.x*.75,0,0),1),back=front.clone();back.center.x*=-1;
 assert(C.distance(front,new THREE.Vector3(),fast.lead)<still.range);
 assert(C.distance(back,new THREE.Vector3(),fast.lead)>still.range);
 const reverse=C.policy(quality,900,new THREE.Vector3(-100,0,0));assert(C.distance(back,new THREE.Vector3(),reverse.lead)<still.range);
 const dive=C.policy(quality,900,new THREE.Vector3(0,-100,0));assert(dive.lead.y<0);
 assert.equal(C.policy(quality,200,new THREE.Vector3()).range,200,'manual render-distance cap respected');
}
console.log('PASS quality-scaled budgets, forward-only velocity extension, reverse direction, diving, manual distance');
