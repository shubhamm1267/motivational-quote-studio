
/**
 * Gemini text generation: ONLY Flash-Lite models with a bounded retry policy.
 * Free-tier access and capacity depend on the user's Google AI Studio project.
 * No automatic switch to paid/non-Lite models.
 */
export const LITE_MODELS = Object.freeze([
  'gemini-3.5-flash-lite',
  'gemini-3.1-flash-lite',
  'gemini-2.5-flash-lite', // Legacy: Google may restrict new projects.
]);
export const DEFAULT_MODEL = LITE_MODELS[0];

const TEMPORARY_STATUSES = new Set([408, 429, 500, 502, 503, 504]);
const MODEL_UNAVAILABLE_STATUSES = new Set([404]);

export function sanitizeModel(model) {
  return LITE_MODELS.includes(model) ? model : DEFAULT_MODEL;
}

export function modelOrder(requested) {
  const selected = sanitizeModel(requested);
  return [selected, ...LITE_MODELS.filter((model) => model !== selected)];
}

export class GeminiUnavailableError extends Error {
  constructor(message, attempts) {
    super(message);
    this.name = 'GeminiUnavailableError';
    this.attempts = attempts;
  }
}

function extractJSON(text) {
  const trimmed = String(text || '')
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/, '')
    .trim();

  try {
    return JSON.parse(trimmed);
  } catch {}

  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');

  if (start < 0 || end <= start) {
    throw new Error('Gemini returned no JSON quote.');
  }

  return JSON.parse(trimmed.slice(start, end + 1));
}

function clean(value, max = 180) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function toPost(json, usedModel) {
  const text =
    json?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';

  const obj = extractJSON(text);

  const post = {
    headline: clean(obj.headline, 200),
    detail: clean(obj.detail, 120),
    eyebrow: clean(obj.eyebrow, 45),
    seoTitle: clean(obj.seoTitle, 180),
    caption: clean(obj.caption, 400),
    hashtags: (Array.isArray(obj.hashtags) ? obj.hashtags : [])
      .map((tag) => clean(tag, 40))
      .filter((tag) => /^#[\p{L}\p{N}_]+$/u.test(tag))
      .slice(0, 3),
    imageQuery: '',
    sourceUrl: '',
    sourceName: `Original Gemini quote draft (${usedModel})`,
    verification: 'ai_original_quote_review_required',
    aiModel: usedModel,
  };

  if (!post.headline) {
    throw new Error('Gemini returned an empty quote.');
  }

  if (!post.hashtags.length) {
    post.hashtags = ['#MotivationalQuotes'];
  }

  return post;
}

function errorMessage(status, text) {
  let message = '';

  try {
    message = JSON.parse(text)?.error?.message || '';
  } catch {}

  return clean(message || text || `HTTP ${status}`, 220);
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Attempts each Lite model up to twice on transient 408/429/5xx errors.
 * Non-retryable 400/401/403 errors are surfaced rather than hidden.
 * Pass fetchImpl/sleepImpl in automated tests; production uses native fetch.
 */
export async function writePost({
  key,
  model,
  topic,
  language = 'en',
  fetchImpl = fetch,
  sleepImpl = wait
}) {
  if (!key?.trim()) {
    throw new Error('Gemini API key required for AI quote generation.');
  }

  const prompt = `Write ONE original, short social media quote in ${language === 'en' ? 'American English' : 'Hindi (Devanagari)'}.
Tone: memorable, emotional, uplifting or relatable, suitable for a motivational Facebook page.
Avoid copyrighted quotations and direct imitations of authors, movies and songs.
Headline: up to 170 characters and 26 words. Detail: optional, up to 90 characters.
Eyebrow: up to 24 characters. SEO title: up to 120 characters.
Caption: one or two short sentences. Exactly 3 relevant hashtags.
Respond with JSON ONLY:
{"headline":"...","detail":"...","eyebrow":"...","seoTitle":"...","caption":"...","hashtags":["#One","#Two","#Three"]}
TOPIC: ${String(topic || 'motivation').slice(0, 180)}`;

  const attempts = [];
  const requested = sanitizeModel(model);

  for (const candidateModel of modelOrder(requested)) {
    const endpoint =
      `https://generativelanguage.googleapis.com/v1beta/models/${candidateModel}:generateContent`;

    for (let retry = 0; retry < 2; retry++) {
      let response;

      try {
        response = await fetchImpl(endpoint, {
          method: 'POST',
          headers: {
            'x-goog-api-key': key,
            'content-type': 'application/json'
          },
          body: JSON.stringify({
            contents: [{
              role: 'user',
              parts: [{ text: prompt }]
            }],
            generationConfig: {
              responseMimeType: 'application/json',
              temperature: 0.8,
              maxOutputTokens: 1200
            }
          }),
          signal: AbortSignal.timeout(12000)
        });
      } catch (error) {
        attempts.push(`${candidateModel}: temporary network error`);

        if (retry === 0) {
          await sleepImpl(700);
        }

        continue;
      }

      if (!response.ok) {
        const detail = errorMessage(
          response.status,
          await response.text().catch(() => '')
        );

        if (
          !TEMPORARY_STATUSES.has(response.status) &&
          !MODEL_UNAVAILABLE_STATUSES.has(response.status)
        ) {
          if (response.status === 400) {
            throw new Error(
              `Gemini 400: ${detail}. Check API request/model settings.`
            );
          }

          if (response.status === 401 || response.status === 403) {
            throw new Error(
              `Gemini ${response.status}: API key or project access denied. Check your AI Studio API key and permissions.`
            );
          }

          throw new Error(`Gemini ${response.status}: ${detail}`);
        }

        attempts.push(`${candidateModel}: HTTP ${response.status}`);

        // A model not offered to this project cannot be rescued by retrying.
        if (MODEL_UNAVAILABLE_STATUSES.has(response.status)) {
          break;
        }

        if (retry === 0) {
          const retryAfter = Number(response.headers?.get?.('retry-after'));

          const backoff =
            Number.isFinite(retryAfter) && retryAfter > 0
              ? Math.min(3000, Math.round(retryAfter * 1000))
              : 750 + Math.floor(Math.random() * 250);

          await sleepImpl(backoff);
        }

        continue;
      }

      try {
        const post = toPost(await response.json(), candidateModel);

        if (candidateModel !== requested) {
          post.aiNotice =
            `Selected ${requested} was unavailable; generated successfully with ${candidateModel}.`;
        }

        return post;
      } catch {
        attempts.push(`${candidateModel}: incomplete AI response`);

        if (retry === 0) {
          await sleepImpl(700);
        }
      }
    }
  }

  throw new GeminiUnavailableError(
    'All available Flash-Lite models failed temporarily or are inaccessible. A local original quote will be used instead.',
    attempts
  );
}
