#!/usr/bin/env node
/**
 * Generates the static legal pages under landing/public/legal/.
 *
 * Why generated: six documents in two languages share one layout, one nav and
 * one version stamp. Hand-editing them is how a footer link or a "last
 * updated" date drifts between translations, and a legal document that differs
 * between languages is worse than one that is merely imperfect.
 *
 * Why static HTML at all (rather than SPA routes):
 *   - it must stay readable when the JS bundle fails or is blocked;
 *   - it must be archivable and quotable (a URL that always returns the text);
 *   - a change to the app must not be able to silently change the text a user
 *     consented to. Version and date are part of the document.
 *
 * Usage:
 *   node scripts/build-legal-pages.mjs           # write the files
 *   node scripts/build-legal-pages.mjs --check   # fail if a page is stale
 *
 * After editing, run the script and commit both it and the generated output.
 */

import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'landing', 'public', 'legal');
const CHECK = process.argv.includes('--check');

/** Bump on every substantive change; it is printed on every page. */
const VERSION = '1.0';
const EFFECTIVE_DATE = '2026-09-28';
const REVIEW_DATE = '2027-03-28';

/**
 * Operator details come from scripts/legal-operator.json — one source of truth,
 * no placeholders. A required field that is empty throws at build time, so a
 * document with a blank contact can never be generated, let alone deployed.
 *
 * `discloseIdentity: false` is a deliberate choice by the project owner: the
 * documents then render a contact-only variant instead of naming an entity we
 * do not have. The GDPR art. 13(1)(a) gap this leaves is recorded in
 * docs/PRODUCTION_DEPLOY_CHECKLIST.md (L-01) rather than papered over with a
 * fabricated legal name.
 */
const OPERATOR = JSON.parse(
  readFileSync(join(ROOT, 'scripts', 'legal-operator.json'), 'utf8'),
);

function required(field) {
  const value = OPERATOR[field];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(
      `legal-operator.json: "${field}" is required and must be a non-empty string`,
    );
  }
  return value.trim();
}

function optional(field) {
  const value = OPERATOR[field];
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

const CONTACT_EMAIL = required('contactEmail');
const PRIVACY_EMAIL_ADDR = required('privacyEmail');
const COPYRIGHT_EMAIL_ADDR = required('copyrightEmail');
const LEGAL_NAME = optional('legalName');
const REGISTERED_ADDRESS = optional('registeredAddress');
const GOVERNING_LAW_TEXT = optional('governingLaw');
const DISCLOSE_IDENTITY = OPERATOR.discloseIdentity === true;

if (DISCLOSE_IDENTITY && (!LEGAL_NAME || !REGISTERED_ADDRESS)) {
  throw new Error(
    'legal-operator.json: discloseIdentity=true requires legalName and registeredAddress',
  );
}

const mail = (address) => `<a href="mailto:${address}">${address}</a>`;

/** «Кто оператор» — с реквизитами или в варианте «только контакт». */
function operatorLine(lang) {
  const ru = lang === 'ru';
  if (DISCLOSE_IDENTITY) {
    return ru
      ? `Оператор:&nbsp;${LEGAL_NAME}. Адрес:&nbsp;${REGISTERED_ADDRESS}. Контакт:&nbsp;${mail(CONTACT_EMAIL)}.`
      : `Operator:&nbsp;${LEGAL_NAME}. Address:&nbsp;${REGISTERED_ADDRESS}. Contact:&nbsp;${mail(CONTACT_EMAIL)}.`;
  }
  return ru
    ? `Проект ARES-1 ведёт частная команда разработчиков. Единый канал связи по любым вопросам, ` +
      `включая юридические и запросы о персональных данных:&nbsp;${mail(CONTACT_EMAIL)}. ` +
      `Мы отвечаем с того же адреса и не ведём переписку через посредников.`
    : `ARES-1 is run by a private development team. A single channel handles every enquiry, ` +
      `legal and data-protection requests included:&nbsp;${mail(CONTACT_EMAIL)}. ` +
      `We reply from that same address and use no intermediaries.`;
}

/** Оговорка о применимом праве печатается только если она задана. */
function governingLawSentence(lang) {
  if (!GOVERNING_LAW_TEXT) return '';
  return lang === 'ru'
    ? ` Применимое право:&nbsp;${GOVERNING_LAW_TEXT}.`
    : ` Governing law:&nbsp;${GOVERNING_LAW_TEXT}.`;
}

const NAV = [
  ['privacy.html', 'Конфиденциальность', 'Privacy'],
  ['terms.html', 'Условия', 'Terms'],
  ['cookies.html', 'Cookies', 'Cookies'],
  ['risk.html', 'Риски', 'Risk'],
  ['third-party.html', 'Лицензии', 'Licences'],
  ['dmca.html', 'Жалобы', 'Takedown'],
];

function nav(current) {
  return NAV.map(([href, ru, en]) => {
    const cur = href === current ? ' aria-current="page"' : '';
    return (
      `      <a href="/legal/${href}"${cur}>` +
      `<span data-lang="ru" class="inline">${ru}</span>` +
      `<span data-lang="en" class="inline">${en}</span></a>`
    );
  }).join('\n');
}

function page({ file, titleRu, titleEn, descRu, descEn, bodyRu, bodyEn }) {
  return `<!doctype html>
<html lang="ru">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${titleRu} — ARES-1</title>
    <meta name="description" content="${descEn}" />
    <meta name="robots" content="index, follow" />
    <link rel="stylesheet" href="/legal/legal.css" />
  </head>
  <body data-active-lang="ru">
    <div class="wrap">
      <div class="topbar">
        <span class="brand">ARES-1 · Potato Colony</span>
        <div class="langswitch" role="group" aria-label="Language / Язык">
          <button type="button" data-lang-value="ru" aria-pressed="true">RU</button>
          <button type="button" data-lang-value="en" aria-pressed="false">EN</button>
        </div>
      </div>

      <nav class="docnav" aria-label="Legal documents">
${nav(file)}
      </nav>

      <main>
        <section data-lang="ru">
          <h1>${titleRu}</h1>
          <p class="meta">
            Версия&nbsp;${VERSION} · действует с&nbsp;${EFFECTIVE_DATE} · следующий пересмотр:&nbsp;${REVIEW_DATE}
          </p>
${bodyRu}
        </section>

        <section data-lang="en">
          <h1>${titleEn}</h1>
          <p class="meta">
            Version&nbsp;${VERSION} · effective&nbsp;${EFFECTIVE_DATE} · next review:&nbsp;${REVIEW_DATE}
          </p>
${bodyEn}
        </section>
      </main>

      <footer class="legal-footer">
        <div class="actions">
          <button type="button" class="btn btn--ghost" id="open-cookie-settings">
            <span data-lang="ru" class="inline">Настройки cookies</span>
            <span data-lang="en" class="inline">Cookie settings</span>
          </button>
          <a class="btn btn--ghost" href="/">
            <span data-lang="ru" class="inline">На сайт</span>
            <span data-lang="en" class="inline">Back to site</span>
          </a>
        </div>
        <p>
          <span data-lang="ru" class="inline">ARES-1 · Potato Colony. Документ доступен по этой ссылке постоянно; предыдущие версии хранятся в репозитории проекта.</span>
          <span data-lang="en" class="inline">ARES-1 · Potato Colony. This URL always serves the current version; previous versions are kept in the project repository.</span>
        </p>
      </footer>
    </div>
    <script src="/legal/legal.js" defer></script>
  </body>
</html>
`;
}

// ---------------------------------------------------------------------------
// Document bodies
// ---------------------------------------------------------------------------

const PRIVACY_RU = `
          <p>
            Это политика конфиденциальности проекта ARES-1 (далее&nbsp;— «мы»). Она описывает, какие данные
            мы получаем, зачем, на каком основании, кому передаём и какие у вас есть права.
          </p>

          <h2>1. Кто оператор</h2>
          <p>
            ${operatorLine('ru')}${governingLawSentence('ru')}
          </p>
          <p>
            Отдельный специалист по защите данных (DPO) не назначен: мы не ведём систематического
            мониторинга субъектов в крупном масштабе и не обрабатываем специальные категории данных,
            то есть оснований ст. 37 GDPR для обязательного назначения нет. Все запросы принимает
            тот же адрес:&nbsp;${mail(PRIVACY_EMAIL_ADDR)}.
          </p>
          <p>
            Если вы считаете, что мы обрабатываем ваши данные незаконно, вы вправе подать жалобу
            в надзорный орган по месту вашего жительства, работы или предполагаемого нарушения.
          </p>

          <h2>2. Какие данные мы собираем</h2>
          <table>
            <thead>
              <tr><th>Данные</th><th>Зачем</th><th>Основание</th><th>Срок</th></tr>
            </thead>
            <tbody>
              <tr>
                <td>Публичный адрес кошелька Solana</td>
                <td>Отображение прогресса, начисление наград, связка с реферальным кодом</td>
                <td>Исполнение договора (правила игры)</td>
                <td>Пока активна игра; адрес остаётся в блокчейне навсегда</td>
              </tr>
              <tr>
                <td>IP-адрес и технические логи (user-agent, время запроса)</td>
                <td>Безопасность, защита от ботов и DDoS, диагностика ошибок</td>
                <td>Законный интерес (безопасность сервиса)</td>
                <td>Не более 90 дней</td>
              </tr>
              <tr>
                <td>Язык интерфейса, настройки звука/вибрации/уведомлений</td>
                <td>Сохранение ваших настроек между визитами</td>
                <td>Согласие (функциональное хранение в браузере)</td>
                <td>Пока вы не очистите хранилище браузера</td>
              </tr>
              <tr>
                <td>Реферальный код</td>
                <td>Начисление реферального бонуса</td>
                <td>Исполнение договора</td>
                <td>Срок действия реферальной программы</td>
              </tr>
              <tr>
                <td>Email</td>
                <td>Мы собираем его только если вы сами написали нам или подписались на рассылку</td>
                <td>Согласие</td>
                <td>До отзыва согласия</td>
              </tr>
            </tbody>
          </table>

          <h2>3. Чего мы не делаем</h2>
          <ul>
            <li>Мы <strong>не просим и никогда не будем просить</strong> seed-фразу, приватный ключ или ключ кошелька. Любой, кто просит их «от имени ARES-1»,&nbsp;— мошенник.</li>
            <li>Мы не записываем персональные данные в блокчейн. В блокчейн попадает только то, что необходимо для механики игры (адрес кошелька и игровые действия), и удалить это оттуда невозможно&nbsp;— поэтому мы туда ничего личного не пишем.</li>
            <li>Мы не используем аналитические счётчики и рекламные пиксели на страницах сайта на момент версии ${VERSION}. Если они появятся, загрузка будет происходить только после вашего согласия, а эта политика будет обновлена.</li>
            <li>Мы не передаём ваши данные третьим лицам для их собственного маркетинга.</li>
          </ul>

          <h2>4. Кто обрабатывает данные по нашему поручению</h2>
          <table>
            <thead><tr><th>Роль</th><th>Что делает</th><th>Страна обработки</th></tr></thead>
            <tbody>
              <tr><td>Cloudflare Pages (хостинг и CDN)</td><td>Отдача статических файлов, TLS, защита от DDoS</td><td>Глобальная сеть точек присутствия; ближайшая к вам обслуживает запрос</td></tr>
              <tr><td>RPC-провайдер Solana</td><td>Чтение состояния блокчейна по вашему запросу из браузера</td><td>Глобальная сеть узлов провайдера</td></tr>
              <tr><td>Почтовый провайдер домена</td><td>Приём и отправка писем по адресам из этих документов</td><td>Инфраструктура почтового провайдера</td></tr>
            </tbody>
          </table>
          <p>
            С каждым таким процессором должен быть заключён договор об обработке данных (DPA). Список
            выше ведёт оператор; при смене подрядчика этот раздел обновляется.
          </p>

          <h2>5. Международная передача</h2>
          <p>
            Блокчейн Solana распределён по всему миру, поэтому транзакция технически доступна любому узлу
            сети. Для передач процессорам за пределы ЕЭЗ мы используем стандартные договорные положения
            (SCC) Европейской комиссии либо иное законное основание, предусмотренное главой V GDPR.
          </p>

          <h2>6. Ваши права</h2>
          <p>
            Вы можете запросить доступ к своим данным, их исправление, удаление, ограничение обработки,
            переносимость, а также возразить против обработки. Напишите на ${mail(PRIVACY_EMAIL_ADDR)}.
            Отвечаем в течение одного месяца (по GDPR).
          </p>
          <p>
            Мы обязаны убедиться, что запрос исходит от вас. Для этого мы просим подписать сообщение
            кошельком, указанным при обращении: это подтверждает владение адресом, не раскрывая никаких
            секретов.
          </p>
          <p>
            Обратите внимание: данные, попавшие в блокчейн, удалить технически невозможно. Удаление
            означает удаление из наших систем (база, логи, бэкапы по графику), но не из блокчейна.
          </p>

          <h2>7. Хранение и безопасность</h2>
          <p>
            Данные передаются только по HTTPS. Доступ к системам ограничен по ролям; привилегированные
            ключи не хранятся на сервере сайта. Логи не содержат секретов и очищаются по расписанию.
            О сроках и порядке восстановления см. внутренний регламент оператора.
          </p>

          <h2>8. Утечка данных</h2>
          <p>
            При утечке, способной повлиять на ваши права, мы уведомляем надзорный орган в течение 72 часов
            и вас&nbsp;— если риск высокий. Все инциденты фиксируются во внутреннем журнале.
          </p>

          <h2>9. Изменения</h2>
          <p>
            При существенных изменениях мы обновляем версию и дату в шапке и, где требуется, запрашиваем
            согласие заново. Предыдущие версии доступны в репозитории проекта.
          </p>
`;

const PRIVACY_EN = `
          <p>
            This is the privacy policy of ARES-1 ("we"). It explains what data we receive, why, on what
            legal basis, who we share it with, and what rights you have.
          </p>

          <h2>1. Who is the operator</h2>
          <p>
            ${operatorLine('en')}${governingLawSentence('en')}
          </p>
          <p>
            No separate Data Protection Officer is appointed: we carry out no large-scale systematic
            monitoring of data subjects and process no special categories of data, so none of the
            art. 37 GDPR triggers apply. The same address handles every request:&nbsp;${mail(PRIVACY_EMAIL_ADDR)}.
          </p>
          <p>
            If you believe we process your data unlawfully, you may lodge a complaint with the
            supervisory authority of your place of residence, place of work or of the alleged
            infringement.
          </p>

          <h2>2. What we collect</h2>
          <table>
            <thead>
              <tr><th>Data</th><th>Purpose</th><th>Legal basis</th><th>Retention</th></tr>
            </thead>
            <tbody>
              <tr>
                <td>Public Solana wallet address</td>
                <td>Showing progress, paying rewards, linking a referral code</td>
                <td>Performance of a contract (the game rules)</td>
                <td>While the game is live; the address stays on-chain permanently</td>
              </tr>
              <tr>
                <td>IP address and technical logs (user agent, request time)</td>
                <td>Security, bot and DDoS protection, error diagnosis</td>
                <td>Legitimate interest (service security)</td>
                <td>At most 90 days</td>
              </tr>
              <tr>
                <td>Interface language, sound / haptics / notification settings</td>
                <td>Remembering your preferences between visits</td>
                <td>Consent (functional browser storage)</td>
                <td>Until you clear your browser storage</td>
              </tr>
              <tr>
                <td>Referral code</td>
                <td>Paying the referral bonus</td>
                <td>Performance of a contract</td>
                <td>Life of the referral programme</td>
              </tr>
              <tr>
                <td>Email address</td>
                <td>Only if you contact us or subscribe yourself</td>
                <td>Consent</td>
                <td>Until consent is withdrawn</td>
              </tr>
            </tbody>
          </table>

          <h2>3. What we do not do</h2>
          <ul>
            <li>We <strong>never ask</strong> for your seed phrase, private key or wallet key. Anyone who does "on behalf of ARES-1" is a scammer.</li>
            <li>We do not write personal data on-chain. Only what the game mechanically needs (wallet address and game actions) reaches the blockchain, and it cannot be deleted from there — which is exactly why we keep personal data out of it.</li>
            <li>As of version ${VERSION} there are no analytics or advertising trackers on this site. If any are added, they will load only after consent and this policy will be updated first.</li>
            <li>We do not sell or share your data with third parties for their own marketing.</li>
          </ul>

          <h2>4. Processors acting on our instructions</h2>
          <table>
            <thead><tr><th>Role</th><th>What it does</th><th>Country of processing</th></tr></thead>
            <tbody>
              <tr><td>Cloudflare Pages (hosting and CDN)</td><td>Serving static files, TLS, DDoS protection</td><td>Global edge network; the point of presence nearest to you serves the request</td></tr>
              <tr><td>Solana RPC provider</td><td>Reading chain state for requests your browser makes</td><td>The provider's global node network</td></tr>
              <tr><td>Domain email provider</td><td>Receiving and sending mail at the addresses in these documents</td><td>The email provider's infrastructure</td></tr>
            </tbody>
          </table>
          <p>
            Each processor must be covered by a data processing agreement (DPA). The operator maintains
            the list above; this section is updated whenever a subprocessor changes.
          </p>

          <h2>5. International transfers</h2>
          <p>
            Solana is a globally distributed ledger, so a transaction is technically visible to any node.
            For transfers to processors outside the EEA we rely on Standard Contractual Clauses or another
            lawful mechanism under Chapter V GDPR.
          </p>

          <h2>6. Your rights</h2>
          <p>
            You may request access to your data, rectification, erasure, restriction, portability, and you
            may object to processing. Write to ${mail(PRIVACY_EMAIL_ADDR)}. We reply within one month (GDPR).
          </p>
          <p>
            We must verify that the request is really yours. We ask you to sign a message with the wallet
            mentioned in your request: this proves control of the address without revealing any secret.
          </p>
          <p>
            Note that data written to a blockchain cannot be deleted. Erasure means erasure from our
            systems (database, logs, backups on schedule) — not from the ledger.
          </p>

          <h2>7. Retention and security</h2>
          <p>
            Data is transmitted over HTTPS only. System access is role-limited; privileged keys are not
            stored on the web server. Logs contain no secrets and are rotated on a schedule. Retention and
            restore procedures are defined in the operator's internal runbook.
          </p>

          <h2>8. Data breach</h2>
          <p>
            Where a breach is likely to affect your rights, we notify the supervisory authority within
            72 hours, and notify you where the risk is high. All incidents are recorded in an internal log.
          </p>

          <h2>9. Changes</h2>
          <p>
            Material changes bump the version and date above and, where required, trigger a fresh consent
            request. Previous versions remain available in the project repository.
          </p>
`;

const TERMS_RU = `
          <p>
            Настоящие условия (далее&nbsp;— «Условия») регулируют использование сайта и игры ARES-1.
            Подключая кошелёк или совершая игровое действие, вы принимаете эти Условия.
          </p>

          <h2>1. Оператор и контакт</h2>
          <p>${operatorLine('ru')}${governingLawSentence('ru')}</p>

          <h2>2. Возраст</h2>
          <p>
            Сервис предназначен только для лиц, достигших 18 лет (или возраста совершеннолетия в вашей
            юрисдикции, если он выше). Мы не собираем данные детей сознательно. Если вы узнали, что
            несовершеннолетний использует сервис,&nbsp;— напишите нам.
          </p>

          <h2>3. Что представляет собой игра</h2>
          <p>
            ARES-1&nbsp;— ончейн-игра на Solana. Игровые действия&nbsp;— это транзакции в блокчейне.
            Они <strong>необратимы</strong>: мы не можем отменить, вернуть или «переиграть» подтверждённую
            транзакцию. Комиссии сети (SOL) не возвращаются, даже если действие завершилось ошибкой.
          </p>

          <h2>4. Правила</h2>
          <ul>
            <li>Один человек&nbsp;— один основной аккаунт. Мультиаккаунты для обхода лимитов запрещены.</li>
            <li>Запрещены боты, автоматизация игровых действий, эксплуатация ошибок (включая баги контракта), атаки на инфраструктуру и попытки получить чужие средства.</li>
            <li>Запрещено использование сервиса для отмывания денег, обхода санкций и любой незаконной деятельности.</li>
            <li>Запрещено выдавать себя за проект ARES-1, его команду или официальные каналы.</li>
          </ul>

          <h2>5. Санкции</h2>
          <p>
            За нарушение мы можем ограничить или заблокировать доступ к интерфейсу, аннулировать
            реферальные начисления и удержать награды, полученные с нарушением. Мы не можем изъять
            средства с вашего кошелька и не пытаемся этого делать: блокировка&nbsp;— это отказ в
            обслуживании интерфейса, а не доступ к вашим ключам.
          </p>

          <h2>6. Токен и риски</h2>
          <p>
            $POTATO и SKR&nbsp;— игровые активы. Они волатильны, могут потерять всю стоимость, не являются
            ценной бумагой, банковским вкладом, электронными деньгами или инвестицией. Ничего на сайте не
            является финансовой, юридической или налоговой консультацией и не обещает доход.
            Полный перечень рисков&nbsp;— в <a href="/legal/risk.html">Risk Disclosure</a>.
          </p>

          <h2>7. Контент</h2>
          <p>
            Код, тексты, графика, музыка и звуки проекта принадлежат оператору или лицензированы им
            (см. <a href="/legal/third-party.html">лицензии третьих лиц</a>). Вы не вправе
            использовать материалы проекта без разрешения, за исключением случаев, прямо разрешённых
            законом.
          </p>

          <h2>8. Ответственность</h2>
          <p>
            Сервис предоставляется «как есть». Мы не гарантируем бесперебойную работу и не отвечаем за
            убытки, вызванные действиями третьих лиц (включая кошельки, RPC-провайдеров и сам блокчейн),
            форс-мажорными обстоятельствами или вашими собственными действиями, включая утрату доступа к
            кошельку. Ничто в этих Условиях не ограничивает ответственность, которую нельзя ограничить
            по закону.
          </p>

          <h2>9. Изменения и прекращение</h2>
          <p>
            Мы можем менять правила игры и эти Условия. Существенные изменения публикуются с новой версией
            и датой. Мы можем прекратить работу сервиса; ончейн-состояние при этом остаётся в блокчейне.
          </p>

          <h2>10. Порядок споров</h2>
          <p>
            Сначала&nbsp;— обращение к нам для досудебного урегулирования: напишите на
            ${mail(CONTACT_EMAIL)}, мы отвечаем в течение одного месяца.${governingLawSentence('ru')}
            Отдельной оговорки о применимом праве и подсудности эти Условия не содержат: спор
            разрешается по коллизионным нормам, а императивные права потребителя, предусмотренные
            законом вашей страны, сохраняются в полном объёме и этими Условиями не ограничиваются.
          </p>
`;

const TERMS_EN = `
          <p>
            These Terms govern your use of the ARES-1 site and game. By connecting a wallet or taking any
            in-game action you accept these Terms.
          </p>

          <h2>1. Operator and contact</h2>
          <p>${operatorLine('en')}${governingLawSentence('en')}</p>

          <h2>2. Age</h2>
          <p>
            The service is for people aged 18 or over (or the age of majority in your jurisdiction, if
            higher). We do not knowingly collect children's data. If you learn that a minor is using the
            service, contact us.
          </p>

          <h2>3. What the game is</h2>
          <p>
            ARES-1 is an on-chain game on Solana. Game actions are blockchain transactions. They are
            <strong>irreversible</strong>: we cannot cancel, refund or replay a confirmed transaction.
            Network fees (SOL) are not refunded even when an action fails.
          </p>

          <h2>4. Rules</h2>
          <ul>
            <li>One person, one main account. Multiple accounts created to bypass limits are prohibited.</li>
            <li>Bots, automation of gameplay, exploitation of bugs (including contract bugs), attacks on infrastructure, and attempts to take other players' funds are prohibited.</li>
            <li>Do not use the service for money laundering, sanctions evasion or any unlawful activity.</li>
            <li>Do not impersonate ARES-1, its team or its official channels.</li>
          </ul>

          <h2>5. Enforcement</h2>
          <p>
            For a breach we may restrict or block access to the interface, void referral rewards, and
            withhold rewards obtained in breach. We cannot and will not take funds from your wallet:
            blocking means refusing to serve the interface, not access to your keys.
          </p>

          <h2>6. Tokens and risk</h2>
          <p>
            $POTATO and SKR are in-game assets. They are volatile, can lose all value, and are not a
            security, bank deposit, e-money or investment. Nothing on this site is financial, legal or tax
            advice and nothing promises a return. See the full
            <a href="/legal/risk.html">Risk Disclosure</a>.
          </p>

          <h2>7. Content</h2>
          <p>
            Code, text, artwork, music and sounds belong to the operator or are licensed to it (see
            <a href="/legal/third-party.html">third-party licences</a>). You may not use project material
            without permission, except as expressly allowed by law.
          </p>

          <h2>8. Liability</h2>
          <p>
            The service is provided "as is". We do not guarantee uninterrupted operation and are not
            liable for losses caused by third parties (including wallet apps, RPC providers and the
            blockchain itself), force majeure, or your own actions — including losing access to your
            wallet. Nothing here limits liability that cannot be limited by law.
          </p>

          <h2>9. Changes and termination</h2>
          <p>
            We may change the game rules and these Terms. Material changes are published with a new
            version and date. We may discontinue the service; on-chain state remains on the ledger.
          </p>

          <h2>10. Disputes</h2>
          <p>
            Contact us first so the issue can be resolved without litigation: write to
            ${mail(CONTACT_EMAIL)} and we reply within one month.${governingLawSentence('en')}
            These Terms contain no separate choice-of-law or forum clause: a dispute is decided by the
            applicable conflict-of-laws rules, and the mandatory consumer rights granted by the law of
            your country are preserved in full and are not limited by these Terms.
          </p>
`;

const COOKIES_RU = `
          <p>
            Эта страница описывает, что именно сайт хранит в вашем браузере и зачем. Полная таблица
            находится в разделе 3; управлять выбором можно кнопкой ниже или в футере любой страницы.
          </p>

          <div class="actions">
            <button type="button" class="btn" id="open-cookie-settings">Настроить cookies</button>
          </div>

          <h2>1. Cookies</h2>
          <p>
            На момент версии ${VERSION} сайт <strong>не устанавливает ни одного HTTP-cookie</strong>.
            Если это изменится, таблица ниже и этот раздел будут обновлены до появления cookie.
          </p>

          <h2>2. Локальное хранилище браузера</h2>
          <p>
            Мы используем только <code>localStorage</code> и <code>sessionStorage</code>. Всё, что там
            лежит, остаётся в вашем браузере и не отправляется на сервер автоматически.
          </p>

          <h2>3. Таблица хранилища</h2>
          <table>
            <thead>
              <tr><th>Ключ</th><th>Провайдер</th><th>Назначение</th><th>Срок</th><th>Категория</th></tr>
            </thead>
            <tbody>
              <tr><td><code>ares1.lang</code></td><td>ARES-1</td><td>Выбранный язык интерфейса</td><td>Пока не очистите хранилище</td><td>Строго необходимо / функциональные</td></tr>
              <tr><td><code>ares1.consent.v1</code></td><td>ARES-1</td><td>Ваш выбор по категориям и его версия</td><td>12 месяцев, затем спрашиваем снова</td><td>Строго необходимо</td></tr>
              <tr><td><code>wallet_connected</code></td><td>ARES-1</td><td>Флаг, что кошелёк был подключён (для авто-reconnect)</td><td>Пока не очистите хранилище</td><td>Функциональные</td></tr>
              <tr><td><code>ares-lut:&lt;адрес&gt;</code></td><td>ARES-1</td><td>Кэш адреса lookup-table для удешевления транзакций</td><td>Пока не очистите хранилище</td><td>Функциональные</td></tr>
              <tr><td><code>potato_tutorial_done</code>, <code>potato_landed</code></td><td>ARES-1</td><td>Показан ли обучение и вступительная анимация</td><td>Пока не очистите хранилище</td><td>Функциональные</td></tr>
              <tr><td><code>ares.notifications.*</code>, <code>ares.haptics</code>, <code>ares.music.*</code></td><td>ARES-1</td><td>Настройки уведомлений, вибрации и звука</td><td>Пока не очистите хранилище</td><td>Функциональные</td></tr>
              <tr><td><code>ares.ref.registered</code></td><td>ARES-1</td><td>Отметка, что реферальный код уже зарегистрирован</td><td>Пока не очистите хранилище</td><td>Функциональные</td></tr>
            </tbody>
          </table>

          <h2>4. Согласие</h2>
          <p>
            Строго необходимое и функциональное хранение не требует согласия в значении ePrivacy: без него
            сайт не может работать (язык, подключение кошелька, настройки). Аналитика и маркетинг у нас
            отсутствуют и включаются <strong>только</strong> после явного согласия; по умолчанию они
            выключены, и отказать так же просто, как принять&nbsp;— кнопка «Отклонить» находится на
            первом уровне баннера.
          </p>

          <h2>5. Внешние ресурсы</h2>
          <p>
            Шрифты, иконки, звуки и весь код загружаются с нашего собственного домена. Мы не подключаем
            внешние CDN и не используем сторонние виджеты, поэтому при загрузке страницы ваш IP не
            уходит третьим лицам. Исключение&nbsp;— RPC-провайдер Solana, запросы к которому необходимы
            для чтения состояния игры.
          </p>

          <h2>6. Global Privacy Control</h2>
          <p>
            Мы учитываем сигнал GPC: если браузер его передаёт, необязательные категории считаются
            отклонёнными.
          </p>

          <h2>7. Как удалить</h2>
          <p>
            Настройки браузера&nbsp;→ «Очистить данные сайтов». Это удалит все ключи из таблицы выше;
            после этого сайт снова спросит язык и покажет обучение.
          </p>
`;

const COOKIES_EN = `
          <p>
            This page lists what the site stores in your browser and why. The full table is in section 3;
            you can change your choice with the button below or from the footer of any page.
          </p>

          <div class="actions">
            <button type="button" class="btn" id="open-cookie-settings">Cookie settings</button>
          </div>

          <h2>1. Cookies</h2>
          <p>
            As of version ${VERSION} the site <strong>sets no HTTP cookies at all</strong>. If that
            changes, this section and the table below are updated before the cookie appears.
          </p>

          <h2>2. Browser storage</h2>
          <p>
            We use <code>localStorage</code> and <code>sessionStorage</code> only. Everything there stays
            in your browser and is not sent to a server automatically.
          </p>

          <h2>3. Storage table</h2>
          <table>
            <thead>
              <tr><th>Key</th><th>Provider</th><th>Purpose</th><th>Retention</th><th>Category</th></tr>
            </thead>
            <tbody>
              <tr><td><code>ares1.lang</code></td><td>ARES-1</td><td>Chosen interface language</td><td>Until you clear storage</td><td>Strictly necessary / functional</td></tr>
              <tr><td><code>ares1.consent.v1</code></td><td>ARES-1</td><td>Your per-category choice and its version</td><td>12 months, then we ask again</td><td>Strictly necessary</td></tr>
              <tr><td><code>wallet_connected</code></td><td>ARES-1</td><td>Whether a wallet was connected (auto-reconnect)</td><td>Until you clear storage</td><td>Functional</td></tr>
              <tr><td><code>ares-lut:&lt;address&gt;</code></td><td>ARES-1</td><td>Cached address-lookup table to make transactions cheaper</td><td>Until you clear storage</td><td>Functional</td></tr>
              <tr><td><code>potato_tutorial_done</code>, <code>potato_landed</code></td><td>ARES-1</td><td>Whether the tutorial and intro animation were shown</td><td>Until you clear storage</td><td>Functional</td></tr>
              <tr><td><code>ares.notifications.*</code>, <code>ares.haptics</code>, <code>ares.music.*</code></td><td>ARES-1</td><td>Notification, haptics and sound preferences</td><td>Until you clear storage</td><td>Functional</td></tr>
              <tr><td><code>ares.ref.registered</code></td><td>ARES-1</td><td>Marks that a referral code was already registered</td><td>Until you clear storage</td><td>Functional</td></tr>
            </tbody>
          </table>

          <h2>4. Consent</h2>
          <p>
            Strictly necessary and functional storage does not require consent under ePrivacy: without it
            the site cannot work (language, wallet connection, preferences). Analytics and marketing are
            absent today and would load <strong>only</strong> after explicit consent; they are off by
            default, and rejecting is as easy as accepting — the "Reject" button is on the first level of
            the banner.
          </p>

          <h2>5. External resources</h2>
          <p>
            Fonts, icons, sounds and all code are loaded from our own domain. We use no external CDN and
            no third-party widgets, so loading a page does not disclose your IP to a third party. The one
            exception is the Solana RPC provider, which is needed to read game state.
          </p>

          <h2>6. Global Privacy Control</h2>
          <p>
            We honour GPC: if the browser sends the signal, non-essential categories are treated as
            rejected.
          </p>

          <h2>7. How to delete</h2>
          <p>
            Browser settings → "Clear site data". This removes every key in the table above; afterwards
            the site asks for your language again and shows the tutorial once more.
          </p>
`;

const RISK_RU = `
          <div class="callout">
            Прочитайте это до того, как подключать кошелёк. Ниже&nbsp;— не формальность, а перечень того,
            что реально может пойти не так.
          </div>

          <h2>1. Волатильность</h2>
          <p>
            $POTATO и SKR&nbsp;— игровые токены. У них нет обеспечения, гарантированной ликвидности или
            гарантированной цены. Стоимость может упасть до нуля, в том числе полностью и навсегда.
            Прошлая динамика не предсказывает будущую.
          </p>

          <h2>2. Необратимость</h2>
          <p>
            Транзакции в блокчейне нельзя отменить. Ошибочный перевод, перевод на неверный адрес или
            подписанная вами вредоносная транзакция не могут быть отменены нами или кем-либо ещё.
            Комиссия сети удерживается независимо от результата.
          </p>

          <h2>3. Это не инвестиция</h2>
          <p>
            Покупка игровых предметов или токенов не является инвестицией, вкладом, займом или участием в
            прибыли. Ничего на сайте не обещает доходность и не является финансовой, инвестиционной,
            юридической или налоговой консультацией.
          </p>

          <h2>4. Смарт-контракт</h2>
          <p>
            Игра работает на программе Solana. В программе могут быть ошибки, которые приведут к потере
            средств. Перед работой с реальными суммами требуется независимый аудит контракта; на момент
            версии ${VERSION} проект работает в devnet и не заявляет о готовности к реальным средствам.
            Программа обновляема, пока управление обновлением не передано мультисигу или не отозвано.
          </p>

          <h2>5. Ваш кошелёк — ваша ответственность</h2>
          <p>
            Мы никогда не просим seed-фразу, приватный ключ и не предлагаем «восстановить» или
            «проверить» кошелёк. Подписывайте только те транзакции, суть которых понимаете; перед
            подписью смотрите, что именно и кому вы разрешаете. Потеря доступа к кошельку означает
            безвозвратную потерю средств.
          </p>

          <h2>6. Фишинг и подделки</h2>
          <p>
            Официальный домен&nbsp;— <strong>ares1.is-a.dev</strong> (сайт) и
            <strong>play.ares1.is-a.dev</strong> (игра). Любой другой домен, копирующий дизайн,
            аккаунт в соцсетях или бот, предлагающий «помощь»,&nbsp;— мошенники. Не переходите по ссылкам
            из личных сообщений и комментариев.
          </p>

          <h2>7. Регуляторный риск</h2>
          <p>
            Законодательство о криптоактивах меняется. Доступ к игре в вашей стране может быть ограничен;
            соблюдение местного закона&nbsp;— ваша обязанность. См. раздел «География» в
            <a href="/legal/terms.html">Условиях</a>.
          </p>

          <h2>8. Налоги</h2>
          <p>
            Операции с криптоактивами могут облагаться налогом. Мы не предоставляем налоговых консультаций
            и не подаём отчётность за вас.
          </p>

          <h2>9. Отсутствие страхования</h2>
          <p>
            Средства на кошельке не застрахованы и не защищены системами страхования вкладов или
            компенсационными схемами.
          </p>
`;

const RISK_EN = `
          <div class="callout">
            Read this before connecting a wallet. This is not boilerplate — it is the list of things that
            can genuinely go wrong.
          </div>

          <h2>1. Volatility</h2>
          <p>
            $POTATO and SKR are in-game tokens. They have no backing, no guaranteed liquidity and no
            guaranteed price. Value can fall to zero, permanently. Past behaviour does not predict future
            results.
          </p>

          <h2>2. Irreversibility</h2>
          <p>
            Blockchain transactions cannot be reversed. A mistaken transfer, a transfer to the wrong
            address, or a malicious transaction you signed cannot be undone by us or anyone else. Network
            fees are charged regardless of the outcome.
          </p>

          <h2>3. Not an investment</h2>
          <p>
            Buying in-game items or tokens is not an investment, deposit, loan or profit participation.
            Nothing on this site promises a return and nothing here is financial, investment, legal or tax
            advice.
          </p>

          <h2>4. Smart contract</h2>
          <p>
            The game runs on a Solana program. The program may contain bugs that lead to loss of funds.
            An independent audit is required before real money is involved; as of version ${VERSION} the
            project runs on devnet and does not claim readiness for real funds. The program remains
            upgradeable until upgrade authority is moved to a multisig or revoked.
          </p>

          <h2>5. Your wallet is your responsibility</h2>
          <p>
            We never ask for a seed phrase or private key and never offer to "restore" or "verify" a
            wallet. Sign only transactions you understand; before signing, check what you are approving
            and to whom. Losing access to your wallet means losing the funds permanently.
          </p>

          <h2>6. Phishing and impersonation</h2>
          <p>
            The official domains are <strong>ares1.is-a.dev</strong> (site) and
            <strong>play.ares1.is-a.dev</strong> (game). Any other domain copying the design, any social
            account or bot offering "help", is a scam. Do not follow links from direct messages or
            comments.
          </p>

          <h2>7. Regulatory risk</h2>
          <p>
            Crypto regulation changes. Access to the game may be restricted in your country; complying
            with local law is your responsibility. See "Jurisdictions" in the
            <a href="/legal/terms.html">Terms</a>.
          </p>

          <h2>8. Tax</h2>
          <p>
            Crypto transactions may be taxable. We give no tax advice and file nothing on your behalf.
          </p>

          <h2>9. No insurance</h2>
          <p>
            Wallet funds are not insured and are not covered by deposit insurance or compensation schemes.
          </p>
`;

const THIRD_PARTY_RU = `
          <p>
            Мы используем сторонний код, шрифты и звуки. Ниже&nbsp;— их лицензии и атрибуция
            (чек-лист §7.4). Полный машинночитаемый список зависимостей формируется из lock-файлов
            командой <code>npm ls --json</code>; здесь перечислены материалы, которые попадают в
            распространяемый бандл.
          </p>

          <h2>Шрифты</h2>
          <table>
            <thead><tr><th>Шрифт</th><th>Лицензия</th><th>Источник</th></tr></thead>
            <tbody>
              <tr><td>Inter</td><td>SIL Open Font License 1.1</td><td>@fontsource/inter</td></tr>
              <tr><td>Oswald</td><td>SIL Open Font License 1.1</td><td>@fontsource/oswald</td></tr>
              <tr><td>JetBrains Mono</td><td>SIL Open Font License 1.1</td><td>@fontsource/jetbrains-mono</td></tr>
              <tr><td>Anton</td><td>SIL Open Font License 1.1</td><td>@fontsource/anton</td></tr>
              <tr><td>Archivo Black</td><td>SIL Open Font License 1.1</td><td>@fontsource/archivo-black</td></tr>
              <tr><td>DM Sans</td><td>SIL Open Font License 1.1</td><td>@fontsource/dm-sans</td></tr>
            </tbody>
          </table>

          <h2>Сторонний код (выборочно)</h2>
          <table>
            <thead><tr><th>Пакет</th><th>Лицензия</th><th>Зачем</th></tr></thead>
            <tbody>
              <tr><td>react, react-dom</td><td>MIT</td><td>Интерфейс</td></tr>
              <tr><td>vite, @vitejs/plugin-react, tailwindcss</td><td>MIT</td><td>Сборка и стили</td></tr>
              <tr><td>framer-motion</td><td>MIT</td><td>Анимации</td></tr>
              <tr><td>lucide-react</td><td>ISC</td><td>Иконки</td></tr>
              <tr><td>@solana/web3.js, @solana/spl-token, @solana/wallet-adapter-*</td><td>Apache-2.0 / MIT</td><td>Работа с Solana и кошельками</td></tr>
              <tr><td>@solana/buffer-layout-utils (локальный backport)</td><td>Apache-2.0</td><td>BigInt-разметки</td></tr>
              <tr><td>@coral-xyz/anchor</td><td>Apache-2.0</td><td>Клиент программы</td></tr>
              <tr><td>canvas-confetti</td><td>MIT</td><td>Эффекты</td></tr>
              <tr><td>lenis</td><td>MIT</td><td>Плавный скролл</td></tr>
            </tbody>
          </table>

          <h2>Музыка и звуки</h2>
          <p>
            Файлы в <code>/music/</code> и <code>/sfx/</code> и их лицензии перечислены в
            <code>/music/CREDITS.txt</code>. Фоновый трек «Cipher» (Kevin MacLeod, incompetech.com)
            используется по лицензии Creative Commons Attribution 4.0 International (CC BY 4.0);
            требуемая атрибуция приведена в том же файле и в настройках звука внутри игры.
            Звуковые эффекты в <code>/sfx/</code> сопроводительной лицензионной документации не имеют
            и до её появления считаются непроверенными: правообладатель может потребовать удаления
            через процедуру на странице «Жалобы».
          </p>

          <h2>Репозиторий проекта</h2>
          <p>
            Лицензия исходного кода указана в README и должна быть выбрана осознанно: по умолчанию в
            репозитории указана MIT, что означает разрешение третьим лицам использовать и перепродавать
            код. Если код должен оставаться закрытым, замените её на «All rights reserved» до публикации
            (чек-лист §2.11).
          </p>
`;

const THIRD_PARTY_EN = `
          <p>
            We use third-party code, fonts and sounds. Their licences and attribution are below
            (checklist §7.4). The complete machine-readable dependency list is generated from the
            lockfiles with <code>npm ls --json</code>; this page lists what actually ships in the bundle.
          </p>

          <h2>Fonts</h2>
          <table>
            <thead><tr><th>Font</th><th>Licence</th><th>Source</th></tr></thead>
            <tbody>
              <tr><td>Inter</td><td>SIL Open Font License 1.1</td><td>@fontsource/inter</td></tr>
              <tr><td>Oswald</td><td>SIL Open Font License 1.1</td><td>@fontsource/oswald</td></tr>
              <tr><td>JetBrains Mono</td><td>SIL Open Font License 1.1</td><td>@fontsource/jetbrains-mono</td></tr>
              <tr><td>Anton</td><td>SIL Open Font License 1.1</td><td>@fontsource/anton</td></tr>
              <tr><td>Archivo Black</td><td>SIL Open Font License 1.1</td><td>@fontsource/archivo-black</td></tr>
              <tr><td>DM Sans</td><td>SIL Open Font License 1.1</td><td>@fontsource/dm-sans</td></tr>
            </tbody>
          </table>

          <h2>Third-party code (selected)</h2>
          <table>
            <thead><tr><th>Package</th><th>Licence</th><th>Used for</th></tr></thead>
            <tbody>
              <tr><td>react, react-dom</td><td>MIT</td><td>Interface</td></tr>
              <tr><td>vite, @vitejs/plugin-react, tailwindcss</td><td>MIT</td><td>Build and styling</td></tr>
              <tr><td>framer-motion</td><td>MIT</td><td>Animation</td></tr>
              <tr><td>lucide-react</td><td>ISC</td><td>Icons</td></tr>
              <tr><td>@solana/web3.js, @solana/spl-token, @solana/wallet-adapter-*</td><td>Apache-2.0 / MIT</td><td>Solana and wallet access</td></tr>
              <tr><td>@solana/buffer-layout-utils (local backport)</td><td>Apache-2.0</td><td>BigInt layouts</td></tr>
              <tr><td>@coral-xyz/anchor</td><td>Apache-2.0</td><td>Program client</td></tr>
              <tr><td>canvas-confetti</td><td>MIT</td><td>Effects</td></tr>
              <tr><td>lenis</td><td>MIT</td><td>Smooth scrolling</td></tr>
            </tbody>
          </table>

          <h2>Music and sounds</h2>
          <p>
            Files under <code>/music/</code> and <code>/sfx/</code> and their licences are listed in
            <code>/music/CREDITS.txt</code>. The background track "Cipher" (Kevin MacLeod,
            incompetech.com) is used under the Creative Commons Attribution 4.0 International licence
            (CC BY 4.0); the required attribution is in that file and in the in-game audio settings.
            The sound effects under <code>/sfx/</code> carry no accompanying licence documentation and
            are treated as unverified until it exists: a rights holder may request removal through the
            procedure on the Takedown page.
          </p>

          <h2>Project repository</h2>
          <p>
            The licence for the source code is stated in the README and must be a deliberate choice: the
            repository currently declares MIT, which permits third parties to reuse and resell the code.
            If the code is meant to stay proprietary, replace it with "All rights reserved" before
            publishing (checklist §2.11).
          </p>
`;

const DMCA_RU = `
          <p>
            Если вы считаете, что материалы на сайте нарушают ваши авторские права, направьте уведомление
            (чек-лист §7.5). Мы рассматриваем обращения и удаляем или отключаем доступ к материалу при
            подтверждении нарушения.
          </p>

          <h2>Что указать в уведомлении</h2>
          <ol>
            <li>Ваши контактные данные: имя, адрес, телефон, email.</li>
            <li>Описание произведения, права на которое нарушены, и подтверждение ваших прав (ссылка на публикацию, регистрацию, договор).</li>
            <li>Точный URL материала на нашем сайте.</li>
            <li>Заявление, что вы добросовестно полагаете, что использование не разрешено правообладателем, его агентом или законом.</li>
            <li>Заявление о достоверности сведений и о том, что вы уполномочены действовать от имени правообладателя (под угрозой ответственности за лжесвидетельство, где применимо).</li>
            <li>Подпись (электронная подпись принимается).</li>
          </ol>

          <h2>Куда отправлять</h2>
          <p>${mail(COPYRIGHT_EMAIL_ADDR)} с темой «Copyright complaint».</p>

          <h2>Встречное уведомление</h2>
          <p>
            Если ваш материал был удалён и вы считаете это ошибкой, пришлите встречное уведомление с теми
            же реквизитами, указанием удалённого URL и обоснованием, почему удаление ошибочно.
          </p>

          <h2>Повторные нарушения</h2>
          <p>
            Мы можем прекратить доступ для пользователей, систематически нарушающих права третьих лиц.
          </p>
`;

const DMCA_EN = `
          <p>
            If you believe material on this site infringes your copyright, send a notice (checklist §7.5).
            We review notices and remove or disable access to the material where an infringement is
            established.
          </p>

          <h2>What to include</h2>
          <ol>
            <li>Your contact details: name, address, telephone, email.</li>
            <li>Description of the copyrighted work and evidence of your rights (publication, registration, contract).</li>
            <li>The exact URL of the material on our site.</li>
            <li>A statement that you have a good-faith belief that the use is not authorised by the owner, its agent or the law.</li>
            <li>A statement that the information is accurate and that you are authorised to act for the owner (under penalty of perjury, where applicable).</li>
            <li>A signature (electronic signature accepted).</li>
          </ol>

          <h2>Where to send</h2>
          <p>${mail(COPYRIGHT_EMAIL_ADDR)} with the subject "Copyright complaint".</p>

          <h2>Counter-notice</h2>
          <p>
            If your material was removed and you believe this was a mistake, send a counter-notice with
            the same details, the removed URL and an explanation of why removal was wrong.
          </p>

          <h2>Repeat infringement</h2>
          <p>We may terminate access for users who repeatedly infringe third-party rights.</p>
`;

// ---------------------------------------------------------------------------

const PAGES = [
  {
    file: 'privacy.html',
    titleRu: 'Политика конфиденциальности',
    titleEn: 'Privacy Policy',
    descRu: 'Какие данные собирает ARES-1, зачем и каковы ваши права.',
    descEn: 'What data ARES-1 collects, why, and what rights you have.',
    bodyRu: PRIVACY_RU,
    bodyEn: PRIVACY_EN,
  },
  {
    file: 'terms.html',
    titleRu: 'Пользовательское соглашение',
    titleEn: 'Terms of Service',
    descRu: 'Правила игры ARES-1, возрастные ограничения и ответственность.',
    descEn: 'ARES-1 game rules, age limits and liability.',
    bodyRu: TERMS_RU,
    bodyEn: TERMS_EN,
  },
  {
    file: 'cookies.html',
    titleRu: 'Cookie Policy',
    titleEn: 'Cookie Policy',
    descRu: 'Что ARES-1 хранит в браузере и как этим управлять.',
    descEn: 'What ARES-1 stores in your browser and how to control it.',
    bodyRu: COOKIES_RU,
    bodyEn: COOKIES_EN,
  },
  {
    file: 'risk.html',
    titleRu: 'Раскрытие рисков',
    titleEn: 'Risk Disclosure',
    descRu: 'Риски криптоактивов, блокчейна и смарт-контракта ARES-1.',
    descEn: 'Risks of crypto assets, blockchain and the ARES-1 smart contract.',
    bodyRu: RISK_RU,
    bodyEn: RISK_EN,
  },
  {
    file: 'third-party.html',
    titleRu: 'Лицензии третьих лиц',
    titleEn: 'Third-party licences',
    descRu: 'Лицензии и атрибуция стороннего кода, шрифтов и звуков.',
    descEn: 'Licences and attribution for third-party code, fonts and sounds.',
    bodyRu: THIRD_PARTY_RU,
    bodyEn: THIRD_PARTY_EN,
  },
  {
    file: 'dmca.html',
    titleRu: 'Жалобы на нарушение авторских прав',
    titleEn: 'Copyright complaints',
    descRu: 'Как сообщить о нарушении авторских прав на сайте ARES-1.',
    descEn: 'How to report copyright infringement on ARES-1.',
    bodyRu: DMCA_RU,
    bodyEn: DMCA_EN,
  },
];

if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

/**
 * A placeholder that reaches production is the exact failure this generator
 * exists to prevent, so it is a hard error rather than a lint warning:
 * `span.todo` was the old marker, and bare [BRACKETED CAPS] is how a new one
 * would most likely be written by hand.
 */
function assertNoPlaceholders(file, html) {
  const problems = [];
  if (html.includes('class="todo"')) problems.push('span.todo marker');
  const bracketed = html.match(/\[[A-ZА-Я][A-ZА-Я \/.-]{3,}\]/g);
  if (bracketed) problems.push(`bracketed placeholder(s): ${[...new Set(bracketed)].join(', ')}`);
  if (problems.length) {
    throw new Error(`${file}: ${problems.join('; ')} — fill scripts/legal-operator.json`);
  }
}

let stale = 0;
for (const spec of PAGES) {
  const html = page(spec);
  assertNoPlaceholders(spec.file, html);
  const out = join(OUT_DIR, spec.file);
  if (CHECK) {
    const current = existsSync(out) ? readFileSync(out, 'utf8') : '';
    if (current !== html) {
      console.error(`stale: landing/public/legal/${spec.file} — run node scripts/build-legal-pages.mjs`);
      stale++;
    }
  } else {
    writeFileSync(out, html);
    console.log(`wrote landing/public/legal/${spec.file}`);
  }
}

if (CHECK) {
  process.exit(stale === 0 ? 0 : 1);
}
