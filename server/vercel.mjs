import { readFile } from 'node:fs/promises';
import { createInterpreter, PublicError } from './interpret.mjs';

const BODY_LIMIT = 4096;
let handlersPromise;

function sendJson(response, status, value) {
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.statusCode = status;
  response.end(JSON.stringify(value));
}

function isSameOrigin(request) {
  try {
    const origin = new URL(request.headers.origin);
    return ['http:', 'https:'].includes(origin.protocol)
      && origin.origin === request.headers.origin
      && origin.host === request.headers.host;
  } catch {
    return false;
  }
}

async function readPayload(request) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers['content-type'] || '')) {
    throw new PublicError('Требуется JSON.', 415);
  }

  // Vercel may parse JSON before calling the handler; local HTTP tests use a stream.
  let raw;
  if (request.body !== undefined) {
    raw = typeof request.body === 'string'
      ? request.body
      : Buffer.isBuffer(request.body)
        ? request.body.toString('utf8')
        : JSON.stringify(request.body);
  } else {
    const chunks = [];
    let size = 0;
    for await (const chunk of request) {
      const buffer = Buffer.from(chunk);
      size += buffer.length;
      if (size > BODY_LIMIT) {
        throw new PublicError('Запрос слишком большой.', 413);
      }
      chunks.push(buffer);
    }
    raw = Buffer.concat(chunks).toString('utf8');
  }
  if (Buffer.byteLength(raw, 'utf8') > BODY_LIMIT) {
    throw new PublicError('Запрос слишком большой.', 413);
  }

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    throw new PublicError('Некорректный JSON.');
  }
  if (!payload || Array.isArray(payload) || typeof payload !== 'object'
    || Object.keys(payload).some(key => key !== 'text')) {
    throw new PublicError('Допустимо только поле text.');
  }
  return payload;
}

export function createVercelHandlers(options) {
  // A warm function instance reuses its in-memory cache and call budget.
  // No writes to the deployment filesystem or external storage are needed.
  const adapter = createInterpreter({ ...options, cacheFile: undefined });

  return {
    status(request, response) {
      if (request.method !== 'GET') {
        response.setHeader('Allow', 'GET');
        return sendJson(response, 405, { error: 'Метод не поддерживается.' });
      }
      return sendJson(response, 200, adapter.status);
    },

    async interpret(request, response) {
      try {
        if (request.method !== 'POST') {
          response.setHeader('Allow', 'POST');
          return sendJson(response, 405, { error: 'Метод не поддерживается.' });
        }
        if (!isSameOrigin(request)) {
          throw new PublicError('Недопустимый источник запроса.', 403);
        }
        const payload = await readPayload(request);
        return sendJson(response, 200, await adapter.interpret(payload.text));
      } catch (error) {
        const status = error instanceof PublicError ? error.status : 500;
        const message = error instanceof PublicError
          ? error.message
          : 'Не удалось выполнить запрос.';
        return sendJson(response, status, { error: message });
      }
    },
  };
}

export function getHandlers() {
  if (!handlersPromise) {
    handlersPromise = readFile(new URL('../public/assets/catalog.json', import.meta.url), 'utf8')
      .then(raw => createVercelHandlers({
        catalog: JSON.parse(raw),
        key: process.env.COHERE_TRIAL_KEY || '',
        model: process.env.COHERE_MODEL || 'command-r7b-12-2024',
      }))
      .catch(error => {
        handlersPromise = undefined;
        throw error;
      });
  }
  return handlersPromise;
}
