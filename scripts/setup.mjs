import {spawnSync} from 'node:child_process';
import {installFrontend,ROOT} from './install-frontend.mjs';

function run(exe,args){
  const result=spawnSync(exe,args,{cwd:ROOT,stdio:'inherit',env:process.env});
  return result.status===0&&!result.error;
}
function pythonCandidate(){
  const candidates=[];
  if(process.env.PYTHON_BIN)candidates.push([process.env.PYTHON_BIN,[]]);
  if(process.platform==='win32')candidates.push(['python',[]],['py',['-3']]);
  else candidates.push(['python3',[]],['python',[]]);
  for(const [exe,args] of candidates){
    const result=spawnSync(exe,[...args,'-c','import sys;assert sys.version_info >= (3,10);print(sys.version)'],{cwd:ROOT,stdio:'pipe',encoding:'utf8'});
    if(result.status===0&&!result.error)return [exe,args];
  }
  return null;
}
try{
  const dryRun=process.argv.includes('--dry-run');
  console.log('\n=== Motivational Quote Studio v5.4 Setup ===');
  await installFrontend({dryRun});
  const py=pythonCandidate();
  if(!py)throw Error('Python 3.10+ not found. Run `python --version` or `py -3 --version`. Install Python and tick "Add Python to PATH".');
  console.log(`[Setup] Python found: ${py[0]}`);
  if(!dryRun){
    console.log('[Setup] Installing Python worker dependencies…');
    if(!run(py[0],[...py[1],'-m','pip','install','-r','worker/requirements.txt'])){
      throw Error('Python dependency installation failed. Try: python -m pip install -r worker\\requirements.txt');
    }
  }
  console.log('\n[Setup] Complete. Run: npm run dev');
}catch(e){
  console.error('\n[Setup] FAILED:',e.message);
  console.error('[Setup] If using Node 22, check `node -v` and your network. Paste the last 30 lines of this output if it fails.');
  process.exitCode=1;
}
