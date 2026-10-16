
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_MODEL,
  LITE_MODELS,
  GeminiUnavailableError,
  sanitizeModel,
  modelOrder,
  writePost
} from '../backend/gemini.mjs';

const good = {
  candidates: [{
    content: {
      parts: [{
        text: JSON.stringify({
          headline: 'Keep showing up for your future self.',
          detail: 'Consistency becomes confidence.',
          eyebrow: 'MOTIVATION',
          seoTitle: 'Keep Showing Up',
          caption: 'Small steps count.',
          hashtags: [
            '#Motivation',
            '#Consistency',
            '#PersonalGrowth'
          ]
        })
      }]
    }
  }]
};

const respond = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json'
    }
  });

const modelFromUrl = (url) =>
  /\/models\/(.*?):generateContent/.exec(url)[1];

const noDelay = async () => {};

test(
  'Lite allowlist excludes Flash and unknown models; newest Lite is default',
  () => {
    assert.deepEqual([...LITE_MODELS], [
      'gemini-3.5-flash-lite',
      'gemini-3.1-flash-lite',
      'gemini-2.5-flash-lite'
    ]);

    assert.equal(
      sanitizeModel('gemini-2.5-flash'),
      DEFAULT_MODEL
    );

    assert.equal(
      sanitizeModel('../bad'),
      DEFAULT_MODEL
    );

    assert.deepEqual(
      modelOrder('gemini-3.1-flash-lite'),
      [
        'gemini-3.1-flash-lite',
        'gemini-3.5-flash-lite',
        'gemini-2.5-flash-lite'
      ]
    );
  }
);

test(
  '503 retries selected model then uses another Lite, with user-visible notice',
  async () => {
    const calls = [];

    const post = await writePost({
      key: 'test-only',
      topic: 'self respect',
      language: 'en',
      model: 'gemini-3.5-flash-lite',
      sleepImpl: noDelay,

      fetchImpl: async (url) => {
        const model = modelFromUrl(url);
        calls.push(model);

        return model === 'gemini-3.5-flash-lite'
          ? respond(503, {
              error: { message: 'high demand' }
            })
          : respond(200, good);
      }
    });

    assert.deepEqual(calls, [
      DEFAULT_MODEL,
      DEFAULT_MODEL,
      'gemini-3.1-flash-lite'
    ]);

    assert.equal(
      post.aiModel,
      'gemini-3.1-flash-lite'
    );

    assert.match(post.aiNotice, /unavailable/);
    assert.equal(post.hashtags.length, 3);
  }
);

test(
  'all Lite models failing with 503 yields typed local fallback signal, not endless retries',
  async () => {
    const calls = [];

    await assert.rejects(
      writePost({
        key: 'test-only',
        topic: 'life',
        sleepImpl: noDelay,

        fetchImpl: async (url) => {
          calls.push(modelFromUrl(url));

          return respond(503, {
            error: {
              message: 'overloaded'
            }
          });
        }
      }),

      (err) =>
        err instanceof GeminiUnavailableError &&
        err.attempts.length === 6
    );

    assert.equal(calls.length, 6);
  }
);

test(
  '404 model not offered to this project skips directly to next Lite',
  async () => {
    const calls = [];

    const post = await writePost({
      key: 'test-only',
      topic: 'life',
      sleepImpl: noDelay,

      fetchImpl: async (url) => {
        const m = modelFromUrl(url);
        calls.push(m);

        return m === DEFAULT_MODEL
          ? respond(404, {})
          : respond(200, good);
      }
    });

    assert.deepEqual(calls, [
      DEFAULT_MODEL,
      'gemini-3.1-flash-lite'
    ]);

    assert.equal(
      post.aiModel,
      'gemini-3.1-flash-lite'
    );
  }
);

test(
  'bad API key is a real error, not silently replaced with local content',
  async () => {
    let count = 0;

    await assert.rejects(
      writePost({
        key: 'bad',
        topic: 'life',
        sleepImpl: noDelay,

        fetchImpl: async () => {
          count++;

          return respond(403, {
            error: {
              message: 'API key invalid'
            }
          });
        }
      }),

      /API key or project access denied/
    );

    assert.equal(count, 1);
  }
);

test(
  'successful request uses correct stable Lite endpoint and JSON payload',
  async () => {
    let sent;

    const post = await writePost({
      key: 'test-only',
      topic: 'confidence',
      sleepImpl: noDelay,

      fetchImpl: async (url, opts) => {
        sent = {
          url,
          body: JSON.parse(opts.body)
        };

        return respond(200, good);
      }
    });

    assert.match(
      sent.url,
      /gemini-3\.5-flash-lite:generateContent$/
    );

    assert.equal(
      sent.body.generationConfig.responseMimeType,
      'application/json'
    );

    assert.match(
      sent.body.contents[0].parts[0].text,
      /confidence/
    );

    assert.equal(
      post.headline,
      'Keep showing up for your future self.'
    );
  }
);
