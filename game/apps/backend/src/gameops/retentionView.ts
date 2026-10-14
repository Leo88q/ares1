/**
 * Операторский экран метрик удержания: самодостаточный HTML по
 * GET /api/gameops/retention/view.
 *
 * Почему не SPA-роут в web: браузер игрока не должен тащить админ-токен,
 * а выносить дашборд в отдельный билд — дольше, чем он стоит. Страница
 * спрашивает токен один раз (sessionStorage), дальше ходит за JSONом на
 * /retention с Authorization — данные остаются под тем же guard'ом.
 *
 * CSP переопределяется ТОЛЬКО на этом роуте (глобально `default-src 'none'`
 * запрещает inline-скрипт — там он и не нужен, там API).
 */
export const RETENTION_HTML = `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ARES-1 · метрики удержания</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 28px 22px 60px; background: #0d0f12; color: #e8e4da;
         font: 14px/1.45 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
  h1 { font-size: 17px; letter-spacing: .08em; text-transform: uppercase; margin: 0 0 4px; color: #f2b84b; }
  .sub { color: #8b8578; font-size: 12px; margin-bottom: 22px; }
  .row { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; margin-bottom: 18px; }
  input, select, button { background: #171a1f; color: #e8e4da; border: 1px solid #33383f;
         border-radius: 6px; padding: 8px 12px; font: inherit; }
  input { min-width: 280px; }
  button { cursor: pointer; border-color: #f2b84b88; color: #f2b84b; }
  button:hover { background: #f2b84b1a; }
  .banner { padding: 14px 16px; border-radius: 8px; margin-bottom: 18px; border: 1px solid; }
  .banner b { font-size: 15px; letter-spacing: .05em; }
  .build { background: #10331c; border-color: #2e9e57; }
  .hold  { background: #3a2c10; border-color: #c99b2a; }
  .stop  { background: #3a1414; border-color: #c9504a; }
  .insufficient { background: #1b1d21; border-color: #4a505a; color: #9aa0aa; }
  table { border-collapse: collapse; width: 100%; min-width: 720px; }
  th, td { padding: 7px 10px; border-bottom: 1px solid #262a30; text-align: right; white-space: nowrap; }
  th { color: #8b8578; font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: .06em; }
  th:first-child, td:first-child { text-align: left; }
  tr.mature td { color: #e8e4da; } tr.immature td { color: #6a6558; }
  td.miss { color: #555; }
  .kinds { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 18px; }
  .kind { background: #171a1f; border: 1px solid #33383f; border-radius: 999px; padding: 4px 12px; font-size: 12px; }
  .err { color: #e08b84; margin: 10px 0; white-space: pre-wrap; }
  .hint { color: #8b8578; font-size: 12px; margin-top: 26px; max-width: 760px; }
</style>
</head>
<body>
  <h1>Метрики удержания · пилот devnet</h1>
  <div class="sub">когорты по первому дню · D1 = вход на T+1 · D7-окно = вход в T+1…T+7 · порог: ≥15% строим, &lt;8% стоп</div>

  <div class="row">
    <input id="token" type="password" placeholder="ADMIN API TOKEN" autocomplete="off">
    <select id="days">
      <option value="14">14 дней</option>
      <option value="30" selected>30 дней</option>
      <option value="60">60 дней</option>
    </select>
    <button id="go">Обновить</button>
    <span id="stamp" class="sub"></span>
  </div>

  <div id="err" class="err"></div>
  <div id="verdict"></div>
  <div id="table"></div>
  <div id="kinds" class="kinds"></div>

  <div class="hint">
    Вердикт считается по последней ЗРЕЛОЙ когорте с n ≥ 10 (зрелость D7 = когорта старше 7 дней).
    События пишет браузер игрока, подпись не проверяется — это метрики, не деньги; накрутка DAU
    возможна, для пилота100–300 человек приемлемо.
  </div>

<script>
  const \$ = id => document.getElementById(id);
  const saved = sessionStorage.getItem('ares_ops_token');
  if (saved) \$('token').value = saved;
  const pct = (r, n) => (r === null || r === undefined || !n) ? '—' : (100 * r / n).toFixed(1) + '%';
  const frac = (r, n) => (r === null || r === undefined) ? '—' : r + '/' + n;

  async function load() {
    const token = \$('token').value.trim();
    $('err').textContent = ''; $('verdict').innerHTML = ''; $('table').innerHTML = ''; $('kinds').innerHTML = '';
    if (!token) { $('err').textContent = 'Введите admin token.'; return; }
    sessionStorage.setItem('ares_ops_token', token);
    let res;
    try {
      res = await fetch('/api/gameops/retention?days=' + encodeURIComponent($('days').value),
        { headers: { Authorization: 'Bearer ' + token } });
    } catch (e) { $('err').textContent = 'Сеть: ' + e; return; }
    if (!res.ok) {
      let msg = res.status + '';
      try { msg += ' ' + (await res.json()).message; } catch {}
      $('err').textContent = 'Ответ ' + msg; return;
    }
    const rep = await res.json();
    $('stamp').textContent = 'на ' + rep.generatedAt;

    const d = rep.decision;
    const cls = d.verdict;
    const title = { build: 'СТРОИМ', hold: 'ДОБИРАЕМ ДАННЫХ', stop: 'СТОП', insufficient: 'НЕТ ДАННЫХ' }[d.verdict] || d.verdict;
    const val = d.value === null ? '' : ' · D7-окно ' + (100 * d.value).toFixed(1) + '%';
    $('verdict').innerHTML =
      '<div class="banner ' + cls + '"><b>ВЕРДИКТ: ' + title + '</b>' + val +
      '<div style="margin-top:6px">' + (d.basis || '') + '</div></div>';

    const rows = rep.cohorts.slice().reverse().map(c =>
      '<tr class="' + (c.d7Mature ? 'mature' : 'immature') + '">' +
      '<td>' + c.day + (c.d1Mature ? '' : ' <span title="когорта ещё молодая">·</span>') + '</td>' +
      '<td>' + c.newPlayers + '</td><td>' + c.dauPlayers + '</td><td>' + c.events + '</td>' +
      '<td>' + frac(c.d1Returned, c.newPlayers) + '</td><td>' + pct(c.d1Returned, c.newPlayers) + '</td>' +
      '<td>' + frac(c.d7WindowReturned, c.newPlayers) + '</td><td>' + pct(c.d7WindowReturned, c.newPlayers) + '</td>' +
      '<td>' + pct(c.d7Returned, c.newPlayers) + '</td></tr>');
    $('table').innerHTML = '<table><thead><tr>' +
      '<th>Когорта</th><th>Новых</th><th>DAU</th><th>Событ.</th>' +
      '<th>D1 n</th><th>D1 %</th><th>D7-окно n</th><th>D7-окно %</th><th>D7-день %</th>' +
      '</tr></thead><tbody>' + rows.join('') + '</tbody></table>' +
      '<div class="sub">белые строки — зрелые когорты (в них принимается вердикт)</div>';

    $('kinds').innerHTML = Object.entries(rep.byEvent || {})
      .sort((a, b) => b[1] - a[1])
      .map(([k, n]) => '<span class="kind">' + k + ' · ' + n + '</span>').join('');
  }

  $('go').addEventListener('click', load);
  $('token').addEventListener('keydown', e => { if (e.key === 'Enter') load(); });
  if (saved) load();
</script>
</body>
</html>`;
