/**
 * Angular installer resilient to npm Arborist crashes such as:
 * "Cannot read properties of null (reading 'edgesOut')".
 *
 * Priority: pinned pnpm via Corepack -> system pnpm -> npm-exec pnpm -> npm fallback.
 * Runs without shell for Node/Python, and uses cmd shell only for Windows .cmd shims.
 */
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

export const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const FRONTEND=path.join(ROOT,'frontend');
const ON_WINDOWS=process.platform==='win32';
const env={...process.env,COREPACK_ENABLE_DOWNLOAD_PROMPT:'0',COREPACK_ENABLE_AUTO_PIN:'0',npm_config_yes:'true'};

function run(exe,args,{cwd=FRONTEND,quiet=false,timeout=8*60*1000}={}){
  const p=spawnSync(exe,args,{
    cwd, env, shell:ON_WINDOWS && /^(corepack|pnpm|npm|npx)$/i.test(exe),
    stdio:quiet?'pipe':'inherit', windowsHide:false,timeout,
    encoding:quiet?'utf8':undefined,maxBuffer:1024*1024
  });
  return {ok:p.status===0&&!p.error,status:p.status,error:p.error?.message||'',out:(p.stdout||'')+'\n'+(p.stderr||'')};
}

function npmCliArgs(args){
  // npm run setup sets npm_execpath to npm-cli.js. Invoke through Node rather
  // than spawning npm.cmd with shell:true (better on Windows + spaces in PATH).
  const cli=process.env.npm_execpath;
  if(cli && cli.endsWith('.js') && fs.existsSync(cli))return {exe:process.execPath,args:[cli,...args]};
  return {exe:'npm',args};
}
function runNpm(args){const target=npmCliArgs(args);return run(target.exe,target.args)}

function cleanBeforePnpm(){
  const modules=path.join(FRONTEND,'node_modules');
  if(fs.existsSync(modules)&&!fs.existsSync(path.join(modules,'.modules.yaml'))){
    console.log('[Setup] Removing old/partially installed npm node_modules to avoid mixed dependency layouts…');
    fs.rmSync(modules,{recursive:true,force:true,maxRetries:4,retryDelay:500});
  }
}
function cleanBeforeNpm(){
  const modules=path.join(FRONTEND,'node_modules');
  if(fs.existsSync(modules)&&fs.existsSync(path.join(modules,'.modules.yaml'))){
    console.log('[Setup] Removing incomplete pnpm node_modules before npm fallback…');
    fs.rmSync(modules,{recursive:true,force:true,maxRetries:4,retryDelay:500});
  }
}
function clearBrokenNpmLock(){
  // Source ZIP never ships with package-lock.json; npm may have created a
  // partial lock during the failed install. pnpm uses its own lock format.
  const lock=path.join(FRONTEND,'package-lock.json');
  if(fs.existsSync(lock)){
    console.log('[Setup] Removing npm package-lock.json before pnpm installation.');
    fs.rmSync(lock,{force:true});
  }
}
function commands(){
  const pnpmArgs=['install','--no-frozen-lockfile','--config.strict-peer-dependencies=false'];
  return [
    {label:'Corepack + pinned pnpm 9.15.9',probe:['corepack',['--version']],exe:'corepack',args:['pnpm',...pnpmArgs]},
    {label:'Installed pnpm',probe:['pnpm',['--version']],exe:'pnpm',args:pnpmArgs},
    {label:'npm exec + isolated pnpm',probe:null,exe:'npm-exec',args:['exec','--yes','--package=pnpm@9.15.9','--','pnpm',...pnpmArgs]},
    {label:'npm fallback with legacy peers',probe:null,exe:'npm-fallback',args:['install','--legacy-peer-deps','--install-strategy=shallow','--no-audit','--no-fund']},
  ];
}
export async function installFrontend({dryRun=false}={}){
  if(!fs.existsSync(path.join(FRONTEND,'package.json')))throw Error('frontend/package.json not found. Run from extracted project root.');
  console.log(`\n[Setup] Frontend: ${FRONTEND}`);
  if(dryRun){
    for(const item of commands())console.log(`[DRY RUN] ${item.label}: ${item.exe} ${item.args.join(' ')}`);
    return;
  }
  try{cleanBeforePnpm();clearBrokenNpmLock()}catch(e){throw Error(`Could not clean the incomplete frontend installation. Close running Node/Angular processes, then try again. ${e.message}`)}
  const tried=[];
  for(const item of commands()){
    if(item.probe){
      const probed=run(item.probe[0],item.probe[1],{quiet:true,timeout:12_000});
      if(!probed.ok){
        console.log(`[Setup] ${item.label} unavailable — trying next installer.`);
        continue;
      }
    }
    if(item.exe==='npm-fallback'){
      try{cleanBeforeNpm()}catch(e){throw Error(`Cannot clean old node_modules: ${e.message}`)}
    }
    console.log(`\n[Setup] Installing Angular dependencies via ${item.label}…`);
    const result=item.exe.startsWith('npm-')?runNpm(item.args):run(item.exe,item.args);
    if(result.ok){
      console.log(`[Setup] Frontend dependencies installed using ${item.label}.`);
      return;
    }
    tried.push(`${item.label} (exit ${result.status??'unknown'}${result.error?'; '+result.error:''})`);
    console.warn(`[Setup] ${item.label} did not finish successfully. Will try another installer.`);
  }
  throw Error('Angular install unsuccessful. Attempts: '+tried.join(' | ')+'. Check internet/registry access, then share the last installer error.');
}

if(process.argv[1] && import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  installFrontend({dryRun:process.argv.includes('--dry-run')}).catch(e=>{console.error('[Setup]',e.message);process.exitCode=1});
}
