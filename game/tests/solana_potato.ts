import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY } from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  AuthorityType,
  TOKEN_PROGRAM_ID,
  createMint,
  getAccount,
  getAssociatedTokenAddressSync,
  getOrCreateAssociatedTokenAccount,
  setAuthority,
} from "@solana/spl-token";
import { assert, expect } from "chai";
import { SolanaPotato } from "../target/types/solana_potato";

const MICRO = 1_000_000n;
const u64 = (v: bigint | number) => {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(BigInt(v));
  return b;
};

describe("solana_potato", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.SolanaPotato as Program<SolanaPotato>;
  const connection = provider.connection;
  const admin = (provider.wallet as anchor.Wallet).payer;

  const pda = (...seeds: (Buffer | Uint8Array)[]) => PublicKey.findProgramAddressSync(seeds, program.programId)[0];
  const configPda = pda(Buffer.from("config"));
  const epochPda = (id: number) => pda(Buffer.from("epoch"), u64(id));
  const fieldPda = (id: bigint) => pda(Buffer.from("field"), u64(id));
  const orderPda = (id: bigint) => pda(Buffer.from("order"), u64(id));
  const escrowPda = (order: PublicKey) => pda(Buffer.from("escrow"), order.toBuffer());
  const sellerProfilePda = (seller: PublicKey) => pda(Buffer.from("seller"), seller.toBuffer());
  const marketStatsPda = pda(Buffer.from("market_stats"));

  let mint: PublicKey;
  let adminAta: PublicKey;
  let treasuryAta: PublicKey;
  const player = Keypair.generate();
  let playerAta: PublicKey;

  const ataBalance = async (ata: PublicKey) => (await getAccount(connection, ata)).amount;

  /** Expects the promise to fail with the given Anchor error name (or any error when omitted). */
  async function expectFail(p: Promise<unknown>, errorName?: string) {
    try {
      await p;
    } catch (err: unknown) {
      if (errorName) {
        const msg = err instanceof Error ? err.message : String(err);
        const code = (err as { error?: { errorCode?: { code?: string } } }).error?.errorCode?.code;
        expect(code ?? msg, `expected ${errorName}`).to.satisfy((v: string) => v.includes(errorName));
      }
      return;
    }
    assert.fail(`expected failure${errorName ? ` (${errorName})` : ""}`);
  }

  const fieldSpendAccounts = (field: PublicKey, owner: PublicKey, userPotato: PublicKey) => ({
    field, potatoMint: mint, userPotato, config: configPda, owner, tokenProgram: TOKEN_PROGRAM_ID,
  });

  before(async () => {
    const sig = await connection.requestAirdrop(player.publicKey, 5 * LAMPORTS_PER_SOL);
    await connection.confirmTransaction(sig);
  });

  describe("initialize", () => {
    it("rejects a mint whose authority is not the config PDA", async () => {
      const wrongMint = await createMint(connection, admin, admin.publicKey, null, 6);
      await expectFail(
        program.methods.initialize().accountsPartial({
          config: configPda, potatoMint: wrongMint, authority: admin.publicKey, systemProgram: SystemProgram.programId,
        }).rpc(),
        "InvalidMintAuthority",
      );
    });

    it("creates GameConfig and epoch 0", async () => {
      mint = await createMint(connection, admin, admin.publicKey, null, 6);
      await setAuthority(connection, admin, mint, admin.publicKey, AuthorityType.MintTokens, configPda);

      await program.methods.initialize().accountsPartial({
        config: configPda, potatoMint: mint, authority: admin.publicKey, systemProgram: SystemProgram.programId,
      }).rpc();
      await program.methods.initEpoch().accountsPartial({
        config: configPda, epoch: epochPda(0), authority: admin.publicKey, systemProgram: SystemProgram.programId,
      }).rpc();

      const cfg = await program.account.gameConfig.fetch(configPda);
      expect(cfg.authority.equals(admin.publicKey)).to.be.true;
      expect(cfg.potatoMint.equals(mint)).to.be.true;
      expect(cfg.epochId.toNumber()).to.eq(0);
      expect(cfg.dailyMintCapMicro.toString()).to.eq("250000000000");
      expect(cfg.paused).to.be.false;

      adminAta = (await getOrCreateAssociatedTokenAccount(connection, admin, mint, admin.publicKey)).address;
      playerAta = (await getOrCreateAssociatedTokenAccount(connection, admin, mint, player.publicKey)).address;
      treasuryAta = getAssociatedTokenAddressSync(mint, configPda, true);
    });

    it("cannot be initialized twice", async () => {
      await expectFail(
        program.methods.initialize().accountsPartial({
          config: configPda, potatoMint: mint, authority: admin.publicKey, systemProgram: SystemProgram.programId,
        }).rpc(),
      );
    });
  });

  describe("grant_reward", () => {
    it("authority can mint a bounded reward", async () => {
      await program.methods.grantReward(new BN(1_000_000_000)).accountsPartial({
        config: configPda, epoch: epochPda(0), authority: admin.publicKey, potatoMint: mint, userPotato: adminAta, tokenProgram: TOKEN_PROGRAM_ID,
      }).rpc();
      await program.methods.grantReward(new BN(1_000_000_000)).accountsPartial({
        config: configPda, epoch: epochPda(0), authority: admin.publicKey, potatoMint: mint, userPotato: playerAta, tokenProgram: TOKEN_PROGRAM_ID,
      }).rpc();
      expect(await ataBalance(adminAta)).to.eq(1000n * MICRO);
      const epoch = await program.account.epoch.fetch(epochPda(0));
      expect(epoch.mintedMicro.toString()).to.eq("2000000000");
    });

    it("rejects rewards above 1000 POTATO", async () => {
      await expectFail(
        program.methods.grantReward(new BN(1_000_000_001)).accountsPartial({
          config: configPda, epoch: epochPda(0), authority: admin.publicKey, potatoMint: mint, userPotato: adminAta, tokenProgram: TOKEN_PROGRAM_ID,
        }).rpc(),
        "RewardTooLarge",
      );
    });

    it("rejects a non-authority signer", async () => {
      await expectFail(
        program.methods.grantReward(new BN(1_000_000)).accountsPartial({
          config: configPda, epoch: epochPda(0), authority: player.publicKey, potatoMint: mint, userPotato: playerAta, tokenProgram: TOKEN_PROGRAM_ID,
        }).signers([player]).rpc(),
      );
    });
  });

  describe("fields", () => {
    const fieldId = BigInt(Date.now());
    let field: PublicKey;

    it("create_field burns the type price and registers the field", async () => {
      field = fieldPda(fieldId);
      const before = await ataBalance(adminAta);
      await program.methods.createField(new BN(fieldId.toString()), 1).accountsPartial({
        config: configPda, field, owner: admin.publicKey, potatoMint: mint, userPotato: adminAta,
        systemProgram: SystemProgram.programId, tokenProgram: TOKEN_PROGRAM_ID,
      }).rpc();
      expect(before - (await ataBalance(adminAta))).to.eq(250n * MICRO);
      const f = await program.account.field.fetch(field);
      expect(f.level).to.eq(1);
      expect(f.durability).to.eq(100);
      expect(f.fieldType).to.eq(1);
      expect(f.owner.equals(admin.publicKey)).to.be.true;
      const cfg = await program.account.gameConfig.fetch(configPda);
      expect(cfg.fieldCount.toNumber()).to.eq(1);
      expect(cfg.totalBurnedMicro.toString()).to.eq((250n * MICRO).toString());
    });

    it("rejects an invalid field type", async () => {
      await expectFail(
        program.methods.createField(new BN(Date.now() + 1), 3).accountsPartial({
          config: configPda, field: fieldPda(BigInt(Date.now() + 1)), owner: admin.publicKey, potatoMint: mint, userPotato: adminAta,
          systemProgram: SystemProgram.programId, tokenProgram: TOKEN_PROGRAM_ID,
        }).rpc(),
        "InvalidFieldType",
      );
    });

    it("rejects paying with a foreign mint", async () => {
      const fake = await createMint(connection, admin, admin.publicKey, null, 6);
      const fakeAta = (await getOrCreateAssociatedTokenAccount(connection, admin, fake, admin.publicKey)).address;
      const id = BigInt(Date.now() + 2);
      await expectFail(
        program.methods.createField(new BN(id.toString()), 0).accountsPartial({
          config: configPda, field: fieldPda(id), owner: admin.publicKey, potatoMint: fake, userPotato: fakeAta,
          systemProgram: SystemProgram.programId, tokenProgram: TOKEN_PROGRAM_ID,
        }).rpc(),
        "ConstraintHasOne",
      );
    });

    it("harvest too soon is rejected", async () => {
      await expectFail(
        program.methods.harvest().accountsPartial({
          config: configPda, epoch: epochPda(0), field, potatoMint: mint, userPotato: adminAta, owner: admin.publicKey, tokenProgram: TOKEN_PROGRAM_ID,
        }).rpc(),
        "HarvestTooSoon",
      );
    });

    it("only the owner can act on a field", async () => {
      await expectFail(
        program.methods.repairField().accountsPartial(fieldSpendAccounts(field, player.publicKey, playerAta)).signers([player]).rpc(),
      );
    });

    it("repair is rejected at full durability", async () => {
      await expectFail(
        program.methods.repairField().accountsPartial(fieldSpendAccounts(field, admin.publicKey, adminAta)).rpc(),
        "NothingToRepair",
      );
    });

    it("upgrade burns 100 × level and raises the level", async () => {
      const before = await ataBalance(adminAta);
      await program.methods.upgradeField().accountsPartial(fieldSpendAccounts(field, admin.publicKey, adminAta)).rpc();
      expect(before - (await ataBalance(adminAta))).to.eq(100n * MICRO);
      expect((await program.account.field.fetch(field)).level).to.eq(2);
    });

    it("tax can be prepaid up to 28 days, not more", async () => {
      for (let i = 0; i < 3; i++) {
        await program.methods.payTax().accountsPartial(fieldSpendAccounts(field, admin.publicKey, adminAta)).rpc();
      }
      const f = await program.account.field.fetch(field);
      const now = Math.floor(Date.now() / 1000);
      expect(f.taxPaidUntil.toNumber()).to.be.greaterThan(now + 27 * 86400);
      await expectFail(
        program.methods.payTax().accountsPartial(fieldSpendAccounts(field, admin.publicKey, adminAta)).rpc(),
        "PrepayLimitReached",
      );
    });

    it("fertilizer stacks up to 7 days", async () => {
      for (let i = 0; i < 7; i++) {
        await program.methods.applyFertilizer().accountsPartial(fieldSpendAccounts(field, admin.publicKey, adminAta)).rpc();
      }
      await expectFail(
        program.methods.applyFertilizer().accountsPartial(fieldSpendAccounts(field, admin.publicKey, adminAta)).rpc(),
        "PrepayLimitReached",
      );
    });

    it("harvest mints yield after the interval and wears the field", async function () {
      this.timeout(120_000);
      await new Promise((r) => setTimeout(r, 61_000));
      const before = await ataBalance(adminAta);
      const epochBefore = (await program.account.epoch.fetch(epochPda(0))).mintedMicro;
      await program.methods.harvest().accountsPartial({
        config: configPda, epoch: epochPda(0), field, potatoMint: mint, userPotato: adminAta, owner: admin.publicKey, tokenProgram: TOKEN_PROGRAM_ID,
      }).rpc();
      const minted = (await ataBalance(adminAta)) - before;
      expect(minted > 0n, "should mint something").to.be.true;
      // level 2 (1.57×) × fertilizer (1.5×) × 6 POTATO/day for ~61s ≈ 0.01 POTATO
      expect(minted < 100_000n, "should mint a small amount").to.be.true;
      const f = await program.account.field.fetch(field);
      expect(f.durability).to.eq(99);
      const epochAfter = (await program.account.epoch.fetch(epochPda(0))).mintedMicro;
      expect(epochAfter.sub(epochBefore).toString()).to.eq(minted.toString());
    });

    it("repair restores durability", async () => {
      await program.methods.repairField().accountsPartial(fieldSpendAccounts(field, admin.publicKey, adminAta)).rpc();
      expect((await program.account.field.fetch(field)).durability).to.eq(100);
    });
  });

  describe("marketplace", () => {
    const orderId = BigInt(Date.now() + 100);
    let order: PublicKey;
    let escrow: PublicKey;

    const createOrderAccounts = (id: bigint, seller: PublicKey, sellerPotato: PublicKey) => ({
      seller, config: configPda, sellerProfile: sellerProfilePda(seller), order: orderPda(id), marketStats: marketStatsPda,
      sellerPotato, escrow: escrowPda(orderPda(id)), potatoMint: mint,
      tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId, rent: SYSVAR_RENT_PUBKEY,
    });

    it("rejects orders whose SOL total rounds to nothing", async () => {
      const id = BigInt(Date.now() + 99);
      await expectFail(
        program.methods.createSellOrder(new BN(id.toString()), new BN(100_000), new BN(1))
          .accountsPartial(createOrderAccounts(id, admin.publicKey, adminAta)).rpc(),
        "OrderTotalTooSmall",
      );
    });

    it("create_sell_order escrows amount + fee", async () => {
      order = orderPda(orderId);
      escrow = escrowPda(order);
      const before = await ataBalance(adminAta);
      // 10 POTATO at 0.001 SOL each
      await program.methods.createSellOrder(new BN(orderId.toString()), new BN(10_000_000), new BN(1_000_000))
        .accountsPartial(createOrderAccounts(orderId, admin.publicKey, adminAta)).rpc();
      expect(before - (await ataBalance(adminAta))).to.eq(10_300_000n); // 3 % fee tier
      expect(await ataBalance(escrow)).to.eq(10_300_000n);
      const o = await program.account.marketOrder.fetch(order);
      expect(o.feeMicro.toNumber()).to.eq(300_000);
      expect(o.expiresAt.toNumber() - o.createdAt.toNumber()).to.eq(86_400);
    });

    it("self-trade is blocked", async () => {
      await expectFail(
        program.methods.fillOrder().accountsPartial({
          buyer: admin.publicKey, seller: admin.publicKey, config: configPda, potatoMint: mint, marketStats: marketStatsPda,
          order, escrow, buyerPotato: adminAta, treasuryPotato: treasuryAta,
          tokenProgram: TOKEN_PROGRAM_ID, associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
        }).rpc(),
        "SelfTradeBlocked",
      );
    });

    it("close_expired_order is rejected before expiry", async () => {
      await expectFail(
        program.methods.closeExpiredOrder().accountsPartial({
          order, escrow, sellerPotato: adminAta, seller: admin.publicKey, tokenProgram: TOKEN_PROGRAM_ID,
        }).rpc(),
        "OrderNotExpired",
      );
    });

    it("fill_order pays SOL to seller, tokens to buyer, splits the fee and closes the order", async () => {
      const sellerSolBefore = await connection.getBalance(admin.publicKey);
      const buyerBefore = await ataBalance(playerAta);
      await program.methods.fillOrder().accountsPartial({
        buyer: player.publicKey, seller: admin.publicKey, config: configPda, potatoMint: mint, marketStats: marketStatsPda,
        order, escrow, buyerPotato: playerAta, treasuryPotato: treasuryAta,
        tokenProgram: TOKEN_PROGRAM_ID, associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
      }).signers([player]).rpc();

      expect((await ataBalance(playerAta)) - buyerBefore).to.eq(10_000_000n);
      expect(await ataBalance(treasuryAta)).to.eq(120_000n); // 40 % of the 0.3 fee
      const sellerSolAfter = await connection.getBalance(admin.publicKey);
      // 10 POTATO × 0.001 SOL = 0.01 SOL, plus escrow + order rent refunds
      expect(sellerSolAfter - sellerSolBefore).to.be.greaterThan(10_000_000);
      expect(await connection.getAccountInfo(order)).to.be.null;
      expect(await connection.getAccountInfo(escrow)).to.be.null;
      const stats = await program.account.marketStats.fetch(marketStatsPda);
      expect(stats.totalTrades.toNumber()).to.eq(1);
      expect(stats.totalSolVolume.toNumber()).to.eq(10_000_000);
      const cfg = await program.account.gameConfig.fetch(configPda);
      expect(cfg.totalBurnedMicro.toNumber()).to.be.greaterThan(250_000_000 + 180_000);
    });

    it("cancel_order refunds and starts the cooldown", async () => {
      const id = BigInt(Date.now() + 200);
      await program.methods.createSellOrder(new BN(id.toString()), new BN(1_000_000), new BN(1_000_000))
        .accountsPartial(createOrderAccounts(id, player.publicKey, playerAta)).signers([player]).rpc();
      const before = await ataBalance(playerAta);
      await program.methods.cancelOrder().accountsPartial({
        seller: player.publicKey, sellerProfile: sellerProfilePda(player.publicKey), order: orderPda(id), escrow: escrowPda(orderPda(id)),
        sellerPotato: playerAta, tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
      }).signers([player]).rpc();
      expect((await ataBalance(playerAta)) - before).to.eq(1_030_000n);

      const id2 = BigInt(Date.now() + 201);
      await expectFail(
        program.methods.createSellOrder(new BN(id2.toString()), new BN(1_000_000), new BN(1_000_000))
          .accountsPartial(createOrderAccounts(id2, player.publicKey, playerAta)).signers([player]).rpc(),
        "CancelCooldown",
      );
    });
  });

  describe("admin", () => {
    it("roll_epoch is rejected before 24h", async () => {
      await expectFail(
        program.methods.rollEpoch().accountsPartial({
          config: configPda, currentEpoch: epochPda(0), nextEpoch: epochPda(1), payer: admin.publicKey, systemProgram: SystemProgram.programId,
        }).rpc(),
        "EpochNotOver",
      );
    });

    it("pause blocks spends and can be lifted", async () => {
      await program.methods.setPaused(true).accountsPartial({ config: configPda, authority: admin.publicKey }).rpc();
      const id = BigInt(Date.now() + 300);
      await expectFail(
        program.methods.createField(new BN(id.toString()), 0).accountsPartial({
          config: configPda, field: fieldPda(id), owner: admin.publicKey, potatoMint: mint, userPotato: adminAta,
          systemProgram: SystemProgram.programId, tokenProgram: TOKEN_PROGRAM_ID,
        }).rpc(),
        "Paused",
      );
      await program.methods.setPaused(false).accountsPartial({ config: configPda, authority: admin.publicKey }).rpc();
    });

    it("update_config enforces ceilings", async () => {
      await expectFail(
        program.methods.updateConfig(new BN("250000000001"), null, null).accountsPartial({ config: configPda, authority: admin.publicKey }).rpc(),
        "CapTooHigh",
      );
      await expectFail(
        program.methods.updateConfig(null, null, 20_001).accountsPartial({ config: configPda, authority: admin.publicKey }).rpc(),
        "MultiplierTooHigh",
      );
      await program.methods.updateConfig(new BN("100000000000"), new BN(4_000_000), 12_000)
        .accountsPartial({ config: configPda, authority: admin.publicKey }).rpc();
      const cfg = await program.account.gameConfig.fetch(configPda);
      expect(cfg.dailyMintCapMicro.toString()).to.eq("100000000000");
      expect(cfg.baseYieldMicroPerDay.toNumber()).to.eq(4_000_000);
      expect(cfg.globalMultiplierBps).to.eq(12_000);
    });

    it("withdraw_treasury only for the authority", async () => {
      await expectFail(
        program.methods.withdrawTreasury(new BN(1)).accountsPartial({
          config: configPda, potatoMint: mint, treasuryPotato: treasuryAta, destination: playerAta, authority: player.publicKey, tokenProgram: TOKEN_PROGRAM_ID,
        }).signers([player]).rpc(),
      );
      const before = await ataBalance(adminAta);
      await program.methods.withdrawTreasury(new BN(100_000)).accountsPartial({
        config: configPda, potatoMint: mint, treasuryPotato: treasuryAta, destination: adminAta, authority: admin.publicKey, tokenProgram: TOKEN_PROGRAM_ID,
      }).rpc();
      expect((await ataBalance(adminAta)) - before).to.eq(100_000n);
    });

    it("two-step authority transfer", async () => {
      const next = Keypair.generate();
      await expectFail(
        program.methods.acceptAuthority().accountsPartial({ config: configPda, newAuthority: next.publicKey }).signers([next]).rpc(),
        "Unauthorized",
      );
      await program.methods.proposeAuthority(next.publicKey).accountsPartial({ config: configPda, authority: admin.publicKey }).rpc();
      await program.methods.acceptAuthority().accountsPartial({ config: configPda, newAuthority: next.publicKey }).signers([next]).rpc();
      let cfg = await program.account.gameConfig.fetch(configPda);
      expect(cfg.authority.equals(next.publicKey)).to.be.true;
      expect(cfg.pendingAuthority.equals(PublicKey.default)).to.be.true;

      // hand it back so later runs on the same ledger keep working
      await program.methods.proposeAuthority(admin.publicKey).accountsPartial({ config: configPda, authority: next.publicKey }).signers([next]).rpc();
      await program.methods.acceptAuthority().accountsPartial({ config: configPda, newAuthority: admin.publicKey }).rpc();
      cfg = await program.account.gameConfig.fetch(configPda);
      expect(cfg.authority.equals(admin.publicKey)).to.be.true;
    });
  });
});
