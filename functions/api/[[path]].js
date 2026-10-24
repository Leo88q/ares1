/**
 * Cloudflare Pages Function: прокси `/api/*` на бэкенд пресейла.
 *
 * Зачем: лендинг — статика, а форма Фазы 1 ходит в `/api/presale` (резерв
 * заказа, статус тиража, привязка подписи). В проде таких роутов у статики
 * нет: без прокси запросы уходят в никуда и форма молча получает 404 — именно
 * так было до этого файла.
 *
 * Настройка: переменная окружения Pages-проекта (Settings → Environment
 * variables, тип «Plain text»):
 *
 *   PRESALE_API_ORIGIN = https://<адрес бэкенда>
 *
 * без `/api` — префикс пути сохраняется как есть. Пока переменная не задана,
 * функция отвечает 503 с понятным текстом, а не 404 «страница не найдена».
 *
 * Безопасность: проксируются только GET/POST/HEAD/OPTIONS; служебные заголовки
 * Cloudflare и hop-by-hop заголовки не пересылаются; ошибки апстрима не
 * раскрывают внутренний адрес.
 */
const FORWARDED_METHODS = new Set(['GET', 'POST', 'HEAD', 'OPTIONS']);
const STRIP_REQUEST_HEADERS = new Set([
  'host',
  'connection',
  'content-length',
  'transfer-encoding',
  'upgrade',
  'cf-connecting-ip',
  'cf-ipcountry',
  'cf-ray',
  'cf-visitor',
  'cf-worker',
  'x-forwarded-for',
  'x-forwarded-proto',
  'x-real-ip',
]);
const STRIP_RESPONSE_HEADERS = new Set([
  'connection',
  'content-encoding',
  'content-length',
  'transfer-encoding',
  'upgrade',
]);
const TIMEOUT_MS = 15_000;

export async function onRequest(context) {
  const { request, env } = context;
  const origin = String(env?.PRESALE_API_ORIGIN ?? '').trim().replace(/\/+$/, '');

  if (!origin || !/^https?:\/\//i.test(origin)) {
    return json(503, {
      error: 'presale_api_not_configured',
      message: 'PRESALE_API_ORIGIN is not set for this Pages project',
    });
  }
  if (!FORWARDED_METHODS.has(request.method)) {
    return json(405, { error: 'method_not_allowed' });
  }

  const url = new URL(request.url);
  let target;
  try {
    target = new URL(url.pathname + url.search, origin);
  } catch {
    return json(503, {
      error: 'presale_api_not_configured',
      message: 'PRESALE_API_ORIGIN is not a valid http(s) URL',
    });
  }

  const headers = new Headers();
  for (const [name, value] of request.headers) {
    if (!STRIP_REQUEST_HEADERS.has(name.toLowerCase())) headers.set(name, value);
  }

  const init = {
    method: request.method,
    headers,
    redirect: 'manual',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  };
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    init.body = await request.arrayBuffer();
  }

  let upstream;
  try {
    upstream = await fetch(target.toString(), init);
  } catch {
    return json(502, {
      error: 'presale_api_unreachable',
      message: 'Presale API did not answer',
    });
  }

  const responseHeaders = new Headers();
  for (const [name, value] of upstream.headers) {
    if (!STRIP_RESPONSE_HEADERS.has(name.toLowerCase())) responseHeaders.set(name, value);
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    responseHeaders.set('cache-control', 'no-store');
  }

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
}

function json(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}
