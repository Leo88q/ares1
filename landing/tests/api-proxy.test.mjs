// Тесты прокси /api/* для Cloudflare Pages (landing/functions/api/[[path]].js).
//
// Зачем тест: без прокси продовая форма молча получает 404, а прод не
// проверяется из песочницы (нет доступа к Cloudflare). Здесь проверяется сам
// контракт прокси: конфигурация, сохранение пути и query, отказ на лишние
// методы, отсутствие утечки служебных заголовков и внутреннего адреса.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

// Node не любит '[' ']' в спецификаторе импорта, поэтому путь строим как URL.
const { onRequest } = await import(
  new URL('../functions/api/[[path]].js', import.meta.url).href
);

function makeRequest(method, path, init = {}) {
  return new Request(`https://ares1-7e1.pages.dev${path}`, { method, ...init });
}

function withServer(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, origin: `http://127.0.0.1:${port}` });
    });
  });
}

test('без PRESALE_API_ORIGIN отвечает 503, а не 404', async () => {
  const res = await onRequest({ request: makeRequest('GET', '/api/presale/packs'), env: {} });
  assert.equal(res.status, 503);
  const body = await res.json();
  assert.equal(body.error, 'presale_api_not_configured');
});

test('не-http(s) PRESALE_API_ORIGIN считается ошибкой конфигурации', async () => {
  const res = await onRequest({
    request: makeRequest('GET', '/api/presale/packs'),
    env: { PRESALE_API_ORIGIN: 'ftp://example.com' },
  });
  assert.equal(res.status, 503);
});

test('непроксируемый метод отклоняется 405', async () => {
  const res = await onRequest({
    request: makeRequest('DELETE', '/api/presale/packs'),
    env: { PRESALE_API_ORIGIN: 'http://127.0.0.1:9' },
  });
  assert.equal(res.status, 405);
});

test('GET сохраняет путь и query, тело и статус апстрима', async () => {
  const { server, origin } = await withServer((req, res) => {
    res.writeHead(200, {
      'content-type': 'application/json',
      'x-upstream': 'ok',
      connection: 'keep-alive',
    });
    res.end(JSON.stringify({ url: req.url, method: req.method }));
  });
  try {
    const res = await onRequest({
      request: makeRequest('GET', '/api/presale/runs/wave1?x=1'),
      env: { PRESALE_API_ORIGIN: `${origin}/` },
    });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('x-upstream'), 'ok');
    assert.equal(res.headers.get('connection'), null);
    const body = await res.json();
    assert.equal(body.url, '/api/presale/runs/wave1?x=1');
    assert.equal(body.method, 'GET');
  } finally {
    server.close();
  }
});

test('POST доносит тело и требует no-store в ответе', async () => {
  const { server, origin } = await withServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
    });
    req.on('end', () => {
      res.writeHead(201, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ got: JSON.parse(raw) }));
    });
  });
  try {
    const res = await onRequest({
      request: makeRequest('POST', '/api/presale/runs/wave1/reserve', {
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ wallet: 'test' }),
      }),
      env: { PRESALE_API_ORIGIN: origin },
    });
    assert.equal(res.status, 201);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    const body = await res.json();
    assert.deepEqual(body.got, { wallet: 'test' });
  } finally {
    server.close();
  }
});

test('недоступный апстрим — 502 без раскрытия адреса', async () => {
  // Порт 9 (discard) на loopback закрыт: соединение отклоняется.
  const res = await onRequest({
    request: makeRequest('GET', '/api/presale/packs'),
    env: { PRESALE_API_ORIGIN: 'http://127.0.0.1:9' },
  });
  assert.equal(res.status, 502);
  const body = await res.json();
  assert.equal(body.error, 'presale_api_unreachable');
  assert.equal(JSON.stringify(body).includes('127.0.0.1'), false);
});
