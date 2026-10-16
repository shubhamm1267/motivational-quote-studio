
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { randomUUID, timingSafeEqual } from 'node:crypto';

import {
  FACTS,
  CATEGORIES,
  getSeed,
  localPost,
  pickAutoTopic
} from './facts.mjs';

import {
  writePost,
  sanitizeModel,
  GeminiUnavailableError
} from './gemini.mjs';

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..'
);

const OUTPUT = path.join(ROOT, 'output');
fs.mkdirSync(OUTPUT, { recursive: true });

const PORT = Number(process.env.API_PORT || process.env.PORT || 3100);
const GENERATE_ACCESS_KEY =
  (process.env.GENERATE_ACCESS_KEY || '').trim();

function validAccessKey(provided) {
  if (!GENERATE_ACCESS_KEY) return true;

  const a = Buffer.from(String(provided || ''));
  const b = Buffer.from(GENERATE_ACCESS_KEY);

  return a.length === b.length && timingSafeEqual(a, b);
}

const WORKER = process.env.WORKER_URL || 'http://127.0.0.1:8008';

const jobs = new Map();
const VALID_STYLES = new Set(['midnight', 'editorial', 'sunset']);
const VALID_SIZES = new Set(['portrait', 'square']);
const VALID_EFFECTS = new Set([
  'none',
  'reference',
  'softGlow',
  'float'
]);

const ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MIME = {
  'poster.png': 'image/png',
  'reel.mp4': 'video/mp4',
  'credits.txt': 'text/plain; charset=utf-8',
  'metadata.json': 'application/json; charset=utf-8'
};

function reply(res, status, obj) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'content-type,x-studio-key',
    'access-control-allow-methods': 'GET, HEAD, POST, OPTIONS'
  });

  res.end(JSON.stringify(obj));
}

async function jsonBody(req) {
  let length = 0;
  let data = '';

  for await (const chunk of req) {
    length += chunk.length;

    if (length > 16 * 1024 * 1024) {
      throw Error('Request too large (16MB limit)');
    }

    data += chunk.toString();
  }

  try {
    return JSON.parse(data || '{}');
  } catch {
    throw Error('Invalid JSON request');
  }
}

function validate(body) {
  return {
    category: String(body.category || 'all').slice(0, 30),
    topic: String(body.topic || '').trim().slice(0, 140),
    brand: String(body.brand || 'Quote Craft').trim().slice(0, 36),
    handle: String(body.handle || '@yourpage').trim().slice(0, 40),
    language: body.language === 'hi' ? 'hi' : 'en',
    style: VALID_STYLES.has(body.style) ? body.style : 'midnight',
    size: VALID_SIZES.has(body.size) ? body.size : 'portrait',
    withVideo: !!body.withVideo,
    videoSeconds: [5, 10].includes(Number(body.videoSeconds))
      ? Number(body.videoSeconds)
      : 5,
    effectEnabled: !!body.effectEnabled,
    effectStyle: VALID_EFFECTS.has(body.effectStyle)
      ? body.effectStyle
      : 'reference',
    iconDataUrl: String(body.iconDataUrl || ''),
    model: sanitizeModel(body.model),
    geminiKey: String(body.geminiKey || '').trim().slice(0, 250)
  };
}

function assetPaths(id) {
  const dir = path.join(OUTPUT, id);
  const assets = {};

  for (const [key, name] of [
    ['poster', 'poster.png'],
    ['reel', 'reel.mp4'],
    ['credits', 'credits.txt'],
    ['metadata', 'metadata.json']
  ]) {
    if (fs.existsSync(path.join(dir, name))) {
      assets[key] = `/output/${id}/${name}`;
    }
  }

  return assets;
}

function safeJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function publicJob(j) {
  const {
    id,
    status,
    stage,
    progress,
    error,
    warnings,
    post,
    image,
    license
  } = j;

  return {
    id,
    status,
    stage,
    progress,
    error,
    warnings: Array.isArray(warnings) ? warnings : [],
    post,
    image,
    license,
    assets: {
      ...assetPaths(id),
      ...(j.assets || {})
    }
  };
}

function diskJob(id) {
  if (!ID_PATTERN.test(id)) return null;

  const dir = path.join(OUTPUT, id);
  const meta = safeJson(path.join(dir, 'metadata.json'));

  if (!meta) return null;

  const assets = assetPaths(id);

  if (!assets.poster) return null;

  const saved = safeJson(path.join(dir, 'job.json'));
  const stats = fs.statSync(path.join(dir, 'poster.png'));

  return {
    id,
    status: 'done',
    stage: 'Ready — restored from output folder',
    progress: 100,
    warnings: saved?.warnings || meta.warnings || [],
    post: saved?.post || meta.post || {},
    assets,
    license: saved?.license || meta.visual || {
      kind: 'original_quote_design'
    },
    createdAt: saved?.createdAt || stats.mtimeMs
  };
}

function findJob(id) {
  return jobs.get(id) || diskJob(id);
}

function history(limit = 20) {
  return fs.readdirSync(OUTPUT, { withFileTypes: true })
    .filter((x) => x.isDirectory() && ID_PATTERN.test(x.name))
    .map((x) => findJob(x.name))
    .filter((j) => j && j.status === 'done' && j.assets?.poster)
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    .slice(0, limit)
    .map(publicJob);
}

function saveJob(job) {
  if (job.status !== 'done') return;

  const dir = path.join(OUTPUT, job.id);

  if (!fs.existsSync(dir)) return;

  const safe = {
    id: job.id,
    status: job.status,
    post: job.post,
    assets: job.assets,
    warnings: job.warnings,
    license: job.license,
    createdAt: job.createdAt
  };

  fs.writeFileSync(
    path.join(dir, 'job.json'),
    JSON.stringify(safe, null, 2)
  );
}

let lastSeed = '';
let lastTopic = '';

function fallbackPost(category, language) {
  const seed = getSeed(category, lastSeed);
  lastSeed = seed.id;
  return localPost(seed, language);
}

async function processJob(job, body) {
  try {
    job.stage = 'Selecting quote theme';
    job.progress = 12;

    let post;

    if (body.geminiKey) {
      const selectedTopic =
        body.topic || pickAutoTopic(body.category, lastTopic);

      if (!body.topic) {
        lastTopic = selectedTopic;
      }

      job.stage = 'Writing original AI quote (Lite models)';
      job.progress = 30;

      try {
        post = await writePost({
          key: body.geminiKey,
          model: body.model,
          language: body.language,
          topic: selectedTopic
        });

        if (post.aiNotice) {
          job.warnings.push(post.aiNotice);
        }
      } catch (error) {
        if (!(error instanceof GeminiUnavailableError)) {
          throw error;
        }

        post = fallbackPost(body.category, body.language);

        job.warnings.push(
          'Gemini Lite models are currently overloaded or inaccessible. ' +
          'This post uses a prewritten LOCAL quote (not a new AI quote).' +
          (body.topic
            ? ' It might not match your custom topic.'
            : '')
        );

        console.warn(
          '[Gemini fallback]',
          error.message,
          error.attempts?.join('; ')
        );
      }
    } else if (body.topic) {
      post = fallbackPost(body.category, body.language);

      job.warnings.push(
        'Custom topic needs a Gemini key; used a local prewritten quote instead.'
      );
    } else {
      post = fallbackPost(body.category, body.language);
    }

    job.post = post;
    job.progress = 58;

    job.stage = body.withVideo
      ? 'Rendering PNG and Shorts MP4'
      : 'Rendering PNG';

    const renderBody = {
      jobId: job.id,
      post,
      brand: body.brand,
      handle: body.handle,
      style: body.style,
      size: body.size,
      withVideo: body.withVideo,
      videoSeconds: body.videoSeconds,
      effectEnabled: body.effectEnabled,
      effectStyle: body.effectEnabled ? body.effectStyle : 'none',
      imageMode: 'illustration',
      imageDataUrl: '',
      iconDataUrl: body.iconDataUrl
    };

    const result = await fetch(`${WORKER}/render`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify(renderBody),
      signal: AbortSignal.timeout(
        body.withVideo ? 180000 : 85000
      )
    });

    const response = await result.json().catch(() => ({
      detail: 'Renderer returned unreadable JSON'
    }));

    if (!result.ok) {
      throw Error(
        typeof response.detail === 'string'
          ? response.detail
          : JSON.stringify(response.detail || response).slice(0, 250)
      );
    }

    job.assets = assetPaths(job.id);

    if (!job.assets.poster) {
      throw Error('PNG missing after renderer completed');
    }

    if (body.withVideo && !job.assets.reel) {
      throw Error('MP4 missing after renderer completed');
    }

    job.image = response.image;
    job.warnings.push(...(response.warnings || []));
    job.license = response.license || {};

    job.stage = 'Ready for in-app preview';
    job.progress = 100;
    job.status = 'done';

    saveJob(job);
  } catch (e) {
    job.status = 'failed';
    job.stage = 'Generation failed';
    job.error = e.message;
    job.progress = 100;
  }
}

function sendFile(req, res, url, id, filename) {
  const full = path.join(OUTPUT, id, filename);

  let stat;

  try {
    stat = fs.statSync(full);

    if (!stat.isFile()) {
      throw Error('not file');
    }
  } catch {
    return reply(res, 404, {
      error: 'Output file not found'
    });
  }

  const isDownload = url.searchParams.get('download') === '1';

  const disposition =
    `${isDownload ? 'attachment' : 'inline'}; filename="${id.slice(0, 8)}-${filename}"`;

  const headers = {
    'content-type': MIME[filename],
    'access-control-allow-origin': '*',
    'access-control-expose-headers':
      'content-length, content-range, accept-ranges',
    'content-disposition': disposition,
    'accept-ranges': 'bytes',
    'cache-control': 'private,max-age=60',
    'x-content-type-options': 'nosniff'
  };

  let start = 0;
  let end = stat.size - 1;
  let status = 200;

  const range = req.headers.range;

  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);

    if (!match) {
      res.writeHead(416, {
        ...headers,
        'content-range': `bytes */${stat.size}`
      });

      return res.end();
    }

    if (match[1]) {
      start = Number(match[1]);
    }

    if (match[2]) {
      end = Number(match[2]);
    }

    if (!match[1] && match[2]) {
      start = Math.max(0, stat.size - Number(match[2]));
      end = stat.size - 1;
    }

    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start > end ||
      start >= stat.size
    ) {
      res.writeHead(416, {
        ...headers,
        'content-range': `bytes */${stat.size}`
      });

      return res.end();
    }

    end = Math.min(end, stat.size - 1);
    status = 206;

    headers['content-range'] =
      `bytes ${start}-${end}/${stat.size}`;
  }

  headers['content-length'] = end - start + 1;

  res.writeHead(status, headers);

  if (req.method === 'HEAD') {
    return res.end();
  }

  const stream = fs.createReadStream(full, { start, end });

  stream.on('error', () => res.destroy());
  stream.pipe(res);
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    return reply(res, 204, {});
  }

  const url = new URL(
    req.url || '/',
    `http://localhost:${PORT}`
  );

  try {
    if (req.method === 'GET' && url.pathname === '/api/health') {
      let worker = false;

      try {
        const r = await fetch(`${WORKER}/health`, {
          signal: AbortSignal.timeout(3000)
        });

        worker = r.ok;
      } catch {}

      return reply(res, worker ? 200 : 503, {
        ok: worker,
        worker,
        apiPort: PORT,
        historyCount: history(40).length
      });
    }

    if (req.method === 'GET' && url.pathname === '/api/categories') {
      return reply(res, 200, {
        categories: CATEGORIES,
        seedCount: FACTS.length
      });
    }

    if (req.method === 'GET' && url.pathname === '/api/history') {
      const requested = Number(
        url.searchParams.get('limit') || 20
      );

      const limit = Number.isFinite(requested)
        ? Math.max(1, Math.min(50, requested))
        : 20;

      return reply(res, 200, {
        jobs: history(limit)
      });
    }

    if (req.method === 'POST' && url.pathname === '/api/generate') {
      if (!validAccessKey(req.headers['x-studio-key'])) {
        return reply(res, 403, {
          error:
            'Incorrect studio access key. Open API URL / Deployment settings and enter the key configured on Render.'
        });
      }

      const body = validate(await jsonBody(req));

      if (
        body.iconDataUrl &&
        !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(
          body.iconDataUrl
        )
      ) {
        throw Error('Upload PNG, JPG or WEBP icon');
      }

      if (body.iconDataUrl.length > 4_500_000) {
        throw Error('Icon too large (3MB max)');
      }

      const id = randomUUID();

      const job = {
        id,
        status: 'working',
        stage: 'Queued',
        progress: 2,
        warnings: [],
        createdAt: Date.now()
      };

      jobs.set(id, job);

      void processJob(job, body);

      return reply(res, 202, {
        id,
        status: 'working'
      });
    }

    const jobMatch = url.pathname.match(
      /^\/api\/jobs\/([a-f0-9-]{36})$/i
    );

    if (req.method === 'GET' && jobMatch) {
      const job = findJob(jobMatch[1]);

      return reply(
        res,
        job ? 200 : 404,
        job ? publicJob(job) : { error: 'Job not found' }
      );
    }

    const fileMatch = url.pathname.match(
      /^\/output\/([a-f0-9-]{36})\/(poster\.png|reel\.mp4|credits\.txt|metadata\.json)$/i
    );

    if (
      (req.method === 'GET' || req.method === 'HEAD') &&
      fileMatch
    ) {
      return sendFile(
        req,
        res,
        url,
        fileMatch[1],
        fileMatch[2]
      );
    }

    return reply(res, 404, {
      error: 'Not found'
    });
  } catch (e) {
    reply(res, 400, {
      error: e.message
    });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(
    `QuoteCraft API with previews: http://localhost:${PORT}`
  );
});

setInterval(() => {
  for (const [id, job] of jobs) {
    if (
      job.status !== 'working' &&
      Date.now() - job.createdAt > 6 * 60 * 60_000
    ) {
      jobs.delete(id);
    }
  }
}, 60 * 60_000).unref();
