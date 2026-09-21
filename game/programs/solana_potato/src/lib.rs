//! # Solana Potato
//!
//! On-chain farming game. Players own `Field` accounts that accrue $POTATO
//! (an SPL token whose mint authority is the `GameConfig` PDA), spend $POTATO on
//! upkeep (tax, repair, upgrades, fertilizer — all of it is **burned**), and trade
//! $POTATO for SOL on a built-in escrow marketplace.
//!
//! ## Economic guard rails
//! * Emission through `harvest` / `batch_harvest` / `grant_reward` is bounded by
//!   a per-epoch mint cap (`Epoch.mint_cap_micro`, dynamically clamped to
//!   [daily_mint_cap_micro, 3×daily_mint_cap_micro] on every roll) and by
//!   `GameConfig.max_supply_micro`. Manual `grant_reward` mints are additionally
//!   capped at `GRANT_QUOTA_SHARE_BPS` (10 %) of the epoch cap.
//! * Epochs are 24h long and are rolled permissionlessly via `roll_epoch`.
//! * Every in-game spend is a burn; 60 % of marketplace fees are burned and the
//!   remaining 40 % go to the treasury ATA owned by the config PDA.
//! * Treasury withdrawals are rate-limited per rolling 24 h window and sensitive
//!   admin updates (SKR mint, presale price) go through a 24 h timelock
//!   (`AdminState`); the presale kill switch (price = 0) is the instant exception.
//!
//! ## Account layout stability
//! The field order of every `#[account]` struct is part of the public ABI: the
//! web client and the backend decode accounts by byte offset. Append new fields
//! only through a versioned migration — never reorder or insert.
//!
//! All amounts suffixed `_micro` are in 10^-6 $POTATO (the mint has 6 decimals).
//! All `_bps` values are basis points (10_000 = 1.0×).

mod migrations;

use anchor_lang::prelude::*;
use anchor_lang::solana_program::slot_hashes::SlotHashes;
use anchor_lang::AccountDeserialize;
use anchor_lang::pubkey;
use anchor_lang::solana_program::program_option::COption;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, Burn, CloseAccount, Mint, MintTo, Token, TokenAccount, Transfer};

// Должен совпадать с аккаунтом программы на кластере (Anchor.toml, keypair,
// web-клиент) — иначе AnchorError 4100 DeclaredProgramIdMismatch.
declare_id!("DUUBiVvpbw5BbFLpryisvLGmBWmhVYC8tdf5xCUyEadf");

// ───────────────────────────── Units ─────────────────────────────

/// 1 $POTATO expressed in micro units (mint decimals = 6).
pub const MICRO: u128 = 1_000_000;
/// Basis-point denominator.
pub const BPS: u128 = 10_000;
pub const SECONDS_PER_DAY: i64 = 86_400;

// ─────────────────────────── Emission ────────────────────────────

/// Epoch length. The mint cap resets every epoch.
pub const EPOCH_DURATION: i64 = SECONDS_PER_DAY;
/// Ceiling for the configured bootstrap cap, NOT for subsequent dynamic epochs.
/// roll_epoch clamps its calculation to [daily_mint_cap_micro, 3×daily_mint_cap_micro].
pub const MAX_DAILY_CAP_MICRO: u64 = 250_000_000_000;
/// Hard ceiling for a single off-chain reward: 1 000 $POTATO.
pub const MAX_REWARD_MICRO: u64 = 1_000_000_000;
/// Manual `grant_reward` mints may consume at most this share (bps) of an
/// epoch cap: 10 %. Gameplay harvests keep the rest.
pub const GRANT_QUOTA_SHARE_BPS: u64 = 1_000;
/// Default total supply ceiling: 1 000 000 000 $POTATO.
pub const DEFAULT_MAX_SUPPLY_MICRO: u64 = 1_000_000_000_000_000;
/// Default base yield of a level-1, 1.0× field: 6 $POTATO / day.
pub const DEFAULT_BASE_YIELD_MICRO_PER_DAY: u64 = 6_000_000;
/// `global_multiplier_bps` can never exceed 2.0×.
pub const MAX_GLOBAL_MULTIPLIER_BPS: u16 = 20_000;
/// Ceiling for `update_config(base_yield_micro_per_day)`: 100 🥔/day per
/// reference field. A typo here would silently break the whole economy.
pub const MAX_BASE_YIELD_MICRO_PER_DAY: u64 = 100_000_000;

// ─────────────────────── Admin safety rails ──────────────────────

/// Sensitive admin updates (SKR mint swap, presale price raise) are proposed
/// first and can only be applied after this delay. Setting the presale price
/// to 0 (emergency stop) is the one exception and applies immediately.
pub const ADMIN_UPDATE_TIMELOCK_SECONDS: i64 = 86_400; // 24 h
/// Rolling window for treasury withdrawal rate limits.
pub const WITHDRAW_WINDOW_SECONDS: i64 = 86_400; // 24 h
/// 250 000 🥔 per window — one full default daily mint cap.
pub const MAX_WITHDRAW_POTATO_MICRO_PER_WINDOW: u64 = 250_000_000_000;
/// 25 SOL per window.
pub const MAX_WITHDRAW_SOL_LAMPORTS_PER_WINDOW: u64 = 25_000_000_000;
/// 100 000 SKR per window.
pub const MAX_WITHDRAW_SKR_ATOMS_PER_WINDOW: u64 = 100_000_000_000;
/// Hard cap on field proofs accepted by one `claim_achievement` call.
pub const MAX_CLAIM_PROOFS: usize = 12;
/// Epoch PDA retention: epochs older than `current - KEEP_EPOCHS` may be
/// closed for rent by anyone via `close_old_epoch`.
pub const KEEP_EPOCHS: u64 = 2;

// ──────────────────────────── Fields ─────────────────────────────

pub const FIELD_TYPE_COUNT: u8 = 3;
pub const MAX_FIELD_LEVEL: u8 = 50;
/// Minimum time between two harvests of the same field.
pub const MIN_HARVEST_INTERVAL: i64 = 60;
/// Yield stops accruing after this much time without a harvest.
/// 7 days: long enough to survive a weekend offline, short enough that a
/// dormant field cannot stockpile an unbounded payout.
pub const MAX_ACCRUAL_SECONDS: i64 = 7 * SECONDS_PER_DAY;

// Лунный цикл доходности (п.3 документа): детерминированный множитель 0.85× – 1.15×
// Период 28 эпох («лунный месяц»), день 7 = пик (полнолуние), день 21 = дно (новолуние)
pub const LUNAR_TABLE: [u16; 28] = [
    10_000, 10_334, 10_651, 10_935, 11_173, 11_352, 11_462, 11_500, // дни 0-7 (пик)
    11_462, 11_352, 11_173, 10_935, 10_651, 10_334, 10_000, 9_666,  // дни 8-15
    9_349,  9_065,  8_827,  8_648,  8_538,  8_500,  8_538,  8_648,  // дни 16-23 (дно)
    8_827,  9_065,  9_349,  9_666,                                   // дни 24-27
];

/// A field loses 1 durability point per this much accrued time (≈4 / day),
/// with a minimum of 1 point per harvest so harvest-spam is never free.
pub const DURABILITY_DECAY_INTERVAL: i64 = 6 * 3600;
pub const MAX_DURABILITY: u8 = 100;
/// Yield multiplier at 0 durability is 0.2×, at 100 durability 1.0×.
pub const DURABILITY_FLOOR_BPS: u128 = 2_000;
pub const DURABILITY_SLOPE_BPS_PER_POINT: u128 = 80;

/// Tax covers this period per payment.
pub const TAX_PERIOD: i64 = 7 * SECONDS_PER_DAY;
/// Tax can be prepaid at most this far into the future.
pub const MAX_TAX_PREPAY: i64 = 28 * SECONDS_PER_DAY;
/// A new field comes with its first tax period already covered.
pub const INITIAL_TAX_GRACE: i64 = TAX_PERIOD;
/// Yield multiplier while tax is overdue (0.5×).
pub const UNPAID_TAX_YIELD_BPS: u128 = 5_000;

pub const FERTILIZER_DURATION: i64 = SECONDS_PER_DAY;
/// Fertilizer can be stacked at most this far into the future.
pub const MAX_FERTILIZER_PREPAY: i64 = 7 * SECONDS_PER_DAY;
/// Yield multiplier while fertilized (1.5×).
pub const FERTILIZER_YIELD_BPS: u128 = 15_000;

/// Prices below are for the reference field type 1 (“Луг”, 1.0×). Other types
/// scale them by [`type_cost_bps`].
pub const BASE_FIELD_PRICE_MICRO: u64 = 250_000_000; // 250 $POTATO
pub const SKR_MINT: Pubkey = pubkey!("Fotom38ZJAYia8VGKtYjmSGuqPPDGiSz7R46ydWzRA4o");
/// 1053 SKR (6 decimals) = 2000 RUB при курсе 1.90
pub const PRESALE_PRICE_SKR_ATOMS: u64 = 1_053_000_000;
pub const EXPORT_LICENSE_PRICE_SKR_ATOMS: u64 = 500_000_000; // 500 SKR / 30 дней
/// One-time referral registration cost, confirmed by the game owner: 5 POTATO.
pub const REFERRAL_REGISTRATION_COST_MICRO: u64 = 5_000_000;
pub const BASE_TAX_MICRO: u64 = 6_000_000; // 6 $POTATO / week
pub const BASE_REPAIR_MICRO: u64 = 15_000_000; // 15 $POTATO
pub const BASE_FERTILIZER_MICRO: u64 = 10_000_000; // 10 $POTATO / 24h
/// Upgrade from level L to L+1 costs `BASE_UPGRADE_MICRO × L × type_cost`.
pub const BASE_UPGRADE_MICRO: u64 = 100_000_000; // 100 $POTATO × level

// ───────────────────────── Marketplace ───────────────────────────

pub const ORDER_TTL: i64 = 24 * 3600;
/// After cancelling an order a seller must wait this long before listing again.
pub const CANCEL_COOLDOWN: i64 = 3 * 3600;
/// Minimum order size: 10 $POTATO.
pub const MIN_ORDER_AMOUNT_MICRO: u64 = 10_000_000; // 10 POTATO
/// Minimum SOL an order must be worth so that rounding can never make it free.
pub const MIN_ORDER_TOTAL_LAMPORTS: u64 = 1_000_000; // 0.001 SOL
/// Share of the marketplace fee that is burned; the rest goes to the treasury.
pub const FEE_BURN_PERCENT: u64 = 60;

// ────────────────────────── Program ──────────────────────────────

#[program]
pub mod solana_potato {
    use super::*;

    /// Creates the singleton `GameConfig`. The $POTATO mint must already have
    /// the config PDA as its mint authority, 6 decimals and no freeze authority.
    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        let config_key = ctx.accounts.config.key();
        let mint = &ctx.accounts.potato_mint;
        require!(
            mint.mint_authority == COption::Some(config_key),
            GameError::InvalidMintAuthority
        );
        require!(mint.decimals == 6, GameError::InvalidMintDecimals);
        require!(mint.freeze_authority.is_none(), GameError::MintHasFreezeAuthority);

        let config = &mut ctx.accounts.config;
        config.authority = ctx.accounts.authority.key();
        config.pending_authority = Pubkey::default();
        config.potato_mint = mint.key();
        config.skr_mint = SKR_MINT;
        config.reward_signer = ctx.accounts.authority.key();
        config.max_supply_micro = DEFAULT_MAX_SUPPLY_MICRO;
        config.daily_mint_cap_micro = MAX_DAILY_CAP_MICRO;
        config.base_yield_micro_per_day = DEFAULT_BASE_YIELD_MICRO_PER_DAY;
        config.global_multiplier_bps = BPS as u16;
        config.field_count = 0;
        config.epoch_id = 0;
        config.total_burned_micro = 0;
        config.last_total_burned_micro = 0;
        config.paused = false;
        config.bump = ctx.bumps.config;
        Ok(())
    }

    /// Bootstraps the epoch account for the current `config.epoch_id`.
    /// Only needed once after `initialize`; later epochs are created by `roll_epoch`.
    pub fn init_epoch(ctx: Context<InitEpoch>) -> Result<()> {
        let config = &ctx.accounts.config;
        let epoch = &mut ctx.accounts.epoch;
        epoch.id = config.epoch_id;
        epoch.mint_cap_micro = config.daily_mint_cap_micro;
        epoch.minted_micro = 0;
        epoch.start_time = Clock::get()?.unix_timestamp;
        epoch.bump = ctx.bumps.epoch;
        epoch.granted_micro = 0;
        Ok(())
    }

    /// Permissionless: anyone may roll to the next epoch once the current one is
    /// over. Without this the mint cap would be frozen forever after day one.
    pub fn roll_epoch(ctx: Context<RollEpoch>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let current_end = ctx
            .accounts
            .current_epoch
            .start_time
            .checked_add(EPOCH_DURATION)
            .ok_or(GameError::MathOverflow)?;
        require!(now >= current_end, GameError::EpochNotOver);

        let config = &mut ctx.accounts.config;
        config.epoch_id = config.epoch_id.checked_add(1).ok_or(GameError::MathOverflow)?;

        // ═══════════════════════════════════════════════════════════════
        // Гибридный эластичный кап: burn-ось + utilization-ось (п.2 документа)
        // ═══════════════════════════════════════════════════════════════
        // Ось 1 (наша): дефляционная — больше сжигания → больше кап
        let prev_burned = config.total_burned_micro
            .saturating_sub(config.last_total_burned_micro);
        let burn_bonus = prev_burned / 2;
        let cap_from_burn = config.daily_mint_cap_micro
            .checked_add(burn_bonus)
            .ok_or(GameError::MathOverflow)?;

        // Ось 2 (документ п.2): спрос-ориентированная
        // CAP_{t+1} = CAP_t × (1 + k × (U_t - target))
        // target = 85%, k = 15% за эпоху
        let last_cap = ctx.accounts.current_epoch.mint_cap_micro;
        let last_minted = ctx.accounts.current_epoch.minted_micro;
        let utilization_bps = if last_cap > 0 {
            ((last_minted as u128) * 10_000 / (last_cap as u128)) as i128
        } else { 8_500i128 };
        let target_bps: i128 = 8_500;  // 85%
        let k_bps: i128 = 1_500;       // 15% реакция за эпоху
        let adjust_bps = k_bps * (utilization_bps - target_bps) / 10_000;
        let cap_from_util: u64 = (if adjust_bps >= 0 {
            (last_cap as u128)
                .saturating_mul(10_000u128 + adjust_bps as u128)
                / 10_000
        } else {
            (last_cap as u128)
                .saturating_mul(10_000u128 - ((-adjust_bps) as u128))
                / 10_000
        }).try_into().unwrap_or(u64::MAX);

        // Гибрид: среднее двух осей, зажатое в [cap, 3×cap], где cap —
        // текущий `config.daily_mint_cap_micro` (админ может снизить его
        // через update_config; следующий roll_epoch это учитывает).
        let hybrid_raw = (cap_from_burn as u128 + cap_from_util as u128) / 2;
        let cap_min = config.daily_mint_cap_micro;
        let cap_max = config.daily_mint_cap_micro.saturating_mul(3);
        let next_cap = (hybrid_raw as u64).clamp(cap_min, cap_max);

        let next = &mut ctx.accounts.next_epoch;
        next.id = config.epoch_id;
        next.mint_cap_micro = next_cap;
        next.minted_micro = 0;
        next.start_time = now;
        next.bump = ctx.bumps.next_epoch;
        next.granted_micro = 0;

        // Запоминаем текущее total_burned для следующего roll_epoch
        ctx.accounts.config.last_total_burned_micro = ctx.accounts.config.total_burned_micro;

        emit!(EpochRolled { epoch_id: next.id, start_time: now });
        Ok(())
    }

    /// Buys a new field of `field_type` (0 = Грядка, 1 = Луг, 2 = Поле) by
    /// burning its price. `field_id` is a client-chosen nonce for the PDA.
    pub fn create_field(ctx: Context<CreateField>, field_id: u64, field_type: u8) -> Result<()> {
        require!(!ctx.accounts.config.paused, GameError::Paused);
        require!(field_type < FIELD_TYPE_COUNT, GameError::InvalidFieldType);

        let cost = field_price_micro(field_type);
        burn_from_user(
            &ctx.accounts.token_program,
            &ctx.accounts.potato_mint,
            &ctx.accounts.user_potato,
            &ctx.accounts.owner,
            cost,
        )?;

        let now = Clock::get()?.unix_timestamp;
        let config = &mut ctx.accounts.config;
        config.total_burned_micro = config.total_burned_micro.saturating_add(cost);
        config.field_count = config.field_count.checked_add(1).ok_or(GameError::MathOverflow)?;

        let field = &mut ctx.accounts.field;
        field.owner = ctx.accounts.owner.key();
        field.level = 1;
        field.durability = MAX_DURABILITY;
        field.last_harvest = now;
        field.tax_paid_until = now.checked_add(INITIAL_TAX_GRACE).ok_or(GameError::MathOverflow)?;
        field.fertilizer_until = 0;
        field.is_active = true;
        field.field_type = field_type;
        field.bump = ctx.bumps.field;

        emit!(FieldCreated { owner: field.owner, field: field.key(), field_type });
        Ok(())
    }

    /// Создаёт синглтон пресейла. Только authority.
    /// cap — общий тираж полей (500), price_lamports — цена за поле (0.25 SOL = 250_000_000).
    pub fn init_presale(ctx: Context<InitPresale>, cap: u32, price_lamports: u64) -> Result<()> {
        require!(cap > 0, GameError::InvalidAmount);
        require!(price_lamports > 0, GameError::InvalidAmount);
        let presale = &mut ctx.accounts.presale_state;
        presale.authority = ctx.accounts.authority.key();
        presale.sold = 0;
        presale.cap = cap;
        presale.price_lamports = price_lamports;
        presale.bump = ctx.bumps.presale_state;
        Ok(())
    }

    /// Claim a quest reward once per player (bitmap in the `achv` PDA).
    /// Field proofs arrive via `remaining_accounts` and are capped by
    /// MAX_CLAIM_PROOFS to keep the O(n²) duplicate check inside CU limits.
    pub fn claim_achievement(ctx: Context<ClaimAchievement>, quest_id: u8) -> Result<()> {
        require!(!ctx.accounts.config.paused, GameError::Paused);
        require!((quest_id as usize) < QUEST_REWARD_MICRO.len(), GameError::InvalidFieldType);
        let achievements = &mut ctx.accounts.achievements;
        let bit = 1u64 << quest_id;
        require!(achievements.bitmap & bit == 0, GameError::AlreadyClaimed);
        let user = ctx.accounts.user.key();
        let pid = ctx.program_id;
        let ata_amount = ctx.accounts.user_potato_ata.amount;
        match quest_id {
            0 => verify_fields(ctx.remaining_accounts, &user, pid, 1, 0)?,
            1 => require!(ata_amount >= 100_000_000, GameError::BadProof),
            2 => require!(ata_amount >= 1_000_000_000, GameError::BadProof),
            3 => verify_fields(ctx.remaining_accounts, &user, pid, 5, 0)?,
            4 => require!(ata_amount >= 10_000_000_000, GameError::BadProof),
            5 => verify_fields(ctx.remaining_accounts, &user, pid, 6, 3)?,
            _ => return err!(GameError::InvalidFieldType),
        }
        achievements.bitmap |= bit;
        let reward = QUEST_REWARD_MICRO[quest_id as usize];
        let (_, t_bump) = Pubkey::find_program_address(&[b"quest_treasury"], ctx.program_id);
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                token::Transfer {
                    from: ctx.accounts.quest_ata.to_account_info(),
                    to: ctx.accounts.user_potato_ata.to_account_info(),
                    authority: ctx.accounts.quest_treasury.to_account_info(),
                },
                &[&[b"quest_treasury", &[t_bump]]],
            ),
            reward,
        )?;
        emit!(AchievementClaimed { user, quest_id, reward });
        Ok(())
    }

    /// Updates the presale price (authority only). Two-step for safety:
    /// * `price_lamports == 0` — EMERGENCY STOP: applies immediately and closes
    ///   both presale rails (SOL and SKR) until a new price is set.
    /// * `price_lamports > 0` — proposal only: stored in `AdminState` and applied
    ///   by `apply_pending_presale_price` after the 24 h timelock, so a stolen
    ///   authority key cannot silently re-price the presale within one day.
    pub fn update_presale_price(ctx: Context<UpdatePresalePrice>, price_lamports: u64) -> Result<()> {
        if price_lamports == 0 {
            ctx.accounts.presale_state.price_lamports = 0;
            ctx.accounts.admin_state.pending_presale_price = 0;
            ctx.accounts.admin_state.pending_presale_price_at = 0;
            msg!("Presale emergency stop: price set to 0, both rails closed");
            return Ok(());
        }
        let state = &mut ctx.accounts.admin_state;
        state.pending_presale_price = price_lamports;
        state.pending_presale_price_at = Clock::get()?.unix_timestamp;
        msg!(
            "Presale price {} lamports proposed; call apply_pending_presale_price after {} s",
            price_lamports,
            ADMIN_UPDATE_TIMELOCK_SECONDS
        );
        Ok(())
    }

    /// Step 2 of the presale price update: applies the pending proposal once
    /// the admin timelock has expired. Authority only.
    pub fn apply_pending_presale_price(ctx: Context<ApplyPendingPresalePrice>) -> Result<()> {
        let state = &mut ctx.accounts.admin_state;
        require!(
            state.pending_presale_price_at > 0 && state.pending_presale_price > 0,
            GameError::NothingPending
        );
        let now = Clock::get()?.unix_timestamp;
        require!(
            now >= state.pending_presale_price_at
                .checked_add(ADMIN_UPDATE_TIMELOCK_SECONDS)
                .ok_or(GameError::MathOverflow)?,
            GameError::TimelockNotExpired
        );
        let price = state.pending_presale_price;
        ctx.accounts.presale_state.price_lamports = price;
        state.pending_presale_price = 0;
        state.pending_presale_price_at = 0;
        msg!("Presale price applied: {} lamports", price);
        Ok(())
    }

    /// Покупка поля за SKR во время пресейла.
    /// Тир поля (0/1/2) определяется on-chain: keccak(buyer ‖ sold ‖ slot) % 100
    /// → COMMON 70 % / RARE 25 % / EPIC 5 %. Клиентский выбор тира не принимается —
    /// это закрывает обход, при котором покупатель всегда забирал EPIC за цену дропа.
    /// `sold` и `slot` покупатель не контролирует в момент подписания (конкурентные
    /// покупки сдвигают `sold`, слот включения в блок неизвестен заранее).
    pub fn buy_field_skr(ctx: Context<BuyFieldSkr>, field_id: u64) -> Result<()> {
        require!(!ctx.accounts.config.paused, GameError::Paused);
        let presale = &mut ctx.accounts.presale_state;
        require!(presale.sold < presale.cap, GameError::PresaleCapReached);

        let buyer_presale = &mut ctx.accounts.buyer_presale;
        require!(buyer_presale.count < 5, GameError::PresaleWalletLimitReached);

        require!(ctx.accounts.skr_mint.key() == ctx.accounts.config.skr_mint, GameError::InvalidMint);
        // PresaleState.price_lamports — цена SOL-пресейла (buy_field_sol);
        // цена SKR-пресейла зафиксирована константой 1053 SKR (PRESALE_PRICE_SKR_ATOMS).
        // price_lamports == 0 означает аварийную остановку пресейла (kill switch):
        // закрывает ОБЕ ветки покупки — SOL и SKR.
        require!(presale.cap > 0 && presale.price_lamports > 0, GameError::PresaleNotActive);

        // ── On-chain drop roll ──
        // Энтропия: buyer ‖ sold ‖ slot ‖ последняя запись SlotHashes.
        // SlotHashes-хеш текущего слота не известен в момент подписания и не
        // контролируется покупателем — grind "buy in slot N for guaranteed EPIC"
        // больше не проходит.
        let slot = Clock::get()?.slot;
        let mut roll_hash = anchor_lang::solana_program::keccak::hashv(&[
            ctx.accounts.buyer.key().as_ref(),
            &presale.sold.to_le_bytes(),
            &slot.to_le_bytes(),
        ]);
        if let Some((recent_slot, recent_hash)) = ctx.accounts.slot_hashes.iter().next() {
            roll_hash = anchor_lang::solana_program::keccak::hashv(&[
                roll_hash.as_ref(),
                &recent_slot.to_le_bytes(),
                recent_hash.as_ref(),
            ]);
        }
        let roll = u32::from_le_bytes([roll_hash.0[0], roll_hash.0[1], roll_hash.0[2], roll_hash.0[3]]) % 100;
        let field_type: u8 = if roll < 70 {
            0
        } else if roll < 95 {
            1
        } else {
            2
        };

        let total = PRESALE_PRICE_SKR_ATOMS; // 1053 SKR за модуль
        let treasury_amount = total.checked_mul(80).ok_or(GameError::MathOverflow)? / 100;
        let buyback_amount = total.checked_sub(treasury_amount).ok_or(GameError::MathOverflow)?;

        // 80 % SKR -> ATA казны
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.buyer_skr_ata.to_account_info(),
                    to: ctx.accounts.treasury_skr_ata.to_account_info(),
                    authority: ctx.accounts.buyer.to_account_info(),
                },
            ),
            treasury_amount,
        )?;

        // 20 % SKR -> ATA buyback
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.buyer_skr_ata.to_account_info(),
                    to: ctx.accounts.buyback_skr_ata.to_account_info(),
                    authority: ctx.accounts.buyer.to_account_info(),
                },
            ),
            buyback_amount,
        )?;

        // Создаём поле (логика идентична create_field)
        let now = Clock::get()?.unix_timestamp;
        let field = &mut ctx.accounts.field;
        field.owner = ctx.accounts.buyer.key();
        field.level = 1;
        field.durability = MAX_DURABILITY;
        field.last_harvest = now;
        field.tax_paid_until = now.checked_add(INITIAL_TAX_GRACE).ok_or(GameError::MathOverflow)?;
        field.fertilizer_until = 0;
        field.is_active = true;
        field.field_type = field_type;
        field.bump = ctx.bumps.field;

        // Обновляем счётчики
        presale.sold = presale.sold.checked_add(1).ok_or(GameError::MathOverflow)?;
        if buyer_presale.count == 0 {
            buyer_presale.buyer = ctx.accounts.buyer.key();
            buyer_presale.bump = ctx.bumps.buyer_presale;
        }
        buyer_presale.count = buyer_presale.count.checked_add(1).ok_or(GameError::MathOverflow)?;

        let config = &mut ctx.accounts.config;
        config.field_count = config.field_count.checked_add(1).ok_or(GameError::MathOverflow)?;

        emit!(PresalePurchase {
            buyer: field.owner,
            field: field.key(),
            field_type,
            sol_amount: total,
            roll: roll as u8,
        });
        emit!(FieldCreated { owner: field.owner, field: field.key(), field_type });

        Ok(())
    }

    /// SOL presale purchase. The price scales with the field type exactly like
    /// the POTATO prices do (type_cost_bps): type 0 pays 0.4×, type 1 pays 1×,
    /// type 2 pays 2× of `presale.price_lamports`. `max_total_lamports` is the
    /// buyer's slippage guard: the transaction reverts with InvalidPrice if the
    /// authority raised the price after the buyer signed.
    pub fn buy_field_sol(
        ctx: Context<BuyFieldSol>,
        field_id: u64,
        field_type: u8,
        max_total_lamports: u64,
    ) -> Result<()> {
        require!(!ctx.accounts.config.paused, GameError::Paused);
        require!(field_type < FIELD_TYPE_COUNT, GameError::InvalidFieldType);
        require!(ctx.accounts.presale_state.price_lamports > 0, GameError::PresaleNotActive);

        let presale = &mut ctx.accounts.presale_state;
        require!(presale.sold < presale.cap, GameError::PresaleCapReached);

        let buyer_presale = &mut ctx.accounts.buyer_presale;
        require!(buyer_presale.count < 5, GameError::PresaleWalletLimitReached);

        // Цена зависит от типа поля (иначе EPIC-поле стоило бы как Грядка).
        let sol_amount = ((presale.price_lamports as u128)
            .checked_mul(type_cost_bps(field_type))
            .ok_or(GameError::MathOverflow)?
            / BPS) as u64;
        require!(sol_amount <= max_total_lamports, GameError::InvalidPrice);

        // Transfer SOL: buyer → treasury_sol PDA
        let transfer_ix = anchor_lang::solana_program::system_instruction::transfer(
            &ctx.accounts.buyer.key(),
            &ctx.accounts.treasury_sol.key(),
            sol_amount,
        );
        anchor_lang::solana_program::program::invoke(
            &transfer_ix,
            &[
                ctx.accounts.buyer.to_account_info(),
                ctx.accounts.treasury_sol.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
        )?;

        // Создаём поле (логика идентична create_field)
        let now = Clock::get()?.unix_timestamp;
        let field = &mut ctx.accounts.field;
        field.owner = ctx.accounts.buyer.key();
        field.level = 1;
        field.durability = MAX_DURABILITY;
        field.last_harvest = now;
        field.tax_paid_until = now.checked_add(INITIAL_TAX_GRACE).ok_or(GameError::MathOverflow)?;
        field.fertilizer_until = 0;
        field.is_active = true;
        field.field_type = field_type;
        field.bump = ctx.bumps.field;

        // Обновляем счётчики
        presale.sold = presale.sold.checked_add(1).ok_or(GameError::MathOverflow)?;
        if buyer_presale.count == 0 {
            buyer_presale.buyer = ctx.accounts.buyer.key();
            buyer_presale.bump = ctx.bumps.buyer_presale;
        }
        buyer_presale.count = buyer_presale.count.checked_add(1).ok_or(GameError::MathOverflow)?;

        let config = &mut ctx.accounts.config;
        config.field_count = config.field_count.checked_add(1).ok_or(GameError::MathOverflow)?;

        emit!(PresalePurchase {
            buyer: field.owner,
            field: field.key(),
            field_type,
            sol_amount,
            // SOL-пресейл — явный тир, ролла нет (0 = без дропа)
            roll: 0,
        });
        emit!(FieldCreated { owner: field.owner, field: field.key(), field_type });

        Ok(())
    }

    /// Mints the yield accrued since the last harvest to the owner's token
    /// account, bounded by the epoch cap and the max supply. If the cap allows
    /// only a partial payout, the unpaid remainder keeps accruing.
    pub fn harvest(ctx: Context<Harvest>) -> Result<()> {
        let config = &ctx.accounts.config;
        require!(!config.paused, GameError::Paused);
        require!(ctx.accounts.field.is_active, GameError::FieldInactive);

        let now = Clock::get()?.unix_timestamp;
        let field = &ctx.accounts.field;
        let elapsed = now.saturating_sub(field.last_harvest).min(MAX_ACCRUAL_SECONDS);
        require!(elapsed >= MIN_HARVEST_INTERVAL, GameError::HarvestTooSoon);

        let pending = compute_pending_yield(
            config.base_yield_micro_per_day,
            config.global_multiplier_bps,
            field,
            elapsed,
            now,
            config.epoch_id,
        )?;
        require!(pending > 0, GameError::NothingToHarvest);

        // ── Растущий налог от supply (п.7 документа) ──
        // BaseTax(supply) = 2% + 8% × (TOTAL_SUPPLY / MAX_SUPPLY)²
        // Диапазон: 2% (ранняя стадия) → 10% (поздняя стадия)
        let total_supply = ctx.accounts.potato_mint.supply;
        let max_supply = config.max_supply_micro;
        let supply_ratio_bps = if max_supply > 0 {
            ((total_supply as u128) * 10_000 / (max_supply as u128)) as u64
        } else {
            0
        };
        let base_tax_bps: u64 = 200 + (800 * supply_ratio_bps * supply_ratio_bps / 100_000_000);
        let base_tax_bps = base_tax_bps.min(1000); // жёсткий потолок 10%

        let epoch = &ctx.accounts.epoch;
        let epoch_cap_left = epoch.mint_cap_micro.saturating_sub(epoch.minted_micro);
        let supply_left = max_supply.saturating_sub(total_supply);
        let gross_mint = pending.min(epoch_cap_left).min(supply_left);
        require!(gross_mint > 0, GameError::EpochCapExceeded);

        // Применяем налог: игрок получает (1 - tax), treasury получает tax/2, остальное burn
        let tax_amount = (gross_mint as u128 * base_tax_bps as u128 / 10_000) as u64;
        let player_yield = gross_mint.saturating_sub(tax_amount);
        let treasury_share = tax_amount / 2; // половина налога в treasury, половина burn
        require!(player_yield > 0, GameError::NothingToHarvest);

        // ── Effects ──
        let epoch = &mut ctx.accounts.epoch;
        // minted_micro учитывает ВСЕ минты (player + treasury), а не только player
        epoch.minted_micro = epoch.minted_micro.saturating_add(player_yield).saturating_add(treasury_share);

        let field = &mut ctx.accounts.field;
        // Time actually paid for. Equals `elapsed` unless the cap truncated the payout.
        let consumed: i64 = if gross_mint == pending {
            elapsed
        } else {
            ((elapsed as u128)
                .checked_mul(gross_mint as u128)
                .ok_or(GameError::MathOverflow)?
                / pending as u128) as i64
        };
        let accrual_start = now.saturating_sub(elapsed);
        field.last_harvest = accrual_start.saturating_add(consumed).min(now);
        // Silicon Skin (mutation_type = 2): durability decay в 2 раза медленнее
        let decay_interval = if field.mutation_type == 2 {
            DURABILITY_DECAY_INTERVAL.saturating_mul(2)
        } else {
            DURABILITY_DECAY_INTERVAL
        };
        let decay = (consumed / decay_interval).max(1).min(MAX_DURABILITY as i64) as u8;
        field.durability = field.durability.saturating_sub(decay);

        // ── Interaction ──
        let bump = config.bump;
        let seeds: &[&[u8]] = &[b"config", &[bump]];
        let signer: &[&[&[u8]]] = &[seeds];
        
        // Минт игроку (после вычета налога)
        token::mint_to(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                MintTo {
                    mint: ctx.accounts.potato_mint.to_account_info(),
                    to: ctx.accounts.user_potato.to_account_info(),
                    authority: ctx.accounts.config.to_account_info(),
                },
                signer,
            ),
            player_yield,
        )?;
        
        // Минт в treasury (доля налога)
        if treasury_share > 0 {
            token::mint_to(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    MintTo {
                        mint: ctx.accounts.potato_mint.to_account_info(),
                        to: ctx.accounts.treasury_potato.to_account_info(),
                        authority: ctx.accounts.config.to_account_info(),
                    },
                    signer,
                ),
                treasury_share,
            )?;
        }

        emit!(Harvested {
            owner: ctx.accounts.field.owner,
            field: ctx.accounts.field.key(),
            amount_micro: player_yield,
        });
        
        if treasury_share > 0 {
            emit!(TreasuryTaxed {
                field: ctx.accounts.field.key(),
                treasury: ctx.accounts.treasury_potato.key(),
                amount_micro: treasury_share,
                tax_bps: base_tax_bps as u16,
            });
        }
        Ok(())
    }

    /// Restores durability to 100 for a burn.
    pub fn repair_field(ctx: Context<RepairField>) -> Result<()> {
        require!(!ctx.accounts.config.paused, GameError::Paused);
        require!(ctx.accounts.field.durability < MAX_DURABILITY, GameError::NothingToRepair);
        let base_cost = scaled_cost(BASE_REPAIR_MICRO, ctx.accounts.field.field_type);
        // Прогрессивный множитель ремонта: L1-2 → 1×, L30 → 10×, L50 → 16×
        let level_mult = ((ctx.accounts.field.level as u64) / 3).max(1);
        let cost = base_cost
            .checked_mul(level_mult)
            .ok_or(GameError::MathOverflow)?;
        burn_from_user(
            &ctx.accounts.token_program,
            &ctx.accounts.potato_mint,
            &ctx.accounts.user_potato,
            &ctx.accounts.owner,
            cost,
        )?;
        ctx.accounts.config.total_burned_micro =
            ctx.accounts.config.total_burned_micro.saturating_add(cost);
        let field = &mut ctx.accounts.field;
        field.durability = MAX_DURABILITY;
        emit!(FieldRepaired { field: field.key(), cost_micro: cost });
        Ok(())
    }

    /// Raises the field level by one for a burn of `BASE_UPGRADE × level × type`.
    pub fn upgrade_field(ctx: Context<UpgradeField>) -> Result<()> {
        require!(!ctx.accounts.config.paused, GameError::Paused);
        let field = &ctx.accounts.field;
        require!(field.level < MAX_FIELD_LEVEL, GameError::MaxLevelReached);
        let cost = upgrade_cost_micro(field.level, field.field_type)?;
        burn_from_user(
            &ctx.accounts.token_program,
            &ctx.accounts.potato_mint,
            &ctx.accounts.user_potato,
            &ctx.accounts.owner,
            cost,
        )?;
        ctx.accounts.config.total_burned_micro =
            ctx.accounts.config.total_burned_micro.saturating_add(cost);
        let field = &mut ctx.accounts.field;
        field.level = field.level.checked_add(1).ok_or(GameError::MathOverflow)?;

        // Шанс мутации при апгрейде (5% общий: 3% Golden, 2% Silicon)
        // Детерминированный рандом: keccak(field_key ‖ slot ‖ SlotHashes[0]).
        // Хеш последнего слота из SlotHashes не известен в момент подписания —
        // игрок не может grind'ить слот включения ради гарантированной мутации.
        if field.mutation_type == 0 {
            let slot = Clock::get()?.slot;
            let mut seed = anchor_lang::solana_program::keccak::hashv(&[
                field.key().as_ref(),
                &slot.to_le_bytes(),
            ]);
            if let Some((recent_slot, recent_hash)) = ctx.accounts.slot_hashes.iter().next() {
                seed = anchor_lang::solana_program::keccak::hashv(&[
                    seed.as_ref(),
                    &recent_slot.to_le_bytes(),
                    recent_hash.as_ref(),
                ]);
            }
            let roll = (seed.0[0] as u64) % 100;
            if roll < 3 {
                field.mutation_type = 1; // Golden Sprout
            } else if roll < 5 {
                field.mutation_type = 2; // Silicon Skin
            }
        }

        emit!(FieldUpgraded { field: field.key(), new_level: field.level, cost_micro: cost });
        Ok(())
    }

    /// Extends tax coverage by one period (prepaid up to `MAX_TAX_PREPAY`).
    pub fn pay_tax(ctx: Context<PayTax>) -> Result<()> {
        require!(!ctx.accounts.config.paused, GameError::Paused);
        let now = Clock::get()?.unix_timestamp;
        let field = &ctx.accounts.field;
        let new_until = extend_timer(field.tax_paid_until, now, TAX_PERIOD)?;
        require!(
            new_until <= now.saturating_add(MAX_TAX_PREPAY),
            GameError::PrepayLimitReached
        );
        let base_cost = scaled_cost(BASE_TAX_MICRO, field.field_type);
        // Прогрессивный множитель: L1 → 1×, L10 → 5.5×, L50 → 25.5×
        let level_mult = (field.level as u64).saturating_add(1) / 2;
        let cost = base_cost
            .checked_mul(level_mult)
            .ok_or(GameError::MathOverflow)?;
        burn_from_user(
            &ctx.accounts.token_program,
            &ctx.accounts.potato_mint,
            &ctx.accounts.user_potato,
            &ctx.accounts.owner,
            cost,
        )?;
        ctx.accounts.config.total_burned_micro =
            ctx.accounts.config.total_burned_micro.saturating_add(cost);
        let field = &mut ctx.accounts.field;
        field.tax_paid_until = new_until;
        emit!(TaxPaid { field: field.key(), paid_until: new_until, cost_micro: cost });
        Ok(())
    }

    /// Applies fertilizer for 24h (stackable up to `MAX_FERTILIZER_PREPAY`).
    pub fn apply_fertilizer(ctx: Context<ApplyFertilizer>) -> Result<()> {
        require!(!ctx.accounts.config.paused, GameError::Paused);
        let now = Clock::get()?.unix_timestamp;
        let field = &ctx.accounts.field;
        let new_until = extend_timer(field.fertilizer_until, now, FERTILIZER_DURATION)?;
        require!(
            new_until <= now.saturating_add(MAX_FERTILIZER_PREPAY),
            GameError::PrepayLimitReached
        );
        let cost = scaled_cost(BASE_FERTILIZER_MICRO, field.field_type);
        burn_from_user(
            &ctx.accounts.token_program,
            &ctx.accounts.potato_mint,
            &ctx.accounts.user_potato,
            &ctx.accounts.owner,
            cost,
        )?;
        ctx.accounts.config.total_burned_micro =
            ctx.accounts.config.total_burned_micro.saturating_add(cost);
        let field = &mut ctx.accounts.field;
        field.fertilizer_until = new_until;
        emit!(FertilizerApplied { field: field.key(), active_until: new_until, cost_micro: cost });
        Ok(())
    }

    /// Покупка лицензии экспорта: 500 SKR уходят в казну проекта
    /// (ATA PDA `treasury_sol` — та же казна, что и 80 % SKR-пресейла),
    /// лицензия на 30 дней. Снижает комиссию рынка на 3% (300 bps)
    /// для продавца с активной лицензией.
    pub fn buy_export_license(ctx: Context<BuyExportLicense>) -> Result<()> {
        require!(!ctx.accounts.config.paused, GameError::Paused);
        require!(ctx.accounts.skr_mint.key() == ctx.accounts.config.skr_mint, GameError::InvalidMint);
        let now = Clock::get()?.unix_timestamp;
        let thirty_days = 30i64 * 86400;

        // 500 SKR с кошелька игрока — в казну
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.user_skr_ata.to_account_info(),
                    to: ctx.accounts.treasury_skr_ata.to_account_info(),
                    authority: ctx.accounts.payer.to_account_info(),
                },
            ),
            EXPORT_LICENSE_PRICE_SKR_ATOMS,
        )?;

        // Создаём или продлеваем лицензию
        let license = &mut ctx.accounts.license;
        if license.owner == Pubkey::default() {
            license.owner = ctx.accounts.payer.key();
            license.expires_at = now + thirty_days;
        } else if license.expires_at < now {
            license.expires_at = now + thirty_days;
        } else {
            license.expires_at = license.expires_at.checked_add(thirty_days).ok_or(GameError::MathOverflow)?;
        }
        license.bump = ctx.bumps.license;

        emit!(ExportLicensePurchased { owner: ctx.accounts.payer.key(), expires_at: license.expires_at, cost_skr_atoms: EXPORT_LICENSE_PRICE_SKR_ATOMS });
        Ok(())
    }

    /// Lists `amount_micro` $POTATO for sale at `price_lamports_per_potato`
    /// (lamports per whole $POTATO). Amount + fee move into an escrow PDA.
    pub fn create_sell_order(
        ctx: Context<CreateSellOrder>,
        order_id: u64,
        amount_micro: u64,
        price_lamports_per_potato: u64,
    ) -> Result<()> {
        require!(!ctx.accounts.config.paused, GameError::Paused);
        require!(amount_micro >= MIN_ORDER_AMOUNT_MICRO, GameError::OrderTooSmall);
        require!(price_lamports_per_potato > 0, GameError::InvalidPrice);
        let total_lamports = order_total_lamports(amount_micro, price_lamports_per_potato)?;
        require!(total_lamports >= MIN_ORDER_TOTAL_LAMPORTS, GameError::OrderTotalTooSmall);

        let now = Clock::get()?.unix_timestamp;

        let profile = &mut ctx.accounts.seller_profile;
        require!(
            now.saturating_sub(profile.last_cancel_at) >= CANCEL_COOLDOWN,
            GameError::CancelCooldown
        );
        profile.seller = ctx.accounts.seller.key();
        profile.bump = ctx.bumps.seller_profile;

        let fee_micro = order_fee_micro(amount_micro)?;
        let total_to_escrow = amount_micro.checked_add(fee_micro).ok_or(GameError::MathOverflow)?;

        let order = &mut ctx.accounts.order;
        order.seller = ctx.accounts.seller.key();
        order.amount_micro = amount_micro;
        order.price_lamports_per_potato = price_lamports_per_potato;
        order.fee_micro = fee_micro;
        order.status = OrderStatus::Active;
        order.created_at = now;
        order.expires_at = now.checked_add(ORDER_TTL).ok_or(GameError::MathOverflow)?;
        order.escrow_bump = ctx.bumps.escrow;
        order.order_bump = ctx.bumps.order;

        let stats = &mut ctx.accounts.market_stats;
        stats.bump = ctx.bumps.market_stats;
        stats.roll_window(now);

        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.seller_potato.to_account_info(),
                    to: ctx.accounts.escrow.to_account_info(),
                    authority: ctx.accounts.seller.to_account_info(),
                },
            ),
            total_to_escrow,
        )?;

        emit!(OrderCreated {
            order: order.key(),
            seller: order.seller,
            amount_micro,
            price_lamports_per_potato,
        });
        Ok(())
    }

    /// Buys an active order: SOL goes to the seller, $POTATO to the buyer, the
    /// fee is split between burn and treasury, escrow and order are closed.
    ///
    /// Fee accounting. The escrow holds exactly `amount + fee_listed` and must
    /// drain to zero, so every rupee of the fee has an explicit destination:
    /// * seller with an export license: −3 % of the amount off the fee,
    ///   the difference is refunded to the seller (the fee payer);
    /// * buyer with a registered referrer: −1 % off the fee (refunded to the
    ///   seller) and +0.5 % paid to the referrer **from the fee itself** —
    ///   no fresh supply is minted, so the reward is always cap-safe;
    /// * the net fee is split 60 % burn / 40 % treasury.
    ///
    /// `remaining_accounts` (fixed positions):
    /// * [0] seller export-license PDA (always passed; may not exist);
    /// * [1] buyer's referral PDA (only when the buyer has a referrer);
    /// * [2] referrer's $POTATO ATA (only together with [1]).
    /// If the referrer's ATA is missing/invalid the reward is burned instead.
    pub fn fill_order<'info>(ctx: Context<'_, '_, '_, 'info, FillOrder<'info>>) -> Result<()> {
        require!(!ctx.accounts.config.paused, GameError::Paused);
        let now = Clock::get()?.unix_timestamp;
        let order = &ctx.accounts.order;
        require!(order.status == OrderStatus::Active, GameError::OrderNotActive);
        require!(now < order.expires_at, GameError::OrderExpired);
        require!(order.seller != ctx.accounts.buyer.key(), GameError::SelfTradeBlocked);

        let order_key = order.key();
        let escrow_bump = order.escrow_bump;
        let amount_micro = order.amount_micro;
        let fee_listed = order.fee_micro;
        let total_lamports = order_total_lamports(amount_micro, order.price_lamports_per_potato)?;

        // ── Скидка за экспортную лицензию продавца (−3 % от суммы) ──
        let mut license_discount: u64 = 0;
        if let Some(lic_acc) = ctx.remaining_accounts.first() {
            let (expected, _) = Pubkey::find_program_address(
                &[b"license", ctx.accounts.seller.key().as_ref()],
                ctx.program_id,
            );
            // Владелец аккаунта должен быть нашей программой: иначе атакующий
            // может подсунуть поддельный аккаунт со своими данными (discount).
            if lic_acc.key() == expected
                && lic_acc.owner() == ctx.program_id
                && !lic_acc.data_is_empty()
            {
                let data = lic_acc.try_borrow_data()?;
                if let Ok(lic) = ExportLicense::try_deserialize(&mut &data[..]) {
                    if lic.expires_at > now {
                        license_discount = ((amount_micro as u128 * 300 / 10_000) as u64).min(fee_listed);
                    }
                }
            }
        }

        // ── Рефералка покупателя: −1 % комиссии + 0.5 % рефереру ──
        let mut referrer_key = Pubkey::default();
        let mut referral_discount: u64 = 0;
        if let Some(ref_acc) = ctx.remaining_accounts.get(1) {
            let (expected_ref, _) = Pubkey::find_program_address(
                &[b"referral", ctx.accounts.buyer.key().as_ref()],
                ctx.program_id,
            );
            // Владелец аккаунта должен быть нашей программой (см. license выше):
            // поддельный Referral-аккаунт позволил бы задать произвольного "реферера".
            if ref_acc.key() == expected_ref
                && ref_acc.owner() == ctx.program_id
                && !ref_acc.data_is_empty()
            {
                let data = ref_acc.try_borrow_data()?;
                if let Ok(referral) = Referral::try_deserialize(&mut &data[..]) {
                    let referrer = referral.referrer;
                    if referrer != Pubkey::default()
                        && referrer != ctx.accounts.seller.key()
                        && referrer != ctx.accounts.buyer.key()
                    {
                        referrer_key = referrer;
                        referral_discount = (amount_micro as u128 * 100 / 10_000) as u64;
                    }
                }
            }
        }

        // ── Итоговая комиссия: скидки уменьшают её, разница — refund продавцу ──
        let total_discounts = license_discount
            .saturating_add(referral_discount)
            .min(fee_listed);
        let fee_net = fee_listed.saturating_sub(total_discounts);
        let fee_to_treasury = ((fee_net as u128) * (100u128 - FEE_BURN_PERCENT as u128) / 100) as u64;
        let fee_to_burn_base = fee_net.saturating_sub(fee_to_treasury);
        let referrer_reward = if referrer_key != Pubkey::default() {
            // 0.5 % от суммы, не больше burn-доли
            ((amount_micro as u128 * 50 / 10_000) as u64).min(fee_to_burn_base)
        } else {
            0
        };
        let mut fee_to_burn = fee_to_burn_base.saturating_sub(referrer_reward);

        // ── Effects (CEI) ──
        ctx.accounts.order.status = OrderStatus::Filled;
        ctx.accounts.config.total_burned_micro =
            ctx.accounts.config.total_burned_micro.saturating_add(fee_to_burn);
        let stats = &mut ctx.accounts.market_stats;
        stats.roll_window(now);
        stats.total_trades = stats.total_trades.saturating_add(1);
        stats.total_sol_volume = stats.total_sol_volume.saturating_add(total_lamports);
        stats.sell_volume_24h_micro = stats.sell_volume_24h_micro.saturating_add(amount_micro);
        stats.buy_volume_24h_micro = stats.buy_volume_24h_micro.saturating_add(amount_micro);

        // ── Interactions ──
        anchor_lang::solana_program::program::invoke(
            &anchor_lang::solana_program::system_instruction::transfer(
                &ctx.accounts.buyer.key(),
                &ctx.accounts.seller.key(),
                total_lamports,
            ),
            &[
                ctx.accounts.buyer.to_account_info(),
                ctx.accounts.seller.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
        )?;

        let seeds: &[&[u8]] = &[b"escrow", order_key.as_ref(), &[escrow_bump]];
        let signer: &[&[&[u8]]] = &[seeds];
        let token_program = ctx.accounts.token_program.to_account_info();
        let escrow = ctx.accounts.escrow.to_account_info();

        // Награда рефереру — переводом из escrow (часть комиссии), НЕ минтом.
        // ATA реферера валидируется полностью: owner == Token Program и полный
        // borsh-deserialize spl TokenAccount (ручная нарезка байт принимала
        // поддельные аккаунты с произвольным owner/mint в первых 64 байтах).
        let mut reward_claimed = false;
        if referrer_reward > 0 {
            if let Some(ata_acc) = ctx.remaining_accounts.get(2) {
                let valid = if ata_acc.owner() == ctx.accounts.token_program.key()
                    && !ata_acc.data_is_empty()
                {
                    let data = ata_acc.try_borrow_data()?;
                    let mut slice: &[u8] = &data;
                    TokenAccount::try_deserialize(&mut slice)
                        .map(|ata| {
                            ata.mint == ctx.accounts.potato_mint.key()
                                && ata.owner == referrer_key
                        })
                        .unwrap_or(false)
                } else {
                    false
                };
                {
                    if valid {
                        token::transfer(
                            CpiContext::new_with_signer(
                                token_program.clone(),
                                Transfer {
                                    from: escrow.clone(),
                                    to: ata_acc.to_account_info(),
                                    authority: escrow.clone(),
                                },
                                signer,
                            ),
                            referrer_reward,
                        )?;
                        reward_claimed = true;
                    }
                }
            }
            if !reward_claimed {
                // ATA не передан/неверный — доля сгорает, баланс escrow сходится.
                fee_to_burn = fee_to_burn.saturating_add(referrer_reward);
            }
        }

        if fee_to_burn > 0 {
            token::burn(
                CpiContext::new_with_signer(
                    token_program.clone(),
                    Burn {
                        mint: ctx.accounts.potato_mint.to_account_info(),
                        from: escrow.clone(),
                        authority: escrow.clone(),
                    },
                    signer,
                ),
                fee_to_burn,
            )?;
        }
        if fee_to_treasury > 0 {
            token::transfer(
                CpiContext::new_with_signer(
                    token_program.clone(),
                    Transfer {
                        from: escrow.clone(),
                        to: ctx.accounts.treasury_potato.to_account_info(),
                        authority: escrow.clone(),
                    },
                    signer,
                ),
                fee_to_treasury,
            )?;
        }
        if total_discounts > 0 {
            token::transfer(
                CpiContext::new_with_signer(
                    token_program.clone(),
                    Transfer {
                        from: escrow.clone(),
                        to: ctx.accounts.seller_potato.to_account_info(),
                        authority: escrow.clone(),
                    },
                    signer,
                ),
                total_discounts,
            )?;
        }
        token::transfer(
            CpiContext::new_with_signer(
                token_program.clone(),
                Transfer {
                    from: escrow.clone(),
                    to: ctx.accounts.buyer_potato.to_account_info(),
                    authority: escrow.clone(),
                },
                signer,
            ),
            amount_micro,
        )?;
        token::close_account(CpiContext::new_with_signer(
            token_program,
            CloseAccount {
                account: escrow.clone(),
                destination: ctx.accounts.seller.to_account_info(),
                authority: escrow,
            },
            signer,
        ))?;

        emit!(OrderFilled {
            order: order_key,
            buyer: ctx.accounts.buyer.key(),
            amount_micro,
            total_lamports,
        });
        if reward_claimed {
            emit!(ReferralRewardPaid {
                buyer: ctx.accounts.buyer.key(),
                referrer: referrer_key,
                reward_micro: referrer_reward,
            });
        }
        Ok(())
    }

    /// Seller cancels their own active order; amount + fee are refunded and a
    /// 3h listing cooldown starts. Works even while the game is paused.
    pub fn cancel_order(ctx: Context<CancelOrder>) -> Result<()> {
        let order = &ctx.accounts.order;
        require!(order.status == OrderStatus::Active, GameError::OrderNotActive);
        let order_key = order.key();
        let escrow_bump = order.escrow_bump;
        let refund = order.amount_micro.checked_add(order.fee_micro).ok_or(GameError::MathOverflow)?;

        ctx.accounts.order.status = OrderStatus::Cancelled;
        let profile = &mut ctx.accounts.seller_profile;
        profile.seller = ctx.accounts.seller.key();
        profile.bump = ctx.bumps.seller_profile;
        profile.last_cancel_at = Clock::get()?.unix_timestamp;

        refund_and_close_escrow(
            &ctx.accounts.token_program,
            &ctx.accounts.escrow,
            &ctx.accounts.seller_potato,
            &ctx.accounts.seller.to_account_info(),
            order_key,
            escrow_bump,
            refund,
        )?;

        emit!(OrderCancelled { order: order_key, seller: ctx.accounts.seller.key() });
        Ok(())
    }

    /// Permissionless crank: refunds an expired order to its seller.
    pub fn close_expired_order(ctx: Context<CloseExpiredOrder>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let order = &ctx.accounts.order;
        require!(order.status == OrderStatus::Active, GameError::OrderNotActive);
        require!(now >= order.expires_at, GameError::OrderNotExpired);
        let order_key = order.key();
        let escrow_bump = order.escrow_bump;
        let refund = order.amount_micro.checked_add(order.fee_micro).ok_or(GameError::MathOverflow)?;

        ctx.accounts.order.status = OrderStatus::Expired;

        refund_and_close_escrow(
            &ctx.accounts.token_program,
            &ctx.accounts.escrow,
            &ctx.accounts.seller_potato,
            &ctx.accounts.seller.to_account_info(),
            order_key,
            escrow_bump,
            refund,
        )?;

        emit!(OrderExpiredEvent { order: order_key });
        Ok(())
    }

    /// Authority-only (backend) reward mint, counted against the epoch cap.
    pub fn grant_reward(ctx: Context<GrantReward>, amount_micro: u64) -> Result<()> {
        require!(!ctx.accounts.config.paused, GameError::Paused);
        // S-03: reward_signer отделён от authority — backend использует low-priv ключ (fallback к authority для совместимости)
        let signer_key = ctx.accounts.authority.key();
        let cfg = &ctx.accounts.config;
        let authorized = signer_key == cfg.reward_signer || signer_key == cfg.authority;
        require!(authorized, GameError::Unauthorized);
        require!(
            amount_micro > 0 && amount_micro <= MAX_REWARD_MICRO,
            GameError::RewardTooLarge
        );
        let supply_left = ctx
            .accounts
            .config
            .max_supply_micro
            .saturating_sub(ctx.accounts.potato_mint.supply);
        require!(amount_micro <= supply_left, GameError::MaxSupplyReached);

        let epoch = &mut ctx.accounts.epoch;
        // Квота ручных грантов: суммарно не более GRANT_QUOTA_SHARE_BPS (10 %)
        // капа эпохи. Иначе скомпрометированный reward_signer мог бы вычерпать
        // весь дневной кап грантами, оставив игроков без harvest.
        let grant_quota = ((epoch.mint_cap_micro as u128)
            .checked_mul(GRANT_QUOTA_SHARE_BPS as u128)
            .ok_or(GameError::MathOverflow)?
            / BPS) as u64;
        let new_granted = epoch
            .granted_micro
            .checked_add(amount_micro)
            .ok_or(GameError::MathOverflow)?;
        require!(new_granted <= grant_quota, GameError::GrantQuotaExceeded);
        epoch.granted_micro = new_granted;

        let new_minted = epoch.minted_micro.checked_add(amount_micro).ok_or(GameError::MathOverflow)?;
        require!(new_minted <= epoch.mint_cap_micro, GameError::EpochCapExceeded);
        epoch.minted_micro = new_minted;

        let bump = ctx.accounts.config.bump;
        let seeds: &[&[u8]] = &[b"config", &[bump]];
        let signer: &[&[&[u8]]] = &[seeds];
        token::mint_to(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                MintTo {
                    mint: ctx.accounts.potato_mint.to_account_info(),
                    to: ctx.accounts.user_potato.to_account_info(),
                    authority: ctx.accounts.config.to_account_info(),
                },
                signer,
            ),
            amount_micro,
        )?;
        emit!(RewardGranted { recipient: ctx.accounts.user_potato.owner, amount_micro });
        Ok(())
    }

    /// Authority-only withdrawal from the treasury ATA, rate-limited to
    /// MAX_WITHDRAW_POTATO_MICRO_PER_WINDOW per rolling 24 h window so a stolen
    /// authority key cannot drain the treasury in one transaction.
    pub fn withdraw_treasury(ctx: Context<WithdrawTreasury>, amount_micro: u64) -> Result<()> {
        require!(amount_micro > 0, GameError::InvalidAmount);
        let state = &mut ctx.accounts.admin_state;
        state.roll_withdraw_window(Clock::get()?.unix_timestamp);
        let new_total = state
            .withdrawn_potato_micro
            .checked_add(amount_micro)
            .ok_or(GameError::MathOverflow)?;
        require!(
            new_total <= MAX_WITHDRAW_POTATO_MICRO_PER_WINDOW,
            GameError::WithdrawWindowLimitExceeded
        );
        state.withdrawn_potato_micro = new_total;
        let bump = ctx.accounts.config.bump;
        let seeds: &[&[u8]] = &[b"config", &[bump]];
        let signer: &[&[&[u8]]] = &[seeds];
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.treasury_potato.to_account_info(),
                    to: ctx.accounts.destination.to_account_info(),
                    authority: ctx.accounts.config.to_account_info(),
                },
                signer,
            ),
            amount_micro,
        )?;
        emit!(TreasuryWithdrawn { destination: ctx.accounts.destination.key(), amount_micro });
        Ok(())
    }

    /// Authority-only: withdraw SOL accumulated in the `treasury_sol` PDA vault
    /// (SOL presale proceeds), rate-limited per rolling 24 h window.
    pub fn withdraw_treasury_sol(ctx: Context<WithdrawTreasurySol>, amount_lamports: u64) -> Result<()> {
        require!(amount_lamports > 0, GameError::InvalidAmount);
        // Rate-limit BEFORE the balance check: the window cap is a policy
        // ceiling, and checking it first keeps the error unambiguous.
        let state = &mut ctx.accounts.admin_state;
        state.roll_withdraw_window(Clock::get()?.unix_timestamp);
        let new_total = state
            .withdrawn_sol_lamports
            .checked_add(amount_lamports)
            .ok_or(GameError::MathOverflow)?;
        require!(
            new_total <= MAX_WITHDRAW_SOL_LAMPORTS_PER_WINDOW,
            GameError::WithdrawWindowLimitExceeded
        );
        state.withdrawn_sol_lamports = new_total;
        let current = ctx.accounts.treasury_sol.lamports();
        require!(amount_lamports <= current, GameError::InvalidAmount);
        // PDA-казна — 0-байтовый системный аккаунт (data owner = System Program):
        // прямой write lamports рантайм запрещает ("spent from the balance of
        // an account it does not own") — переводим через System Program CPI,
        // подписанный seeds PDA (new_with_signer) — без этого `from` не
        // считается подписантом и CPI отклоняется. Тот же паттерн, что в
        // withdraw_treasury (POTATO), где он проходит тесты.
        let bump = ctx.bumps.treasury_sol;
        let seeds: &[&[u8]] = &[b"treasury_sol", &[bump]];
        let signer: &[&[&[u8]]] = &[seeds];
        let cpi_accounts = anchor_lang::system_program::Transfer {
            from: ctx.accounts.treasury_sol.to_account_info(),
            to: ctx.accounts.authority.to_account_info(),
        };
        let cpi_context = CpiContext::new_with_signer(
            ctx.accounts.system_program.to_account_info(),
            cpi_accounts,
            signer,
        );
        anchor_lang::system_program::transfer(cpi_context, amount_lamports)?;
        emit!(TreasurySolWithdrawn { destination: ctx.accounts.authority.key(), amount_lamports });
        Ok(())
    }

    /// Authority-only: withdraw SKR from the treasury ATA (80 % of SKR presale
    /// proceeds + export license payments) to the authority's own SKR ATA.
    pub fn withdraw_skr_treasury(ctx: Context<WithdrawSkrTreasury>, amount_skr_atoms: u64) -> Result<()> {
        require!(ctx.accounts.skr_mint.key() == ctx.accounts.config.skr_mint, GameError::InvalidMint);
        require!(amount_skr_atoms > 0, GameError::InvalidAmount);
        let state = &mut ctx.accounts.admin_state;
        state.roll_withdraw_window(Clock::get()?.unix_timestamp);
        let new_total = state
            .withdrawn_skr_atoms
            .checked_add(amount_skr_atoms)
            .ok_or(GameError::MathOverflow)?;
        require!(
            new_total <= MAX_WITHDRAW_SKR_ATOMS_PER_WINDOW,
            GameError::WithdrawWindowLimitExceeded
        );
        state.withdrawn_skr_atoms = new_total;
        let (_, t_bump) = Pubkey::find_program_address(&[b"treasury_sol"], ctx.program_id);
        let seeds: &[&[u8]] = &[b"treasury_sol", &[t_bump]];
        let signer: &[&[&[u8]]] = &[seeds];
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.treasury_skr_ata.to_account_info(),
                    to: ctx.accounts.destination_ata.to_account_info(),
                    authority: ctx.accounts.treasury_sol.to_account_info(),
                },
                signer,
            ),
            amount_skr_atoms,
        )?;
        emit!(TreasurySkrWithdrawn { destination: ctx.accounts.authority.key(), amount_skr_atoms });
        Ok(())
    }

    /// After a two-step authority transfer the presale state still references
    /// the OLD authority (fixed at `init_presale`), so all presale purchases
    /// fail on `has_one = authority`. Call once, by the new authority.
    pub fn migrate_presale_authority(ctx: Context<MigratePresaleAuthority>) -> Result<()> {
        let presale = &mut ctx.accounts.presale_state;
        presale.authority = ctx.accounts.authority.key();
        emit!(PresaleAuthorityMigrated { authority: presale.authority });
        Ok(())
    }

    /// Emergency switch. Pausing blocks minting and new spends but never
    /// refunds (`cancel_order`, `close_expired_order`).
    pub fn set_paused(ctx: Context<SetPaused>, paused: bool) -> Result<()> {
        ctx.accounts.config.paused = paused;
        emit!(PausedToggled { paused });
        Ok(())
    }

    /// Step 1 of the two-step authority transfer.
    pub fn propose_authority(ctx: Context<UpdateConfig>, new_authority: Pubkey) -> Result<()> {
        require!(new_authority != Pubkey::default(), GameError::InvalidAuthority);
        ctx.accounts.config.pending_authority = new_authority;
        emit!(AuthorityProposed { pending_authority: new_authority });
        Ok(())
    }

    /// Step 2: the proposed key signs to take over.
    pub fn accept_authority(ctx: Context<AcceptAuthority>) -> Result<()> {
        let config = &mut ctx.accounts.config;
        require!(
            config.pending_authority != Pubkey::default()
                && ctx.accounts.new_authority.key() == config.pending_authority,
            GameError::Unauthorized
        );
        let previous = config.authority;
        config.authority = config.pending_authority;
        config.pending_authority = Pubkey::default();
        emit!(AuthorityAccepted { previous, current: config.authority });
        Ok(())
    }

    /// Tunes emission parameters within hard-coded ceilings. A new mint cap
    /// takes effect from the next epoch.
    pub fn update_config(
        ctx: Context<UpdateConfig>,
        daily_mint_cap_micro: Option<u64>,
        base_yield_micro_per_day: Option<u64>,
        global_multiplier_bps: Option<u16>,
    ) -> Result<()> {
        let config = &mut ctx.accounts.config;
        if let Some(cap) = daily_mint_cap_micro {
            require!(cap > 0, GameError::InvalidAmount);
            require!(cap <= MAX_DAILY_CAP_MICRO, GameError::CapTooHigh);
            config.daily_mint_cap_micro = cap;
        }
        if let Some(y) = base_yield_micro_per_day {
            // Верхняя граница обязательна: base_yield × ~10 M полей — главный
            // рычаг эмиссии, опечатка в нём ломает экономику необратимо.
            require!(
                y > 0 && y <= MAX_BASE_YIELD_MICRO_PER_DAY,
                GameError::BaseYieldTooHigh
            );
            config.base_yield_micro_per_day = y;
        }
        if let Some(m) = global_multiplier_bps {
            require!(m <= MAX_GLOBAL_MULTIPLIER_BPS, GameError::MultiplierTooHigh);
            config.global_multiplier_bps = m;
        }
        emit!(ConfigUpdated {
            daily_mint_cap_micro: config.daily_mint_cap_micro,
            base_yield_micro_per_day: config.base_yield_micro_per_day,
            global_multiplier_bps: config.global_multiplier_bps,
        });
        Ok(())
    }

    /// S-01: обновляет SKR mint (mainnet миграция) — только authority.
    /// Двухшагово: здесь лишь ПРЕДЛОЖЕНИЕ (proposal) в AdminState; фактическая
    /// замена происходит в `apply_pending_skr_mint` после 24-часового тимелокa.
    /// Мгновенная подмена mint позволила бы угнанному ключу принимать платежи
    /// в бесполезном токене уже в следующей транзакции.
    pub fn update_skr_mint(ctx: Context<UpdateSkrMint>, new_skr_mint: Pubkey) -> Result<()> {
        require!(new_skr_mint != Pubkey::default(), GameError::InvalidMint);
        let state = &mut ctx.accounts.admin_state;
        state.pending_skr_mint = new_skr_mint;
        state.pending_skr_mint_at = Clock::get()?.unix_timestamp;
        msg!(
            "SKR mint {} proposed; call apply_pending_skr_mint after {} s",
            new_skr_mint,
            ADMIN_UPDATE_TIMELOCK_SECONDS
        );
        Ok(())
    }

    /// Step 2 of the SKR mint migration: applies the pending mint once the
    /// admin timelock has expired. Authority only.
    pub fn apply_pending_skr_mint(ctx: Context<ApplyPendingSkrMint>) -> Result<()> {
        let state = &mut ctx.accounts.admin_state;
        require!(
            state.pending_skr_mint_at > 0 && state.pending_skr_mint != Pubkey::default(),
            GameError::NothingPending
        );
        let now = Clock::get()?.unix_timestamp;
        require!(
            now >= state.pending_skr_mint_at
                .checked_add(ADMIN_UPDATE_TIMELOCK_SECONDS)
                .ok_or(GameError::MathOverflow)?,
            GameError::TimelockNotExpired
        );
        let new_skr_mint = state.pending_skr_mint;
        ctx.accounts.config.skr_mint = new_skr_mint;
        state.pending_skr_mint = Pubkey::default();
        state.pending_skr_mint_at = 0;
        emit!(SkrMintUpdated { new_skr_mint });
        Ok(())
    }

    /// S-03: обновляет reward_signer — только authority. Backend будет подписывать grant_reward этим ключом.
    pub fn update_reward_signer(ctx: Context<UpdateConfig>, new_signer: Pubkey) -> Result<()> {
        require!(new_signer != Pubkey::default(), GameError::InvalidAuthority);
        ctx.accounts.config.reward_signer = new_signer;
        emit!(RewardSignerUpdated { new_signer });
        Ok(())
    }
    // ───────────────────────── Migration (devnet → v2) ───────────────────────────
    
    /// Upgrade supported legacy layouts, preserving existing fields and flags.
    /// Authority pays only the target account's rent shortfall; retries are safe.
    pub fn migrate_config(ctx: Context<MigrateConfig>) -> Result<()> {
        let info = ctx.accounts.config.to_account_info();
        let updated = {
            let data = info.try_borrow_data()?;
            migrations::authority(&data, &ctx.accounts.authority.key())?;
            migrations::config(&data)?
        };
        write_migrated_account(&info, &ctx.accounts.authority, &ctx.accounts.system_program, &updated)
    }

    pub fn migrate_field(ctx: Context<MigrateField>) -> Result<()> {
        migrations::authority(&ctx.accounts.config.try_borrow_data()?, &ctx.accounts.authority.key())?;
        let info = ctx.accounts.field.to_account_info();
        let updated = migrations::field(&info.try_borrow_data()?)?;
        write_migrated_account(&info, &ctx.accounts.authority, &ctx.accounts.system_program, &updated)
    }

    pub fn migrate_epoch(ctx: Context<MigrateEpoch>) -> Result<()> {
        migrations::authority(&ctx.accounts.config.try_borrow_data()?, &ctx.accounts.authority.key())?;
        let info = ctx.accounts.epoch.to_account_info();
        let updated = migrations::epoch(&info.try_borrow_data()?)?;
        let epoch = Epoch::try_deserialize(&mut &updated[..])?;
        let (expected, _) = Pubkey::find_program_address(&[b"epoch", &epoch.id.to_le_bytes()], ctx.program_id);
        require_keys_eq!(info.key(), expected, GameError::BadProof);
        write_migrated_account(&info, &ctx.accounts.authority, &ctx.accounts.system_program, &updated)
    }

    /// Registers a one-time referral relationship; burns the registration cost.

    pub fn register_referrer(ctx: Context<RegisterReferrer>, referrer: Pubkey) -> Result<()> {
        require!(referrer != ctx.accounts.owner.key(), GameError::Unauthorized);
        require!(referrer != Pubkey::default(), GameError::Unauthorized);
        
        // One-time registration burns 5 POTATO; market referral rewards are unchanged.
        token::burn(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Burn {
                    mint: ctx.accounts.potato_mint.to_account_info(),
                    from: ctx.accounts.user_potato.to_account_info(),
                    authority: ctx.accounts.owner.to_account_info(),
                },
            ),
            REFERRAL_REGISTRATION_COST_MICRO,
        )?;
        
        ctx.accounts.referral.owner = ctx.accounts.owner.key();
        ctx.accounts.referral.referrer = referrer;
        ctx.accounts.referral.bump = ctx.bumps.referral;
        
        emit!(ReferrerRegistered {
            owner: ctx.accounts.owner.key(),
            referrer,
        });
        Ok(())
    }

    /// Дешёвая батч-чеканка: собирает урожай сразу с N полей за одну транзакцию.
    /// Экономия: 1 подпись вместо N, 1 CU-оплата, 1 приоритетная комиссия.
    /// Все поля проверяются: owner == signer, is_active, интервал, кроме того
    /// агрегированный mint ограничен капом эпохи и max_supply.
    /// Использует remaining_accounts как список Field PDAs.
    pub fn batch_harvest<'info>(ctx: Context<'_, '_, '_, 'info, BatchHarvest<'info>>) -> Result<()> {
        require!(!ctx.accounts.config.paused, GameError::Paused);
        require!(!ctx.remaining_accounts.is_empty(), GameError::NothingToHarvest);
        require!(ctx.remaining_accounts.len() <= 10, GameError::InvalidAmount); // лимит 10 полей/батч

        let now = Clock::get()?.unix_timestamp;
        let epoch_id = ctx.accounts.config.epoch_id;
        let base_yield = ctx.accounts.config.base_yield_micro_per_day;
        let global_bps = ctx.accounts.config.global_multiplier_bps;
        let total_supply = ctx.accounts.potato_mint.supply;
        let max_supply = ctx.accounts.config.max_supply_micro;

        // Проверка supply-налога один раз для всех полей (консервативно)
        let supply_ratio_bps = if max_supply > 0 {
            ((total_supply as u128) * 10_000 / (max_supply as u128)) as u64
        } else { 0 };
        let base_tax_bps: u64 = 200 + (800 * supply_ratio_bps * supply_ratio_bps / 100_000_000);
        let base_tax_bps = base_tax_bps.min(1000);

        let mut total_player: u64 = 0;
        let mut total_treasury: u64 = 0;
        let mut total_gross: u64 = 0;

        // Первый проход: валидация + расчёт pending без мутации состояния
        // Собираем данные чтобы проверить лимиты до минта
        // Для защиты от дублей в батче
        for i in 0..ctx.remaining_accounts.len() {
            for j in (i+1)..ctx.remaining_accounts.len() {
                require!(ctx.remaining_accounts[i].key() != ctx.remaining_accounts[j].key(), GameError::BadProof);
            }
        }
        for acc in ctx.remaining_accounts.iter() {
            require!(acc.owner == ctx.program_id && acc.is_writable, GameError::BadProof);
            let mut slice: &[u8] = &acc.try_borrow_data()?[..];
            let f = Field::try_deserialize(&mut slice).map_err(|_| error!(GameError::BadProof))?;
            require!(f.owner == ctx.accounts.owner.key(), GameError::Unauthorized);
            require!(f.is_active, GameError::FieldInactive);
            let elapsed = now.saturating_sub(f.last_harvest).min(MAX_ACCRUAL_SECONDS);
            require!(elapsed >= MIN_HARVEST_INTERVAL, GameError::HarvestTooSoon);
            let pending = compute_pending_yield(base_yield, global_bps, &f, elapsed, now, epoch_id)?;
            require!(pending > 0, GameError::NothingToHarvest);
            let tax_amount = (pending as u128 * base_tax_bps as u128 / 10_000) as u64;
            let player_yield = pending.saturating_sub(tax_amount);
            let treasury_share = tax_amount / 2;
            require!(player_yield > 0, GameError::NothingToHarvest);
            total_gross = total_gross.saturating_add(pending);
            total_player = total_player.saturating_add(player_yield);
            total_treasury = total_treasury.saturating_add(treasury_share);
        }

        // Проверка капов (агрегированно)
        let epoch_cap_left = ctx.accounts.epoch.mint_cap_micro.saturating_sub(ctx.accounts.epoch.minted_micro);
        let supply_left = max_supply.saturating_sub(total_supply);
        let available = epoch_cap_left.min(supply_left);
        // Если капа не хватает на весь батч — пропорционально урезаем каждый harvest
        // (аналогично одиночному harvest: consumed пропорционально gross_mint/pending)
        let (scale_num, scale_den) = if total_gross > available {
            require!(available > 0, GameError::EpochCapExceeded);
            (available as u128, total_gross as u128)
        } else {
            (1u128, 1u128)
        };

        let scaled_player = (total_player as u128 * scale_num / scale_den) as u64;
        let scaled_treasury = (total_treasury as u128 * scale_num / scale_den) as u64;
        require!(scaled_player > 0, GameError::NothingToHarvest);

        // Эффекты: обновляем epoch и каждое поле
        ctx.accounts.epoch.minted_micro = ctx.accounts.epoch.minted_micro
            .saturating_add(scaled_player).saturating_add(scaled_treasury);

        for acc in ctx.remaining_accounts.iter() {
            // All remaining accounts were validated before any state mutation.
            let mut data = acc.try_borrow_mut_data()?;
            let mut slice: &[u8] = &data;
            let mut f = Field::try_deserialize(&mut slice).map_err(|_| error!(GameError::BadProof))?;
            // Пропорциональный consumed
            let elapsed = now.saturating_sub(f.last_harvest).min(MAX_ACCRUAL_SECONDS);
            let consumed: i64 = if scale_num == scale_den {
                elapsed
            } else {
                ((elapsed as u128) * scale_num / scale_den) as i64
            };
            let accrual_start = now.saturating_sub(elapsed);
            f.last_harvest = accrual_start.saturating_add(consumed).min(now);
            let decay_interval = if f.mutation_type == 2 { DURABILITY_DECAY_INTERVAL * 2 } else { DURABILITY_DECAY_INTERVAL };
            let decay = (consumed / decay_interval).max(1).min(MAX_DURABILITY as i64) as u8;
            f.durability = f.durability.saturating_sub(decay);
            write_field_account(&f, &mut data)?;
        }

        // Интеракция: минт
        let bump = ctx.accounts.config.bump;
        let seeds: &[&[u8]] = &[b"config", &[bump]];
        let signer: &[&[&[u8]]] = &[seeds];
        token::mint_to(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                MintTo {
                    mint: ctx.accounts.potato_mint.to_account_info(),
                    to: ctx.accounts.user_potato.to_account_info(),
                    authority: ctx.accounts.config.to_account_info(),
                },
                signer,
            ),
            scaled_player,
        )?;
        if scaled_treasury > 0 {
            token::mint_to(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    MintTo {
                        mint: ctx.accounts.potato_mint.to_account_info(),
                        to: ctx.accounts.treasury_potato.to_account_info(),
                        authority: ctx.accounts.config.to_account_info(),
                    },
                    signer,
                ),
                scaled_treasury,
            )?;
        }

        emit!(BatchHarvested {
            owner: ctx.accounts.owner.key(),
            field_count: ctx.remaining_accounts.len() as u8,
            total_micro: scaled_player,
            treasury_micro: scaled_treasury,
        });
        Ok(())
    }

    /// Закрывает поле и возвращает ренту владельцу. Поле становится неактивным
    /// навсегда (is_active=false) и больше не приносит урожай. Дешёвая "де-чеканка":
    /// игрок возвращает ~0.001 SOL за каждое закрытое поле, что снижает
    /// эффективную стоимость минта на 50% при выходе из игры.
    pub fn close_field(ctx: Context<CloseField>) -> Result<()> {
        let field = &ctx.accounts.field;
        require!(field.is_active, GameError::FieldInactive);
        // Налоговое требование: нельзя закрыть поле с просроченным налогом без оплаты?
        // Разрешаем закрытие всегда — игрок уже заплатил burn при создании.
        // field_count декрементируем, чтобы статистика (и будущие лимиты на
        // общее число полей) не расходилась с реальностью.
        let config = &mut ctx.accounts.config;
        config.field_count = config.field_count.saturating_sub(1);
        // Anchor `close = owner` в контексте: lamports уходят владельцу, data зануляется.
        emit!(FieldClosed { owner: ctx.accounts.owner.key(), field: ctx.accounts.field.key() });
        Ok(())
    }

    /// Permissionless rent-reclaim crank: closes epoch PDAs older than
    /// `current - KEEP_EPOCHS` (default: keeps the current and previous epoch).
    /// Historical emission stats stay in events/`GameConfig` counters.
    pub fn close_old_epoch(ctx: Context<CloseOldEpoch>) -> Result<()> {
        let config = &ctx.accounts.config;
        let epoch_id = ctx.accounts.epoch.id;
        require!(
            config.epoch_id
                >= epoch_id.checked_add(KEEP_EPOCHS).ok_or(GameError::MathOverflow)?,
            GameError::EpochTooRecent
        );
        msg!("Epoch {} closed, rent returned to payer", epoch_id);
        Ok(())
    }

}

/// Anchor AccountSerialize writes the discriminator AND payload. Remaining
/// accounts must be written from offset zero, without reallocating the account.
fn write_field_account(field: &Field, data: &mut [u8]) -> Result<()> {
    require!(data.len() == 8 + Field::INIT_SPACE, GameError::BadProof);
    field.try_serialize(&mut &mut data[..])
}

// ────────────────────────── Pure helpers ─────────────────────────
// Kept free of account types so they can be unit-tested on the host.

/// Yield multiplier for a field type, in bps.
pub fn type_yield_bps(field_type: u8) -> u128 {
    match field_type {
        0 => 3_500,  // Грядка: 0.35×
        1 => 10_000, // Луг:    1.00×
        _ => 21_000, // Поле:   2.10×
    }
}

/// Cost multiplier for a field type, in bps (price, tax, repair, fertilizer, upgrades).
pub fn type_cost_bps(field_type: u8) -> u128 {
    match field_type {
        0 => 4_000,  // 0.4×
        1 => 10_000, // 1.0×
        _ => 20_000, // 2.0×
    }
}

/// Purchase price of a field.
pub fn field_price_micro(field_type: u8) -> u64 {
    scaled_cost(BASE_FIELD_PRICE_MICRO, field_type)
}

/// Scales a type-1 base cost by the field type cost multiplier.
pub fn scaled_cost(base_micro: u64, field_type: u8) -> u64 {
    ((base_micro as u128) * type_cost_bps(field_type) / BPS) as u64
}

/// Cost of upgrading from `level` to `level + 1`.
pub fn upgrade_cost_micro(level: u8, field_type: u8) -> Result<u64> {
    let base = (BASE_UPGRADE_MICRO as u128)
        .checked_mul(level as u128)
        .ok_or(GameError::MathOverflow)?;
    let scaled = base
        .checked_mul(type_cost_bps(field_type))
        .ok_or(GameError::MathOverflow)?
        / BPS;
    u64::try_from(scaled).map_err(|_| GameError::MathOverflow.into())
}

/// Level multiplier, in bps. Strictly increasing in `level`:
/// hand-tuned diminishing returns for levels 1-5, then +0.40× per level.
pub fn get_level_mult(level: u8) -> u128 {
    match level {
        0 | 1 => 10_000,
        2 => 15_700,
        3 => 20_400,
        4 => 24_600,
        5 => 28_600,
        l => 28_600 + (l as u128 - 5) * 4_000,
    }
}

/// Durability multiplier, in bps: 0.2× at 0, 1.0× at 100.
pub fn durability_mult_bps(durability: u8) -> u128 {
    DURABILITY_FLOOR_BPS + (durability.min(MAX_DURABILITY) as u128) * DURABILITY_SLOPE_BPS_PER_POINT
}

/// Marketplace fee tier by order size (progressive: 9 % → 12 %).
pub fn calculate_fee_bps(amount_micro: u64) -> u16 {
    // Прогрессивная комиссия 9% – 12% (от объёма ордера)
    if amount_micro < 1_000_000_000 {
        900    // < 1k POTATO:   9%
    } else if amount_micro < 10_000_000_000 {
        1_000  // < 10k POTATO:  10%
    } else if amount_micro < 100_000_000_000 {
        1_100  // < 100k POTATO: 11%
    } else {
        1_200  // >= 100k POTATO: 12%
    }
}

pub fn order_fee_micro(amount_micro: u64) -> Result<u64> {
    let fee = (amount_micro as u128)
        .checked_mul(calculate_fee_bps(amount_micro) as u128)
        .ok_or(GameError::MathOverflow)?
        / BPS;
    u64::try_from(fee).map_err(|_| GameError::MathOverflow.into())
}

/// SOL (lamports) a buyer pays for an order. `price` is lamports per whole $POTATO.
pub fn order_total_lamports(amount_micro: u64, price_lamports_per_potato: u64) -> Result<u64> {
    let total = (amount_micro as u128)
        .checked_mul(price_lamports_per_potato as u128)
        .ok_or(GameError::MathOverflow)?
        / MICRO;
    u64::try_from(total).map_err(|_| GameError::MathOverflow.into())
}

/// Extends a deadline by `period`, starting from `max(current, now)`.
fn extend_timer(current: i64, now: i64, period: i64) -> Result<i64> {
    current.max(now).checked_add(period).ok_or(GameError::MathOverflow.into())
}

/// Time-weighted lunar multiplier (bps) for an accrual window of `elapsed`
/// seconds ending in `epoch_id`. The window is split into trailing 86 400 s
/// segments; segment `k` (0 = most recent) is weighted by
/// `LUNAR_TABLE[(epoch_id - k) mod 28]`. For `elapsed <= 86400` this is
/// exactly `LUNAR_TABLE[epoch_id % 28]`, so single-day behaviour is unchanged.
pub fn lunar_weighted_bps(elapsed: i64, epoch_id: u64) -> u128 {
    let current = LUNAR_TABLE[(epoch_id % 28) as usize] as u128;
    if elapsed <= 0 {
        return current;
    }
    let mut weighted: u128 = 0;
    let mut remaining = elapsed;
    let mut age_days: i128 = 0;
    while remaining > 0 {
        let chunk = remaining.min(SECONDS_PER_DAY);
        let idx = ((epoch_id as i128 - age_days).rem_euclid(28)) as usize;
        weighted = weighted.saturating_add((LUNAR_TABLE[idx] as u128).saturating_mul(chunk as u128));
        remaining -= chunk;
        age_days += 1;
    }
    weighted / elapsed as u128
}

/// Yield accrued over `elapsed` seconds, in micro $POTATO:
/// `base × elapsed/day × level × durability × global × type × fertilizer × tax`.
pub fn compute_pending_yield(
    base_yield_micro_per_day: u64,
    global_multiplier_bps: u16,
    field: &Field,
    elapsed: i64,
    now: i64,
    epoch_id: u64,
) -> Result<u64> {
    let tax_bps = if now > field.tax_paid_until { UNPAID_TAX_YIELD_BPS } else { BPS };
    let fert_bps = if now < field.fertilizer_until { FERTILIZER_YIELD_BPS } else { BPS };
    // Golden Sprout (mutation_type = 1): +25% yield навсегда
    let mutation_bps: u128 = match field.mutation_type {
        1 => 12_500,  // 1.25× = 12500 bps
        _ => BPS,
    };
    // Лунный цикл: взвешенный по сегментам множитель. Начисление может
    // охватывать до 7 суток (MAX_ACCRUAL_SECONDS) = до 7 эпох; каждая
    // trailing-сутка оценивается по лунному bps СВОЕЙ эпохи, а не только
    // текущей (иначе harvest прямо перед roll_epoch давал бесплатный арбитраж).
    let lunar_bps: u128 = lunar_weighted_bps(elapsed, epoch_id);
    let multipliers = [
        get_level_mult(field.level),
        durability_mult_bps(field.durability),
        global_multiplier_bps as u128,
        type_yield_bps(field.field_type),
        fert_bps,
        tax_bps,
        mutation_bps,
        lunar_bps,
    ];
    let mut value = (base_yield_micro_per_day as u128)
        .checked_mul(elapsed.max(0) as u128)
        .ok_or(GameError::MathOverflow)?
        / SECONDS_PER_DAY as u128;
    for m in multipliers {
        value = value.checked_mul(m).ok_or(GameError::MathOverflow)? / BPS;
    }
    Ok(u64::try_from(value).unwrap_or(u64::MAX))
}


// ВНИМАНИЕ: используем UncheckedAccount чтобы избежать deserialization
// старых аккаунтов (меньшего размера) до realloc.
// Проверка authority через прямой read из GameConfig data.

#[derive(Accounts)]
pub struct RegisterReferrer<'info> {
    #[account(
        init,
        payer = owner,
        space = 8 + Referral::INIT_SPACE,
        seeds = [b"referral", owner.key().as_ref()],
        bump,
    )]
    pub referral: Account<'info, Referral>,
    #[account(mut, seeds = [b"config"], bump = config.bump, has_one = potato_mint)]
    pub config: Account<'info, GameConfig>,
    #[account(mut)]
    pub potato_mint: Account<'info, Mint>,
    #[account(mut, token::mint = potato_mint, token::authority = owner)]
    pub user_potato: Account<'info, TokenAccount>,
    #[account(mut)]
    pub owner: Signer<'info>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct MigrateConfig<'info> {
    /// CHECK: canonical PDA/owner here; exact layout, discriminator and authority in handler.
    #[account(mut, seeds = [b"config"], bump, owner = crate::ID)]
    pub config: UncheckedAccount<'info>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct MigrateField<'info> {
    /// CHECK: program owner here; exact Field layout and discriminator in handler.
    #[account(mut, owner = crate::ID)]
    pub field: UncheckedAccount<'info>,
    /// CHECK: canonical config PDA; legacy layout is validated in handler.
    #[account(seeds = [b"config"], bump, owner = crate::ID)]
    pub config: UncheckedAccount<'info>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct MigrateEpoch<'info> {
    /// CHECK: program owner here; exact Epoch layout/discriminator and PDA in handler.
    #[account(mut, owner = crate::ID)]
    pub epoch: UncheckedAccount<'info>,
    /// CHECK: canonical config PDA; legacy layout is validated in handler.
    #[account(seeds = [b"config"], bump, owner = crate::ID)]
    pub config: UncheckedAccount<'info>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

fn write_migrated_account<'info>(
    account: &AccountInfo<'info>,
    authority: &Signer<'info>,
    system_program: &Program<'info, System>,
    data: &[u8],
) -> Result<()> {
    let shortfall = Rent::get()?.minimum_balance(data.len()).saturating_sub(account.lamports());
    if shortfall > 0 {
        anchor_lang::system_program::transfer(
            CpiContext::new(system_program.to_account_info(), anchor_lang::system_program::Transfer {
                from: authority.to_account_info(), to: account.clone(),
            }), shortfall,
        )?;
    }
    if account.data_len() != data.len() {
        account.realloc(data.len(), true)?;
    }
    account.try_borrow_mut_data()?.copy_from_slice(data);
    Ok(())
}

// ───────────────────────── CPI helpers ───────────────────────────

fn burn_from_user<'info>(
    token_program: &Program<'info, Token>,
    potato_mint: &Account<'info, Mint>,
    user_potato: &Account<'info, TokenAccount>,
    owner: &Signer<'info>,
    amount: u64,
) -> Result<()> {
    token::burn(
        CpiContext::new(
            token_program.to_account_info(),
            Burn {
                mint: potato_mint.to_account_info(),
                from: user_potato.to_account_info(),
                authority: owner.to_account_info(),
            },
        ),
        amount,
    )
}

fn refund_and_close_escrow<'info>(
    token_program: &Program<'info, Token>,
    escrow: &Account<'info, TokenAccount>,
    seller_potato: &Account<'info, TokenAccount>,
    seller: &AccountInfo<'info>,
    order_key: Pubkey,
    escrow_bump: u8,
    refund_micro: u64,
) -> Result<()> {
    let seeds: &[&[u8]] = &[b"escrow", order_key.as_ref(), &[escrow_bump]];
    let signer: &[&[&[u8]]] = &[seeds];
    token::transfer(
        CpiContext::new_with_signer(
            token_program.to_account_info(),
            Transfer {
                from: escrow.to_account_info(),
                to: seller_potato.to_account_info(),
                authority: escrow.to_account_info(),
            },
            signer,
        ),
        refund_micro,
    )?;
    token::close_account(CpiContext::new_with_signer(
        token_program.to_account_info(),
        CloseAccount {
            account: escrow.to_account_info(),
            destination: seller.clone(),
            authority: escrow.to_account_info(),
        },
        signer,
    ))
}

// ─────────────────────────── Accounts ────────────────────────────
// Field order inside each struct == account order in the IDL == the order raw
// clients pass keys in. Do not reorder.

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(init, payer = authority, space = 8 + GameConfig::INIT_SPACE, seeds = [b"config"], bump)]
    pub config: Account<'info, GameConfig>,
    pub potato_mint: Account<'info, Mint>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct InitEpoch<'info> {
    #[account(seeds = [b"config"], bump = config.bump, has_one = authority)]
    pub config: Account<'info, GameConfig>,
    #[account(
        init,
        payer = authority,
        space = 8 + Epoch::INIT_SPACE,
        seeds = [b"epoch", config.epoch_id.to_le_bytes().as_ref()],
        bump
    )]
    pub epoch: Account<'info, Epoch>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RollEpoch<'info> {
    #[account(mut, seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, GameConfig>,
    #[account(seeds = [b"epoch", config.epoch_id.to_le_bytes().as_ref()], bump = current_epoch.bump)]
    pub current_epoch: Account<'info, Epoch>,
    #[account(
        init,
        payer = payer,
        space = 8 + Epoch::INIT_SPACE,
        seeds = [b"epoch", (config.epoch_id + 1).to_le_bytes().as_ref()],
        bump
    )]
    pub next_epoch: Account<'info, Epoch>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(field_id: u64)]
pub struct CreateField<'info> {
    #[account(mut, seeds = [b"config"], bump = config.bump, has_one = potato_mint)]
    pub config: Account<'info, GameConfig>,
    #[account(
        init,
        payer = owner,
        space = 8 + Field::INIT_SPACE,
        seeds = [b"field", field_id.to_le_bytes().as_ref()],
        bump
    )]
    pub field: Account<'info, Field>,
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(mut)]
    pub potato_mint: Account<'info, Mint>,
    #[account(mut, token::mint = potato_mint, token::authority = owner)]
    pub user_potato: Account<'info, TokenAccount>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct Harvest<'info> {
    #[account(mut, seeds = [b"config"], bump = config.bump, has_one = potato_mint)]
    pub config: Account<'info, GameConfig>,
    #[account(mut, seeds = [b"epoch", config.epoch_id.to_le_bytes().as_ref()], bump = epoch.bump)]
    pub epoch: Account<'info, Epoch>,
    #[account(mut, has_one = owner)]
    pub field: Account<'info, Field>,
    #[account(mut)]
    pub potato_mint: Account<'info, Mint>,
    #[account(mut, token::mint = potato_mint, token::authority = owner)]
    pub user_potato: Account<'info, TokenAccount>,
    #[account(
        init_if_needed,
        payer = owner,
        associated_token::mint = potato_mint,
        associated_token::authority = config,
    )]
    pub treasury_potato: Account<'info, TokenAccount>,
    #[account(mut)]
    pub owner: Signer<'info>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}

/// Shared shape for repair / upgrade / tax / fertilizer.
macro_rules! field_spend_accounts {
    ($name:ident) => {
        #[derive(Accounts)]
        pub struct $name<'info> {
            #[account(mut, has_one = owner)]
            pub field: Account<'info, Field>,
            #[account(mut)]
            pub potato_mint: Account<'info, Mint>,
            #[account(mut, token::mint = potato_mint, token::authority = owner)]
            pub user_potato: Account<'info, TokenAccount>,
            #[account(mut, seeds = [b"config"], bump = config.bump, has_one = potato_mint)]
            pub config: Account<'info, GameConfig>,
            pub owner: Signer<'info>,
            pub token_program: Program<'info, Token>,
        }
    };
}
field_spend_accounts!(RepairField);
field_spend_accounts!(PayTax);
field_spend_accounts!(ApplyFertilizer);

/// UpgradeField = field_spend_accounts + SlotHashes: мутация при апгрейде
/// роллится с примесью хеша последнего слота (непредсказуемо в момент подписания).
#[derive(Accounts)]
pub struct UpgradeField<'info> {
    #[account(mut, has_one = owner)]
    pub field: Account<'info, Field>,
    #[account(mut)]
    pub potato_mint: Account<'info, Mint>,
    #[account(mut, token::mint = potato_mint, token::authority = owner)]
    pub user_potato: Account<'info, TokenAccount>,
    #[account(mut, seeds = [b"config"], bump = config.bump, has_one = potato_mint)]
    pub config: Account<'info, GameConfig>,
    pub owner: Signer<'info>,
    pub token_program: Program<'info, Token>,
    pub slot_hashes: Sysvar<'info, SlotHashes>,
}

// Boxed: three `init`s plus an escrow token account exceed the 4 KiB SBF stack frame unboxed.
#[derive(Accounts)]
pub struct BuyExportLicense<'info> {
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, GameConfig>,
    #[account(
        init_if_needed,
        payer = payer,
        space = 8 + ExportLicense::INIT_SPACE,
        seeds = [b"license", payer.key().as_ref()],
        bump
    )]
    pub license: Account<'info, ExportLicense>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub skr_mint: Account<'info, Mint>,
    #[account(
        mut,
        associated_token::mint = skr_mint,
        associated_token::authority = payer,
    )]
    pub user_skr_ata: Account<'info, TokenAccount>,
    /// CHECK: treasury_sol PDA — владелец ATA казны
    #[account(mut, seeds = [b"treasury_sol"], bump)]
    pub treasury_sol: AccountInfo<'info>,
    // init-аккаунт имплицитно mut (в anchor 0.30 явный `mut` с init запрещён)
    #[account(
        init_if_needed,
        payer = payer,
        associated_token::mint = skr_mint,
        associated_token::authority = treasury_sol,
    )]
    pub treasury_skr_ata: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}

#[derive(Accounts)]
#[instruction(order_id: u64)]

pub struct CreateSellOrder<'info> {
    #[account(mut)]
    pub seller: Signer<'info>,
    #[account(seeds = [b"config"], bump = config.bump, has_one = potato_mint)]
    pub config: Box<Account<'info, GameConfig>>,
    #[account(
        init_if_needed,
        payer = seller,
        space = 8 + SellerProfile::INIT_SPACE,
        seeds = [b"seller", seller.key().as_ref()],
        bump
    )]
    pub seller_profile: Box<Account<'info, SellerProfile>>,
    #[account(
        init,
        payer = seller,
        space = 8 + MarketOrder::INIT_SPACE,
        seeds = [b"order", order_id.to_le_bytes().as_ref()],
        bump
    )]
    pub order: Box<Account<'info, MarketOrder>>,
    #[account(
        init_if_needed,
        payer = seller,
        space = 8 + MarketStats::INIT_SPACE,
        seeds = [b"market_stats"],
        bump
    )]
    pub market_stats: Box<Account<'info, MarketStats>>,
    #[account(mut, token::mint = potato_mint, token::authority = seller)]
    pub seller_potato: Box<Account<'info, TokenAccount>>,
    #[account(
        init,
        payer = seller,
        seeds = [b"escrow", order.key().as_ref()],
        bump,
        token::mint = potato_mint,
        token::authority = escrow
    )]
    pub escrow: Box<Account<'info, TokenAccount>>,
    pub potato_mint: Box<Account<'info, Mint>>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct FillOrder<'info> {
    #[account(mut)]
    pub buyer: Signer<'info>,
    /// CHECK: receives SOL and escrow rent; enforced equal to `order.seller` via `has_one`.
    #[account(mut)]
    pub seller: UncheckedAccount<'info>,
    #[account(mut, seeds = [b"config"], bump = config.bump, has_one = potato_mint)]
    pub config: Account<'info, GameConfig>,
    #[account(mut)]
    pub potato_mint: Account<'info, Mint>,
    #[account(mut, seeds = [b"market_stats"], bump = market_stats.bump)]
    pub market_stats: Account<'info, MarketStats>,
    #[account(mut, has_one = seller, close = seller)]
    pub order: Account<'info, MarketOrder>,
    #[account(
        mut,
        seeds = [b"escrow", order.key().as_ref()],
        bump = order.escrow_bump,
        token::mint = potato_mint,
        token::authority = escrow
    )]
    pub escrow: Account<'info, TokenAccount>,
    #[account(mut, token::mint = potato_mint, token::authority = buyer)]
    pub buyer_potato: Account<'info, TokenAccount>,
    /// Получает refund скидок с комиссии (лицензия продавца / рефералка покупателя).
    #[account(mut, token::mint = potato_mint, token::authority = seller)]
    pub seller_potato: Account<'info, TokenAccount>,
    #[account(
        init_if_needed,
        payer = buyer,
        associated_token::mint = potato_mint,
        associated_token::authority = config
    )]
    pub treasury_potato: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CancelOrder<'info> {
    #[account(mut)]
    pub seller: Signer<'info>,
    #[account(
        init_if_needed,
        payer = seller,
        space = 8 + SellerProfile::INIT_SPACE,
        seeds = [b"seller", seller.key().as_ref()],
        bump
    )]
    pub seller_profile: Account<'info, SellerProfile>,
    #[account(mut, has_one = seller, close = seller)]
    pub order: Account<'info, MarketOrder>,
    #[account(
        mut,
        seeds = [b"escrow", order.key().as_ref()],
        bump = order.escrow_bump,
        token::authority = escrow
    )]
    pub escrow: Account<'info, TokenAccount>,
    #[account(
        mut,
        token::authority = seller,
        constraint = seller_potato.mint == escrow.mint @ GameError::InvalidMint
    )]
    pub seller_potato: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CloseExpiredOrder<'info> {
    #[account(mut, has_one = seller, close = seller)]
    pub order: Account<'info, MarketOrder>,
    #[account(
        mut,
        seeds = [b"escrow", order.key().as_ref()],
        bump = order.escrow_bump,
        token::authority = escrow
    )]
    pub escrow: Account<'info, TokenAccount>,
    #[account(
        mut,
        token::authority = seller,
        constraint = seller_potato.mint == escrow.mint @ GameError::InvalidMint
    )]
    pub seller_potato: Account<'info, TokenAccount>,
    /// CHECK: receives the refund's rent; enforced equal to `order.seller` via `has_one`.
    #[account(mut)]
    pub seller: UncheckedAccount<'info>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct InitPresale<'info> {
    #[account(seeds = [b"config"], bump = config.bump, has_one = authority)]
    pub config: Account<'info, GameConfig>,

    #[account(
        init,
        payer = authority,
        space = 8 + PresaleState::INIT_SPACE,
        seeds = [b"presale"],
        bump
    )]
    pub presale_state: Account<'info, PresaleState>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdatePresalePrice<'info> {
    #[account(seeds = [b"config"], bump = config.bump, has_one = authority)]
    pub config: Account<'info, GameConfig>,

    #[account(mut, seeds = [b"presale"], bump = presale_state.bump, has_one = authority)]
    pub presale_state: Account<'info, PresaleState>,

    #[account(
        init_if_needed,
        payer = authority,
        space = 8 + AdminState::INIT_SPACE,
        seeds = [b"admin_state"],
        bump,
    )]
    pub admin_state: Account<'info, AdminState>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ApplyPendingPresalePrice<'info> {
    #[account(seeds = [b"config"], bump = config.bump, has_one = authority)]
    pub config: Account<'info, GameConfig>,

    #[account(mut, seeds = [b"presale"], bump = presale_state.bump, has_one = authority)]
    pub presale_state: Account<'info, PresaleState>,

    #[account(mut, seeds = [b"admin_state"], bump)]
    pub admin_state: Account<'info, AdminState>,

    pub authority: Signer<'info>,
}

#[derive(Accounts)]
#[instruction(field_id: u64)]
pub struct BuyFieldSkr<'info> {
    #[account(mut, seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, GameConfig>,

    #[account(mut, seeds = [b"presale"], bump = presale_state.bump, has_one = authority)]
    pub presale_state: Account<'info, PresaleState>,

    /// CHECK: authority of presale_state (validated by has_one)
    pub authority: UncheckedAccount<'info>,

    #[account(
        init_if_needed,
        payer = buyer,
        space = 8 + BuyerPresaleCounter::INIT_SPACE,
        seeds = [b"buyer_presale", buyer.key().as_ref()],
        bump
    )]
    pub buyer_presale: Account<'info, BuyerPresaleCounter>,

    #[account(
        init,
        payer = buyer,
        space = 8 + Field::INIT_SPACE,
        seeds = [b"field", field_id.to_le_bytes().as_ref()],
        bump
    )]
    pub field: Account<'info, Field>,

    #[account(mut)]
    pub buyer: Signer<'info>,

    pub skr_mint: Account<'info, Mint>,

    #[account(
        mut,
        associated_token::mint = skr_mint,
        associated_token::authority = buyer,
    )]
    pub buyer_skr_ata: Account<'info, TokenAccount>,

    /// CHECK: treasury_sol PDA — владелец ATA казны
    #[account(mut, seeds = [b"treasury_sol"], bump)]
    pub treasury_sol: AccountInfo<'info>,

    #[account(
        mut,
        associated_token::mint = skr_mint,
        associated_token::authority = treasury_sol,
    )]
    pub treasury_skr_ata: Account<'info, TokenAccount>,

    #[account(
        mut,
        associated_token::mint = skr_mint,
        associated_token::authority = authority,
    )]
    pub buyback_skr_ata: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    /// Энтропия drop-roll'а: хеш последнего слота неизвестен покупателю при подписании.
    pub slot_hashes: Sysvar<'info, SlotHashes>,
}

#[derive(Accounts)]
#[instruction(field_id: u64)]
pub struct BuyFieldSol<'info> {
    #[account(mut, seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, GameConfig>,

    #[account(
        mut,
        seeds = [b"presale"],
        bump = presale_state.bump,
        has_one = authority
    )]
    pub presale_state: Account<'info, PresaleState>,

    /// CHECK: authority of presale_state (validated by has_one)
    pub authority: UncheckedAccount<'info>,

    #[account(
        init_if_needed,
        payer = buyer,
        space = 8 + BuyerPresaleCounter::INIT_SPACE,
        seeds = [b"buyer_presale", buyer.key().as_ref()],
        bump
    )]
    pub buyer_presale: Account<'info, BuyerPresaleCounter>,

    #[account(
        init,
        payer = buyer,
        space = 8 + Field::INIT_SPACE,
        seeds = [b"field", field_id.to_le_bytes().as_ref()],
        bump
    )]
    pub field: Account<'info, Field>,

    #[account(mut)]
    pub buyer: Signer<'info>,

    /// CHECK: treasury_sol PDA хранит SOL; bump валидируется Anchor
    #[account(mut, seeds = [b"treasury_sol"], bump)]
    pub treasury_sol: AccountInfo<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct GrantReward<'info> {
    #[account(mut, seeds = [b"config"], bump = config.bump, has_one = potato_mint)]
    pub config: Account<'info, GameConfig>,
    #[account(mut, seeds = [b"epoch", config.epoch_id.to_le_bytes().as_ref()], bump = epoch.bump)]
    pub epoch: Account<'info, Epoch>,
    /// S-03: может подписать как authority, так и reward_signer (low-priv backend)
    pub authority: Signer<'info>,
    #[account(mut)]
    pub potato_mint: Account<'info, Mint>,
    #[account(mut, token::mint = potato_mint)]
    pub user_potato: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct WithdrawTreasury<'info> {
    #[account(seeds = [b"config"], bump = config.bump, has_one = authority, has_one = potato_mint)]
    pub config: Account<'info, GameConfig>,
    pub potato_mint: Account<'info, Mint>,
    #[account(mut, associated_token::mint = potato_mint, associated_token::authority = config)]
    pub treasury_potato: Account<'info, TokenAccount>,
    #[account(mut, token::mint = potato_mint)]
    pub destination: Account<'info, TokenAccount>,
    #[account(
        init_if_needed,
        payer = authority,
        space = 8 + AdminState::INIT_SPACE,
        seeds = [b"admin_state"],
        bump,
    )]
    pub admin_state: Account<'info, AdminState>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct WithdrawTreasurySol<'info> {
    #[account(seeds = [b"config"], bump = config.bump, has_one = authority)]
    pub config: Account<'info, GameConfig>,
    /// CHECK: 0-byte System vault holding SOL presale proceeds
    #[account(mut, seeds = [b"treasury_sol"], bump)]
    pub treasury_sol: AccountInfo<'info>,
    #[account(
        init_if_needed,
        payer = authority,
        space = 8 + AdminState::INIT_SPACE,
        seeds = [b"admin_state"],
        bump,
    )]
    pub admin_state: Account<'info, AdminState>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct WithdrawSkrTreasury<'info> {
    #[account(seeds = [b"config"], bump = config.bump, has_one = authority)]
    pub config: Account<'info, GameConfig>,
    /// CHECK: treasury_sol PDA — владелец ATA казны (signer перевода)
    #[account(seeds = [b"treasury_sol"], bump)]
    pub treasury_sol: AccountInfo<'info>,
    #[account(mut, associated_token::mint = skr_mint, associated_token::authority = treasury_sol)]
    pub treasury_skr_ata: Account<'info, TokenAccount>,
    #[account(
        init_if_needed,
        payer = authority,
        space = 8 + AdminState::INIT_SPACE,
        seeds = [b"admin_state"],
        bump,
    )]
    pub admin_state: Account<'info, AdminState>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub skr_mint: Account<'info, Mint>,
    // init-аккаунт имплицитно mut (в anchor 0.30 явный `mut` с init запрещён);
    // init_if_needed + associated_token требует system_program в контексте
    #[account(init_if_needed, payer = authority, associated_token::mint = skr_mint, associated_token::authority = authority)]
    pub destination_ata: Account<'info, TokenAccount>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}

#[derive(Accounts)]
pub struct MigratePresaleAuthority<'info> {
    #[account(seeds = [b"config"], bump = config.bump, has_one = authority)]
    pub config: Account<'info, GameConfig>,
    #[account(mut, seeds = [b"presale"], bump = presale_state.bump)]
    pub presale_state: Account<'info, PresaleState>,
    #[account(mut)]
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct SetPaused<'info> {
    #[account(mut, seeds = [b"config"], bump = config.bump, has_one = authority)]
    pub config: Account<'info, GameConfig>,
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct UpdateConfig<'info> {
    #[account(mut, seeds = [b"config"], bump = config.bump, has_one = authority)]
    pub config: Account<'info, GameConfig>,
    pub authority: Signer<'info>,
}

/// Proposal step for the SKR mint migration (see `update_skr_mint`).
#[derive(Accounts)]
pub struct UpdateSkrMint<'info> {
    #[account(seeds = [b"config"], bump = config.bump, has_one = authority)]
    pub config: Account<'info, GameConfig>,
    #[account(
        init_if_needed,
        payer = authority,
        space = 8 + AdminState::INIT_SPACE,
        seeds = [b"admin_state"],
        bump,
    )]
    pub admin_state: Account<'info, AdminState>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

/// Apply step for the SKR mint migration, after the admin timelock.
#[derive(Accounts)]
pub struct ApplyPendingSkrMint<'info> {
    #[account(mut, seeds = [b"config"], bump = config.bump, has_one = authority)]
    pub config: Account<'info, GameConfig>,
    #[account(mut, seeds = [b"admin_state"], bump)]
    pub admin_state: Account<'info, AdminState>,
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct AcceptAuthority<'info> {
    #[account(mut, seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, GameConfig>,
    pub new_authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct BatchHarvest<'info> {
    #[account(mut, seeds = [b"config"], bump = config.bump, has_one = potato_mint)]
    pub config: Account<'info, GameConfig>,
    #[account(mut, seeds = [b"epoch", config.epoch_id.to_le_bytes().as_ref()], bump = epoch.bump)]
    pub epoch: Account<'info, Epoch>,
    #[account(mut)]
    pub potato_mint: Account<'info, Mint>,
    #[account(mut, token::mint = potato_mint, token::authority = owner)]
    pub user_potato: Account<'info, TokenAccount>,
    #[account(
        init_if_needed,
        payer = owner,
        associated_token::mint = potato_mint,
        associated_token::authority = config,
    )]
    pub treasury_potato: Account<'info, TokenAccount>,
    #[account(mut)]
    pub owner: Signer<'info>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}

#[derive(Accounts)]
pub struct CloseField<'info> {
    #[account(mut, seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, GameConfig>,
    #[account(mut, has_one = owner, close = owner)]
    pub field: Account<'info, Field>,
    #[account(mut)]
    pub owner: Signer<'info>,
}

/// Permissionless rent-reclaim for stale epoch PDAs (see `close_old_epoch`).
#[derive(Accounts)]
pub struct CloseOldEpoch<'info> {
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, GameConfig>,
    #[account(
        mut,
        seeds = [b"epoch", epoch.id.to_le_bytes().as_ref()],
        bump = epoch.bump,
        close = payer,
    )]
    pub epoch: Account<'info, Epoch>,
    #[account(mut)]
    pub payer: Signer<'info>,
}
// ──────────────────────────── State ──────────────────────────────

/// Singleton game configuration and the mint authority of $POTATO.
/// PDA seeds: `["config"]`.
#[account]
#[derive(InitSpace)]
pub struct GameConfig {
    pub authority: Pubkey,
    pub pending_authority: Pubkey,
    pub potato_mint: Pubkey,
    pub skr_mint: Pubkey,              // S-01: конфигурируемый SKR mint (mainnet мигрируется без redeploy)
    pub reward_signer: Pubkey,         // S-03: low-priv ключ для grant_reward (backend), отделён от authority
    pub max_supply_micro: u64,
    pub daily_mint_cap_micro: u64,
    pub base_yield_micro_per_day: u64,
    pub global_multiplier_bps: u16,
    pub field_count: u64,
    pub epoch_id: u64,
    pub total_burned_micro: u64,
    pub last_total_burned_micro: u64,  // для эластичного капа: значение total_burned на момент прошлого roll_epoch
    pub paused: bool,
    pub bump: u8,
}


/// Состояние пресейла полей за SOL. PDA seeds: `["presale"]`
#[account]
#[derive(InitSpace)]
pub struct PresaleState {
    pub authority: Pubkey,
    pub sold: u32,
    pub cap: u32,
    pub price_lamports: u64,
    pub bump: u8,
}

/// Счётчик купленных полей на кошелёк. PDA seeds: `["buyer_presale", buyer_pubkey]`
#[account]
#[derive(InitSpace)]
pub struct BuyerPresaleCounter {
    pub buyer: Pubkey,
    pub count: u8,
    pub bump: u8,
}

/// A player's field. PDA seeds: `["field", field_id.to_le_bytes()]`.
#[account]
#[derive(InitSpace)]
pub struct Field {
    pub owner: Pubkey,
    pub level: u8,
    pub durability: u8,
    pub last_harvest: i64,
    pub tax_paid_until: i64,
    pub fertilizer_until: i64,
    pub is_active: bool,
    pub field_type: u8,
    pub bump: u8,
    pub mutation_type: u8,  // 0=None, 1=Golden (+25% yield), 2=Silicon (decay ÷2)
}

/// One 24h emission window. PDA seeds: `["epoch", id.to_le_bytes()]`.
#[account]
#[derive(InitSpace)]
pub struct Epoch {
    pub id: u64,
    pub mint_cap_micro: u64,
    pub minted_micro: u64,
    pub start_time: i64,
    pub bump: u8,
    /// micro-POTATO minted through `grant_reward` during this epoch.
    /// Counts toward the manual-grant quota (GRANT_QUOTA_SHARE_BPS of the cap).
    /// NOT a burn — the historical name was misleading; layout is unchanged.
    pub granted_micro: u64,
}

/// Admin safety state: withdrawal rate limits + timelocked update proposals.
/// Singleton PDA seeds: `["admin_state"]`. Created on first use
/// (`init_if_needed`, payer = authority).
#[account]
#[derive(Default, InitSpace)]
pub struct AdminState {
    /// Start of the current rolling withdrawal window (unix seconds).
    pub window_start: i64,
    pub withdrawn_potato_micro: u64,
    pub withdrawn_sol_lamports: u64,
    pub withdrawn_skr_atoms: u64,
    /// Proposed SKR mint; applied by `apply_pending_skr_mint` after the timelock.
    pub pending_skr_mint: Pubkey,
    pub pending_skr_mint_at: i64,
    /// Proposed presale price (lamports); applied by `apply_pending_presale_price`.
    pub pending_presale_price: u64,
    pub pending_presale_price_at: i64,
    pub bump: u8,
}

impl AdminState {
    /// Resets the withdrawal counters when the rolling 24h window has elapsed.
    pub fn roll_withdraw_window(&mut self, now: i64) {
        if now.saturating_sub(self.window_start) >= WITHDRAW_WINDOW_SECONDS {
            self.window_start = now;
            self.withdrawn_potato_micro = 0;
            self.withdrawn_sol_lamports = 0;
            self.withdrawn_skr_atoms = 0;
        }
    }
}

/// Реферальная связь игрока. PDA seeds: `["referral", owner]`.
/// Создаётся один раз через `register_referrer` (burn 5 POTATO).
#[account]
#[derive(InitSpace)]
pub struct Referral {
    pub owner: Pubkey,     // кому принадлежит
    pub referrer: Pubkey,  // кто пригласил (Pubkey::default() = нет)
    pub bump: u8,
}


/// A sell order. PDA seeds: `["order", order_id.to_le_bytes()]`; its escrow
/// token account is `["escrow", order_pubkey]`. Closed on fill/cancel/expiry.
#[account]
#[derive(InitSpace)]
pub struct MarketOrder {
    pub seller: Pubkey,
    pub amount_micro: u64,
    pub price_lamports_per_potato: u64,
    pub fee_micro: u64,
    pub status: OrderStatus,
    pub created_at: i64,
    pub expires_at: i64,
    pub escrow_bump: u8,
    pub order_bump: u8,
}

/// Global marketplace counters. PDA seeds: `["market_stats"]`.
/// The `_24h` counters reset when a trade lands on a new UTC day.
#[account]
#[derive(InitSpace)]
pub struct MarketStats {
    pub sell_volume_24h_micro: u64,
    pub buy_volume_24h_micro: u64,
    pub total_sol_volume: u64,
    pub total_trades: u64,
    pub last_update: i64,
    pub bump: u8,
}

impl MarketStats {
    /// Resets the daily counters when `now` falls on a different UTC day than
    /// the previous update, then stamps `last_update`.
    pub fn roll_window(&mut self, now: i64) {
        if self.last_update.div_euclid(SECONDS_PER_DAY) != now.div_euclid(SECONDS_PER_DAY) {
            self.sell_volume_24h_micro = 0;
            self.buy_volume_24h_micro = 0;
        }
        self.last_update = now;
    }
}

/// Per-seller anti-spam state. PDA seeds: `["seller", seller_pubkey]`.
#[account]
#[derive(InitSpace)]
pub struct SellerProfile {
    pub seller: Pubkey,
    pub last_cancel_at: i64,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum OrderStatus {
    Active,
    Filled,
    Cancelled,
    Expired,
}

impl Default for OrderStatus {
    fn default() -> Self {
        OrderStatus::Active
    }
}

// ─────────────────────────── Events ──────────────────────────────

#[event]
pub struct EpochRolled {
    pub epoch_id: u64,
    pub start_time: i64,
}

#[event]
pub struct PresalePurchase {
    pub buyer: Pubkey,
    pub field: Pubkey,
    pub field_type: u8,
    /// SKR atoms paid (6 decimals).
    pub sol_amount: u64,
    /// On-chain drop roll, 0-99: <70 COMMON, <95 RARE, else EPIC.
    pub roll: u8,
}

#[event]
pub struct ReferralRewardPaid {
    pub buyer: Pubkey,
    pub referrer: Pubkey,
    pub reward_micro: u64,
}

/// Export license: снижает комиссию рынка на 3% на 30 дней. PDA seeds: [b"license", owner].
#[account]
#[derive(InitSpace)]
pub struct ExportLicense {
    pub owner: Pubkey,
    pub expires_at: i64,
    pub bump: u8,
}

#[event]

pub struct FieldCreated {
    pub owner: Pubkey,
    pub field: Pubkey,
    pub field_type: u8,
}

#[event]
pub struct Harvested {
    pub owner: Pubkey,
    pub field: Pubkey,
    pub amount_micro: u64,
}

#[event]
pub struct TreasuryTaxed {
    pub field: Pubkey,
    pub treasury: Pubkey,
    pub amount_micro: u64,
    pub tax_bps: u16,
}

#[event]
pub struct ReferrerRegistered {
    pub owner: Pubkey,
    pub referrer: Pubkey,
}

#[event]
pub struct FieldRepaired {
    pub field: Pubkey,
    pub cost_micro: u64,
}

#[event]
pub struct FieldUpgraded {
    pub field: Pubkey,
    pub new_level: u8,
    pub cost_micro: u64,
}

#[event]
pub struct TaxPaid {
    pub field: Pubkey,
    pub paid_until: i64,
    pub cost_micro: u64,
}

#[event]
pub struct FertilizerApplied {
    pub field: Pubkey,
    pub active_until: i64,
    pub cost_micro: u64,
}

#[event]
pub struct ExportLicensePurchased {
    pub owner: Pubkey,
    pub expires_at: i64,
    pub cost_skr_atoms: u64,
}

#[event]
pub struct OrderCreated {
    pub order: Pubkey,
    pub seller: Pubkey,
    pub amount_micro: u64,
    pub price_lamports_per_potato: u64,
}

#[event]
pub struct OrderFilled {
    pub order: Pubkey,
    pub buyer: Pubkey,
    pub amount_micro: u64,
    pub total_lamports: u64,
}

#[event]
pub struct OrderCancelled {
    pub order: Pubkey,
    pub seller: Pubkey,
}

#[event]
pub struct OrderExpiredEvent {
    pub order: Pubkey,
}

#[event]
pub struct RewardGranted {
    /// Wallet that owns the receiving token account.
    pub recipient: Pubkey,
    pub amount_micro: u64,
}

#[event]
pub struct TreasuryWithdrawn {
    pub destination: Pubkey,
    pub amount_micro: u64,
}

#[event]
pub struct TreasurySolWithdrawn {
    pub destination: Pubkey,
    pub amount_lamports: u64,
}

#[event]
pub struct TreasurySkrWithdrawn {
    pub destination: Pubkey,
    pub amount_skr_atoms: u64,
}

#[event]
pub struct PresaleAuthorityMigrated {
    pub authority: Pubkey,
}

#[event]
pub struct PausedToggled {
    pub paused: bool,
}

#[event]
pub struct AuthorityProposed {
    pub pending_authority: Pubkey,
}

#[event]
pub struct AuthorityAccepted {
    pub previous: Pubkey,
    pub current: Pubkey,
}

#[event]
pub struct BatchHarvested {
    pub owner: Pubkey,
    pub field_count: u8,
    pub total_micro: u64,
    pub treasury_micro: u64,
}

#[event]
pub struct FieldClosed {
    pub owner: Pubkey,
    pub field: Pubkey,
}

#[event]
pub struct ConfigUpdated {
    pub daily_mint_cap_micro: u64,
    pub base_yield_micro_per_day: u64,
    pub global_multiplier_bps: u16,
}

#[event]
pub struct SkrMintUpdated {
    pub new_skr_mint: Pubkey,
}

#[event]
pub struct RewardSignerUpdated {
    pub new_signer: Pubkey,
}

// ─────────────────────────── Errors ──────────────────────────────
// Existing codes are frozen (clients match on them). Append only.

#[error_code]
pub enum GameError {
    AlreadyClaimed, // 6000
    BadProof, // 6001
    #[msg("Game is paused")]
    Paused, // 6002
    #[msg("Field is not active")]
    FieldInactive, // 6003
    #[msg("Nothing to harvest")]
    NothingToHarvest, // 6004
    #[msg("Harvest too soon: wait at least 60 seconds between harvests")]
    HarvestTooSoon, // 6005
    #[msg("Max level reached")]
    MaxLevelReached, // 6006
    #[msg("Unauthorized")]
    Unauthorized, // 6007
    #[msg("Invalid authority")]
    InvalidAuthority, // 6008
    #[msg("Invalid field type: expected 0, 1 or 2")]
    InvalidFieldType, // 6009
    #[msg("Invalid amount")]
    InvalidAmount, // 6010
    #[msg("Order is too small: minimum is 10 POTATO")]
    OrderTooSmall, // 6011
    #[msg("Invalid price")]
    InvalidPrice, // 6012
    #[msg("Order is not active")]
    OrderNotActive, // 6013
    #[msg("Order has expired")]
    OrderExpired, // 6014
    #[msg("Order has not expired yet")]
    OrderNotExpired, // 6015
    #[msg("Self-trade is blocked")]
    SelfTradeBlocked, // 6016
    #[msg("Cooldown: you can create orders only 3 hours after a cancel")]
    CancelCooldown, // 6017
    #[msg("Reward too large (max 1000 POTATO)")]
    RewardTooLarge, // 6018
    #[msg("Epoch mint cap exceeded — try again next epoch")]
    EpochCapExceeded, // 6019
    #[msg("Daily cap cannot be raised above 250K POTATO")]
    CapTooHigh, // 6020
    #[msg("Global multiplier too high (max 2.0x)")]
    MultiplierTooHigh, // 6021
    #[msg("Epoch has not ended yet")]
    EpochNotOver, // 6022
    #[msg("Math overflow")]
    MathOverflow, // 6023
    #[msg("Token account mint does not match the game mint")]
    InvalidMint, // 6024
    #[msg("Mint authority must be the config PDA")]
    InvalidMintAuthority, // 6025
    #[msg("Mint must have 6 decimals")]
    InvalidMintDecimals, // 6026
    #[msg("Mint must not have a freeze authority")]
    MintHasFreezeAuthority, // 6027
    #[msg("Order total is below the minimum of 1 000 000 lamports (0.001 SOL)")]
    OrderTotalTooSmall, // 6028
    #[msg("Prepay limit reached: tax up to 28 days, fertilizer up to 7 days ahead")]
    PrepayLimitReached, // 6029
    #[msg("Field durability is already at maximum")]
    NothingToRepair, // 6030
    #[msg("Max supply reached")]
    MaxSupplyReached, // 6031
    #[msg("Presale cap reached: all fields sold")]
    PresaleCapReached, // 6032
    #[msg("Wallet presale limit reached: max 5 fields per wallet")]
    PresaleWalletLimitReached, // 6033
    #[msg("Presale is not active")]
    PresaleNotActive, // 6034
    #[msg("Manual grant quota exceeded (10% of the epoch cap)")]
    GrantQuotaExceeded, // 6035
    #[msg("Withdrawal rate limit exceeded for the current 24h window")]
    WithdrawWindowLimitExceeded, // 6036
    #[msg("Base yield too high (max 100 POTATO/day per reference field)")]
    BaseYieldTooHigh, // 6037
    #[msg("Admin timelock has not expired yet")]
    TimelockNotExpired, // 6038
    #[msg("No pending admin proposal to apply")]
    NothingPending, // 6039
    #[msg("Epoch is too recent to be closed")]
    EpochTooRecent, // 6040
}

// ──────────────────────────── Tests ──────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn field(level: u8, durability: u8, field_type: u8) -> Field {
        Field {
            owner: Pubkey::default(),
            level,
            durability,
            last_harvest: 0,
            tax_paid_until: i64::MAX,
            fertilizer_until: 0,
            is_active: true,
            field_type,
            bump: 0,
            mutation_type: 0,
        }
    }

    #[test]
    fn level_multiplier_is_strictly_increasing() {
        for l in 1..MAX_FIELD_LEVEL {
            assert!(get_level_mult(l + 1) > get_level_mult(l), "level {l} -> {}", l + 1);
        }
        assert_eq!(get_level_mult(1), 10_000);
        assert_eq!(get_level_mult(5), 28_600);
        assert_eq!(get_level_mult(6), 32_600);
        assert_eq!(get_level_mult(50), 208_600);
    }

    #[test]
    fn field_prices_match_spec() {
        assert_eq!(field_price_micro(0), 100_000_000);
        assert_eq!(field_price_micro(1), 250_000_000);
        assert_eq!(field_price_micro(2), 500_000_000);
    }

    #[test]
    fn upgrade_cost_scales_with_level_and_type() {
        assert_eq!(upgrade_cost_micro(1, 1).unwrap(), 100_000_000);
        assert_eq!(upgrade_cost_micro(10, 1).unwrap(), 1_000_000_000);
        assert_eq!(upgrade_cost_micro(1, 0).unwrap(), 40_000_000);
        assert_eq!(upgrade_cost_micro(1, 2).unwrap(), 200_000_000);
    }

    #[test]
    fn one_day_yield_of_reference_field_is_base_yield() {
        let f = field(1, 100, 1);
        let y = compute_pending_yield(DEFAULT_BASE_YIELD_MICRO_PER_DAY, 10_000, &f, SECONDS_PER_DAY, 1, 0)
            .unwrap();
        assert_eq!(y, DEFAULT_BASE_YIELD_MICRO_PER_DAY);
    }

    #[test]
    fn unpaid_tax_halves_yield_and_fertilizer_adds_half() {
        let mut f = field(1, 100, 1);
        f.tax_paid_until = 0; // overdue at now = 10
        let y = compute_pending_yield(6_000_000, 10_000, &f, SECONDS_PER_DAY, 10, 0).unwrap();
        assert_eq!(y, 3_000_000);
        f.tax_paid_until = i64::MAX;
        f.fertilizer_until = i64::MAX;
        let y = compute_pending_yield(6_000_000, 10_000, &f, SECONDS_PER_DAY, 10, 0).unwrap();
        assert_eq!(y, 9_000_000);
    }

    #[test]
    fn durability_multiplier_bounds() {
        assert_eq!(durability_mult_bps(0), 2_000);
        assert_eq!(durability_mult_bps(100), 10_000);
        assert_eq!(durability_mult_bps(200), 10_000);
    }

    #[test]
    fn weekly_yield_covers_tax_at_level_one() {
        for t in 0..FIELD_TYPE_COUNT {
            let f = field(1, 100, t);
            let weekly =
                compute_pending_yield(DEFAULT_BASE_YIELD_MICRO_PER_DAY, 10_000, &f, TAX_PERIOD, 1, 0).unwrap();
            let tax = scaled_cost(BASE_TAX_MICRO, t);
            assert!(weekly > tax * 3, "type {t}: weekly {weekly} vs tax {tax}");
        }
    }

    #[test]
    fn lunar_weight_is_segment_weighted_over_trailing_days() {
        // Одна эпоха назад = ровно табличное значение текущей эпохи.
        assert_eq!(lunar_weighted_bps(SECONDS_PER_DAY, 0), LUNAR_TABLE[0] as u128);
        assert_eq!(lunar_weighted_bps(SECONDS_PER_DAY, 3), LUNAR_TABLE[3] as u128);
        // elapsed = 0 → текущая эпоха.
        assert_eq!(lunar_weighted_bps(0, 27), LUNAR_TABLE[27] as u128);
        // Двое суток, epoch_id = 0: средняя между LUNAR[0] и LUNAR[27].
        let expected = (LUNAR_TABLE[0] as u128 + LUNAR_TABLE[27] as u128) / 2;
        assert_eq!(lunar_weighted_bps(2 * SECONDS_PER_DAY, 0), expected);
        // Частичный сегмент взвешивается по своей длительности.
        // 1.5 суток, epoch 0: 86400 s по LUNAR[0] + 43200 s по LUNAR[27].
        let w = (LUNAR_TABLE[0] as u128 * 86_400 + LUNAR_TABLE[27] as u128 * 43_200) / 129_600;
        assert_eq!(lunar_weighted_bps(SECONDS_PER_DAY * 3 / 2, 0), w);
        // Семь суток (MAX_ACCRUAL) не выходят за границы таблицы.
        let _ = lunar_weighted_bps(MAX_ACCRUAL_SECONDS, 5);
    }

    #[test]
    fn admin_withdraw_window_resets_after_24h() {
        let mut s = AdminState::default();
        s.window_start = 100;
        s.withdrawn_sol_lamports = 5;
        s.roll_withdraw_window(100 + WITHDRAW_WINDOW_SECONDS - 1);
        assert_eq!(s.withdrawn_sol_lamports, 5);
        s.roll_withdraw_window(100 + WITHDRAW_WINDOW_SECONDS);
        assert_eq!(s.withdrawn_sol_lamports, 0);
        assert_eq!(s.window_start, 100 + WITHDRAW_WINDOW_SECONDS);
        // Отрицательный сдвиг времени (clock skew) окно не сбрасывает.
        s.withdrawn_potato_micro = 7;
        s.roll_withdraw_window(0);
        assert_eq!(s.withdrawn_potato_micro, 7);
    }

    #[test]
    fn presale_sol_price_scales_with_field_type() {
        // type_cost_bps: 0 → 0.4×, 1 → 1.0×, 2 → 2.0× базовой цены пресейла.
        let base: u64 = 50_000_000; // 0.05 SOL
        for (t, expected) in [(0u8, 20_000_000u64), (1, 50_000_000), (2, 100_000_000)] {
            let price = ((base as u128) * type_cost_bps(t) / BPS) as u64;
            assert_eq!(price, expected, "type {t}");
        }
    }

    #[test]
    fn grant_quota_is_ten_percent_of_epoch_cap() {
        let cap = MAX_DAILY_CAP_MICRO; // 250k 🥔
        let quota = ((cap as u128) * GRANT_QUOTA_SHARE_BPS as u128 / BPS) as u64;
        assert_eq!(quota, 25_000_000_000); // 25k 🥔
        assert!(quota >= MAX_REWARD_MICRO, "single max reward must fit in quota");
    }

    #[test]
    fn fee_tiers_are_progressive() {
        // Прогрессивная комиссия 9% – 12%
        assert_eq!(calculate_fee_bps(999_999_999), 900);
        assert_eq!(calculate_fee_bps(1_000_000_000), 1_000);
        assert_eq!(calculate_fee_bps(10_000_000_000), 1_100);
        assert_eq!(calculate_fee_bps(100_000_000_000), 1_200);
        assert_eq!(order_fee_micro(1_000_000).unwrap(), 90_000); // 1 POTATO × 9%
    }

    #[test]
    fn order_total_rounds_down_and_is_gated() {
        assert_eq!(order_total_lamports(1_000_000, 1_000).unwrap(), 1_000);
        assert_eq!(order_total_lamports(100_000, 1).unwrap(), 0);
        assert!(order_total_lamports(u64::MAX, u64::MAX).is_err());
    }

    #[test]
    fn extend_timer_starts_from_now_when_expired() {
        assert_eq!(extend_timer(0, 1_000, 10).unwrap(), 1_010);
        assert_eq!(extend_timer(2_000, 1_000, 10).unwrap(), 2_010);
    }

    #[test]
    fn market_stats_window_resets_on_new_day() {
        let mut s = MarketStats {
            sell_volume_24h_micro: 5,
            buy_volume_24h_micro: 5,
            total_sol_volume: 9,
            total_trades: 1,
            last_update: 100,
            bump: 0,
        };
        s.roll_window(200);
        assert_eq!(s.sell_volume_24h_micro, 5);
        s.roll_window(SECONDS_PER_DAY + 1);
        assert_eq!(s.sell_volume_24h_micro, 0);
        assert_eq!(s.total_sol_volume, 9);
    }

    #[test]
    fn batch_field_serialization_round_trips_without_extra_discriminator() {
        let mut original = field(3, 99, 1);
        original.last_harvest = 123456;
        let mut data = vec![0; 8 + Field::INIT_SPACE];
        write_field_account(&original, &mut data).unwrap();
        let restored = Field::try_deserialize(&mut &data[..]).unwrap();
        assert_eq!(restored.owner, original.owner);
        assert_eq!(restored.last_harvest, 123456);
        assert_eq!(restored.durability, 99);
        assert_eq!(restored.level, 3);
        assert!(write_field_account(&original, &mut data[..69]).is_err());
    }

    #[test]
    fn achievement_proofs_reject_duplicate_and_foreign_fields() {
        let user = Pubkey::new_unique();
        let program = crate::ID;
        let key = Pubkey::new_unique();
        let mut f = field(3, 100, 1);
        f.owner = user;
        let mut data = vec![0; 8 + Field::INIT_SPACE];
        write_field_account(&f, &mut data).unwrap();
        let mut lamports = 1;
        let account = AccountInfo::new(&key, false, false, &mut lamports, &mut data, &program, false, 0);
        assert!(verify_fields(&[account.clone()], &user, &program, 1, 3).is_ok());
        assert!(verify_fields(&[account.clone(), account.clone()], &user, &program, 2, 0).is_err());
        assert!(verify_fields(&[account.clone()], &Pubkey::new_unique(), &program, 1, 0).is_err());
        assert!(verify_fields(&[account], &user, &Pubkey::new_unique(), 1, 0).is_err());
    }

    #[test]
    fn account_sizes_match_client_decoders() {
        assert_eq!(8 + Field::INIT_SPACE, 70);
        assert_eq!(8 + MarketOrder::INIT_SPACE, 83);
        // GameConfig: 32*5 (authority,pending,potato,skr,reward) + 8*4 +2+8*3+1+1
        assert_eq!(8 + GameConfig::INIT_SPACE, 8 + 32 * 5 + 8 * 4 + 2 + 8 * 3 + 1 + 1);
        // AdminState: i64 + 3*u64 + Pubkey + i64 + u64 + i64 + u8
        assert_eq!(8 + AdminState::INIT_SPACE, 8 + 8 + 24 + 32 + 8 + 8 + 8 + 1);
    }
}

fn verify_fields(accs: &[AccountInfo], user: &Pubkey, program: &Pubkey, min: usize, min_level: u8) -> Result<()> {
    require!(accs.len() >= min, GameError::BadProof);
    // Верхняя граница: O(n²) проверка дублей с n в тысячи аккаунтов — это
    // DoS по CU (и превышение лимита транзакции). Клиент режет поля сам.
    require!(accs.len() <= MAX_CLAIM_PROOFS, GameError::BadProof);
    // Защита от дублей: один и тот же Field PDA нельзя засчитать дважды
    // (иначе 1 поле проходит проверку "5 полей" и "6 полей L3").
    for i in 0..accs.len() {
        for j in (i + 1)..accs.len() {
            require!(accs[i].key() != accs[j].key(), GameError::BadProof);
        }
    }
    let mut saw_level = min_level == 0;
    for acc in accs.iter() {
        require!(acc.owner == program, GameError::BadProof);
        let data = acc.try_borrow_data()?;
        let mut slice: &[u8] = &data;
        let f = Field::try_deserialize(&mut slice).map_err(|_| error!(GameError::BadProof))?;
        require!(f.owner == *user, GameError::BadProof);
        if f.level >= min_level { saw_level = true; }
    }
    require!(saw_level, GameError::BadProof);
    Ok(())
}

#[account]
#[derive(Default, InitSpace)]
pub struct Achievements {
    pub bitmap: u64,
    pub bump: u8,
}

#[derive(Accounts)]
pub struct ClaimAchievement<'info> {
    #[account(mut, seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, GameConfig>,
    #[account(
        init_if_needed,
        payer = user,
        space = 8 + Achievements::INIT_SPACE,
        seeds = [b"achv", user.key().as_ref()],
        bump
    )]
    pub achievements: Account<'info, Achievements>,
    #[account(mut)]
    pub user: Signer<'info>,
    /// CHECK: PDA-казна квестов, владеет пулом наград
    #[account(seeds = [b"quest_treasury"], bump)]
    pub quest_treasury: AccountInfo<'info>,
    #[account(
        mut,
        associated_token::mint = potato_mint,
        associated_token::authority = quest_treasury
    )]
    pub quest_ata: Account<'info, TokenAccount>,
    #[account(
        mut,
        associated_token::mint = potato_mint,
        associated_token::authority = user
    )]
    pub user_potato_ata: Account<'info, TokenAccount>,
    #[account(address = config.potato_mint)]
    pub potato_mint: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[event]
pub struct AchievementClaimed {
    pub user: Pubkey,
    pub quest_id: u8,
    pub reward: u64,
}

pub const QUEST_REWARD_MICRO: [u64; 6] = [50_000_000, 50_000_000, 100_000_000, 100_000_000, 200_000_000, 50_000_000];
