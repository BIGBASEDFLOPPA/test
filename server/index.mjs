import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile, realpath, stat } from 'node:fs/promises';
import { createInterpreter, PublicError } from './interpret.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

function sendJson(res, status, value) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(JSON.stringify(value));
}

export async function createServer({
  publicDir = path.join(root, 'public'),
  catalog,
  key = process.env.COHERE_TRIAL_KEY || '',
  model = process.env.COHERE_MODEL || 'command-r7b-12-2024',
  cacheFile = path.join(root, '.cache/interpret.json'),
  fetchImpl,
  ...options
} = {}) {
  catalog ??= JSON.parse(await readFile(path.join(publicDir, 'assets/catalog.json'), 'utf8'));
  const adapter = createInterpreter({ catalog, key, model, cacheFile, fetchImpl, ...options });
  const publicRoot = await realpath(publicDir);
  const inside = target => target.startsWith(publicRoot + path.sep);
  const server = http.createServer(async (req, res) => {
    const json = (status, value) => sendJson(res, status, value);
    try {
      const pathname = decodeURIComponent((req.url || '/').split('?')[0]);
      if (req.method === 'GET' && pathname === '/api/status') {
        return json(200, adapter.status);
      }
      if (req.method === 'POST' && pathname === '/api/interpret') {
        const port = server.address().port;
        const origins = [`http://127.0.0.1:${port}`, `http://localhost:${port}`];
        if (!origins.includes(req.headers.origin)) {
          throw new PublicError('Недопустимый источник запроса.', 403);
        }
        if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) {
          throw new PublicError('Требуется JSON.', 415);
        }
        const chunks = [];
        let size = 0;
        for await (const chunk of req) {
          size += chunk.length;
          if (size > 4096) {
            throw new PublicError('Запрос слишком большой.', 413);
          }
          chunks.push(chunk);
        }
        let payload;
        try {
          payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        } catch {
          throw new PublicError('Некорректный JSON.');
        }
        if (!payload || Array.isArray(payload) || typeof payload !== 'object'
          || Object.keys(payload).some(key => key !== 'text')) {
          throw new PublicError('Допустимо только поле text.');
        }
        return json(200, await adapter.interpret(payload.text));
      }
      if (!['GET', 'HEAD'].includes(req.method)) {
        return json(405, { error: 'Метод не поддерживается.' });
      }
      if (pathname.includes('\\') || pathname.includes('\0')
        || pathname.split('/').some(part => part.startsWith('.') || part === '..')) {
        return json(404, { error: 'Не найдено.' });
      }
      const target = path.resolve(publicRoot, '.' + (pathname === '/' ? '/index.html' : pathname));
      if (!inside(target)) {
        return json(404, { error: 'Не найдено.' });
      }
      const resolved = await realpath(target);
      if (!inside(resolved) || !(await stat(resolved)).isFile()) {
        return json(404, { error: 'Не найдено.' });
      }
      const data = await readFile(resolved);
      res.writeHead(200, {
        'Content-Type': mime[path.extname(resolved)] || 'application/octet-stream',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'self'; img-src 'self' blob: data:; "
          + "style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'none'"
      });
      res.end(req.method === 'HEAD' ? undefined : data);
    } catch (error) {
      const status = error instanceof PublicError
        ? error.status
        : error.code === 'ENOENT' || error instanceof URIError ? 404 : 500;
      const message = error instanceof PublicError
        ? error.message
        : 'Не удалось выполнить запрос.';
      json(status, { error: message });
    }
  });
  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.loadEnvFile(path.join(root, '.env'));
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.error('Не удалось загрузить настройки .env.');
    }
  }
  const port = Number(process.env.PORT || 4173);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('Invalid PORT');
  }
  const server = await createServer();
  server.listen(port, '127.0.0.1', () => console.log(`SVG Composer: http://127.0.0.1:${port}`));
}
