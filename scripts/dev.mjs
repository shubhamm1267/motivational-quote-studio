import {spawn} from 'node:child_process';
const win=process.platform==='win32';
const processes=[];
function boot(label,bin,args){
 const p=spawn(bin,args,{stdio:'inherit',shell:win,env:process.env});processes.push(p);
 p.on('exit',(code)=>{ if(code!==null&&code!==0) console.error(`${label} exited ${code}`)});
}
boot('worker',process.env.PYTHON_BIN||'python',['-m','uvicorn','main:app','--app-dir','worker','--host','127.0.0.1','--port','8008']);
boot('backend', 'node',['backend/server.mjs']);
boot('angular',win?'npm.cmd':'npm',['--prefix','frontend','start']);
for(const event of ['SIGINT','SIGTERM'])process.on(event,()=>{for(const p of processes){try{p.kill()}catch{}}process.exit(0)});
console.log('Angular http://localhost:4200 | Node http://localhost:3100 | Python http://localhost:8008');
