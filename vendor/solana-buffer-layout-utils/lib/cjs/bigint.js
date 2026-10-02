"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.u256be = exports.u256 = exports.u192be = exports.u192 = exports.u128be = exports.u128 = exports.u64be = exports.u64 = exports.bigIntBE = exports.bigInt = void 0;
const buffer_1 = require("buffer");
const buffer_layout_1 = require("@solana/buffer-layout");
const base_1 = require("./base");
// Written as `BigInt(...)` calls rather than `8n` literals so this module keeps
// compiling under the repository's existing `target`, which is below ES2020.
const ZERO = BigInt(0);
const BITS_PER_BYTE = BigInt(8);
const BYTE_MASK = BigInt(0xff);
/**
 * Read an unsigned big integer out of a buffer.
 *
 * Previously delegated to `bigint-buffer`, whose native addon contains a buffer
 * overflow in `toBigIntLE()` (CVE-2025-3194 / GHSA-3gc7-fjrx-p6mg). No fixed
 * release exists and the package has been unmaintained since 2023, so the four
 * functions this module used are implemented here instead. They are pure
 * JavaScript and allocate nothing beyond the result, so the overflow cannot
 * occur by construction.
 */
function toBigInt(buf, littleEndian) {
    let result = ZERO;
    if (littleEndian) {
        for (let i = buf.length - 1; i >= 0; i--) {
            result = (result << BITS_PER_BYTE) | BigInt(buf[i]);
        }
    }
    else {
        for (let i = 0; i < buf.length; i++) {
            result = (result << BITS_PER_BYTE) | BigInt(buf[i]);
        }
    }
    return result;
}
/**
 * Write an unsigned big integer into a buffer of exactly `length` bytes.
 *
 * Values wider than `length` are truncated to their low-order bytes — i.e.
 * `value mod 2 ** (8 * length)`. That matches what `bigint-buffer`'s native
 * addon did, so installs that had a working native build see no change.
 *
 * It is a deliberate fix for installs that did NOT. `bigint-buffer` silently
 * falls back to a pure-JS path whenever its addon fails to build — which is the
 * common case, since building requires node-gyp and a C++ toolchain — and that
 * fallback keeps the HIGH-order bytes instead, disagreeing with the addon it
 * stands in for. The same input therefore encoded differently depending on
 * whether a consumer's install happened to compile the addon.
 */
function toBuffer(num, length, littleEndian) {
    const buf = buffer_1.Buffer.alloc(length);
    let value = num;
    if (littleEndian) {
        for (let i = 0; i < length; i++) {
            buf[i] = Number(value & BYTE_MASK);
            value >>= BITS_PER_BYTE;
        }
    }
    else {
        for (let i = length - 1; i >= 0; i--) {
            buf[i] = Number(value & BYTE_MASK);
            value >>= BITS_PER_BYTE;
        }
    }
    return buf;
}
// https://github.com/no2chem/bigint-buffer/issues/59
function assertValidBigInteger(untrustedInput) {
    if (typeof untrustedInput !== 'bigint') {
        throw new Error('Expected a `BigInt`');
    }
    // Every layout this module exports is UNSIGNED, and neither previous
    // implementation handled a negative sensibly: the native addon encoded the
    // absolute value (-1n became 0x01), while the pure-JS fallback returned a
    // buffer of the WRONG LENGTH (7 bytes for a width of 8), silently
    // corrupting the surrounding layout. Rejecting the input is the only
    // behaviour that cannot quietly produce a wrong value.
    if (untrustedInput < ZERO) {
        throw new RangeError('Expected an unsigned `BigInt`, received a negative value');
    }
}
function bigInt_IMPL(littleEndian, length) {
    return (property) => {
        const layout = (0, buffer_layout_1.blob)(length, property);
        const { encode, decode } = (0, base_1.encodeDecode)(layout);
        const bigIntLayout = layout;
        bigIntLayout.decode = (buffer, offset) => {
            const src = decode(buffer, offset);
            return toBigInt(buffer_1.Buffer.from(src), littleEndian);
        };
        bigIntLayout.encode = (bigInt, buffer, offset) => {
            assertValidBigInteger(bigInt);
            // A zero length yields an empty buffer rather than crashing the
            // process, which is what `bigint-buffer`'s addon did here.
            // https://github.com/no2chem/bigint-buffer/issues/40
            const src = toBuffer(bigInt, length, littleEndian);
            return encode(src, buffer, offset);
        };
        return bigIntLayout;
    };
}
exports.bigInt = bigInt_IMPL.bind(null, /* littleEndian */ true);
exports.bigIntBE = bigInt_IMPL.bind(null, /* littleEndian */ false);
exports.u64 = (0, exports.bigInt)(8);
exports.u64be = (0, exports.bigIntBE)(8);
exports.u128 = (0, exports.bigInt)(16);
exports.u128be = (0, exports.bigIntBE)(16);
exports.u192 = (0, exports.bigInt)(24);
exports.u192be = (0, exports.bigIntBE)(24);
exports.u256 = (0, exports.bigInt)(32);
exports.u256be = (0, exports.bigIntBE)(32);
//# sourceMappingURL=bigint.js.map