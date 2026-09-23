#!/usr/bin/env node
/**
 * One-shot audit text corrections (F-03 / F-05 / F-06).
 * Rewrites Russian source keys AND all locale values in:
 *   - game/apps/web/src/i18n/strings/*.ts  (+ component t() usages)
 *   - landing/i18n/strings/*.ts + landing/content.ts + landing/App.tsx usage
 * Every expected replacement must match exactly once per file, else exit 1.
 * Idempotency: a second run exits 0 having found nothing to do (reports "already").
 */
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
let failures = [];
let applied = 0;

function mustReplace(file, oldStr, newStr, label) {
  const abs = path.join(root, file);
  if (!fs.existsSync(abs)) {
    failures.push(`${label}: file missing: ${file}`);
    return;
  }
  const src = fs.readFileSync(abs, "utf8");
  if (!src.includes(oldStr)) {
    if (src.includes(newStr)) return; // already applied
    failures.push(`${label}: old text not found in ${file}: ${oldStr.slice(0, 80)}…`);
    return;
  }
  const next = src.split(oldStr).join(newStr);
  if (next === src) {
    failures.push(`${label}: no-op replace in ${file}`);
    return;
  }
  fs.writeFileSync(abs, next);
  applied++;
}

// ─── GAME WEB: i18n keys (RU key + value per locale) ───
const gameLocales = ["en", "es-419", "id", "pt-BR", "tl", "vi"];

// F-05 buyback → team treasury
const g1OldKey = "80% SKR → казна · 20% → buyback & burn POTATO";
const g1NewKey = "80% SKR → казна · 20% → казна команды";
const g1Vals = {
  en: "80% SKR → treasury · 20% → team treasury",
  "es-419": "80% SKR → tesorería · 20% → tesorería del equipo",
  id: "80% SKR → bendahara · 20% → bendahara tim",
  "pt-BR": "80% SKR → tesouraria · 20% → tesouraria da equipe",
  tl: "80% SKR → tesoreriya · 20% → tesoreriya ng team",
  vi: "80% SKR → kho bạc · 20% → kho bạc của đội",
};
// current en value (old) per locale — used to locate the line, then whole key:value is rebuilt
const g1OldVals = {
  en: "80% SKR → treasury · 20% → POTATO buyback & burn",
  "es-419": "80% SKR → tesorería · 20% → recompra y burn de POTATO",
  id: "80% SKR → bendahara · 20% → buyback & burn POTATO",
  "pt-BR": "80% SKR → tesouraria · 20% → buyback & burn de POTATO",
  tl: "80% SKR → tesoreriya · 20% → buyback & burn ng POTATO",
  vi: "80% SKR → kho bạc · 20% → mua lại & burn POTATO",
};

// F-06 emission ("100% to players / team doesn't mint" → real emission sources)
const g2OldKey =
  "Картошка = $POTATO. Всё через кошелёк, без посредников. 100% токена рождается в руках игроков — команда не майнит.";
const g2NewKey =
  "Картошка = $POTATO. Эмиссия — урожаи игроков, награды квестов и ½ налога маркета в казну; команда не продаёт токен отдельно.";
const g2Vals = {
  en: "Potato = $POTATO. Emission is player harvests, quest rewards and half the market tax to the treasury; the team does not sell tokens separately.",
  "es-419": "Papa = $POTATO. La emisión son las cosechas de los jugadores, las recompensas de misiones y la mitad del impuesto del mercado a la tesorería; el equipo no vende tokens aparte.",
  id: "Kentang = $POTATO. Emisi berasal dari panen pemain, hadiah misi, dan setengah pajak pasar ke bendahara; tim tidak menjual token terpisah.",
  "pt-BR": "Batata = $POTATO. A emissão vem das colheitas dos jogadores, recompensas de missões e metade do imposto do mercado para o tesouro; a equipe não vende tokens à parte.",
  tl: "Kamote = $POTATO. Ang emission ay ani ng mga player, gantimpala ng misyon, at kalahati ng buwis sa merkado sa treasury; hindi nagbebenta ng hiwalay na token ang team.",
  vi: "Khoai tây = $POTATO. Phát hành đến từ mùa thu hoạch của người chơi, phần thưởng nhiệm vụ và một nửa thuế thị trường vào kho bạc; đội không bán token riêng.",
};
const g2OldVals = {
  en: "Potato = $POTATO. Everything goes through your wallet, no middlemen. 100% of the token is minted into players’ hands — the team doesn’t mine.",
  "es-419": "Papa = $POTATO. Todo pasa por tu billetera, sin intermediarios. El 100% del token nace en manos de los jugadores — el equipo no minea.",
  id: "Kentang = $POTATO. Semua lewat dompetmu, tanpa perantara. 100% token lahir di tangan pemain — tim tidak menambang.",
  "pt-BR": "Batata = $POTATO. Tudo pela sua carteira, sem intermediários. 100% do token nasce nas mãos dos jogadores — a equipe não minera.",
  tl: "Kamote = $POTATO. Lahat ay pamamagitan ng wallet, walang intermediary. 100% ng token ay ipinagmamay-ari ng mga player — hindi na-mining ng team.",
  vi: "Khoai tây = $POTATO. Mọi thứ qua ví, không trung gian. 100% token ra đời trong tay người chơi — đội ngũ không đào token.",
};

// F-06 tax penalty −15% → −50% (code truth)
const g3OldKey =
  "Неуплаченный налог = −15% к урожаю. Лицензия 500 SKR / 30 дней → −3% комиссии рынка. Покупка в КАЮТЕ.";
const g3NewKey =
  "Неуплаченный налог = −50% к урожаю. Лицензия 500 SKR / 30 дней → −3% комиссии рынка. Покупка в КАЮТЕ.";
const g3Vals = {
  en: "Unpaid tax = −50% to the harvest. A license (500 SKR / 30 days) gives −3% on the market fee. Buy it in the CABIN.",
  "es-419": "Tasa no pagada = −50% a la cosecha. La licencia (500 SKR / 30 días) da −3% en la comisión del mercado. Se compra en la CABINA.",
  id: "Pajak belum bayar = −50% panen. Lisensi 500 SKR / 30 hari → −3% komisi pasar. Beli di KABIN.",
  "pt-BR": "Taxa não paga = −50% na colheita. Licença (500 SKR / 30 dias) dá −3% na comissão do mercado. Compre na CABINE.",
  tl: "Hindi binabayaran ang buwis = −50% sa ani. Lisensya 500 SKR / 30 araw → −3% sa commission ng merkado. Bilhin sa KABIN.",
  vi: "Chưa đóng thuế = −50% thu hoạch. Giấy phép 500 SKR / 30 ngày → giảm −3% phí thị trường. Mua trong KABIN.",
};
const g3OldVals = {
  en: "Unpaid tax = −15% to the harvest. A license (500 SKR / 30 days) gives −3% on the market fee. Buy it in the CABIN.",
  "es-419": "Tasa no pagada = −15% a la cosecha. La licencia (500 SKR / 30 días) da −3% en la comisión del mercado. Se compra en la CABINA.",
  id: "Pajak belum bayar = −15% panen. Lisensi 500 SKR / 30 hari → −3% komisi pasar. Beli di KABIN.",
  "pt-BR": "Taxa não paga = −15% na colheita. Licença (500 SKR / 30 dias) dá −3% na comissão do mercado. Compre na CABINE.",
  tl: "Hindi binabayaran ang buwis = −15% sa ani. Lisensya 500 SKR / 30 araw → −3% sa commission ng merkado. Bilhin sa KABIN.",
  vi: "Chưa đóng thuế = −15% thu hoạch. Giấy phép 500 SKR / 30 ngày → giảm −3% phí thị trường. Mua trong KABIN.",
};

// F-06 referral wording: −1% goes to the SELLER (funded from the fee), referrer +0.5%
const g4OldKey = "Приглашённому −1 % комиссии за сделки, тебе — 0.5 % от суммы каждой его сделки (on-chain)";
const g4NewKey = "Продавцу −1 % от сделки, когда покупатель пришёл по ссылке; рефереру — 0.5 % от суммы каждой такой сделки (on-chain)";
const g4Vals = {
  en: "The seller gets −1% of the trade when the buyer came via the link; the referrer gets 0.5% of each such trade (on-chain)",
  "es-419": "El vendedor recibe −1% de la operación cuando el comprador vino por el enlace; el referidor recibe 0.5% de cada operación así (on-chain)",
  id: "Penjual mendapat −1% dari transaksi saat pembeli datang dari tautan; referrer mendapat 0.5% dari setiap transaksi seperti itu (on-chain)",
  "pt-BR": "O vendedor ganha −1% da negociação quando o comprador veio pelo link; o referenciador ganha 0,5% de cada negociação assim (on-chain)",
  tl: "Ang nagbenta ay may −1% sa trade kapag ang bumili ay galing sa link; ang referrer ay may 0.5% sa bawat ganoong trade (on-chain)",
  vi: "Người bán được −1% của giao dịch khi người mua đến qua liên kết; người giới thiệu được 0.5% mỗi giao dịch như vậy (on-chain)",
};
const g4OldVals = {
  en: "The invitee gets −1% on transaction fees, you get 0.5% of each of their trades (on-chain)",
  "es-419": "El invitado tiene −1% en la comisión de sus trades, tú recibes 0.5% de cada uno (on-chain)",
  id: "Yang diundang dapat −1% komisi transaksi, kamu dapat 0.5% dari setiap transaksinya (on-chain)",
  "pt-BR": "O convidado tem −1% na comissão das transações, você ganha 0,5% de cada negociação dele (on-chain)",
  tl: "May −1% discount sa commission ng tinawag, ikaw ay may 0.5% sa bawat transaksyon nito (on-chain)",
  vi: "Người được mời giảm −1% phí giao dịch, bạn nhận 0.5% giá trị mỗi giao dịch của họ (on-chain)",
};

const g5OldKey = "Скидка приглашённому: −1 % на покупках маркета, в каждой";
const g5NewKey = "−1 % продавцу на сделках приглашённого — на каждой покупке";
const g5Vals = {
  en: "−1% to the seller on the invitee’s trades — on every purchase",
  "es-419": "−1% al vendedor en las operaciones del invitado — en cada compra",
  id: "−1% ke penjual pada transaksi tamu undangan — di setiap pembelian",
  "pt-BR": "−1% ao vendedor nas negociações do convidado — em cada compra",
  tl: "−1% sa nagbenta sa mga trade ng imbitado — sa bawat bili",
  vi: "−1% cho người bán trong giao dịch của khách được mời — ở mỗi lần mua",
};
const g5OldVals = {
  en: "Discount for the invitee: −1% on market purchases, on each one",
  "es-419": "Descuento para el invitado: −1% en las compras del mercado, en cada una",
  id: "Diskon untuk yang diundang: −1% di setiap pembelian pasar",
  "pt-BR": "Desconto para o convidado: −1% nas compras do mercado, em cada uma",
  tl: "Discount para sa tinawag: −1% sa bawat pagbili sa merkado",
  vi: "Giảm giá cho người được mời: −1% mỗi lần mua trên thị trường",
};

const g6OldKey = "Ссылка в КАЮТЕ. Тебе и другу −1% комиссии. Рефереру +0.5% от каждой сделки приглашённого.";
const g6NewKey = "Ссылка в КАЮТЕ. Продавцу −1% от сделки, если покупатель пришёл по ссылке; рефереру +0.5% от каждой его сделки.";
const g6Vals = {
  en: "The link is in the CABIN. The seller gets −1% of a trade when the buyer came via the link; the referrer gets +0.5% of each of their trades.",
  "es-419": "El enlace está en la CABINA. El vendedor recibe −1% de una operación si el comprador vino por el enlace; el referidor recibe +0.5% de cada operación suya.",
  id: "Tautan ada di KABIN. Penjual mendapat −1% dari transaksi jika pembeli datang dari tautan; referrer mendapat +0.5% dari setiap transaksinya.",
  "pt-BR": "O link está na CABINE. O vendedor ganha −1% de uma negociação se o comprador veio pelo link; o referenciador ganha +0,5% de cada negociação dele.",
  tl: "Nasa KABIN ang link. Ang nagbenta ay may −1% sa trade kung ang bumili ay galing sa link; ang referrer ay +0.5% sa bawat trade niya.",
  vi: "Liên kết ở BUỒNG. Người bán được −1% của giao dịch nếu người mua đến qua liên kết; người giới thiệu được +0.5% mỗi giao dịch của họ.",
};
const g6OldVals = {
  en: "The link is in the CABIN. You and your friend get −1% on the fee. The referrer gets +0.5% of each of the invitee’s trades.",
  "es-419": "El enlace está en la CABINA. Tú y tu amigo tienen −1% en la comisión. El referidor recibe +0.5% de cada trade del invitado.",
  id: "Tautan ada di KABIN. Kamu dan temanmu dapat −1% komisi. Referrer dapat +0.5% dari setiap transaksi yang diundang.",
  "pt-BR": "O link está na CABINE. Você e seu amigo têm −1% na comissão. O referenciador ganha +0,5% de cada negociação do convidado.",
  tl: "Nasa KABIN ang link. Ikaw at ang kaibigan mo ay −1% sa commission. Ang referrer ay +0.5% sa bawat transaksyon ng tinawag.",
  vi: "Link nằm trong KABIN. Bạn và bạn bè giảm −1% phí. Người giới thiệu nhận +0.5% mỗi giao dịch của người được mời.",
};

const gameKeys = [
  [g1OldKey, g1NewKey, g1OldVals, g1Vals, "F-05 buyback"],
  [g2OldKey, g2NewKey, g2OldVals, g2Vals, "F-06 emission"],
  [g3OldKey, g3NewKey, g3OldVals, g3Vals, "F-06 tax-50"],
  [g4OldKey, g4NewKey, g4OldVals, g4Vals, "F-06 referral-a"],
  [g5OldKey, g5NewKey, g5OldVals, g5Vals, "F-06 referral-b"],
  [g6OldKey, g6NewKey, g6OldVals, g6Vals, "F-06 referral-c"],
];

for (const lang of gameLocales) {
  const file = `game/apps/web/src/i18n/strings/${lang}.ts`;
  for (const [oldKey, newKey, oldVals, newVals, label] of gameKeys) {
    const oldLine = `  '${oldKey}': '${oldVals[lang]}',`;
    const newLine = `  '${newKey}': '${newVals[lang]}',`;
    mustReplace(file, oldLine, newLine, `${label}/${lang}`);
  }
}

// component usages (RU keys inside t())
const usages = [
  [
    "game/apps/web/src/components/PresaleSection.tsx",
    `t('${g1OldKey}')`,
    `t('${g1NewKey}')`,
    "F-05 usage",
  ],
  [
    "game/apps/web/src/components/InteractiveTutorial.tsx",
    `t('${g2OldKey}')`,
    `t('${g2NewKey}')`,
    "F-06 emission usage",
  ],
  [
    "game/apps/web/src/components/InteractiveTutorial.tsx",
    `t('${g3OldKey}')`,
    `t('${g3NewKey}')`,
    "F-06 tax usage",
  ],
  [
    "game/apps/web/src/components/InteractiveTutorial.tsx",
    `t('${g6OldKey}')`,
    `t('${g6NewKey}')`,
    "F-06 referral-c usage",
  ],
  [
    "game/apps/web/src/components/ReferralSection.tsx",
    `t('${g4OldKey}')`,
    `t('${g4NewKey}')`,
    "F-06 referral-a usage",
  ],
  [
    "game/apps/web/src/components/ReferralSection.tsx",
    `t('${g5OldKey}')`,
    `t('${g5NewKey}')`,
    "F-06 referral-b usage",
  ],
];
for (const [file, oldStr, newStr, label] of usages) {
  mustReplace(file, oldStr, newStr, label);
}

// ─── LANDING ───
const landingLocales = ["en", "es-419", "id", "pt-BR", "tl", "vi"];

// price label (lowercase key used in App.tsx t(); uppercase in content price field)
const l0 = [
  [
    "  '0.25 SOL · 1 053 SKR / модуль': '0.25 SOL · 1,053 SKR / module',",
    "  '1 053 SKR / модуль': '1,053 SKR / module',",
  ],
  [
    "  '0.25 SOL · 1 053 SKR / модуль': '0.25 SOL · 1 053 SKR / módulo',",
    "  '1 053 SKR / модуль': '1 053 SKR / módulo',",
  ],
  [
    "  '0.25 SOL · 1 053 SKR / модуль': '0.25 SOL · 1.053 SKR / modul',",
    "  '1 053 SKR / модуль': '1.053 SKR / modul',",
  ],
  [
    "  '0.25 SOL · 1 053 SKR / модуль': '0.25 SOL · 1.053 SKR / módulo',",
    "  '1 053 SKR / модуль': '1.053 SKR / módulo',",
  ],
  [
    "  '0.25 SOL · 1 053 SKR / модуль': '0.25 SOL · 1,053 SKR / modyul',",
    "  '1 053 SKR / модуль': '1,053 SKR / modyul',",
  ],
  [
    "  '0.25 SOL · 1 053 SKR / модуль': '0.25 SOL · 1.053 SKR / mô-đun',",
    "  '1 053 SKR / модуль': '1.053 SKR / mô-đun',",
  ],
];
const l0ByLang = Object.fromEntries(landingLocales.map((l, i) => [l, l0[i]]));

const l1 = [
  [
    "  '0.25 SOL · 1 053 SKR / МОДУЛЬ': '0.25 SOL · 1,053 SKR / MODULE',",
    "  '1 053 SKR / МОДУЛЬ': '1,053 SKR / MODULE',",
  ],
  [
    "  '0.25 SOL · 1 053 SKR / МОДУЛЬ': '0.25 SOL · 1,053 SKR / MÓDULO',",
    "  '1 053 SKR / МОДУЛЬ': '1,053 SKR / MÓDULO',",
  ],
  [
    "  '0.25 SOL · 1 053 SKR / МОДУЛЬ': '0.25 SOL · 1.053 SKR / MODUL',",
    "  '1 053 SKR / МОДУЛЬ': '1.053 SKR / MODUL',",
  ],
  [
    "  '0.25 SOL · 1 053 SKR / МОДУЛЬ': '0.25 SOL · 1.053 SKR / MÓDULO',",
    "  '1 053 SKR / МОДУЛЬ': '1.053 SKR / MÓDULO',",
  ],
  [
    "  '0.25 SOL · 1 053 SKR / МОДУЛЬ': '0.25 SOL · 1,053 SKR / MODULE',",
    "  '1 053 SKR / МОДУЛЬ': '1,053 SKR / MODULE',",
  ],
  [
    "  '0.25 SOL · 1 053 SKR / МОДУЛЬ': '0.25 SOL · 1.053 SKR / MODULE',",
    "  '1 053 SKR / МОДУЛЬ': '1.053 SKR / MODULE',",
  ],
];
const l1ByLang = Object.fromEntries(landingLocales.map((l, i) => [l, l1[i]]));

// F-03: FAQ wave — scope random roll to SKR; note SOL rail is buyer-chosen & not in UI
const l2KeyOld =
  "Первая волна — 500 модулей по 0.25 SOL или 1 053 SKR. Тип модуля роллится ончейн случайно: 70% — COMMON (урожай 35%), 25% — RARE (100%), 5% — EPIC (210%). Это игровая характеристика модуля, а не финансовая доходность.";
const l2KeyNew =
  "Первая волна — 500 модулей по 1 053 SKR. Тип роллится ончейн случайно: 70% — COMMON (урожай 35%), 25% — RARE (100%), 5% — EPIC (210%). SOL-рельс программы (0.1 / 0.25 / 0.5 SOL, тип выбирает покупатель) в интерфейсе пока не подключён. Это игровая характеристика модуля, а не финансовая доходность.";
const l2Rail = {
  en: "The program’s SOL rail (0.1 / 0.25 / 0.5 SOL, the buyer picks the type) is not wired into the UI yet. ",
  "es-419": "El carril SOL del programa (0.1 / 0.25 / 0.5 SOL, el comprador elige el tipo) aún no está en la interfaz. ",
  id: "Rel SOL program (0.1 / 0.25 / 0.5 SOL, pembeli memilih jenis) belum tersambung ke UI. ",
  "pt-BR": "O trilho SOL do programa (0.1 / 0.25 / 0.5 SOL, o comprador escolhe o tipo) ainda não está na interface. ",
  tl: "Ang SOL rail ng programa (0.1 / 0.25 / 0.5 SOL, ang bumibili ang pumipili ng klase) ay hindi pa nakakabit sa UI. ",
  vi: "Ray SOL của chương trình (0.1 / 0.25 / 0.5 SOL, người mua chọn loại) chưa gắn vào giao diện. ",
};
// value-side surgical edits: [oldFragment, newFragment] applied to the locale value
const l2ValEdits = {
  en: [
    ["The first wave is 500 modules at 0.25 SOL or 1,053 SKR. The module type is rolled",
      "The first wave is 500 modules at 1,053 SKR. The type is rolled"],
    ["EPIC (210%). This is", `EPIC (210%). ${l2Rail.en}This is`],
  ],
  "es-419": [
    ["La primera oleada: 500 módulos a 0.25 SOL o 1 053 SKR. El tipo de módulo se sortea",
      "La primera oleada: 500 módulos a 1 053 SKR. El tipo se sortea"],
    ["EPIC (210%). Es una", `EPIC (210%). ${l2Rail["es-419"]}Es una`],
  ],
  id: [
    ["Gelombang pertama — 500 modul seharga 0.25 SOL atau 1.053 SKR. Jenis modul diacak",
      "Gelombang pertama — 500 modul seharga 1.053 SKR. Jenis diacak"],
    ["EPIC (210%). Ini karakteristik", `EPIC (210%). ${l2Rail.id}Ini karakteristik`],
  ],
  "pt-BR": [
    ["A primeira onda tem 500 módulos por 0.25 SOL ou 1.053 SKR. O tipo do módulo é sorteado",
      "A primeira onda tem 500 módulos por 1.053 SKR. O tipo é sorteado"],
    ["EPIC (210%). É uma", `EPIC (210%). ${l2Rail["pt-BR"]}É uma`],
  ],
  tl: [
    ["Unang alon — 500 na modyul sa 0.25 SOL o 1,053 SKR. Ang uri ng modyul ay on-chain random",
      "Unang alon — 500 na modyul sa 1,053 SKR. Ang uri ay on-chain random"],
    ["EPIC (210%). Ito ay", `EPIC (210%). ${l2Rail.tl}Ito ay`],
  ],
  vi: [
    ["Đợt đầu — 500 mô-đun giá 0.25 SOL hoặc 1.053 SKR. Loại mô-đun gieo on-chain ngẫu nhiên",
      "Đợt đầu — 500 mô-đun giá 1.053 SKR. Loại gieo on-chain ngẫu nhiên"],
    ["EPIC (210%). Đây là", `EPIC (210%). ${l2Rail.vi}Đây là`],
  ],
};

// F-03: devnet parity claim → code parity only
const l3KeyOldTail = "Все цифры на этом сайте совпадают с кодом и живым состоянием devnet-цепи.";
const l3KeyNewTail =
  "Все цифры на этом сайте сверены с кодом репозитория; devnet-программа может отставать от последнего коммита — эталон исходники на GitHub.";
const l3ValTails = [
  [
    "All numbers on this site match the code and the live state of the devnet chain.",
    "All numbers on this site were verified against the repository code; the devnet program may lag behind the latest commit — the sources on GitHub are the reference.",
  ],
  [
    "Todos los números de este sitio coinciden con el código y el estado en vivo de la devnet.",
    "Todos los números de este sitio se verificaron con el código del repositorio; el programa en devnet puede estar detrás del último commit — la referencia son los fuentes en GitHub.",
  ],
  [
    "Semua angka di situs ini cocok dengan kode dan kondisi live devnet.",
    "Semua angka di situs ini diverifikasi terhadap kode repositori; program devnet mungkin tertinggal dari commit terakhir — acuannya adalah kode sumber di GitHub.",
  ],
  [
    "Todos os números deste site batem com o código e o estado ao vivo da devnet.",
    "Todos os números deste site foram verificados com o código do repositório; o programa em devnet pode estar atrás do último commit — a referência é o código no GitHub.",
  ],
  [
    "Lahat ng numero sa site na ito ay tumutugma sa code at sa live state ng devnet.",
    "Lahat ng numero sa site na ito ay na-verify sa code ng repository; maaaring nasa likod ang devnet program ng huling commit — ang sanggunian ay ang source sa GitHub.",
  ],
  [
    "Mọi con số trên trang này khớp với code và trạng thái devnet sống.",
    "Mọi con số trên trang này đã được đối chiếu với mã kho lưu trữ; chương trình devnet có thể chậm hơn commit mới nhất — tham chiếu là mã nguồn trên GitHub.",
  ],
];
const l3ByLang = Object.fromEntries(landingLocales.map((l, i) => [l, l3ValTails[i]]));

// F-03: hero — SKR-only purchase (matches actual UI)
const l4KeyEdits = [["за 0.25 SOL или 1 053 SKR,", "за 1 053 SKR,"]];
const l4ValEdits = {
  en: [["for 0.25 SOL or 1,053 SKR,", "for 1,053 SKR,"]],
  "es-419": [["por 0.25 SOL o 1,053 SKR,", "por 1,053 SKR,"]],
  id: [["seharga 0.25 SOL atau 1.053 SKR,", "seharga 1.053 SKR,"]],
  "pt-BR": [["por 0.25 SOL ou 1.053 SKR,", "por 1.053 SKR,"]],
  tl: [["sa 0.25 SOL o 1,053 SKR,", "sa 1,053 SKR,"]],
  vi: [["với 0.25 SOL hoặc 1.053 SKR,", "với 1.053 SKR,"]],
};

// F-06: presale notice — SKR only
const l5KeyEdit = ["(0.25 SOL или 1 053 SKR)", "(1 053 SKR)"];
const l5ValEdits = {
  en: [["(0.25 SOL or 1,053 SKR)", "(1,053 SKR)"]],
  "es-419": [["(0.25 SOL o 1,053 SKR)", "(1,053 SKR)"]],
  id: [["(0.25 SOL atau 1.053 SKR)", "(1.053 SKR)"]],
  "pt-BR": [["(0.25 SOL ou 1.053 SKR)", "(1.053 SKR)"]],
  tl: [["(0.25 SOL o 1,053 SKR)", "(1,053 SKR)"]],
  vi: [["(0.25 SOL hoặc 1.053 SKR)", "(1.053 SKR)"]],
};

// F-06: footer payments line — SKR only
const l6KeyEdits = [["Платежи 0.25 SOL / 1 053 SKR.", "Платежи за SKR — 1 053 за модуль."]];
const l6ValEdits = {
  en: [["Payments in 0.25 SOL / 1,053 SKR.", "Payments in SKR — 1,053 per module."]],
  "es-419": [["Pagos en 0.25 SOL / 1,053 SKR.", "Pagos en SKR — 1,053 por módulo."]],
  id: [["Pembayaran 0.25 SOL / 1.053 SKR.", "Pembayaran dalam SKR — 1.053 per modul."]],
  "pt-BR": [["Pagamentos em 0.25 SOL / 1.053 SKR.", "Pagamentos em SKR — 1.053 por módulo."]],
  tl: [["Babayaran sa 0.25 SOL / 1,053 SKR.", "Babayaran sa SKR — 1,053 bawat module."]],
  vi: [["Thanh toán 0.25 SOL / 1.053 SKR.", "Thanh toán bằng SKR — 1.053 mỗi mô-đun."]],
};

// F-06: referral description — 0.5% referrer / 1% seller-from-fee
const l7KeyOldTail =
  "Тебе — 0.5% от суммы его сделок на бирже, ему — −1% от суммы из комиссии.";
const l7KeyNewTail =
  "Тебе (рефереру) — 0.5% от суммы его сделок на бирже; продавцу — 1% из комиссии, если покупатель пришёл по ссылке.";
const l7ValTails = [
  [
    "You get 0.5% of their trade amounts on the exchange; they get −1% off the fee amount.",
    "You (the referrer) get 0.5% of their trade amounts on the exchange; the seller gets 1% out of the fee when the buyer came via your link.",
  ],
  [
    "Tú recibes 0.5% del valor de sus operaciones en el exchange; él recibe −1% del valor de la comisión.",
    "Tú (el referidor) recibes 0.5% del valor de sus operaciones en el exchange; el vendedor recibe 1% de la comisión cuando el comprador vino por tu enlace.",
  ],
  [
    "Kamu mendapat 0.5% dari nilai transaksinya di exchange; ia mendapat −1% dari nilai komisi.",
    "Kamu (referrer) mendapat 0.5% dari nilai transaksinya di exchange; penjual mendapat 1% dari komisi saat pembeli datang dari tautanmu.",
  ],
  [
    "Você ganha 0.5% do valor de suas negociações na corretora; ele ganha −1% do valor da comissão.",
    "Você (referenciador) ganha 0.5% do valor de suas negociações na corretora; o vendedor ganha 1% da comissão quando o comprador veio pelo seu link.",
  ],
  [
    "Ikaw ay 0.5% ng halaga ng kanyang trades sa exchange; siya ay −1% ng halaga ng fee.",
    "Ikaw (referrer) ay 0.5% ng halaga ng kanyang mga trade sa exchange; ang nagbenta ay 1% mula sa commission kapag ang bumili ay galing sa link mo.",
  ],
  [
    "Bạn nhận 0.5% giá trị giao dịch của họ trên sàn; họ được −1% giá trị phí.",
    "Bạn (người giới thiệu) nhận 0.5% giá trị giao dịch của họ trên sàn; người bán được 1% từ phí khi người mua đến qua liên kết của bạn.",
  ],
];
const l7ByLang = Object.fromEntries(landingLocales.map((l, i) => [l, l7ValTails[i]]));

// F-06: team income bullet — "не майнит" → "не продаёт отдельно"
const l8KeyOld = "Команда не майнит POTATO. Доход команды";
const l8KeyNew = "Команда не продаёт POTATO отдельно от игры. Доход команды";
const l8ValTails = [
  ["The team does not mine POTATO.", "The team does not sell POTATO outside the game."],
  ["El equipo no minea POTATO.", "El equipo no vende POTATO por fuera del juego."],
  ["Tim tidak menambang POTATO.", "Tim tidak menjual POTATO di luar game."],
  ["A equipe não minera POTATO.", "A equipe não vende POTATO fora do jogo."],
  ["Hindi nagmama-mine ng POTATO ang team.", "Hindi nagbebenta ng POTATO ang team sa labas ng laro."],
  ["Đội ngũ không đào POTATO.", "Đội ngũ không bán POTATO ngoài trò chơi."],
];
const l8ByLang = Object.fromEntries(landingLocales.map((l, i) => [l, l8ValTails[i]]));

function editLandingLine(file, keyOldFragments, keyNewFragments, valOld, valNew, label) {
  // key fragments must be applied first (they rewrite the RU key), then value pair.
  const abs = path.join(root, file);
  const lines = fs.readFileSync(abs, "utf8").split("\n");
  // find candidate lines by first key fragment
  const probe = keyOldFragments[0][0];
  const idxs = [];
  lines.forEach((l, i) => {
    if (l.includes(probe)) idxs.push(i);
  });
  if (idxs.length === 0) {
    // already applied?
    const probeNew = keyNewFragments[0][1];
    if (lines.some((l) => l.includes(probeNew) && l.includes(valNew))) return;
    failures.push(`${label}: key fragment not found in ${file}: ${probe.slice(0, 60)}…`);
    return;
  }
  if (idxs.length > 1) {
    failures.push(`${label}: ambiguous ${idxs.length} matches in ${file}`);
    return;
  }
  let line = lines[idxs[0]];
  for (let i = 0; i < keyOldFragments.length; i++) {
    if (!line.includes(keyOldFragments[i][0])) {
      failures.push(`${label}: key edit ${i} miss in ${file}`);
      return;
    }
    line = line.replace(keyOldFragments[i][0], keyOldFragments[i][1]);
  }
  if (line.includes(valOld)) {
    line = line.replace(valOld, valNew);
  } else if (!line.includes(valNew)) {
    failures.push(`${label}: value text not found in ${file}: ${valOld.slice(0, 60)}…`);
    return;
  }
  lines[idxs[0]] = line;
  fs.writeFileSync(abs, lines.join("\n"));
  applied++;
}

for (const lang of landingLocales) {
  const file = `landing/i18n/strings/${lang}.ts`;

  // L0 price (lowercase)
  {
    const [oldL, newL] = l0ByLang[lang];
    mustReplace(file, oldL, newL, `F-03 price-lower/${lang}`);
  }
  // L1 price (uppercase)
  {
    const [oldL, newL] = l1ByLang[lang];
    mustReplace(file, oldL, newL, `F-03 price-upper/${lang}`);
  }
  // L2 FAQ wave
  {
    const [vOld1, vNew1] = l2ValEdits[lang][0];
    const [vOld2, vNew2] = l2ValEdits[lang][1];
    const abs = path.join(root, file);
    const src = fs.readFileSync(abs, "utf8");
    if (src.includes(l2KeyNew)) {
      // already
    } else if (src.includes(l2KeyOld)) {
      // rebuild line: key + value edits
      const lines = src.split("\n");
      const i = lines.findIndex((l) => l.includes(l2KeyOld));
      if (i < 0) { failures.push(`F-03 faq/${lang}: line not found`); }
      else {
        let l = lines[i];
        let ok = true;
        if (!l.includes(vOld1)) { failures.push(`F-03 faq/${lang}: value head not found: ${vOld1.slice(0, 50)}`); ok = false; }
        if (!l.includes(vOld2)) { failures.push(`F-03 faq/${lang}: value tail not found: ${vOld2.slice(0, 50)}`); ok = false; }
        if (ok) {
          l = l.replace(l2KeyOld, l2KeyNew).replace(vOld1, vNew1).replace(vOld2, vNew2);
          lines[i] = l;
          fs.writeFileSync(abs, lines.join("\n"));
          applied++;
        }
      }
    } else {
      failures.push(`F-03 faq/${lang}: neither old nor new key found`);
    }
  }
  // L3 devnet parity
  {
    const [vOld, vNew] = l3ByLang[lang];
    editLandingLine(file, [[l3KeyOldTail, l3KeyNewTail]], [[l3KeyNewTail, l3KeyNewTail]], vOld, vNew, `F-03 parity/${lang}`);
  }
  // L4 hero
  editLandingLine(file, l4KeyEdits, l4KeyEdits, l4ValEdits[lang][0][0], l4ValEdits[lang][0][1], `F-03 hero/${lang}`);
  // L5 presale notice
  editLandingLine(file, [l5KeyEdit], [l5KeyEdit], l5ValEdits[lang][0][0], l5ValEdits[lang][0][1], `F-06 notice/${lang}`);
  // L6 footer payments
  editLandingLine(file, l6KeyEdits, l6KeyEdits, l6ValEdits[lang][0][0], l6ValEdits[lang][0][1], `F-06 footer/${lang}`);
  // L7 referral desc
  {
    const [vOld, vNew] = l7ByLang[lang];
    editLandingLine(file, [[l7KeyOldTail, l7KeyNewTail]], [[l7KeyNewTail, l7KeyNewTail]], vOld, vNew, `F-06 ref-desc/${lang}`);
  }
  // L8 team income
  {
    const [vOld, vNew] = l8ByLang[lang];
    editLandingLine(file, [[l8KeyOld, l8KeyNew]], [[l8KeyNew, l8KeyNew]], vOld, vNew, `F-06 team-mine/${lang}`);
  }
}

// landing/content.ts (double-quoted RU strings)
const contentEdits = [
  ["  '0.25 SOL · 1 053 SKR / МОДУЛЬ',", null], // placeholder no-op (content uses price: field below)
  ['price: "0.25 SOL · 1 053 SKR / МОДУЛЬ",', 'price: "1 053 SKR / МОДУЛЬ",'],
  [l2KeyOld, l2KeyNew],
  [l3KeyOldTail, l3KeyNewTail],
  ["за 0.25 SOL или 1 053 SKR,", "за 1 053 SKR,"],
  ["(0.25 SOL или 1 053 SKR)", "(1 053 SKR)"],
  ["Платежи 0.25 SOL / 1 053 SKR.", "Платежи за SKR — 1 053 за модуль."],
  [l7KeyOldTail, l7KeyNewTail],
  [l8KeyOld, l8KeyNew],
];
for (const [oldStr, newStr] of contentEdits) {
  if (newStr === null) continue;
  mustReplace("landing/content.ts", oldStr, newStr, `content: ${oldStr.slice(0, 40)}`);
}
// App.tsx price usage
mustReplace(
  "landing/App.tsx",
  't("0.25 SOL · 1 053 SKR / модуль")',
  't("1 053 SKR / модуль")',
  "F-03 App price usage",
);

// verify no leftover old claims in edited surfaces
const residualChecks = [
  ["game/apps/web/src", "−15%"],
  ["game/apps/web/src", "buyback & burn"],
  ["landing/content.ts", "0.25 SOL или"],
  ["landing/content.ts", "совпадают с кодом и живым"],
  ["landing/App.tsx", "0.25 SOL · 1 053 SKR"],
];
for (const [rel, needle] of residualChecks) {
  const abs = path.join(root, rel);
  const walk = fs.statSync(abs).isDirectory()
    ? fs.readdirSync(abs, { recursive: true }).map((f) => path.join(abs, f))
    : [abs];
  for (const f of walk) {
    if (!fs.existsSync(f) || !fs.statSync(f).isFile()) continue;
    if (!/\.(ts|tsx)$/.test(f)) continue;
    const src = fs.readFileSync(f, "utf8");
    if (src.includes(needle) && !f.includes("apply-audit-text-fixes")) {
      failures.push(`residual '${needle}' in ${path.relative(root, f)}`);
    }
  }
}

if (failures.length) {
  console.error("FAILURES:");
  for (const f of failures) console.error(" -", f);
  process.exit(1);
}
console.log(`OK: ${applied} line replacements applied.`);
