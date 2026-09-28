/**
 * Фикстуры для DB-тестов: единая реализация берётся из scripts/db-common.ts,
 * чтобы стенд, тесты и мутационные пробы генерировали одинаковые по формату
 * адреса и подписи (схема проверяет 32..44 и 64..88 base58).
 */
export { base58, ataLike as ata, signatureLike as signature } from '../../scripts/db-common.js';
