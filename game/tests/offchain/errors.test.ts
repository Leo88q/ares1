import { test } from 'node:test';
import assert from 'node:assert/strict';
import idl from '../../apps/web/src/idl.json';
import { describeError } from '../../apps/web/src/utils/errors';

test('game errors are resolved by IDL name, not obsolete numeric offsets', () => {
  const cases = { Paused: /паузе/, AlreadyClaimed: /уже получена/, BadProof: /условия/, Unauthorized: /Нет прав/ };
  for (const [name, expected] of Object.entries(cases)) {
    const code = idl.errors.find(e => e.name === name)!.code;
    assert.match(describeError(`custom program error: 0x${code.toString(16)}`), expected);
  }
});
