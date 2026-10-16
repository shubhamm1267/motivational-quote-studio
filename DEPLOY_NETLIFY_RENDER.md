# Deployment: Netlify Angular + Render Docker (FREE trial/hobby)

See the chat instructions for screenshots and step-by-step setup. The key values are:

## GitHub
Push the CONTENTS of this directory as the repository ROOT (Dockerfile and netlify.toml must be at the top level).

## Render: one web service
- **New → Web Service** → connect your GitHub repository
- Runtime / Language: **Docker** (Dockerfile in repository root)
- Branch: **main**
- Root directory: blank
- Instance: **Free**
- Health check path: **/api/health**
- Optional but strongly recommended environment variable: `GENERATE_ACCESS_KEY` = a long private passphrase. Enter the same key inside the frontend's "API URL / Deployment settings" form before generating content.
- Docker command: leave blank (uses Dockerfile CMD)
- On deploy, copy URL like `https://my-quote-api.onrender.com`
- Test `https://my-quote-api.onrender.com/api/health` (must show `worker:true`).

Node and Python worker run together inside one container. FFmpeg and fonts are installed by Dockerfile.

## Netlify: Angular
- **Add new project → Import an existing project** → GitHub repository
- `netlify.toml` at repository root defines build settings:
  - Base directory `frontend`
  - Build command `node ../scripts/install-frontend.mjs && node ../scripts/prepare-netlify.mjs && npm run build`
  - Publish directory `dist/studio/browser` (relative to base)
- **Angular dependencies use Corepack/pnpm first** (with automatic npm fallback) to avoid the local `edgesOut` npm error.
- Before deploy, under **Environment variables**, add `RENDER_API_URL` = exact Render origin e.g. `https://my-quote-api.onrender.com` (NO trailing slash; NO `/api`).
- Deploy. Angular app uses this URL automatically. No localhost source editing is needed.
- Alternative for a running frontend: open UI → `API URL / Deployment settings` → paste the Render URL, then refresh Recent Outputs. This browser value is saved in localStorage, so configure the Netlify env var for all visitors.

## Do not expose secrets
- Never commit Gemini API keys, passwords or `.env` files.
- Never put `GENERATE_ACCESS_KEY` in Netlify environment or Angular source: it must be typed manually in the UI and sent as `x-studio-key` header. It is kept in sessionStorage for that browser tab session.
- The frontend is publicly accessible; access key prevents anonymous POST /api/generate, but history/output listing is not private. Keep the service URL private if you need outputs to be private.

## Limitations
- Render Free idles after 15 minutes, and takes about a minute to wake.
- Render Free's local filesystem is ephemeral: generated PNG/MP4 files and Recent Outputs vanish after spin-down/restart/redeploy. Download PNG and MP4 soon after completion. A persistent gallery requires external storage or paid persistent disk.
- Free CPU/RAM may struggle with 10-sec video. Start with 5s, lower load, and monitor Render logs.
