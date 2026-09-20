import * as anchor from '@coral-xyz/anchor';
import { Program, BN } from '@coral-xyz/anchor';
import { Keypair, PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY } from '@solana/web3.js';
import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID, AuthorityType, createMint, setAuthority, getOrCreateAssociatedTokenAccount, getAssociatedTokenAddressSync, mintTo, getAccount, getMint, transfer } from '@solana/spl-token';
import { expect, assert } from 'chai';
import { SolanaPotato } from '../target/types/solana_potato';

// Test-only prices/mints. No production price table is assigned by this suite.
describe('SKR-only payment rail', () => {
  const provider = anchor.AnchorProvider.env(); anchor.setProvider(provider);
  const program = anchor.workspace.SolanaPotato as Program<SolanaPotato>;
  const c = provider.connection; const admin = (provider.wallet as anchor.Wallet).payer;
  const buyer = Keypair.generate(); const stranger = Keypair.generate();
  const u64 = (n: number) => new BN(n).toArrayLike(Buffer, 'le', 8);
  const pda = (...seeds: Buffer[]) => PublicKey.findProgramAddressSync(seeds, program.programId)[0];
  const config = pda(Buffer.from('config')); const epoch = pda(Buffer.from('epoch'), u64(0));
  const treasury = pda(Buffer.from('treasury_sol'));
  const field = (n: number) => pda(Buffer.from('field'), u64(n));
  const order = (n: number) => pda(Buffer.from('skr_order'), u64(n));
  const escrow = (n: number) => pda(Buffer.from('skr_escrow'), order(n).toBuffer());
  const profile = (key: PublicKey) => pda(Buffer.from('seller'), key.toBuffer());
  let potato: PublicKey, skr: PublicKey, foreign: PublicKey;
  let adminPotato: PublicKey, buyerPotato: PublicKey, adminSkr: PublicKey, buyerSkr: PublicKey, vault: PublicKey, potatoVault: PublicKey;
  const prices = [10_000_000, 1_000_000, 2_000_000, 1_000_000, 1_000_000, 1_000_000];
  const pricing = () => pda(Buffer.from('skr_pricing'), skr.toBuffer());
  const stats = () => pda(Buffer.from('skr_market_stats'), skr.toBuffer());
  const balance = async (key: PublicKey) => (await getAccount(c, key)).amount;
  const configure = (values = prices, min = 1_000_000) => program.methods.configureSkrPricing(values.map(v => new BN(v)), new BN(min)).accountsPartial({ config, authority: admin.publicKey, skrMint: skr, pricing: pricing(), systemProgram: SystemProgram.programId }).rpc();
  const payment = (owner = buyer.publicKey, userSkr = buyerSkr) => ({ config, pricing: pricing(), skrMint: skr, userSkr, treasury, treasurySkr: vault, owner, tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId });
  const create = (n: number, max = prices[0]) => program.methods.createFieldSkr(new BN(n), 1, new BN(max)).accountsPartial({ ...payment(), field: field(n) }).signers([buyer]).rpc();
  const service = (action: number, max = 100_000_000) => program.methods.serviceFieldSkr(action, new BN(max)).accountsPartial({ ...payment(), field: field(1) }).signers([buyer]).rpc();
  const listing = (n: number) => ({ seller: admin.publicKey, config, pricing: pricing(), skrMint: skr, sellerProfile: profile(admin.publicKey), order: order(n), marketStats: stats(), sellerPotato: adminPotato, escrow: escrow(n), potatoMint: potato, tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId, rent: SYSVAR_RENT_PUBKEY });
  const fill = (n: number) => ({ buyer: buyer.publicKey, seller: admin.publicKey, config, potatoMint: potato, skrMint: skr, marketStats: stats(), order: order(n), escrow: escrow(n), buyerPotato, sellerPotato: adminPotato, buyerSkr, sellerSkr: adminSkr, treasury, treasurySkr: vault, tokenProgram: TOKEN_PROGRAM_ID });
  const reject = async (tx: Promise<unknown>, code?: string) => {
    try { await tx; } catch (e: any) {
      if (code) expect(e.error?.errorCode?.code ?? `${e.message} ${(e.logs ?? []).join(' ')}`).to.contain(code);
      return;
    }
    assert.fail('Expected rejected transaction');
  };
  before(async () => {
    await c.confirmTransaction(await c.requestAirdrop(buyer.publicKey, 5_000_000_000), 'confirmed');
    potato = await createMint(c, admin, admin.publicKey, null, 6);
    skr = await createMint(c, admin, admin.publicKey, null, 6);
    foreign = await createMint(c, admin, admin.publicKey, null, 6);
    await setAuthority(c, admin, potato, admin.publicKey, AuthorityType.MintTokens, config);
    await program.methods.initialize().accountsPartial({ config, potatoMint: potato, authority: admin.publicKey, systemProgram: SystemProgram.programId }).rpc();
    await program.methods.initEpoch().accountsPartial({ config, epoch, authority: admin.publicKey, systemProgram: SystemProgram.programId }).rpc();
    await program.methods.updateSkrMint(skr).accountsPartial({ config, authority: admin.publicKey }).rpc();
    adminPotato = (await getOrCreateAssociatedTokenAccount(c, admin, potato, admin.publicKey)).address;
    buyerPotato = (await getOrCreateAssociatedTokenAccount(c, admin, potato, buyer.publicKey)).address;
    adminSkr = (await getOrCreateAssociatedTokenAccount(c, admin, skr, admin.publicKey)).address;
    buyerSkr = (await getOrCreateAssociatedTokenAccount(c, admin, skr, buyer.publicKey)).address;
    vault = (await getOrCreateAssociatedTokenAccount(c, admin, skr, treasury, true)).address;
    potatoVault = (await getOrCreateAssociatedTokenAccount(c, admin, potato, config, true)).address;
    await mintTo(c, admin, skr, buyerSkr, admin, 1_000_000_000n); // faucet for this isolated test mint only
    await program.methods.grantReward(new BN(1_000_000_000)).accountsPartial({ config, epoch, authority: admin.publicKey, potatoMint: potato, userPotato: adminPotato, tokenProgram: TOKEN_PROGRAM_ID }).rpc();
  });
  it('only authority can configure prices; unpriced actions are disabled', async () => {
    await configure([0, 0, 0, 0, 0, 0], 0);
    await reject(create(1), 'SkrPriceNotConfigured');
    expect(await c.getAccountInfo(field(1))).to.eq(null);
    await reject(program.methods.configureSkrPricing(prices.map(v => new BN(v)), new BN(1_000_000)).accountsPartial({ config, authority: buyer.publicKey, skrMint: skr, pricing: pricing(), systemProgram: SystemProgram.programId }).signers([buyer]).rpc(), 'ConstraintHasOne');
    await configure();
  });
  it('does not accept a legacy POTATO purchase', async () => {
    await reject(program.methods.createField(new BN(99), 1).accountsPartial({ config, field: field(99), owner: admin.publicKey, potatoMint: potato, userPotato: adminPotato, systemProgram: SystemProgram.programId, tokenProgram: TOKEN_PROGRAM_ID }).rpc(), 'LegacyPaymentDisabled');
    expect(await c.getAccountInfo(field(99))).to.eq(null);
  });
  it('enforces the wallet maximum and atomically rolls back on failure', async () => {
    const before = await balance(buyerSkr);
    await reject(create(1, 1), 'SkrPriceChanged');
    expect(await balance(buyerSkr)).to.eq(before); expect(await c.getAccountInfo(field(1))).to.eq(null);
  });
  it('creation transfers SKR to the canonical vault; no POTATO burn or SOL purchase', async () => {
    const before = await balance(buyerSkr); const vaultBefore = await balance(vault);
    const supply = (await getMint(c, potato)).supply; const sol = await c.getBalance(buyer.publicKey);
    await create(1);
    expect(before - await balance(buyerSkr)).to.eq(10_000_000n);
    expect(await balance(vault) - vaultBefore).to.eq(10_000_000n);
    expect((await getMint(c, potato)).supply).to.eq(supply);
    const account = (await c.getAccountInfo(field(1)))!;
    // Buyer pays only Field account rent; provider/admin pays the transaction fee.
    expect(sol - await c.getBalance(buyer.publicKey)).to.eq(account.lamports);
    expect((await program.account.gameConfig.fetch(config)).totalBurnedMicro.toString()).to.eq('0');
  });
  it('wrong mint, source owner, treasury and field owner are rejected', async () => {
    const foreignAta = (await getOrCreateAssociatedTokenAccount(c, admin, foreign, buyer.publicKey)).address;
    await reject(program.methods.createFieldSkr(new BN(2), 1, new BN(10_000_000)).accountsPartial({ ...payment(), field: field(2), skrMint: foreign, userSkr: foreignAta }).signers([buyer]).rpc());
    await reject(program.methods.createFieldSkr(new BN(2), 1, new BN(10_000_000)).accountsPartial({ ...payment(), field: field(2), userSkr: adminSkr }).signers([buyer]).rpc());
    await reject(program.methods.createFieldSkr(new BN(2), 1, new BN(10_000_000)).accountsPartial({ ...payment(), field: field(2), treasurySkr: adminSkr }).signers([buyer]).rpc());
    await reject(program.methods.serviceFieldSkr(2, new BN(100_000_000)).accountsPartial({ ...payment(admin.publicKey, adminSkr), field: field(1) }).rpc(), 'ConstraintHasOne');
  });
  it('upgrade, tax and fertilizer are paid in SKR without burning POTATO', async () => {
    const before = await balance(buyerSkr); const supply = (await getMint(c, potato)).supply;
    await service(2); await service(3); await service(4);
    expect(before - await balance(buyerSkr)).to.eq(4_000_000n); // L1 upgrade 2 + L2 tax 1 + fertilizer 1
    expect((await getMint(c, potato)).supply).to.eq(supply);
    expect((await program.account.field.fetch(field(1))).level).to.eq(2);
    await reject(service(1), 'NothingToRepair');
  });
  it('pause blocks SKR spending', async () => {
    await program.methods.setPaused(true).accountsPartial({ config, authority: admin.publicKey }).rpc();
    try { await reject(create(3), 'Paused'); await reject(service(2), 'Paused'); }
    finally { await program.methods.setPaused(false).accountsPartial({ config, authority: admin.publicKey }).rpc(); }
  });
  it('referral registration is paid once in SKR', async () => {
    const referral = pda(Buffer.from('referral'), buyer.publicKey.toBuffer());
    const before = await balance(buyerSkr);
    await program.methods.registerReferrerSkr(stranger.publicKey, new BN(1_000_000)).accountsPartial({ ...payment(), referral }).signers([buyer]).rpc();
    expect(before - await balance(buyerSkr)).to.eq(1_000_000n);
    await reject(program.methods.registerReferrerSkr(stranger.publicKey, new BN(1_000_000)).accountsPartial({ ...payment(), referral }).signers([buyer]).rpc());
  });
  it('new SKR orders escrow only the POTATO resource, not an additional POTATO fee', async () => {
    const before = await balance(adminPotato);
    await program.methods.createSkrOrder(new BN(1), new BN(10_000_000), new BN(2_000_000)).accountsPartial(listing(1)).rpc();
    expect(before - await balance(adminPotato)).to.eq(10_000_000n);
    const stored = await program.account.skrOrder.fetch(order(1));
    expect(stored.skrMint.equals(skr)).to.eq(true); expect(stored.priceSkrAtoms.toNumber()).to.eq(2_000_000);
  });
  it('fill rejects stale maximum and foreign mint without moving balances', async () => {
    const before = await balance(buyerSkr);
    await reject(program.methods.fillSkrOrder(new BN(1)).accountsPartial(fill(1)).signers([buyer]).rpc(), 'SkrPriceChanged');
    await reject(program.methods.fillSkrOrder(new BN(20_000_000)).accountsPartial({ ...fill(1), skrMint: foreign }).signers([buyer]).rpc());
    expect(await balance(buyerSkr)).to.eq(before); expect(await balance(escrow(1))).to.eq(10_000_000n);
  });
  it('settles buyer→seller/treasury in SKR, transfers POTATO and refunds SOL rent only', async () => {
    // Deliberate unsolicited dust must not prevent closing the escrow.
    await transfer(c, admin, adminPotato, escrow(1), admin, 1n);
    const rent = (await c.getAccountInfo(order(1)))!.lamports + (await c.getAccountInfo(escrow(1)))!.lamports;
    const sellerBefore = await balance(adminSkr), buyerBefore = await balance(buyerSkr), vaultBefore = await balance(vault);
    const potatoes = await balance(buyerPotato); const skrSupply = (await getMint(c, skr)).supply;
    const tx = await program.methods.fillSkrOrder(new BN(20_000_000)).accountsPartial(fill(1)).signers([buyer]).rpc();
    expect(buyerBefore - await balance(buyerSkr)).to.eq(20_000_000n);
    expect(await balance(adminSkr) - sellerBefore).to.eq(18_200_000n);
    expect(await balance(vault) - vaultBefore).to.eq(1_800_000n);
    expect(await balance(buyerPotato) - potatoes).to.eq(10_000_000n);
    expect((await getMint(c, skr)).supply).to.eq(skrSupply);
    expect(await c.getAccountInfo(order(1))).to.eq(null); expect(await c.getAccountInfo(escrow(1))).to.eq(null);
    const record = await c.getTransaction(tx, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 });
    assert.isNotNull(record);
    // The buyer is not fee payer and no account is created here: its SOL is untouched.
    const keys = record!.transaction.message.getAccountKeys().staticAccountKeys;
    const index = keys.findIndex(k => k.equals(buyer.publicKey));
    expect(record!.meta!.postBalances[index]).to.eq(record!.meta!.preBalances[index]);
    assert.isAbove(rent, 0);
  });
  it('cancellation works while paused and returns all escrowed resource', async () => {
    await program.methods.createSkrOrder(new BN(2), new BN(10_000_000), new BN(2_000_000)).accountsPartial(listing(2)).rpc();
    await transfer(c, admin, adminPotato, escrow(2), admin, 5n);
    await program.methods.setPaused(true).accountsPartial({ config, authority: admin.publicKey }).rpc();
    const before = await balance(adminPotato);
    try { await program.methods.cancelSkrOrder().accountsPartial({ seller: admin.publicKey, sellerProfile: profile(admin.publicKey), order: order(2), escrow: escrow(2), sellerPotato: adminPotato, tokenProgram: TOKEN_PROGRAM_ID }).rpc(); }
    finally { await program.methods.setPaused(false).accountsPartial({ config, authority: admin.publicKey }).rpc(); }
    expect(await balance(adminPotato) - before).to.eq(10_000_005n);
    await reject(program.methods.createSkrOrder(new BN(3), new BN(10_000_000), new BN(2_000_000)).accountsPartial(listing(3)).rpc(), 'CancelCooldown');
  });
  it('harvest still produces POTATO; repair is charged in SKR; close returns rent', async function () {
    this.timeout(120_000); await new Promise(r => setTimeout(r, 62_000));
    const before = await balance(buyerPotato);
    await program.methods.batchHarvest().accountsPartial({ config, epoch, potatoMint: potato, userPotato: buyerPotato, treasuryPotato: potatoVault, owner: buyer.publicKey, tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId, associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID }).remainingAccounts([{ pubkey: field(1), isWritable: true, isSigner: false }]).signers([buyer]).rpc();
    expect(await balance(buyerPotato) > before).to.eq(true);
    const skrBefore = await balance(buyerSkr); await service(1);
    expect(skrBefore - await balance(buyerSkr)).to.eq(1_000_000n);
    const rent = (await c.getAccountInfo(field(1)))!.lamports; const sol = await c.getBalance(buyer.publicKey);
    await program.methods.closeField().accountsPartial({ field: field(1), owner: buyer.publicKey }).signers([buyer]).rpc();
    expect(await c.getBalance(buyer.publicKey) - sol).to.eq(rent);
  });
  it('SKR treasury withdrawal is authority-only and transfers SKR, never mints it', async () => {
    const before = await balance(adminSkr); const supply = (await getMint(c, skr)).supply;
    await reject(program.methods.withdrawSkrTreasury(new BN(1)).accountsPartial({ config, treasurySol: treasury, treasurySkrAta: vault, authority: buyer.publicKey, skrMint: skr, destinationAta: buyerSkr, systemProgram: SystemProgram.programId, tokenProgram: TOKEN_PROGRAM_ID, associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID }).signers([buyer]).rpc(), 'ConstraintHasOne');
    await program.methods.withdrawSkrTreasury(new BN(1)).accountsPartial({ config, treasurySol: treasury, treasurySkrAta: vault, authority: admin.publicKey, skrMint: skr, destinationAta: adminSkr, systemProgram: SystemProgram.programId, tokenProgram: TOKEN_PROGRAM_ID, associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID }).rpc();
    expect(await balance(adminSkr) - before).to.eq(1n); expect((await getMint(c, skr)).supply).to.eq(supply);
  });
});
