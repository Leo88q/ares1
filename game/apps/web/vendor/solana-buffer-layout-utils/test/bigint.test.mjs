import test from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import Module from 'node:module';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { delimiter, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// This vendored package is shared by game/ and landing/. The test runner lives
// outside both package-manager node_modules trees, so expose game/node_modules
// to the CommonJS resolver when it exists. Standalone installs use normal
// dependency resolution.
const gameNodeModules = resolve(dirname(fileURLToPath(import.meta.url)), '../../../game/node_modules');
if (existsSync(gameNodeModules)) {
    process.env.NODE_PATH = [gameNodeModules, process.env.NODE_PATH].filter(Boolean).join(delimiter);
    Module._initPaths();
}
const require = createRequire(import.meta.url);
const { bigInt, bigIntBE, u64, u64be, u128, u128be, u192, u192be, u256, u256be } = require('../lib/cjs/index.js');

const ONE = BigInt(1);
const ZERO = BigInt(0);
const maxFor = (bytes) => (ONE << BigInt(bytes * 8)) - ONE;

const LAYOUTS = [
    ['u64', u64, 8, true],
    ['u64be', u64be, 8, false],
    ['u128', u128, 16, true],
    ['u128be', u128be, 16, false],
    ['u192', u192, 24, true],
    ['u192be', u192be, 24, false],
    ['u256', u256, 32, true],
    ['u256be', u256be, 32, false],
];

for (const [name, factory, width, littleEndian] of LAYOUTS) {
    const layout = factory('v');

    test(`${name}: round-trips boundary values`, () => {
        for (const value of [ZERO, ONE, BigInt(1000000), maxFor(width) - ONE, maxFor(width)]) {
            const buf = Buffer.alloc(width);
            layout.encode(value, buf, 0);
            assert.equal(layout.decode(buf, 0), value, `round-trip failed for ${value}`);
        }
    });

    test(`${name}: writes exactly ${width} bytes and respects endianness`, () => {
        const buf = Buffer.alloc(width);
        layout.encode(ONE, buf, 0);
        assert.equal(buf.length, width);
        // 1 lands in the first byte little-endian, the last byte big-endian.
        assert.equal(buf[littleEndian ? 0 : width - 1], 1);
        assert.equal(buf[littleEndian ? width - 1 : 0], 0);
    });

    test(`${name}: rejects a negative value`, () => {
        // Both previous implementations mangled negatives silently: the native
        // bigint-buffer addon encoded the absolute value, and its pure-JS
        // fallback produced a buffer of the wrong length.
        const buf = Buffer.alloc(width);
        assert.throws(() => layout.encode(BigInt(-1), buf, 0), RangeError);
    });

    test(`${name}: rejects a non-BigInt`, () => {
        const buf = Buffer.alloc(width);
        assert.throws(() => layout.encode(1, buf, 0), /Expected a `BigInt`/);
        assert.throws(() => layout.encode('1', buf, 0), /Expected a `BigInt`/);
    });

    test(`${name}: truncates an over-wide value to its low-order bytes`, () => {
        // Matches what bigint-buffer's native addon did (value mod 2**bits),
        // so installs that had a working native build see no change.
        const modulus = ONE << BigInt(width * 8);
        for (const extra of [ONE, BigInt(5)]) {
            const value = maxFor(width) + extra;
            const buf = Buffer.alloc(width);
            layout.encode(value, buf, 0);
            assert.equal(layout.decode(buf, 0), value % modulus);
        }
    });
}

test('u64: known wire vectors stay stable', () => {
    const buf = Buffer.alloc(8);
    u64('v').encode(BigInt(1), buf, 0);
    assert.equal(buf.toString('hex'), '0100000000000000');

    u64('v').encode(BigInt('18446744073709551615'), buf, 0);
    assert.equal(buf.toString('hex'), 'ffffffffffffffff');

    u64('v').encode(BigInt(1000), buf, 0);
    assert.equal(buf.toString('hex'), 'e803000000000000');
});

test('u64be: known wire vectors stay stable', () => {
    const buf = Buffer.alloc(8);
    u64be('v').encode(BigInt(1), buf, 0);
    assert.equal(buf.toString('hex'), '0000000000000001');

    u64be('v').encode(BigInt(1000), buf, 0);
    assert.equal(buf.toString('hex'), '00000000000003e8');
});

test('decode reads an all-zero and an all-ones buffer', () => {
    assert.equal(u64('v').decode(Buffer.alloc(8), 0), ZERO);
    assert.equal(u64('v').decode(Buffer.alloc(8, 0xff), 0), maxFor(8));
    assert.equal(u256('v').decode(Buffer.alloc(32, 0xff), 0), maxFor(32));
});

test('a zero-length layout yields an empty buffer instead of crashing', () => {
    // bigint-buffer's native addon aborted the PROCESS here
    // (no2chem/bigint-buffer#40: "fromBigInt: Assertion `status == napi_ok'
    // failed"), which is why the previous implementation special-cased it.
    const layout = bigInt(0)('v');
    const buf = Buffer.alloc(0);
    layout.encode(BigInt('78868670889991484386623569508133237101851'), buf, 0);
    assert.equal(buf.length, 0);
    assert.equal(layout.decode(buf, 0), ZERO);
});

test('encode/decode agree at a non-zero offset inside a larger buffer', () => {
    const buf = Buffer.alloc(24);
    const layout = u64('v');
    layout.encode(BigInt('1234567890123456789'), buf, 8);
    assert.equal(layout.decode(buf, 8), BigInt('1234567890123456789'));
    // Neighbouring bytes untouched.
    assert.equal(buf.subarray(0, 8).toString('hex'), '0000000000000000');
    assert.equal(buf.subarray(16).toString('hex'), '0000000000000000');
});

test('little-endian and big-endian are byte reversals of each other', () => {
    const value = BigInt('1234567890123456789');
    const le = Buffer.alloc(8);
    const be = Buffer.alloc(8);
    u64('v').encode(value, le, 0);
    u64be('v').encode(value, be, 0);
    assert.equal(Buffer.from(le).reverse().toString('hex'), be.toString('hex'));
});

test('bigIntBE factory produces the same result as the named be layouts', () => {
    const custom = bigIntBE(8)('v');
    const named = u64be('v');
    const a = Buffer.alloc(8);
    const b = Buffer.alloc(8);
    custom.encode(BigInt(424242), a, 0);
    named.encode(BigInt(424242), b, 0);
    assert.equal(a.toString('hex'), b.toString('hex'));
});
