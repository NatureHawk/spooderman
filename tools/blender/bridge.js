/* Local bridge to the user's Blender MCP add-on socket. */
'use strict';
const net=require('net'),fs=require('fs');
const script=process.argv[2];
const command=script?{type:'execute_code',params:{code:fs.readFileSync(script,'utf8')}}:{type:'get_scene_info',params:{}};
const socket=net.createConnection({host:'127.0.0.1',port:9876});
let buffer='';socket.setTimeout(900000);
socket.on('connect',()=>socket.write(JSON.stringify(command)));
socket.on('data',chunk=>{buffer+=chunk.toString();let response;try{response=JSON.parse(buffer);}catch{return;}
 console.log(JSON.stringify(response,null,2));socket.end();if(response.status!=='success')process.exitCode=1;});
socket.on('timeout',()=>{console.error('Blender response timeout');socket.destroy();process.exitCode=1;});
socket.on('error',e=>{console.error(e.message);process.exitCode=1;});
