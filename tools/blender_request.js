'use strict';
const net = require('net'), fs = require('fs');
const command = {type:'execute_code', params:{code:fs.readFileSync(process.argv[2],'utf8')}};
let response='';
const socket=net.createConnection({host:'127.0.0.1',port:9876},()=>socket.write(JSON.stringify(command)));
socket.setTimeout(180000);
socket.on('data',chunk=>{response+=chunk;try{const result=JSON.parse(response);console.log(JSON.stringify(result));socket.end();}catch{}});
socket.on('error',e=>{console.error(e.message);process.exitCode=1;});
socket.on('timeout',()=>{console.error('Blender timed out');socket.destroy();process.exitCode=1;});
