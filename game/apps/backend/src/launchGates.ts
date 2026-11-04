/**
 * Стартовый набор и дейлик: рельса существует, но выключена до зелёного
 * devnet-smoke и одобрения владельца. Включение — отдельный релиз: поднимает
 * выдачу POTATO из бэкенда и делает бота-фарм возможным.
 */
export const REWARDS_RAIL_ENABLED = false
/** User-facing token payment gates stay closed until a separate approved launch release. */
export const USER_PRESALE_PAYMENTS_ENABLED = false
export const USER_SKR_SLOT_PURCHASES_ENABLED = false
/**
 * B2B-тиражи пресейла (паки полей за SOL) можно открывать БЕЗ права покупателя
 * платить в приложении.
 *
 * До этого единственным условием открытия тиража был
 * `USER_PRESALE_PAYMENTS_ENABLED`, то есть два разных риска были склеены в один
 * флаг: «игрок платит нам из интерфейса» (нужна проверка кошелька, UX, возвраты)
 * и «оператор продаёт пак по номеру заказа» (платёж приходит на казну, выдача —
 * через уже работающую рельсу `grant_reward_once`). Пока флаг один, продажи
 * нельзя открыть, не открыв одновременно покупательский чекаут, — а значит
 * витрина навсегда остаётся «выключенной».
 *
 * Условия для открытия этой ветки (должны выполняться все):
 *   - смоук на devnet: резерв → платёж → выдача POTATO → сверка (`presale:open-run`);
 *   - `REWARD_KEYPAIR_JSON` и `REWARD_INVITE_SECRET` заданы, рельса жива;
 *   - мониторинг `reconcile` зелёный, возвраты (`refunds`) проверены.
 */
export const B2B_PRESALE_RUNS_ENABLED = false
/** Set true only after the complete persistent-colony acceptance suite and release review pass. */
export const COLONY_V1_RELEASE_READY = false
