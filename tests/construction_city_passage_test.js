'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm');
// Reuse the exact whole-city geometry fixture, including native rooftops,
// neighboring scan buildings, construction members, and real dynamic cranes.
const fixtureFile=path.join(__dirname,'construction_worksites_test.js');
const fixture=new Function('require','__dirname',fs.readFileSync(fixtureFile,'utf8')+'\nreturn {streamer,world};')(require,__dirname);
vm.runInThisContext(fs.readFileSync(path.join(__dirname,'../src/04c_reference.js'),'utf8'),{filename:'04c_reference.js'});TL.V.init();
vm.runInThisContext(fs.readFileSync(path.join(__dirname,'../src/03q_facade_repairs.js'),'utf8'),{filename:'03q_facade_repairs.js'});TL.FacadeRepairs.asset=require('../evidence/construction/facade_repairs.json');TL.FacadeRepairs.build(fixture.streamer);
const result=require('./construction_city_passages').checkCityPassages(fixture.world,fixture.streamer.constructionState.sites,20);
fs.mkdirSync(path.join(__dirname,'../evidence/construction/zip_revision'),{recursive:true});fs.writeFileSync(path.join(__dirname,'../evidence/construction/zip_revision/full_city_passages.json'),JSON.stringify(result,null,2));
console.log('PASS '+result.cases+' real whole-city curved passages through '+result.gates+' gates across '+result.sites+' unique sites, both heroes/directions at15/35/60m/s');
