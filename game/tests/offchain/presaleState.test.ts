// SKR purchase remains disabled until a separate, explicit launch approval.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const source = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('presale UI is a closed status notice with no wallet or transaction flow', () => {
  const component = source('apps/web/src/components/PresaleSection.tsx');
  assert.match(component, /data-testid="skr-presale-closed"/);
  assert.match(component, /ПОКУПКА ЗА SKR ОТКЛЮЧЕНА/);
  assert.match(component, /прежние 1053 SKR были devnet-путём покупки одного поля/);
  assert.match(component, /Повторное открытие покупки требует отдельного одобрения запуска/);
  assert.doesNotMatch(component, /useWallet|useConnection|Transaction|buy_field|transfer/);
});

test('presale transaction builders remain absent from the browser client', () => {
  const client = source('apps/web/src/utils/anchorClient.ts');
  for (const builder of ['ixInitPresale', 'ixUpdatePresalePrice', 'ixBuyFieldSol', 'ixBuyFieldSkr', 'ixBuyExportLicense']) {
    assert.doesNotMatch(client, new RegExp(`export\\s+(?:async\\s+)?function\\s+${builder}\\b`), `${builder} must not be exported`);
  }
});
