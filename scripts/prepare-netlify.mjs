import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

// This public URL is NOT a secret. Set RENDER_API_URL in Netlify environment variables.
const value=(process.env.RENDER_API_URL||'').trim().replace(/\/+$/,'');
if(!/^https:\/\/[a-z0-9.-]+(?:\:\d+)?$/i.test(value)){
 console.error('ERROR: Netlify environment variable RENDER_API_URL is missing or invalid.');
 console.error('Example: https://your-studio-api.onrender.com');
 process.exit(1);
}
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const file=path.join(root,'frontend','src','app','deploy-config.ts');
fs.writeFileSync(file,`// GENERATED AT NETLIFY BUILD: public backend base URL only.\nexport const DEFAULT_API_BASE = ${JSON.stringify(value)};\n`);
console.log('Netlify API base configured:',value);
