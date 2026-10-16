# Motivational Quote Studio v5.4 — Windows npm Setup Fix + Netlify / Render

Quote poster + optional 5s/10s silent Shorts video, with effect on/off, custom icon upload, original Gemini quotes, history and preview UI.

## Important: The `edgesOut` npm error

On some Windows/npm 10/11 setups, `npm install` fails with:

```
npm error Cannot read properties of null (reading 'edgesOut')
```

**v5.4 setup avoids npm's dependency-tree resolver by trying pinned pnpm through Corepack first.** If Corepack is missing, it automatically tries installed pnpm, isolated pnpm via `npm exec`, and finally npm with compatibility flags. It uses one command (`npm run setup`) and prints which method succeeded. It never needs a globally installed pnpm if Corepack or npm-exec can fetch it.

### Run on Windows 10/11

Requirements: Node.js 22, Python 3.10+, FFmpeg on PATH, working internet to install npm/Python packages.

1. Extract this ZIP. Open CMD in the **inner `motivational-quote-studio` folder** where `package.json` lives.
2. Check:

```cmd
node -v
npm -v
python --version
ffmpeg -version
```

3. Install:

```cmd
npm run setup
```

4. Start:

```cmd
npm run dev
```

5. Open <http://localhost:4200>.

One-step Windows installers are also included: `setup-windows.bat` and `start-windows.bat`.

### If setup still fails

Try the same folder after closing all Angular/Node processes:

```cmd
corepack --version
corepack pnpm --version
npm run setup
```

If Corepack reports a missing command, you can install pnpm with the following optional manual fallback (requires internet):

```cmd
npm install -g pnpm@9.15.9
npm run setup
```

For diagnostics (without installing):

```cmd
npm run setup -- --dry-run
```

Send complete failure output and `node -v`, `npm -v`, `corepack --version`. If network/DNS or file permissions cause failure, no script can install missing packages offline.

## Deploy: Netlify + Render

Follow `DEPLOY_NETLIFY_RENDER.md` included with this project.

- Render: one **Docker** Web Service. Repository root contains `Dockerfile`; Node and Python/FFmpeg run in one service.
- Netlify: `netlify.toml` builds Angular in `frontend`. The build runs `scripts/install-frontend.mjs` too, so the installer workaround is used on Netlify.
- Configure `RENDER_API_URL` in Netlify to your Render service origin (`https://your-service.onrender.com`). `scripts/prepare-netlify.mjs` writes it to `frontend/src/app/deploy-config.ts` during build. Do not manually replace the local Angular dev proxy.
- On Render optionally add `GENERATE_ACCESS_KEY` as a private environment variable; enter the same key in the UI. Never put API keys in Git.
- Render Free has **ephemeral output storage**: PNG/MP4 and history may disappear after idle spin-down/redeploy. Download results promptly.

## Checks run on v5.4

- JavaScript/Node source syntax check
- `npm run setup -- --dry-run`
- Node unit tests: 3 passing
- Python renderer tests: 3 passing

The full Angular dependency install/build cannot be verified in the packaging environment because the npm registry is not reachable from here. Always check actual install/build logs on your machine and Netlify.
