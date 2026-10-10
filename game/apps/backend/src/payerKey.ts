/**
 * Загрузка keypair плательщика эпохи (AUDIT B4: dedicated low-privilege key,
 * НЕ authority-ключ).
 *
 * `PAYER_KEYPAIR_JSON` принимается в двух формах:
 *   1) **путь к файлу** с массивом из 64 чисел (формат `solana-keygen`) —
 *      исторический формат: docker-compose монтирует секрет файлом;
 *   2) **inline-JSON** того же массива — для платформ, где секрет передаётся
 *      только переменной окружения, а файловой монтировки нет (Flux, Railway,
 *      Render и т.п.). Форма выбирается по значению, а не флагом: обе формы
 *      несовместимы (путь не начинается с `[`), и явный флаг — лишняя
 *      возможность ошибиться при деплое.
 *
 * Сообщения об ошибках намеренно НЕ эхоят значение переменной: неудачный
 * деплой не должен разлить секрет по логам платформы. Форма массива (64 байта)
 * проверяется до `Keypair.fromSecretKey`, чтобы отказ был внятным, а не
 * «неверная длина».
 */

export const PAYER_SECRET_KEY_BYTES = 64;

/** Разбор строки, которая уже является JSON-содержимым (не путём). */
export function parsePayerSecretKey(raw: string): Uint8Array {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(
      "PAYER_KEYPAIR_JSON: значение не является JSON — ожидается массив из 64 чисел " +
        "(формат solana-keygen) либо путь к такому файлу",
    );
  }
  if (!Array.isArray(parsed) || parsed.length !== PAYER_SECRET_KEY_BYTES) {
    const got = Array.isArray(parsed) ? `массив из ${parsed.length}` : `значение типа ${typeof parsed}`;
    throw new Error(
      `PAYER_KEYPAIR_JSON: ожидается JSON-массив из ${PAYER_SECRET_KEY_BYTES} чисел, получено ${got}`,
    );
  }
  const bytes = new Uint8Array(PAYER_SECRET_KEY_BYTES);
  for (let i = 0; i < PAYER_SECRET_KEY_BYTES; i++) {
    const v = parsed[i];
    if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > 255) {
      throw new Error(`PAYER_KEYPAIR_JSON: элемент [${i}] не является байтом 0..255`);
    }
    bytes[i] = v;
  }
  return bytes;
}

/** Inline-JSON отличается от пути первым непробельным символом. */
export function isInlineKeypairJson(spec: string): boolean {
  const trimmed = spec.trim();
  return trimmed.startsWith("[") || trimmed.startsWith("{");
}

/**
 * Разрешает значение `PAYER_KEYPAIR_JSON` в секретный ключ.
 * `readFile` инжектируется, чтобы модуль оставался юнит-тестируемым.
 */
export function loadPayerSecretKey(spec: string, readFile: (path: string) => string): Uint8Array {
  if (isInlineKeypairJson(spec)) return parsePayerSecretKey(spec.trim());
  let content: string;
  try {
    content = readFile(spec);
  } catch {
    // Путь не печатаем: при опечатке в inline-значении (без `[`) мы получим
    // именно этот путь отказа, и эхо переменной утащило бы секрет в лог.
    throw new Error(
      "PAYER_KEYPAIR_JSON: не удалось прочитать файл по пути из переменной — " +
        "проверьте путь или передайте inline-JSON-массив из 64 чисел",
    );
  }
  return parsePayerSecretKey(content);
}
