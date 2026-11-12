import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createInterpreter } from '../server/interpret.mjs';
import { createServer } from '../server/index.mjs';

const catalog = [
  { id: 'tree', name: 'Дерево' },
  { id: 'sun', name: 'Солнце' }
];
const response = ids => ({
  ok: true,
  json: async () => ({
    message: { content: [{ type: 'text', text: JSON.stringify({ ids }) }] }
  })
});
test('validates unknown IDs and hides provider details', async () => {
  const adapter = createInterpreter({
    catalog,
    key: 'SECRET',
    fetchImpl: async () => response(['unknown'])
  });
  await assert.rejects(
    adapter.interpret('forest'),
    error => error.status === 502 && !error.message.includes('SECRET')
  );
});
test('normalizes disk cache, deduplicates in flight, sends only text and catalog', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'composer-cache-'));
  try {
    let calls = 0;
    const cacheFile = path.join(dir, 'cache.json');
    const adapter = createInterpreter({
      catalog,
      key: 'SECRET',
      cacheFile,
      fetchImpl: async (url, options) => {
        calls++;
        const payload = JSON.parse(options.body);
        assert.equal(payload.messages[1].content, 'Forest');
        assert.equal(payload.messages[0].content.includes('tree:Дерево'), true);
        assert.equal(JSON.stringify(payload).includes('SECRET'), false);
        assert.equal('files' in payload, false);
        return response(['tree']);
      }
    });
    const results = await Promise.all([
      adapter.interpret('Forest'),
      adapter.interpret('  FOREST  ')
    ]);
    assert.deepEqual(results, [
      { ids: ['tree'], cached: false },
      { ids: ['tree'], cached: false }
    ]);
    assert.equal(calls, 1);
    assert.deepEqual(await adapter.interpret('forest'), {
      ids: ['tree'],
      cached: true
    });
    const restored = createInterpreter({
      catalog,
      cacheFile,
      fetchImpl: () => {
        throw Error('Must not call');
      }
    });
    assert.deepEqual(await restored.interpret('forest'), {
      ids: ['tree'],
      cached: true
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test('enforces text, cooldown and session limits before provider calls', async () => {
  let time = 0;
  let calls = 0;
  const adapter = createInterpreter({
    catalog,
    key: 'key',
    now: () => time,
    maxCalls: 2,
    fetchImpl: async () => {
      calls++;
      return response(['sun']);
    }
  });
  await assert.rejects(adapter.interpret('x'.repeat(241)), /240/);
  await adapter.interpret('one');
  await assert.rejects(adapter.interpret('two'), error => error.status === 429);
  time = 6000;
  await adapter.interpret('two');
  time = 12000;
  await assert.rejects(adapter.interpret('three'), error => error.status === 429);
  assert.equal(calls, 2);
});
test('HTTP static boundary, origin, body limit, and text-only payload', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'composer-http-'));
  const publicDir = path.join(dir, 'public');
  await mkdir(publicDir);
  await writeFile(path.join(publicDir, 'index.html'), '<h1>Composer</h1>');
  await writeFile(path.join(dir, '.env'), 'SECRET');
  const server = await createServer({ publicDir, catalog, key: '', cacheFile: undefined });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal((await fetch(base)).status, 200);
    assert.deepEqual(await (await fetch(base + '/api/status')).json(), {
      cohereAvailable: false,
      model: 'command-r7b-12-2024'
    });
    const privatePaths = [
      '/.env',
      '/server/index.mjs',
      '/%2e%2e%5c.env',
      '/%252e%252e/.env'
    ];
    for (const pathname of privatePaths) {
      assert.equal((await fetch(base + pathname)).status, 404);
    }
    const post = (body, origin = base) => fetch(base + '/api/interpret', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: origin },
      body: JSON.stringify(body)
    });
    assert.equal((await post({ text: 'tree' }, 'https://evil.test')).status, 403);
    assert.equal((await post({ text: 'tree', file: 'secret.svg' })).status, 400);
    assert.equal((await post({ text: 'x'.repeat(5000) })).status, 413);
    assert.equal((await post({ text: 'tree' })).status, 503);
  } finally {
    await new Promise(resolve => server.close(resolve));
    await rm(dir, { recursive: true, force: true });
  }
});
