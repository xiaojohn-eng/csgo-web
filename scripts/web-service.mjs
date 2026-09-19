import {spawn,spawnSync,execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync,openSync,closeSync,existsSync,unlinkSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {networkInterfaces} from 'node:os';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const dir=resolve(root,'.web-service');mkdirSync(dir,{recursive:true});
const stateFile=resolve(dir,'state.json');
const action=process.argv[2]||'start';
// macOS flock is released by the OS on exit, including crashes; the lock file is never removed.
if(process.env.BREACHLINE_WEB_LOCKED!=='1'){
 const result=spawnSync('/usr/bin/python3',[resolve(root,'scripts/web-service-lock.py'),process.execPath,fileURLToPath(import.meta.url),action],{stdio:'inherit',env:process.env});
 if(result.error)console.error(result.error.message);
 process.exit(result.status??1);
}
const readState=()=>{try{return JSON.parse(readFileSync(stateFile,'utf8'));}catch{return null;}};
function fingerprint(pid){try{return execFileSync('/bin/ps',['-p',String(pid),'-o','lstart=','-o','args='],{encoding:'utf8'}).trim();}catch{return '';}}
function own(s){return !!s && fingerprint(s.pid)===s.fingerprint && s.fingerprint.includes(s.entry);}
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function health(){try{const r=await fetch('http://127.0.0.1:2567/health',{signal:AbortSignal.timeout(1000)});return r.ok?await r.json():null;}catch{return null;}}
function addresses(){return [...new Set(Object.values(networkInterfaces()).flat().filter(a=>a&&a.family==='IPv4'&&!a.internal&&(/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a.address))).map(a=>a.address))];}
function show(s){console.log('本机：http://127.0.0.1:2567/');for(const ip of s.addresses||[])console.log(`局域网：http://${ip}:2567/`);console.log(`版本：${s.version} · PID ${s.pid}\n日志：${resolve(dir,'server.log')}`);}
try{
const state=readState();
if(action==='stop'){
 if(!state){console.log('当前没有由此入口启动的服务。');process.exit(0);}
 if(!own(state)){console.log('原服务已退出或进程身份不符，未向任何进程发信号。');unlinkSync(stateFile);process.exit(0);}
 process.kill(state.pid,'SIGTERM');for(let i=0;i<50&&own(state);i++)await delay(100);
 if(own(state))throw Error('服务尚未退出，已保留状态；请检查日志，不强制终止其他进程。');
 unlinkSync(stateFile);console.log('BREACHLINE 网页与房间服务已停止。');process.exit(0);
}
if(action==='status'){if(own(state)){show(state);console.log(JSON.stringify(await health()));}else console.log('服务未运行。');process.exit(0);}
if(action!=='start')throw Error('仅支持 start / stop / status');
if(own(state)){if(!(await health()))throw Error('服务进程存在但健康检查失败，请先检查日志。');show(state);process.exit(0);}
if(await health())throw Error('2567 已有未登记的服务；为保护其他进程，本入口没有接管或终止它。');
const release=process.env.BREACHLINE_WEB_RELEASE||JSON.parse(readFileSync(resolve(root,'current-web-release.json'),'utf8')).path;
const base=resolve(root,release),entry=resolve(base,'server/server/index.js');
const manifest=JSON.parse(readFileSync(resolve(base,'version.json'),'utf8'));
if(!existsSync(entry)||!existsSync(resolve(base,'web/index.html')))throw Error('交付不完整；请使用已经构建和验证的版本。');
const ips=addresses();
const origins=['http://127.0.0.1:2567','http://localhost:2567',...ips.map(ip=>`http://${ip}:2567`)];
const fd=openSync(resolve(dir,'server.log'),'a');
const child=spawn(process.execPath,[entry],{cwd:root,env:{...process.env,HOST:'0.0.0.0',PORT:'2567',ALLOWED_ORIGINS:origins.join(','),WEB_ROOT:resolve(base,'web')},detached:true,stdio:['ignore',fd,fd]});
closeSync(fd);let failed=null;child.on('error',e=>{failed=e;});child.unref();
let healthy=false;
for(let i=0;i<70;i++){await delay(100);if(failed)throw failed;if(!fingerprint(child.pid).includes(entry))break;const h=await health();if(h?.version===manifest.wireVersion&&fingerprint(child.pid).includes(entry)){healthy=true;break;}if(!fingerprint(child.pid))break;}
if(!healthy){if(fingerprint(child.pid).includes(entry))process.kill(child.pid,'SIGTERM');throw Error('启动未通过健康检查；请查看 .web-service/server.log。');}
if(!fingerprint(child.pid).includes(entry))throw Error('本次服务进程已退出，未登记。');
const next={pid:child.pid,entry,fingerprint:fingerprint(child.pid),version:manifest.version,addresses:ips,startedAt:new Date().toISOString()};
writeFileSync(stateFile,JSON.stringify(next,null,2));show(next);
}catch(error){console.error(error.message);process.exitCode=1;}
