import { useEffect } from "react";
import { useI18n } from "./i18n";

/**
 * Юридические страницы лендинга: политика конфиденциальности и условия
 * использования.
 *
 * Зачем они здесь. Лендинг публично собирает как минимум одно техническое
 * персональное данное — IP-адрес, который видит CDN, и записывает выбор cookie
 * в localStorage устройства. По чек-листу (§4.3) без описания этого запуск
 * публичного сервиса не одобряется. Страницы удалили 2026-10-06 «до
 * юридического ревью» — ревью так и не случилось, а вместо него появился
 * красный комментарий в CI. Теперь текст есть, ссылки на него стоят в
 * футере и в баннере cookie, а сам текст честно перечисляет, что мы НЕ
 * собираем, чтобы его нельзя было потом расширить молча.
 *
 * ГРАНИЦА ОТВЕТСТВЕННОСТИ: это описание фактического поведения кода, а не
 * заключение юриста. Перед приёмом реальных платежей текст обязан пройти
 * ревью (см. docs/LEGAL_REVIEW.md) — и ревью может его изменить.
 *
 * Роутинг. Лендинг — одна страница без роутера, а `_redirects` отдаёт
 * `/index.html` на любой неизвестный путь. Поэтому `/privacy` и `/terms`
 * обслуживает тот же бандл: путь читается из `location.pathname`, ссылки —
 * обычные `<a href>`, кнопка «назад» работает штатно (pushState в начале).
 */

export type LegalPage = "privacy" | "terms";

const LEGAL_TITLE_RU: Record<LegalPage, string> = {
  privacy: "Политика конфиденциальности",
  terms: "Условия использования",
};

/** Путь из адреса; всё неизвестное — лендинг. Работает и с трейлинг-слэшем. */
export function legalPageFromPath(pathname: string): LegalPage | null {
  const normalized = pathname.replace(/\/+$/, "").toLowerCase();
  if (normalized === "/privacy" || normalized.endsWith("/privacy")) return "privacy";
  if (normalized === "/terms" || normalized.endsWith("/terms")) return "terms";
  return null;
}

/** Год для копирайта берётся из даты, а не из литерала в тексте. */
const UPDATED = "2026-11-05";

interface Section {
  readonly heading: string;
  readonly body: readonly string[];
}

function useDocumentTitle(page: LegalPage | null): void {
  useEffect(() => {
    if (!page) return;
    const previous = document.title;
    document.title = `${LEGAL_TITLE_RU[page]} · POTATO ARES-1`;
    return () => {
      document.title = previous;
    };
  }, [page]);
}

function SectionList({ sections }: { sections: readonly Section[] }): JSX.Element {
  return (
    <div className="legal__sections">
      {sections.map((section) => (
        <section key={section.heading} className="legal__section">
          <h2>{section.heading}</h2>
          {section.body.map((paragraph) => (
            <p key={paragraph.slice(0, 40)}>{paragraph}</p>
          ))}
        </section>
      ))}
    </div>
  );
}

function PrivacyContent({ en }: { en: boolean }): JSX.Element {
  if (en) {
    return (
      <SectionList
        sections={[
          {
            heading: "Who we are and what this page covers",
            body: [
              "ARES-1 / POTATO is a browser game with on-chain plots on the Solana test network (devnet). This policy covers the public landing page and the game client; it describes what the code actually does today.",
              "There is no user account, no sign-up form, no newsletter and no support portal on this site. We do not ask for a name, email, phone number, passport data or address.",
            ],
          },
          {
            heading: "What is processed and why",
            body: [
              "Technical request data: the hosting provider and CDN see the request itself — IP address, user agent, requested path, timestamp. This is unavoidable for serving any web page and is used only to deliver the page and to protect the service from abuse (rate limiting, DDoS).",
              "Device-local storage: the cookie choice (categories and its version), the selected interface language, sound and haptics toggles, and a cached address-lookup table for the game. All of it stays in your browser; we cannot read it from the server.",
              "Public blockchain data: your wallet address, your plots and your token balances are public by design. If you connect a wallet, the client reads them from Solana RPC nodes. A wallet connection does not identify you to us.",
            ],
          },
          {
            heading: "Legal basis and retention",
            body: [
              "Technical request data is processed on the basis of our legitimate interest in delivering and protecting the service. Consent-based categories (functional, analytics, marketing) are only activated after you grant them and can be withdrawn at any moment with the same number of clicks.",
              "Hosting logs live for a short retention window configured at the provider; the game keeps no server-side profile of players. Blockchain records are permanent and outside anybody's control — that is a property of the network, not a choice we can revoke.",
            ],
          },
          {
            heading: "What we do not do",
            body: [
              "No analytics, advertising or tracking scripts are installed. No third-party font or script CDNs: fonts are self-hosted. No data is sold or shared with data brokers.",
              "The site honours Global Privacy Control: if your browser sends Sec-GPC: 1, non-essential categories are treated as rejected from the start.",
            ],
          },
          {
            heading: "Your rights",
            body: [
              "Where the GDPR or a similar law applies, you can request access, rectification, erasure, restriction, portability and object to processing. Since we hold no account and no profile, in practice there is nothing to export or delete beyond browser storage, which you control directly (the cookie panel erases it).",
              "Requests about privacy: open a private GitHub Security Advisory in the project repository — the same channel listed in the footer. We answer within a reasonable time.",
            ],
          },
          {
            heading: "Children and changes",
            body: [
              "The game is not directed at children under 13 and no real-money purchase is offered on this site.",
              `Material changes to this policy are published on this page with a new date. Current version: ${UPDATED}.`,
            ],
          },
        ]}
      />
    );
  }
  return (
    <SectionList
      sections={[
        {
          heading: "Кто мы и на что распространяется политика",
          body: [
            "ARES-1 / POTATO — браузерная игра с on-chain-полями в тестовой сети Solana (devnet). Политика распространяется на публичный лендинг и игровой клиент и описывает то, что код делает сегодня.",
            "На сайте нет учётной записи, формы регистрации, рассылки и портала поддержки. Мы не запрашиваем имя, email, телефон, паспортные данные и адрес.",
          ],
        },
        {
          heading: "Что обрабатывается и зачем",
          body: [
            "Технические данные запроса: хостинг и CDN видят сам запрос — IP-адрес, user agent, запрошенный путь, время. Без этого невозможно отдать страницу и защитить сервис от злоупотреблений (ограничение частоты, DDoS).",
            "Локальное хранилище устройства: запись о выборе cookie (категории и версия), выбранный язык интерфейса, переключатели звука и вибрации, кеш таблицы адресов для игры. Всё это остаётся в браузере; сервер эти данные прочитать не может.",
            "Публичные данные блокчейна: адрес кошелька, поля и балансы токенов публичны по своей природе. При подключении кошелька клиент читает их из RPC-узлов Solana. Подключение кошелька не идентифицирует вас для нас.",
          ],
        },
        {
          heading: "Основание и сроки",
          body: [
            "Технические данные запроса обрабатываются на основании законного интереса в доставке и защите сервиса. Категории по согласию (functional, analytics, marketing) включаются только после согласия и отзываются за то же число кликов.",
            "Журналы хостинга хранятся ограниченное время, настроенное у провайдера; серверного профиля игрока игра не ведёт. Записи в блокчейне постоянны и не находятся под чьим-либо контролем — это свойство сети, а не наш выбор, который можно отозвать.",
          ],
        },
        {
          heading: "Чего мы не делаем",
          body: [
            "Ни аналитики, ни рекламных и трекинговых скриптов. Никаких сторонних CDN для шрифтов и скриптов: шрифты раздаются с нашего домена. Данные не продаются и не передаются брокерам данных.",
            "Сайт учитывает Global Privacy Control: если браузер присылает Sec-GPC: 1, необязательные категории считаются отклонёнными с самого начала.",
          ],
        },
        {
          heading: "Ваши права",
          body: [
            "Если применяется GDPR или аналогичный закон, вы можете запросить доступ, исправление, удаление, ограничение обработки, переносимость и возразить против обработки. Поскольку учётной записи и профиля у нас нет, экспортировать или удалять на сервере нечего: всем, что есть, вы управляете прямо в браузере (панель cookie стирает запись).",
            "Обращения по приватности: приватный GitHub Security Advisory в репозитории проекта — тот же канал, что указан в футере. Отвечаем в разумный срок.",
          ],
        },
        {
          heading: "Дети и изменения",
          body: [
            "Игра не адресована детям младше 13 лет, и на сайте не предлагается покупок за реальные деньги.",
            `Существенные изменения политики публикуются на этой странице с новой датой. Текущая версия: ${UPDATED}.`,
          ],
        },
      ]}
    />
  );
}

function TermsContent({ en }: { en: boolean }): JSX.Element {
  if (en) {
    return (
      <SectionList
        sections={[
          {
            heading: "What the product is today",
            body: [
              "The site and the game client run on the Solana test network (devnet) unless the interface explicitly says MAINNET. Devnet SOL and tokens have no monetary value, are not a security or an investment, and devnet progress does not carry over to mainnet.",
              "Only the operations the contract executes are game operations. Plot state, token balances and market orders are read from the chain; the interface does not promise outcomes that the program does not enforce.",
            ],
          },
          {
            heading: "No offer, no financial product",
            body: [
              "Nothing on this site is an offer to sell securities, a promise of income, yield or profit, or investment advice. Text about tokenomics and economy describes game mechanics and draft parameters, not financial returns.",
              "Purchases (SOL presale of plots, SKR licences, colony packages) are closed at the time of publication. When a purchase is opened it is announced separately and executed by a signed transaction you review in your own wallet.",
            ],
          },
          {
            heading: "Your wallet, your responsibility",
            body: [
              "You sign every on-chain action yourself. We never ask for a seed phrase or a private key and will never ask for one in chat, mail or support.",
              "Blockchain transactions are irreversible. If you send tokens to a wrong address or approve a malicious transaction, nobody can reverse it. Check the network, the addresses and the amounts in your wallet before signing.",
            ],
          },
          {
            heading: "Acceptable use",
            body: [
              "Do not attempt to break the service or the contract, exploit bugs for profit, spam the API, or automate account creation to farm rewards. Bugs should be reported through the GitHub Security Advisory channel, not used.",
              "The interface is provided as is, without a warranty of uninterrupted availability. Read-only chain data may be temporarily unavailable; the game fails closed rather than sign an unverified action.",
            ],
          },
          {
            heading: "Colony, SKR and closed features",
            body: [
              "Colony construction, SKR purchases and the presale are closed until a separate launch approval. Closed features are stated as closed in the interface; their absence is not a defect and does not entitle anyone to compensation.",
            ],
          },
          {
            heading: "Changes and applicable rules",
            body: [
              `Terms change together with the product; the current version is dated ${UPDATED} on this page. Continued use after a published change means acceptance of the updated version.`,
              "Nothing in these terms limits rights that mandatory consumer-protection law of your place of residence grants you.",
            ],
          },
        ]}
      />
    );
  }
  return (
    <SectionList
      sections={[
        {
          heading: "Что продукт представляет собой сегодня",
          body: [
            "Сайт и игровой клиент работают в тестовой сети Solana (devnet), если интерфейс явно не говорит MAINNET. Devnet-SOL и токены не имеют денежной стоимости, не являются ценной бумагой или инвестицией, а прогресс в devnet не переносится в mainnet.",
            "Игровыми являются только те операции, которые исполняет контракт. Состояние полей, балансы и ордера читаются из цепи; интерфейс не обещает результатов, которых программа не обеспечивает.",
          ],
        },
        {
          heading: "Не оферта и не финансовый продукт",
          body: [
            "Ничто на сайте не является предложением продажи ценных бумаг, обещанием дохода, доходности или прибыли и инвестиционной рекомендацией. Тексты про токеномику и экономику описывают игровые механики и черновые параметры, а не финансовый результат.",
            "Покупки (SOL-пресейл полей, SKR-лицензии, пакеты колоний) на момент публикации закрыты. Когда покупка открывается, об этом объявляется отдельно, а исполняет её подписанная транзакция, которую вы проверяете в своём кошельке.",
          ],
        },
        {
          heading: "Кошелёк — ваша ответственность",
          body: [
            "Каждое ончейн-действие подписываете вы. Мы никогда не просим seed-фразу или приватный ключ и не будем просить их в чате, почте или поддержке.",
            "Транзакции в блокчейне необратимы. Если вы отправили токены на неверный адрес или одобрили вредоносную транзакцию, отменить это невозможно. Перед подписью проверяйте сеть, адреса и суммы в кошельке.",
          ],
        },
        {
          heading: "Допустимое использование",
          body: [
            "Не пытайтесь ломать сервис или контракт, использовать баги для выгоды, спамить API или автоматизировать создание кошельков ради фарма наград. Об уязвимостях нужно сообщать через GitHub Security Advisory, а не использовать их.",
            "Интерфейс предоставляется «как есть», без гарантии непрерывной доступности. Read-only чтение цепи может быть временно недоступно; игра отказывает (fail-closed), а не подписывает непроверенное действие.",
          ],
        },
        {
          heading: "Колонии, SKR и закрытые функции",
          body: [
            "Строительство колоний, покупки за SKR и пресейл закрыты до отдельного одобрения запуска. Закрытые функции обозначены в интерфейсе как закрытые; их отсутствие не является дефектом и не даёт права на компенсацию.",
          ],
        },
        {
          heading: "Изменения и применимые правила",
          body: [
            `Условия меняются вместе с продуктом; текущая версия датирована на этой странице: ${UPDATED}. Продолжение использования после опубликованного изменения означает принятие новой версии.`,
            "Ничто в этих условиях не ограничивает права, которые даёт вам императивное законодательство о защите прав потребителей по месту вашего жительства.",
          ],
        },
      ]}
    />
  );
}

export function LegalPage({ page }: { page: LegalPage }): JSX.Element {
  const { lang } = useI18n();
  const en = lang === "en";
  useDocumentTitle(page);
  return (
    <main className="legal">
      <div className="container legal__container">
        <a className="legal__back" href="/">← {en ? "Back to the site" : "Вернуться на сайт"}</a>
        <p className="legal__eyebrow">ARES-1 / LEGAL</p>
        <h1 className="legal__title">
          {en
            ? page === "privacy" ? "Privacy policy" : "Terms of use"
            : LEGAL_TITLE_RU[page]}
        </h1>
        <p className="legal__meta">{en ? `Version: ${UPDATED}` : `Версия: ${UPDATED}`}</p>
        <p className="legal__lead">
          {en
            ? "This page describes what the code actually does. It is a factual description, not a legal opinion; a human legal review is still required before any real-money launch (see docs/LEGAL_REVIEW.md in the repository)."
            : "Эта страница описывает то, что делает код. Это фактическое описание, а не юридическое заключение: перед запуском с реальными платежами текст обязан пройти ревью юриста (см. docs/LEGAL_REVIEW.md в репозитории)."}
        </p>
        {page === "privacy" ? <PrivacyContent en={en} /> : <TermsContent en={en} />}
        <div className="legal__footer">
          <a href="/privacy">{en ? "Privacy" : "Конфиденциальность"}</a>
          <span aria-hidden="true">·</span>
          <a href="/terms">{en ? "Terms" : "Условия"}</a>
          <span aria-hidden="true">·</span>
          <a href="/">ARES-1</a>
        </div>
      </div>
    </main>
  );
}

/** Ссылки для футера: один источник путей для футера и юридических страниц. */
export const LEGAL_LINKS = [
  { label: "Политика конфиденциальности", labelEn: "Privacy policy", href: "/privacy" },
  { label: "Условия использования", labelEn: "Terms of use", href: "/terms" },
] as const;

export function LegalNav(): JSX.Element {
  const { lang } = useI18n();
  const en = lang === "en";
  return (
    <nav aria-label={en ? "Legal" : "Правовая информация"} className="footer-legal__links">
      {LEGAL_LINKS.map((link) => (
        <a key={link.href} href={link.href} className="footer-legal__button">
          {en ? link.labelEn : link.label}
        </a>
      ))}
    </nav>
  );
}
