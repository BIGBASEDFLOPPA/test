import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { createVercelHandlers } from '../server/vercel.mjs';
import statusHandler from '../api/status.js';
import interpretHandler from '../api/interpret.js';

const catalog = { assets: [{ id: 'book', name: 'Книга' }] };

function mockResponse() {
  return {
    headers: {},
    setHeader(name, value) {
      this.headers[name] = value;
    },
    end(value) {
      this.body = JSON.parse(value);
    },
  };
}

function request(body, overrides = {}) {
  return {
    method: 'POST',
    headers: {
      host: 'composer-demo.vercel.app',
      origin: 'https://composer-demo.vercel.app',
      'content-type': 'application/json',
    },
    body,
    ...overrides,
  };
}

test('Vercel supports production and preview origins, parsed bodies and warm cache', async () => {
  let calls = 0;
  const handlers = createVercelHandlers({
    catalog,
    key: 'TEST_KEY',
    fetchImpl: async (url, options) => {
      calls++;
      const payload = JSON.parse(options.body);
      assert.equal(payload.max_tokens, 100);
      assert.deepEqual(Object.keys(payload), [
        'model', 'messages', 'max_tokens', 'temperature', 'response_format',
      ]);
      assert.equal(payload.messages[0].content.includes('book:Книга'), true);
      assert.equal(JSON.stringify(payload).includes('TEST_KEY'), false);
      return {
        ok: true,
        json: async () => ({
          message: { content: [{ type: 'text', text: '{"ids":["book"]}' }] },
        }),
      };
    },
  });
  const response = mockResponse();
  await handlers.interpret(request({ text: 'Новая метафора' }), response);
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, { ids: ['book'], cached: false });

  const cached = mockResponse();
  await handlers.interpret(request('{"text":"новая метафора"}', {
    headers: {
      host: 'composer-git-review-team.vercel.app',
      origin: 'https://composer-git-review-team.vercel.app',
      'content-type': 'application/json',
    },
  }), cached);
  assert.deepEqual(cached.body, { ids: ['book'], cached: true });
  assert.equal(calls, 1);
});

test('Vercel rejects wrong origins, methods, large JSON and attached files before API call', async () => {
  const handlers = createVercelHandlers({
    catalog,
    key: 'TEST_KEY',
    fetchImpl: () => assert.fail('Must not call Cohere'),
  });
  const cases = [
    [request({ text: 'test' }, { method: 'GET' }), 405],
    [request({ text: 'test' }, { headers: { host: 'site.test', origin: 'https://evil.test' } }), 403],
    [request({ text: 'test' }, { headers: { host: 'site.test' } }), 403],
    [request({ text: 'test', file: 'image.svg' }), 400],
    [request({ text: 'x'.repeat(5000) }), 413],
    [request('{broken'), 400],
  ];
  for (const [input, status] of cases) {
    const response = mockResponse();
    await handlers.interpret(input, response);
    assert.equal(response.statusCode, status);
    assert.equal(JSON.stringify(response.body).includes('TEST_KEY'), false);
  }
});

test('Vercel accepts streamed JSON and keeps status available without a key', async () => {
  const handlers = createVercelHandlers({ catalog, key: '' });
  const server = http.createServer((req, res) => {
    if (req.url === '/api/status') return handlers.status(req, res);
    return handlers.interpret(req, res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const status = await fetch(base + '/api/status');
    assert.equal(status.status, 200);
    assert.equal((await status.json()).cohereAvailable, false);
    assert.equal(status.headers.get('cache-control'), 'no-store');
    const result = await fetch(base + '/api/interpret', {
      method: 'POST',
      headers: { Origin: base, 'Content-Type': 'application/json' },
      body: '{"text":"test"}',
    });
    assert.equal(result.status, 503);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test('Vercel entrypoints and deployment configuration reference packaged assets', async () => {
  assert.equal(typeof statusHandler, 'function');
  assert.equal(typeof interpretHandler, 'function');
  const config = JSON.parse(await readFile(new URL('../vercel.json', import.meta.url), 'utf8'));
  assert.equal(config.outputDirectory, 'public');
  assert.equal(config.functions['api/*.js'].includeFiles, 'public/assets/catalog.json');
  assert.equal(config.functions['api/*.js'].maxDuration > 12, true);
  const catalogFile = JSON.parse(await readFile(new URL('../public/assets/catalog.json', import.meta.url), 'utf8'));
  assert.equal(catalogFile.assets.length, 10);
  const ignores = await readFile(new URL('../.vercelignore', import.meta.url), 'utf8');
  assert.equal(ignores.split(/\r?\n/).includes('.env'), true);
});
