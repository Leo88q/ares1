import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY, SYSVAR_SLOT_HASHES_PUBKEY, Transaction } from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  AuthorityType,
  TOKEN_PROGRAM_ID,
  createMint,
  getAccount,
  getAssociatedTokenAddressSync,
  getMint,
  getOrCreateAssociatedTokenAccount,
  setAuthority,
  transfer,
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
  const adminStatePda = pda(Buffer.from("admin_state"));

  let mint: PublicKey;
  const presaleFieldIds: bigint[] = [];
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
        expect(code ?? msg, `expected ${errorName}, got: ${code ?? msg}`).to.satisfy((v: string) => v.includes(errorName));
      }
      return;
    }
    assert.fail(`expected failure${errorName ? ` (${errorName})` : ""}`);
  }

  const fieldSpendAccounts = (field: PublicKey, owner: PublicKey, userPotato: PublicKey) => ({
    field, potatoMint: mint, userPotato, config: configPda, owner, tokenProgram: TOKEN_PROGRAM_ID,
  });

  const createOrderAccounts = (id: bigint, seller: PublicKey, sellerPotato: PublicKey) => ({
    seller, config: configPda, sellerProfile: sellerProfilePda(seller), order: orderPda(id), marketStats: marketStatsPda,
    sellerPotato, escrow: escrowPda(orderPda(id)), potatoMint: mint,
    tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId, rent: SYSVAR_RENT_PUBKEY,
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
      // Казна-ATA должна существовать до первого harvest/fill_order
      // (программа требует инициализированный аккаунт, а не init_if_needed)
      await getOrCreateAssociatedTokenAccount(connection, admin, mint, configPda, true);
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

  describe("reward signer separation", () => {
    it("delegates mint only, rejects admin actions, and revokes the old signer", async () => {
      const rewardSigner = Keypair.generate();
      const rewardAta = (await getOrCreateAssociatedTokenAccount(connection, admin, mint, rewardSigner.publicKey)).address;
      const reward = (amount: number) => program.methods.grantReward(new BN(amount)).accountsPartial({
        config: configPda, epoch: epochPda(0), authority: rewardSigner.publicKey,
        potatoMint: mint, userPotato: rewardAta, tokenProgram: TOKEN_PROGRAM_ID,
      }).signers([rewardSigner]).rpc();
      await program.methods.updateRewardSigner(rewardSigner.publicKey).accountsPartial({ config: configPda, authority: admin.publicKey }).rpc();
      try {
        const before = (await program.account.epoch.fetch(epochPda(0))).mintedMicro;
        await reward(1);
        expect(await ataBalance(rewardAta)).to.eq(1n);
        expect((await program.account.epoch.fetch(epochPda(0))).mintedMicro.sub(before).toNumber()).to.eq(1);
        await expectFail(reward(0), "RewardTooLarge");
        await expectFail(reward(1_000_000_001), "RewardTooLarge");
        await expectFail(program.methods.setPaused(true).accountsPartial({ config: configPda, authority: rewardSigner.publicKey }).signers([rewardSigner]).rpc(), "Unauthorized");
        await expectFail(program.methods.updateRewardSigner(player.publicKey).accountsPartial({ config: configPda, authority: rewardSigner.publicKey }).signers([rewardSigner]).rpc(), "ConstraintHasOne");
      } finally {
        await program.methods.updateRewardSigner(admin.publicKey).accountsPartial({ config: configPda, authority: admin.publicKey }).rpc();
      }
      await expectFail(reward(2), "Unauthorized");
    });

    it("current-layout config migration is idempotent and authority-only", async () => {
      const before = (await connection.getAccountInfo(configPda))!.data;
      await expectFail(program.methods.migrateConfig().accountsPartial({ config: configPda, authority: player.publicKey, systemProgram: SystemProgram.programId }).signers([player]).rpc(), "Unauthorized");
      await program.methods.migrateConfig().accountsPartial({ config: configPda, authority: admin.publicKey, systemProgram: SystemProgram.programId }).rpc();
      expect((await connection.getAccountInfo(configPda))!.data.equals(before)).to.be.true;
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
      const id = BigInt(Date.now()) + 1n;
      await expectFail(
        program.methods.createField(new BN(id.toString()), 3).accountsPartial({
          config: configPda, field: fieldPda(id), owner: admin.publicKey, potatoMint: mint, userPotato: adminAta,
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
          config: configPda, epoch: epochPda(0), field, potatoMint: mint, userPotato: adminAta, owner: admin.publicKey,
          treasuryPotato: treasuryAta, tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
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
      // UpgradeField — единственный field-spend ix с sysvar slot_hashes (энтропия мутации).
      await program.methods.upgradeField().accountsPartial({ ...fieldSpendAccounts(field, admin.publicKey, adminAta), slotHashes: SYSVAR_SLOT_HASHES_PUBKEY }).rpc();
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
      const treasuryBefore = await ataBalance(treasuryAta);
      const epochBefore = (await program.account.epoch.fetch(epochPda(0))).mintedMicro;
      await program.methods.harvest().accountsPartial({
        config: configPda, epoch: epochPda(0), field, potatoMint: mint, userPotato: adminAta, owner: admin.publicKey,
        treasuryPotato: treasuryAta, tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      }).rpc();
      const minted = (await ataBalance(adminAta)) - before;
      expect(minted > 0n, "should mint something").to.be.true;
      // level 2 (1.57×) × fertilizer (1.5×) × 6 POTATO/day for ~61s ≈ 0.01 POTATO
      expect(minted < 100_000n, "should mint a small amount").to.be.true;
      const f = await program.account.field.fetch(field);
      expect(f.durability).to.eq(99);
      const epochAfter = (await program.account.epoch.fetch(epochPda(0))).mintedMicro;
      // epoch.minted counts the player's yield PLUS the treasury tax share
      const treasuryDelta = (await ataBalance(treasuryAta)) - treasuryBefore;
      expect(epochAfter.sub(epochBefore).toString()).to.eq((minted + treasuryDelta).toString());
    });

    it("repair restores durability", async () => {
      await program.methods.repairField().accountsPartial(fieldSpendAccounts(field, admin.publicKey, adminAta)).rpc();
      expect((await program.account.field.fetch(field)).durability).to.eq(100);
    });
  });

  describe("batch_harvest and close_field", () => {
    const owner = Keypair.generate();
    const ids = [900_000_001n, 900_000_002n];
    let ownerAta: PublicKey;
    const accounts = () => ({
      config: configPda, epoch: epochPda(0), potatoMint: mint, userPotato: ownerAta,
      treasuryPotato: treasuryAta, owner: owner.publicKey, tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId, associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
    });
    const batch = (fields: bigint[], writable = true) => program.methods.batchHarvest().accountsPartial(accounts())
      .remainingAccounts(fields.map(id => ({ pubkey: fieldPda(id), isWritable: writable, isSigner: false })))
      .signers([owner]).rpc();
    before(async () => {
      await connection.confirmTransaction(await connection.requestAirdrop(owner.publicKey, LAMPORTS_PER_SOL));
      ownerAta = (await getOrCreateAssociatedTokenAccount(connection, admin, mint, owner.publicKey)).address;
      await program.methods.grantReward(new BN(300_000_000)).accountsPartial({
        config: configPda, epoch: epochPda(0), authority: admin.publicKey, potatoMint: mint,
        userPotato: ownerAta, tokenProgram: TOKEN_PROGRAM_ID,
      }).rpc();
      for (const id of ids) {
        await program.methods.createField(new BN(id.toString()), 0).accountsPartial({
          config: configPda, field: fieldPda(id), owner: owner.publicKey, potatoMint: mint,
          userPotato: ownerAta, systemProgram: SystemProgram.programId, tokenProgram: TOKEN_PROGRAM_ID,
        }).signers([owner]).rpc();
      }
    });
    it("rejects empty, duplicate, read-only and premature batches", async () => {
      await expectFail(batch([]), "NothingToHarvest");
      await expectFail(batch([ids[0], ids[0]]), "BadProof");
      await expectFail(batch([ids[0]], false), "BadProof");
      await expectFail(batch([ids[0]]), "HarvestTooSoon");
    });
    it("mints once, persists readable fields, and cannot immediately harvest twice", async function () {
      this.timeout(120_000);
      await new Promise(resolve => setTimeout(resolve, 62_000));
      const before = await ataBalance(ownerAta);
      const treasuryBefore = await ataBalance(treasuryAta);
      const supplyBefore = (await getMint(connection, mint)).supply;
      const epochBefore = (await program.account.epoch.fetch(epochPda(0))).mintedMicro;
      const lastBefore = (await program.account.field.fetch(fieldPda(ids[0]))).lastHarvest;
      await batch(ids);
      const delta = await ataBalance(ownerAta) - before;
      const total = delta + (await ataBalance(treasuryAta) - treasuryBefore);
      expect(delta > 0n).to.be.true;
      expect((await getMint(connection, mint)).supply - supplyBefore).to.eq(total);
      expect((await program.account.epoch.fetch(epochPda(0))).mintedMicro.sub(epochBefore).toString()).to.eq(total.toString());
      for (const id of ids) {
        const field = await program.account.field.fetch(fieldPda(id));
        expect(field.owner.equals(owner.publicKey)).to.be.true;
        expect(field.lastHarvest.gt(lastBefore)).to.be.true;
        expect(field.durability).to.eq(99);
      }
      await expectFail(batch(ids), "HarvestTooSoon");
    });
    it("rejects a foreign owner and refunds rent on close even while paused", async () => {
      await expectFail(program.methods.closeField().accountsPartial({ field: fieldPda(ids[0]), owner: player.publicKey }).signers([player]).rpc(), "ConstraintHasOne");
      const rent = (await connection.getAccountInfo(fieldPda(ids[0])))!.lamports;
      const before = await connection.getBalance(owner.publicKey);
      const fieldCountBefore = (await program.account.gameConfig.fetch(configPda)).fieldCount;
      await program.methods.setPaused(true).accountsPartial({ config: configPda, authority: admin.publicKey }).rpc();
      try {
        await expectFail(batch(ids), "Paused");
        await program.methods.closeField().accountsPartial({ config: configPda, field: fieldPda(ids[0]), owner: owner.publicKey }).signers([owner]).rpc();
        expect(await connection.getAccountInfo(fieldPda(ids[0]))).to.eq(null);
        // Provider/admin pays the transaction fee, so the owner receives full rent.
        expect(await connection.getBalance(owner.publicKey)).to.eq(before + rent);
        // close_field декрементирует config.field_count — статистика не разъезжается.
        const fieldCountAfter = (await program.account.gameConfig.fetch(configPda)).fieldCount;
        expect(fieldCountAfter.toNumber()).to.eq(fieldCountBefore.toNumber() - 1);
      } finally {
        await program.methods.setPaused(false).accountsPartial({ config: configPda, authority: admin.publicKey }).rpc();
      }
    });
  });

  describe("marketplace", () => {
    const orderId = BigInt(Date.now() + 100);
    let order: PublicKey;
    let escrow: PublicKey;

    it("rejects orders whose SOL total rounds to nothing", async () => {
      // 10 POTATO at 0.00005 SOL each -> 0.5 SOL… wait: 10_000_000 * 50_000 / 1e6 = 500_000
      // lamports < 1_000_000 minimum total.
      const id = BigInt(Date.now() + 99);
      await expectFail(
        program.methods.createSellOrder(new BN(id.toString()), new BN(10_000_000), new BN(50_000))
          .accountsPartial(createOrderAccounts(id, admin.publicKey, adminAta)).rpc(),
        "OrderTotalTooSmall",
      );
    });

    it("rejects orders below the 10 POTATO minimum", async () => {
      const id = BigInt(Date.now() + 98);
      await expectFail(
        program.methods.createSellOrder(new BN(id.toString()), new BN(1_000_000), new BN(1_000_000))
          .accountsPartial(createOrderAccounts(id, admin.publicKey, adminAta)).rpc(),
        "OrderTooSmall",
      );
    });

    it("create_sell_order escrows amount + fee", async () => {
      order = orderPda(orderId);
      escrow = escrowPda(order);
      const before = await ataBalance(adminAta);
      // 10 POTATO at 0.001 SOL each
      await program.methods.createSellOrder(new BN(orderId.toString()), new BN(10_000_000), new BN(1_000_000))
        .accountsPartial(createOrderAccounts(orderId, admin.publicKey, adminAta)).rpc();
      expect(before - (await ataBalance(adminAta))).to.eq(10_900_000n); // 9 % fee tier
      expect(await ataBalance(escrow)).to.eq(10_900_000n);
      const o = await program.account.marketOrder.fetch(order);
      expect(o.feeMicro.toNumber()).to.eq(900_000);
      expect(o.expiresAt.toNumber() - o.createdAt.toNumber()).to.eq(86_400);
    });

    it("self-trade is blocked", async () => {
      await expectFail(
        program.methods.fillOrder().accountsPartial({
          buyer: admin.publicKey, seller: admin.publicKey, config: configPda, potatoMint: mint, marketStats: marketStatsPda,
          order, escrow, buyerPotato: adminAta, sellerPotato: adminAta, treasuryPotato: treasuryAta,
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
      const treasuryBefore = await ataBalance(treasuryAta);
      await program.methods.fillOrder().accountsPartial({
        buyer: player.publicKey, seller: admin.publicKey, config: configPda, potatoMint: mint, marketStats: marketStatsPda,
        order, escrow, buyerPotato: playerAta, sellerPotato: adminAta, treasuryPotato: treasuryAta,
        tokenProgram: TOKEN_PROGRAM_ID, associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
      }).signers([player]).rpc();

      expect((await ataBalance(playerAta)) - buyerBefore).to.eq(10_000_000n);
      expect((await ataBalance(treasuryAta)) - treasuryBefore).to.eq(360_000n); // 40 % of the 900 k fee
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
      await program.methods.createSellOrder(new BN(id.toString()), new BN(10_000_000), new BN(1_000_000))
        .accountsPartial(createOrderAccounts(id, player.publicKey, playerAta)).signers([player]).rpc();
      const before = await ataBalance(playerAta);
      await program.methods.cancelOrder().accountsPartial({
        seller: player.publicKey, sellerProfile: sellerProfilePda(player.publicKey), order: orderPda(id), escrow: escrowPda(orderPda(id)),
        sellerPotato: playerAta, tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
      }).signers([player]).rpc();
      expect((await ataBalance(playerAta)) - before).to.eq(10_900_000n); // 10 + 9 % fee

      const id2 = BigInt(Date.now() + 201);
      await expectFail(
        program.methods.createSellOrder(new BN(id2.toString()), new BN(10_000_000), new BN(1_000_000))
          .accountsPartial(createOrderAccounts(id2, player.publicKey, playerAta)).signers([player]).rpc(),
        "CancelCooldown",
      );
    });
  });

  describe("referrals", () => {
    const referrer = Keypair.generate();
    let referrerAta: PublicKey;
    const playerReferralPda = pda(Buffer.from("referral"), player.publicKey.toBuffer());

    it("register_referrer burns exactly 5 POTATO and stores the link once", async () => {
      referrerAta = (await getOrCreateAssociatedTokenAccount(connection, player, mint, referrer.publicKey)).address;
      // F-17: регистрация — трата, при паузе блокируется
      await program.methods.setPaused(true).accountsPartial({ config: configPda, authority: admin.publicKey }).rpc();
      await expectFail(
        program.methods.registerReferrer(referrer.publicKey).accountsPartial({
          referral: playerReferralPda, config: configPda, potatoMint: mint, userPotato: playerAta,
          owner: player.publicKey, tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
        }).signers([player]).rpc(),
        "Paused",
      );
      await program.methods.setPaused(false).accountsPartial({ config: configPda, authority: admin.publicKey }).rpc();
      const before = await ataBalance(playerAta);
      const supplyBefore = (await getMint(connection, mint)).supply;
      await program.methods.registerReferrer(referrer.publicKey).accountsPartial({
        referral: playerReferralPda, config: configPda, potatoMint: mint, userPotato: playerAta,
        owner: player.publicKey, tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
      }).signers([player]).rpc();
      expect(before - (await ataBalance(playerAta))).to.eq(5_000_000n);
      expect(supplyBefore - (await getMint(connection, mint)).supply).to.eq(5_000_000n);
      const r = await program.account.referral.fetch(playerReferralPda);
      expect(r.owner.equals(player.publicKey)).to.be.true;
      expect(r.referrer.equals(referrer.publicKey)).to.be.true;
    });

    it("registration rejects 4.999999 POTATO atomically and succeeds with exactly 5", async () => {
      const newcomer = Keypair.generate();
      await connection.confirmTransaction(await connection.requestAirdrop(newcomer.publicKey, LAMPORTS_PER_SOL));
      const newcomerAta = (await getOrCreateAssociatedTokenAccount(connection, admin, mint, newcomer.publicKey)).address;
      const referral = pda(Buffer.from("referral"), newcomer.publicKey.toBuffer());
      await transfer(connection, admin, adminAta, newcomerAta, admin, 4_999_999n);
      const register = () => program.methods.registerReferrer(referrer.publicKey).accountsPartial({
        referral, config: configPda, potatoMint: mint, userPotato: newcomerAta,
        owner: newcomer.publicKey, tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
      }).signers([newcomer]).rpc();
      const supplyBefore = (await getMint(connection, mint)).supply;
      const rentBefore = await connection.getBalance(newcomer.publicKey);
      await expectFail(register());
      expect(await ataBalance(newcomerAta)).to.eq(4_999_999n);
      expect((await getMint(connection, mint)).supply).to.eq(supplyBefore);
      expect(await connection.getAccountInfo(referral)).to.be.null;
      expect(await connection.getBalance(newcomer.publicKey)).to.eq(rentBefore);

      await transfer(connection, admin, adminAta, newcomerAta, admin, 1n);
      await register();
      expect(await ataBalance(newcomerAta)).to.eq(0n);
      expect(supplyBefore - (await getMint(connection, mint)).supply).to.eq(5_000_000n);
      const stored = await program.account.referral.fetch(referral);
      expect(stored.owner.equals(newcomer.publicKey)).to.be.true;
      expect(stored.referrer.equals(referrer.publicKey)).to.be.true;
    });

    it("rejects self-referral and re-registration without another charge", async () => {
      const playerBefore = await ataBalance(playerAta);
      const adminBefore = await ataBalance(adminAta);
      const supplyBefore = (await getMint(connection, mint)).supply;
      const selfPda = pda(Buffer.from("referral"), admin.publicKey.toBuffer());
      await expectFail(
        program.methods.registerReferrer(admin.publicKey).accountsPartial({
          referral: selfPda, config: configPda, potatoMint: mint, userPotato: adminAta,
          owner: admin.publicKey, tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
        }).rpc(),
        "Unauthorized",
      );
      await expectFail(
        program.methods.registerReferrer(referrer.publicKey).accountsPartial({
          referral: playerReferralPda, config: configPda, potatoMint: mint, userPotato: playerAta,
          owner: player.publicKey, tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
        }).signers([player]).rpc(),
      );
      expect(await ataBalance(playerAta)).to.eq(playerBefore);
      expect(await ataBalance(adminAta)).to.eq(adminBefore);
      expect((await getMint(connection, mint)).supply).to.eq(supplyBefore);
      expect(await connection.getAccountInfo(selfPda)).to.be.null;
    });

    it("fill_order pays the 0.5 % referral reward to the referrer from escrow, minting nothing", async () => {
      const id = BigInt(Date.now() + 300);
      await program.methods.createSellOrder(new BN(id.toString()), new BN(10_000_000), new BN(1_000_000))
        .accountsPartial(createOrderAccounts(id, admin.publicKey, adminAta)).rpc();
      const orderPk = orderPda(id);
      const escrowPk = escrowPda(orderPk);

      const supplyBefore = (await getMint(connection, mint)).supply;
      const refBefore = await ataBalance(referrerAta);
      const sellerBefore = await ataBalance(adminAta);
      const buyerBefore = await ataBalance(playerAta);
      const treasuryBefore = await ataBalance(treasuryAta);

      const sellerLicensePda = pda(Buffer.from("license"), admin.publicKey.toBuffer());
      await program.methods.fillOrder().accountsPartial({
        buyer: player.publicKey, seller: admin.publicKey, config: configPda, potatoMint: mint, marketStats: marketStatsPda,
        order: orderPk, escrow: escrowPk, buyerPotato: playerAta, sellerPotato: adminAta, treasuryPotato: treasuryAta,
        tokenProgram: TOKEN_PROGRAM_ID, associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
      }).signers([player]).remainingAccounts([
        { pubkey: sellerLicensePda, isSigner: false, isWritable: false },
        { pubkey: playerReferralPda, isSigner: false, isWritable: false },
        { pubkey: referrerAta, isSigner: false, isWritable: true },
      ]).rpc();

      // buyer gets the amount, referrer the 0.5 % (50 k), seller the 1 % refund (100 k)
      expect((await ataBalance(playerAta)) - buyerBefore).to.eq(10_000_000n);
      expect((await ataBalance(referrerAta)) - refBefore).to.eq(50_000n);
      expect((await ataBalance(adminAta)) - sellerBefore).to.eq(100_000n);
      // 9 % fee = 900 k; after 1 % refund the net fee is 800 k -> 320 k treasury, 430 k burn
      expect((await ataBalance(treasuryAta)) - treasuryBefore).to.eq(320_000n);
      // Supply drops ONLY by the burned fee: 900k - 100k refund = 800k net
      // -> 320k treasury (40%) + 480k burn base - 50k referral reward = 430k burned.
      // The 50k reward itself is a transfer out of escrow, not a fresh mint.
      const supplyAfter = (await getMint(connection, mint)).supply;
      expect(supplyAfter).to.eq(supplyBefore - 430_000n);
      expect(await connection.getAccountInfo(orderPk)).to.be.null;
      expect(await connection.getAccountInfo(escrowPk)).to.be.null;
    });

    it("fill_order burns the reward when the referrer ATA is not provided", async () => {
      const id = BigInt(Date.now() + 301);
      await program.methods.createSellOrder(new BN(id.toString()), new BN(10_000_000), new BN(1_000_000))
        .accountsPartial(createOrderAccounts(id, admin.publicKey, adminAta)).rpc();
      const orderPk = orderPda(id);
      const escrowPk = escrowPda(orderPk);

      const supplyBefore = (await getMint(connection, mint)).supply;
      const refBefore = await ataBalance(referrerAta);
      const sellerBefore = await ataBalance(adminAta);
      // license + buyer referral PDA are passed, but NO referrer ATA
      // -> the 0.5 % reward is burned instead of paid; the 1 % refund still goes to the seller
      const sellerLicensePda = pda(Buffer.from("license"), admin.publicKey.toBuffer());
      await program.methods.fillOrder().accountsPartial({
        buyer: player.publicKey, seller: admin.publicKey, config: configPda, potatoMint: mint, marketStats: marketStatsPda,
        order: orderPk, escrow: escrowPk, buyerPotato: playerAta, sellerPotato: adminAta, treasuryPotato: treasuryAta,
        tokenProgram: TOKEN_PROGRAM_ID, associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
      }).signers([player]).remainingAccounts([
        { pubkey: sellerLicensePda, isSigner: false, isWritable: false },
        { pubkey: playerReferralPda, isSigner: false, isWritable: false },
      ]).rpc();

      expect((await ataBalance(referrerAta)) - refBefore).to.eq(0n);
      expect((await ataBalance(adminAta)) - sellerBefore).to.eq(100_000n); // 1 % refund
      // No referrer ATA -> the 50k reward joins the burn: 800k net - 320k treasury = 480k burned
      expect((await getMint(connection, mint)).supply).to.eq(supplyBefore - 480_000n);
      expect(await connection.getAccountInfo(orderPk)).to.be.null;
    });
  });

  describe("presale", () => {
    const treasurySolPda = pda(Buffer.from("treasury_sol"));
    const presalePda = pda(Buffer.from("presale"));
    const buyerPresalePda = (buyer: PublicKey) => pda(Buffer.from("buyer_presale"), buyer.toBuffer());
    const PRE_PRICE_LAMPORTS = 50_000_000n; // 0.05 SOL — дешевле, чем у игрока на airdrop

    // buy_field_sol теперь масштабирует цену по типу поля (0.4× / 1× / 2×) и
    // принимает maxTotalLamports — slippage-guard покупателя.
    const buySol = async (
      buyer: Keypair,
      fieldId: bigint,
      authority: PublicKey,
      fieldType = 1,
      maxTotalLamports = PRE_PRICE_LAMPORTS * 4n,
    ) =>
      program.methods
        .buyFieldSol(new BN(fieldId.toString()), fieldType, new BN(maxTotalLamports.toString()))
        .accountsPartial({
          config: configPda, presaleState: presalePda, authority,
          buyerPresale: buyerPresalePda(buyer.publicKey), field: fieldPda(fieldId),
          buyer: buyer.publicKey, treasurySol: treasurySolPda, systemProgram: SystemProgram.programId,
        }).signers([buyer]).rpc();

    it("init_presale creates the state; re-init and bad price are rejected", async () => {
      // vault для SOL-пресейла: 0-байт System-аккаунт (как в init-onchain)
      const rent = await connection.getMinimumBalanceForRentExemption(0);
      await connection.confirmTransaction(await connection.sendTransaction(
        new Transaction().add(
          SystemProgram.transfer({ fromPubkey: admin.publicKey, toPubkey: treasurySolPda, lamports: rent }),
        ),
        [admin],
      ));

      await program.methods.initPresale(new BN(12), new BN(PRE_PRICE_LAMPORTS.toString())).accountsPartial({
        config: configPda, presaleState: presalePda, authority: admin.publicKey, systemProgram: SystemProgram.programId,
      }).rpc();
      const st = await program.account.presaleState.fetch(presalePda);
      expect(st.cap).to.eq(12);
      expect(st.priceLamports.toString()).to.eq(PRE_PRICE_LAMPORTS.toString());

      await expectFail(
        program.methods.initPresale(new BN(12), new BN(PRE_PRICE_LAMPORTS.toString())).accountsPartial({
          config: configPda, presaleState: presalePda, authority: admin.publicKey, systemProgram: SystemProgram.programId,
        }).rpc(),
      );
      await expectFail(
        program.methods.updatePresalePrice(new BN(1)).accountsPartial({
          config: configPda, presaleState: presalePda, authority: player.publicKey,
        }).signers([player]).rpc(),
        "ConstraintHasOne",
      );

      // Ненулевая цена больше НЕ применяется мгновенно: это предложение,
      // которое можно применить только через 24-часовой тимелок.
      await program.methods.updatePresalePrice(new BN(75_000_000n.toString())).accountsPartial({
        config: configPda, presaleState: presalePda, authority: admin.publicKey, adminState: adminStatePda,
        systemProgram: SystemProgram.programId,
      }).rpc();
      const stAfterProposal = await program.account.presaleState.fetch(presalePda);
      expect(stAfterProposal.priceLamports.toString()).to.eq(PRE_PRICE_LAMPORTS.toString());
      const as0 = await program.account.adminState.fetch(adminStatePda);
      expect(as0.pendingPresalePrice.toString()).to.eq("75000000");
      expect(as0.pendingPresalePriceAt.gt(new BN(0))).to.be.true;
      await expectFail(
        program.methods.applyPendingPresalePrice().accountsPartial({
          config: configPda, presaleState: presalePda, adminState: adminStatePda, authority: admin.publicKey,
        }).rpc(),
        "TimelockNotExpired",
      );
    });

    it("SKR rail: rejects a mint different from config before the presale is exhausted", async function () {
      this.timeout(20_000);
      // Run before wallet/global caps are exhausted, so this exercises the mint guard.
      // SKR is configurable now; rejection is InvalidMint in the handler, not ConstraintAddress.
      const wrongSkrMint = await createMint(connection, admin, admin.publicKey, null, 6);
      const buyerSkrAta = (await getOrCreateAssociatedTokenAccount(connection, admin, wrongSkrMint, player.publicKey, true)).address;
      const treasurySkrAta = (await getOrCreateAssociatedTokenAccount(connection, admin, wrongSkrMint, treasurySolPda, true)).address;
      const buybackSkrAta = (await getOrCreateAssociatedTokenAccount(connection, admin, wrongSkrMint, admin.publicKey, true)).address;
      const id = BigInt(Date.now()) + 5555n;
      await expectFail(
        program.methods.buyFieldSkr(new BN(id.toString())).accountsPartial({
          config: configPda, presaleState: presalePda, authority: admin.publicKey,
          buyerPresale: buyerPresalePda(player.publicKey), field: fieldPda(id),
          buyer: player.publicKey, skrMint: wrongSkrMint, buyerSkrAta,
          treasurySol: treasurySolPda, treasurySkrAta, buybackSkrAta,
          tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
          slotHashes: SYSVAR_SLOT_HASHES_PUBKEY,
        }).signers([player]).rpc(),
        "InvalidMint",
      );
    });

    it("buy_field_sol moves SOL to the treasury and creates the field", async () => {
      const fieldId = BigInt(Date.now()) + 1n;
      const treasuryBefore = await connection.getBalance(treasurySolPda);
      await buySol(player, fieldId, admin.publicKey);
      presaleFieldIds.push(fieldId);

      const field = await program.account.field.fetch(fieldPda(fieldId));
      expect(field.owner.equals(player.publicKey)).to.be.true;
      expect(field.fieldType).to.eq(1);
      const st = await program.account.presaleState.fetch(presalePda);
      expect(st.sold).to.eq(1);
      const counter = await program.account.buyerPresaleCounter.fetch(buyerPresalePda(player.publicKey));
      expect(counter.count).to.eq(1);
      const treasuryAfter = await connection.getBalance(treasurySolPda);
      expect(treasuryAfter - treasuryBefore).to.eq(Number(PRE_PRICE_LAMPORTS));
    });

    it("scales the SOL price by field type and enforces maxTotalLamports", async () => {
      const buyerX = Keypair.generate();
      await connection.confirmTransaction(await connection.requestAirdrop(buyerX.publicKey, 2 * LAMPORTS_PER_SOL));

      // type 0 = 0.4× базовой цены = 0.02 SOL; maxTotal впритык — проходит.
      const id0 = BigInt(Date.now()) + 31n;
      const treasuryBefore = await connection.getBalance(treasurySolPda);
      await buySol(buyerX, id0, admin.publicKey, 0, 20_000_000n);
      expect((await connection.getBalance(treasurySolPda)) - treasuryBefore).to.eq(20_000_000);
      expect((await program.account.field.fetch(fieldPda(id0))).fieldType).to.eq(0);
      // id0 принадлежит buyerX, а presaleFieldIds используется только как пруфы
      // квестов для player (verify_fields проверяет f.owner == user) — не пушим.

      // type 2 = 2× базовой цены = 0.1 SOL; лимит покупателя 0.05 SOL —
      // InvalidPrice, поле не создаётся, SOL не списывается.
      const id2 = BigInt(Date.now()) + 32n;
      await expectFail(buySol(buyerX, id2, admin.publicKey, 2, PRE_PRICE_LAMPORTS), "InvalidPrice");
      expect(await connection.getAccountInfo(fieldPda(id2))).to.eq(null);
      expect((await program.account.buyerPresaleCounter.fetch(buyerPresalePda(buyerX.publicKey))).count).to.eq(1);
    });

    it("rejects an invalid field type", async () => {
      const id = BigInt(Date.now()) + 901n;
      await expectFail(
        program.methods.buyFieldSol(new BN(id.toString()), 3, new BN((PRE_PRICE_LAMPORTS * 4n).toString())).accountsPartial({
          config: configPda, presaleState: presalePda, authority: admin.publicKey,
          buyerPresale: buyerPresalePda(player.publicKey), field: fieldPda(id),
          buyer: player.publicKey, treasurySol: treasurySolPda, systemProgram: SystemProgram.programId,
        }).signers([player]).rpc(),
        "InvalidFieldType",
      );
    });

    it("enforces the 5-fields-per-wallet limit", async () => {
      for (let i = 2; i <= 5; i++) {
        const fieldId = BigInt(Date.now()) + BigInt(i * 10);
        await buySol(player, fieldId, admin.publicKey);
        presaleFieldIds.push(fieldId);
      }
      await expectFail(
        buySol(player, BigInt(Date.now()) + 999n, admin.publicKey),
        "PresaleWalletLimitReached",
      );
      const st = await program.account.presaleState.fetch(presalePda);
      expect(st.sold).to.eq(6); // 5 полей игрока + 1 поле buyerX из теста цен
    });

    it("enforces the global cap", async () => {
      const buyer2 = Keypair.generate();
      await connection.confirmTransaction(await connection.requestAirdrop(buyer2.publicKey, 1 * LAMPORTS_PER_SOL));
      for (let i = 1; i <= 5; i++) {
        const fieldId = BigInt(Date.now()) + BigInt(100 + i * 10);
        await buySol(buyer2, fieldId, admin.publicKey);
      }
      // sold = 11 из 12: последняя покупка заполняет кап.
      const buyer3 = Keypair.generate();
      await connection.confirmTransaction(await connection.requestAirdrop(buyer3.publicKey, 1 * LAMPORTS_PER_SOL));
      await buySol(buyer3, BigInt(Date.now()) + 8887n, admin.publicKey);
      const buyer4 = Keypair.generate();
      await connection.confirmTransaction(await connection.requestAirdrop(buyer4.publicKey, 1 * LAMPORTS_PER_SOL));
      await expectFail(
        buySol(buyer4, BigInt(Date.now()) + 8888n, admin.publicKey),
        "PresaleCapReached",
      );
      const st = await program.account.presaleState.fetch(presalePda);
      expect(st.sold).to.eq(12);
    });

    it("is blocked while paused (paused-чек идёт первым в обработчике)", async () => {
      await program.methods.setPaused(true).accountsPartial({ config: configPda, authority: admin.publicKey }).rpc();
      const buyer4 = Keypair.generate();
      await connection.confirmTransaction(await connection.requestAirdrop(buyer4.publicKey, 1 * LAMPORTS_PER_SOL));
      // cap уже 12/12, но require!(paused) стоит раньше всех остальных проверок
      await expectFail(
        buySol(buyer4, BigInt(Date.now()) + 7777n, admin.publicKey),
        "Paused",
      );
      await program.methods.setPaused(false).accountsPartial({ config: configPda, authority: admin.publicKey }).rpc();
    });

    it("migrate_presale_authority repairs the presale after an authority transfer", async () => {
      const next = Keypair.generate();
      try {
        await program.methods.proposeAuthority(next.publicKey).accountsPartial({ config: configPda, authority: admin.publicKey }).rpc();
        await program.methods.acceptAuthority().accountsPartial({ config: configPda, newAuthority: next.publicKey }).signers([next]).rpc();

        // без миграции покупки падают: UI передаёт authority = config.authority (next)
        const buyer5 = Keypair.generate();
        await connection.confirmTransaction(await connection.requestAirdrop(buyer5.publicKey, 1 * LAMPORTS_PER_SOL));
        const stBefore = (await program.account.presaleState.fetch(presalePda)).sold;
        await expectFail(
          buySol(buyer5, BigInt(Date.now()) + 4444n, next.publicKey),
          "ConstraintHasOne",
        );

        await expectFail(
          program.methods.migratePresaleAuthority().accountsPartial({
            config: configPda, presaleState: presalePda, authority: admin.publicKey,
          }).rpc(),
          "ConstraintHasOne", // старый authority не может мигрировать
        );

        await program.methods.migratePresaleAuthority().accountsPartial({
          config: configPda, presaleState: presalePda, authority: next.publicKey,
        }).signers([next]).rpc();
        const st = await program.account.presaleState.fetch(presalePda);
        expect(st.authority.equals(next.publicKey)).to.be.true;

        // cap исчерпан в этом тесте (10/10) — покупка не пройдёт по PresaleCapReached,
        // а НЕ по ConstraintHasOne: этого достаточно, чтобы доказать, что has_one прошёл.
        await expectFail(
          buySol(buyer5, BigInt(Date.now()) + 4445n, next.publicKey),
          "PresaleCapReached",
        );
        expect((await program.account.presaleState.fetch(presalePda)).sold).to.eq(stBefore);
      } finally {
        // Возвращаем authority admin'у ЛЮБЫМ ЦЕНОМ: если тест выше упал до явного
        // restore, каскад ConstraintHasOne сломал бы все последующие сьюиты
        // (quest, treasury, admin).
        const cfg = await program.account.gameConfig.fetch(configPda);
        if (!cfg.authority.equals(admin.publicKey)) {
          if (cfg.pendingAuthority.equals(PublicKey.default)) {
            await program.methods.proposeAuthority(admin.publicKey).accountsPartial({
              config: configPda, authority: next.publicKey,
            }).signers([next]).rpc();
          }
          await program.methods.acceptAuthority().accountsPartial({
            config: configPda, newAuthority: admin.publicKey,
          }).rpc();
          await program.methods.migratePresaleAuthority().accountsPartial({
            config: configPda, presaleState: presalePda, authority: admin.publicKey,
          }).rpc();
        }
      }
    });

    // ПОСЛЕДНИЙ тест presale: kill switch обнуляет цену без тимелока, и до
    // следующего предложения+apply (24 h) пресейл закрыт — покупки после него
    // в этом прогоне невозможны.
    it("kill switch: price 0 applies immediately and closes the presale", async () => {
      await program.methods.updatePresalePrice(new BN(0)).accountsPartial({
        config: configPda, presaleState: presalePda, authority: admin.publicKey, adminState: adminStatePda,
        systemProgram: SystemProgram.programId,
      }).rpc();
      const st = await program.account.presaleState.fetch(presalePda);
      expect(st.priceLamports.toNumber()).to.eq(0);
      const as = await program.account.adminState.fetch(adminStatePda);
      expect(as.pendingPresalePrice.toNumber()).to.eq(0);
      expect(as.pendingPresalePriceAt.toNumber()).to.eq(0);

      // PresaleNotActive (price == 0) проверяется раньше PresaleCapReached.
      const buyerZ = Keypair.generate();
      await connection.confirmTransaction(await connection.requestAirdrop(buyerZ.publicKey, 1 * LAMPORTS_PER_SOL));
      await expectFail(buySol(buyerZ, BigInt(Date.now()) + 6666n, admin.publicKey), "PresaleNotActive");

      // Применять больше нечего: прежнее предложение (75M) стёрто kill switch'ем.
      await expectFail(
        program.methods.applyPendingPresalePrice().accountsPartial({
          config: configPda, presaleState: presalePda, adminState: adminStatePda, authority: admin.publicKey,
        }).rpc(),
        "NothingPending",
      );
    });
  });

  describe("quest pool (claim_achievement)", () => {
    const questTreasuryPda = pda(Buffer.from("quest_treasury"));
    // Лениво: mint задаётся во внешнем before() — на момент загрузки файла undefined
    const questAta = () => getAssociatedTokenAddressSync(mint, questTreasuryPda, true);
    const achvPda = (user: PublicKey) => pda(Buffer.from("achv"), user.toBuffer());
    const POOL = 550_000_000n; // 550 🥔 — зеркало QUEST_REWARD_MICRO

    const claim = async (user: Keypair, questId: number, fields: bigint[] = [], userPotatoAta: PublicKey = playerAta) => {
      // fields — bigint-идентификаторы полей -> PDA ["field", id] (remaining-аккаунты proofs)
      const fieldPdas = fields.map((id) => fieldPda(id));
      return program.methods.claimAchievement(questId).accountsPartial({
        config: configPda, achievements: achvPda(user.publicKey), user: user.publicKey,
        questTreasury: questTreasuryPda, questAta: questAta(), userPotatoAta,
        potatoMint: mint, tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
      }).remainingAccounts(fieldPdas.map((pubkey) => ({ pubkey, isSigner: false, isWritable: false })))
        .signers([user]).rpc();
    };

    before(async () => {
      const rent = await connection.getMinimumBalanceForRentExemption(0);
      await connection.confirmTransaction(await connection.sendTransaction(
        new Transaction().add(SystemProgram.transfer({ fromPubkey: admin.publicKey, toPubkey: questTreasuryPda, lamports: rent })),
        [admin],
      ));
      await getOrCreateAssociatedTokenAccount(connection, admin, mint, questTreasuryPda, true);
      await program.methods.grantReward(new BN(POOL.toString())).accountsPartial({
        config: configPda, epoch: epochPda(0), authority: admin.publicKey, potatoMint: mint, userPotato: questAta(), tokenProgram: TOKEN_PROGRAM_ID,
      }).rpc();
      expect(await ataBalance(questAta())).to.eq(POOL);
    });

    it("funds the 550 🥔 pool and pays quest 0 (1 field) from it", async () => {
      const playerAtaBefore = await ataBalance(playerAta);
      await claim(player, 0, presaleFieldIds.slice(0, 1));
      expect((await ataBalance(questAta()))).to.eq(POOL - 50_000_000n);
      expect((await ataBalance(playerAta)) - playerAtaBefore).to.eq(50_000_000n);
      const achv = await program.account.achievements.fetch(achvPda(player.publicKey));
      expect(achv.bitmap.toNumber() & 1).to.eq(1);
    });

    it("rejects a double claim", async () => {
      await expectFail(claim(player, 0, presaleFieldIds.slice(0, 1)), "AlreadyClaimed");
    });

    it("rejects a user without the required fields (BadProof)", async () => {
      const stranger = Keypair.generate();
      await connection.confirmTransaction(await connection.requestAirdrop(stranger.publicKey, 1 * LAMPORTS_PER_SOL));
      const strangerAta = (await getOrCreateAssociatedTokenAccount(connection, admin, mint, stranger.publicKey)).address;
      await expectFail(claim(stranger, 0, [], strangerAta), "BadProof");
    });

    it("pays balance-based quests (100 / 1000 🥔) for a clean user", async () => {
      // playerAta уже содержит 🥔 из ранних сьютов — берём чистого пользователя
      const saver = Keypair.generate();
      await connection.confirmTransaction(await connection.requestAirdrop(saver.publicKey, 1 * LAMPORTS_PER_SOL));
      const saverAta = (await getOrCreateAssociatedTokenAccount(connection, admin, mint, saver.publicKey)).address;

      await program.methods.grantReward(new BN("150000000")).accountsPartial({
        config: configPda, epoch: epochPda(0), authority: admin.publicKey, potatoMint: mint, userPotato: saverAta, tokenProgram: TOKEN_PROGRAM_ID,
      }).rpc();
      // 150 🥔: quest 2 (нужно 1000) невалиден, quest 1 (нужно 100) валиден
      await expectFail(claim(saver, 2, [], saverAta), "BadProof");
      await claim(saver, 1, [], saverAta);
      expect(await ataBalance(saverAta)).to.eq(200_000_000n); // 150 + 50 (награда)
      expect(await ataBalance(questAta())).to.eq(POOL - 50_000_000n - 50_000_000n);

      await program.methods.grantReward(new BN("900000000")).accountsPartial({
        config: configPda, epoch: epochPda(0), authority: admin.publicKey, potatoMint: mint, userPotato: saverAta, tokenProgram: TOKEN_PROGRAM_ID,
      }).rpc();
      await claim(saver, 2, [], saverAta); // 1100 🥔 ≥ 1000
      expect(await ataBalance(saverAta)).to.eq(1200_000_000n);
      expect(await ataBalance(questAta())).to.eq(POOL - 50_000_000n - 50_000_000n - 100_000_000n);
    });

    it("rejects repeating one field as a five-field achievement proof", async () => {
      await expectFail(claim(player, 3, Array(5).fill(presaleFieldIds[0])), "BadProof");
    });

    it("pays quest 3 (5 fields) to the player", async () => {
      const playerAtaBefore = await ataBalance(playerAta);
      await claim(player, 3, presaleFieldIds.slice(0, 5));
      expect((await ataBalance(playerAta)) - playerAtaBefore).to.eq(100_000_000n);
      expect(await ataBalance(questAta())).to.eq(POOL - 50_000_000n - 50_000_000n - 100_000_000n - 100_000_000n);
    });

    it("rejects out-of-range quest ids and claims while paused", async () => {
      await expectFail(claim(player, 6), "InvalidFieldType");
      await program.methods.setPaused(true).accountsPartial({ config: configPda, authority: admin.publicKey }).rpc();
      await expectFail(claim(player, 4), "Paused"); // paused-чек раньше проверки баланса
      await program.methods.setPaused(false).accountsPartial({ config: configPda, authority: admin.publicKey }).rpc();
    });
  });

  describe("treasury withdrawals (SOL)", () => {
    const treasurySolPda = pda(Buffer.from("treasury_sol"));
    const proposeSol = (lamports: string) => program.methods.proposeWithdrawal(1, new BN(lamports)).accountsPartial({
      config: configPda, adminState: adminStatePda, authority: admin.publicKey, systemProgram: SystemProgram.programId,
    }).rpc();
    const execSol = (lamports: string) => program.methods.withdrawTreasurySol(new BN(lamports)).accountsPartial({
      config: configPda, treasurySol: treasurySolPda, authority: admin.publicKey, systemProgram: SystemProgram.programId,
    }).rpc();
    const cancelPending = () => program.methods.cancelWithdrawal().accountsPartial({
      config: configPda, adminState: adminStatePda, authority: admin.publicKey, systemProgram: SystemProgram.programId,
    }).rpc();
    const waitTimelock = () => new Promise((resolve) => setTimeout(resolve, 32_000));

    it("withdraw_treasury_sol pays the authority; non-authority is rejected", async function () {
      this.timeout(90_000);
      const treasuryBefore = await connection.getBalance(treasurySolPda);
      const adminBefore = await connection.getBalance(admin.publicKey);

      // Шаг 2 без шага 1 невозможен.
      await expectFail(execSol("10000000"), "NoPendingWithdrawal");
      await expectFail(
        program.methods.proposeWithdrawal(1, new BN("10000000")).accountsPartial({
          config: configPda, adminState: adminStatePda, authority: player.publicKey, systemProgram: SystemProgram.programId,
        }).signers([player]).rpc(),
        "ConstraintHasOne",
      );
      await expectFail(
        program.methods.withdrawTreasurySol(new BN("10000000")).accountsPartial({
          config: configPda, treasurySol: treasurySolPda, authority: player.publicKey,
          systemProgram: SystemProgram.programId,
        }).signers([player]).rpc(),
        "ConstraintHasOne",
      );

      await proposeSol("10000000");
      await expectFail(proposeSol("10000000"), "WithdrawalAlreadyProposed");
      await expectFail(execSol("10000000"), "WithdrawTimelockNotExpired");
      await waitTimelock();
      await execSol("10000000");
      const treasuryAfter = await connection.getBalance(treasurySolPda);
      expect(treasuryBefore - treasuryAfter).to.eq(10_000_000);
      // admin: +10_000_000 минус 2 успешные подписи (propose+withdraw, 5_000 каждая)
      const adminDelta = (await connection.getBalance(admin.publicKey)) - adminBefore;
      expect(adminDelta).to.be.within(9_985_000, 10_000_000);
      // pending очищен после исполнения
      await expectFail(execSol("10000000"), "NoPendingWithdrawal");
    });

    it("rejects withdrawing more than the vault holds", async () => {
      // Проверка баланса — на шаге 2 до таймлока: ошибка сразу, без ожидания.
      await proposeSol((10 * LAMPORTS_PER_SOL).toString());
      await expectFail(execSol((10 * LAMPORTS_PER_SOL).toString()), "InvalidAmount");
      await cancelPending();
      // withdraw_skr_treasury на localnet не проверяется: SKR_MINT — константа
      // (devnet-mint Fotom…), создать его без ключа нельзя.
    });

    it("rate-limits SOL withdrawals per rolling 24h window", async () => {
      // Бюджет окна списывается на шаге 1 (propose): 26 SOL > 25 SOL окна.
      await expectFail(proposeSol((26 * LAMPORTS_PER_SOL).toString()), "WithdrawWindowLimitExceeded");
      const afterFailed = await program.account.adminState.fetch(adminStatePda);
      expect(afterFailed.pendingWithdrawSol.toNumber()).to.eq(0);
      // Успешный propose фиксирует бюджет even без исполнения; cancel освобождает pending.
      await proposeSol("1000000");
      const as = await program.account.adminState.fetch(adminStatePda);
      expect(as.withdrawnSolLamports.gte(new BN(1_000_000))).to.be.true;
      await cancelPending();
      const cleared = await program.account.adminState.fetch(adminStatePda);
      expect(cleared.pendingWithdrawSol.toNumber()).to.eq(0);
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

    it("guardian can pause but not unpause; strangers cannot toggle", async () => {
      const guardian = Keypair.generate();
      const pauseBy = (signer: Keypair, paused: boolean) =>
        program.methods.setPaused(paused).accountsPartial({ config: configPda, authority: signer.publicKey }).signers([signer]).rpc();
      // guardian ещё не задан
      await expectFail(pauseBy(guardian, true), "Unauthorized");
      await program.methods.updateGuardian(guardian.publicKey).accountsPartial({ config: configPda, authority: admin.publicKey }).rpc();
      await pauseBy(guardian, true);
      expect((await program.account.gameConfig.fetch(configPda)).paused).to.be.true;
      await expectFail(pauseBy(guardian, false), "Unauthorized");
      await expectFail(pauseBy(player, false), "Unauthorized");
      await program.methods.setPaused(false).accountsPartial({ config: configPda, authority: admin.publicKey }).rpc();
      // очистка guardian (Pubkey::default) возвращает переключателю обычный режим
      await program.methods.updateGuardian(PublicKey.default).accountsPartial({ config: configPda, authority: admin.publicKey }).rpc();
      await expectFail(pauseBy(guardian, true), "Unauthorized");
      await expectFail(
        program.methods.updateGuardian(guardian.publicKey).accountsPartial({ config: configPda, authority: player.publicKey }).signers([player]).rpc(),
        "ConstraintHasOne",
      );
    });

    it("update_config enforces ceilings", async () => {
      await expectFail(
        program.methods.updateConfig(new BN("250000000001"), null, null).accountsPartial({ config: configPda, authority: admin.publicKey }).rpc(),
        "CapTooHigh",
      );
      await expectFail(
        program.methods.updateConfig(new BN(0), null, null).accountsPartial({ config: configPda, authority: admin.publicKey }).rpc(),
        "InvalidAmount",
      );
      await expectFail(
        program.methods.updateConfig(null, null, 20_001).accountsPartial({ config: configPda, authority: admin.publicKey }).rpc(),
        "MultiplierTooHigh",
      );
      // base_yield ограничен сверху (100 🥔/день): опечатка в этом параметре
      // — необратимая поломка эмиссии.
      await expectFail(
        program.methods.updateConfig(null, new BN(101_000_000), null).accountsPartial({ config: configPda, authority: admin.publicKey }).rpc(),
        "BaseYieldTooHigh",
      );
      await program.methods.updateConfig(new BN("100000000000"), new BN(4_000_000), 12_000)
        .accountsPartial({ config: configPda, authority: admin.publicKey }).rpc();
      const cfg = await program.account.gameConfig.fetch(configPda);
      expect(cfg.dailyMintCapMicro.toString()).to.eq("100000000000");
      expect(cfg.baseYieldMicroPerDay.toNumber()).to.eq(4_000_000);
      expect(cfg.globalMultiplierBps).to.eq(12_000);
    });

    it("withdraw_treasury is two-step, authority-only and window-capped", async function () {
      this.timeout(90_000);
      // Финансируем казну: grant_reward минтит в treasury ATA (владелец митта — config PDA)
      await program.methods.grantReward(new BN(500_000)).accountsPartial({
        config: configPda, epoch: epochPda(0), authority: admin.publicKey, potatoMint: mint, userPotato: treasuryAta, tokenProgram: TOKEN_PROGRAM_ID,
      }).rpc();
      const proposePotato = (micro: string) => program.methods.proposeWithdrawal(0, new BN(micro)).accountsPartial({
        config: configPda, adminState: adminStatePda, authority: admin.publicKey, systemProgram: SystemProgram.programId,
      }).rpc();
      const execPotato = (micro: string) => program.methods.withdrawTreasury(new BN(micro)).accountsPartial({
        config: configPda, potatoMint: mint, treasuryPotato: treasuryAta, destination: adminAta, authority: admin.publicKey, tokenProgram: TOKEN_PROGRAM_ID,
      }).rpc();

      await expectFail(execPotato("100000"), "NoPendingWithdrawal");
      await expectFail(
        program.methods.proposeWithdrawal(0, new BN("100000")).accountsPartial({
          config: configPda, adminState: adminStatePda, authority: player.publicKey, systemProgram: SystemProgram.programId,
        }).signers([player]).rpc(),
        "ConstraintHasOne",
      );
      // destination теперь ATA authority: playerAta с authority=player проходит
      // associated-проверку, но has_one отсекает не-authority.
      await expectFail(
        program.methods.withdrawTreasury(new BN(1)).accountsPartial({
          config: configPda, potatoMint: mint, treasuryPotato: treasuryAta, destination: playerAta, authority: player.publicKey, tokenProgram: TOKEN_PROGRAM_ID,
        }).signers([player]).rpc(),
        "ConstraintHasOne",
      );
      // 251 000 🥔 > лимит окна (250 000 🥔 / 24 h) — падает уже на propose.
      await expectFail(proposePotato("251000000000"), "WithdrawWindowLimitExceeded");
      await proposePotato("100000");
      await expectFail(proposePotato("100000"), "WithdrawalAlreadyProposed");
      // Очередь SKR: propose пишет только окно/счётчик (исполнение требует митта).
      await program.methods.proposeWithdrawal(2, new BN(1000)).accountsPartial({
        config: configPda, adminState: adminStatePda, authority: admin.publicKey, systemProgram: SystemProgram.programId,
      }).rpc();
      await expectFail(execPotato("100000"), "WithdrawTimelockNotExpired");
      await new Promise((resolve) => setTimeout(resolve, 32_000));
      const before = await ataBalance(adminAta);
      await execPotato("100000");
      expect((await ataBalance(adminAta)) - before).to.eq(100_000n);
      const as = await program.account.adminState.fetch(adminStatePda);
      expect(as.pendingWithdrawPotato.toNumber()).to.eq(0);
      expect(as.withdrawnSkrAtoms.gte(new BN(1000))).to.be.true;
      await expectFail(execPotato("100000"), "NoPendingWithdrawal");
      // cancel чистит оставшееся SKR-предложение
      await program.methods.cancelWithdrawal().accountsPartial({
        config: configPda, adminState: adminStatePda, authority: admin.publicKey, systemProgram: SystemProgram.programId,
      }).rpc();
      expect((await program.account.adminState.fetch(adminStatePda)).pendingWithdrawSkr.toNumber()).to.eq(0);
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

    it("update_skr_mint is a timelocked proposal, not an instant swap", async () => {
      const newSkr = Keypair.generate().publicKey;
      await program.methods.updateSkrMint(newSkr).accountsPartial({
        config: configPda, adminState: adminStatePda, authority: admin.publicKey, systemProgram: SystemProgram.programId,
      }).rpc();
      // config.skrMint НЕ изменился — только предложение в AdminState.
      const cfg = await program.account.gameConfig.fetch(configPda);
      expect(cfg.skrMint.equals(newSkr)).to.be.false;
      const as = await program.account.adminState.fetch(adminStatePda);
      expect(as.pendingSkrMint.equals(newSkr)).to.be.true;
      expect(as.pendingSkrMintAt.gt(new BN(0))).to.be.true;
      await expectFail(
        program.methods.applyPendingSkrMint().accountsPartial({
          config: configPda, adminState: adminStatePda, authority: admin.publicKey,
        }).rpc(),
        "TimelockNotExpired",
      );
      await expectFail(
        program.methods.updateSkrMint(PublicKey.default).accountsPartial({
          config: configPda, adminState: adminStatePda, authority: admin.publicKey, systemProgram: SystemProgram.programId,
        }).rpc(),
        "InvalidMint",
      );
      // Не-authority не может предложить подмену митта.
      await expectFail(
        program.methods.updateSkrMint(newSkr).accountsPartial({
          config: configPda, adminState: adminStatePda, authority: player.publicKey, systemProgram: SystemProgram.programId,
        }).signers([player]).rpc(),
        "ConstraintHasOne",
      );
    });

    it("close_old_epoch refuses epochs inside the retention window", async () => {
      // config.epochId == 0, KEEP_EPOCHS == 2 → текущая эпоха закрываться не должна.
      await expectFail(
        program.methods.closeOldEpoch().accountsPartial({
          config: configPda, epoch: epochPda(0), payer: admin.publicKey,
        }).rpc(),
        "EpochTooRecent",
      );
      // Эпоха по-прежнему на месте и читаема.
      expect((await program.account.epoch.fetch(epochPda(0))).id.toNumber()).to.eq(0);
    });

    // ПОСЛЕДНИЙ тест прогона: исчерпывает квоту грантов (10% капа эпохи),
    // поэтому все остальные grant_reward-сценарии идут выше по файлу.
    it("grant_reward is capped at 10% of the epoch cap", async function () {
      this.timeout(240_000);
      const quota = (await program.account.epoch.fetch(epochPda(0))).mintCapMicro.divn(10);
      const grant = () =>
        program.methods.grantReward(new BN(1_000_000_000)).accountsPartial({
          config: configPda, epoch: epochPda(0), authority: admin.publicKey, potatoMint: mint, userPotato: adminAta, tokenProgram: TOKEN_PROGRAM_ID,
        }).rpc();
      for (let i = 0; i < 30; i++) {
        const ep = await program.account.epoch.fetch(epochPda(0));
        if (ep.grantedMicro.add(new BN(1_000_000_000)).gt(quota)) break;
        await grant();
      }
      await expectFail(grant(), "GrantQuotaExceeded");
      const ep = await program.account.epoch.fetch(epochPda(0));
      expect(ep.grantedMicro.lte(quota)).to.be.true;
    });
  });
});
