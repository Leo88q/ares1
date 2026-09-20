//! SKR is settlement currency; POTATO remains a harvested/traded resource.
//! This module never mints SKR and never transfers SOL as a game purchase.
use super::*;
use anchor_spl::token::TransferChecked;

pub(crate) fn configure(ctx: Context<ConfigureSkrPricing>, prices: [u64; 6], market_min_atoms: u64) -> Result<()> {
    require!(ctx.accounts.skr_mint.decimals == 6, GameError::InvalidMintDecimals);
    let pricing = &mut ctx.accounts.pricing;
    pricing.skr_mint = ctx.accounts.skr_mint.key();
    pricing.prices = prices;
    pricing.market_min_atoms = market_min_atoms;
    pricing.bump = ctx.bumps.pricing;
    emit!(SkrPricingUpdated { skr_mint: pricing.skr_mint, prices, market_min_atoms });
    Ok(())
}

/// indices: creation, repair, upgrade, tax, fertilizer, referral registration.
/// Zero means disabled, not free. Preserve the existing type/level multipliers.
pub(crate) fn cost(pricing: &SkrPricing, action: u8, field_type: u8, level: u8) -> Result<u64> {
    require!(action < 6 && field_type < FIELD_TYPE_COUNT, GameError::InvalidFieldType);
    require!((1..=MAX_FIELD_LEVEL).contains(&level), GameError::InvalidAmount);
    let base = pricing.prices[action as usize];
    require!(base > 0, GameError::SkrPriceNotConfigured);
    let multiplier = match action { 1 => ((level as u64) / 3).max(1), 2 => level as u64,
        3 => ((level as u64 + 1) / 2).max(1), _ => 1 };
    let type_bps = if action == 5 { BPS } else { type_cost_bps(field_type) };
    let amount = (base as u128).checked_mul(type_bps).and_then(|v| v.checked_mul(multiplier as u128))
        .ok_or(GameError::MathOverflow)? / BPS;
    let amount = u64::try_from(amount).map_err(|_| error!(GameError::MathOverflow))?;
    require!(amount > 0, GameError::InvalidAmount);
    Ok(amount)
}

fn transfer<'info>(program: &Program<'info, Token>, mint: &Account<'info, Mint>,
    source: AccountInfo<'info>, destination: AccountInfo<'info>, signer: AccountInfo<'info>, amount: u64) -> Result<()> {
    if amount == 0 { return Ok(()); }
    require!(mint.decimals == 6, GameError::InvalidMintDecimals);
    token::transfer_checked(CpiContext::new(program.to_account_info(), TransferChecked {
        from: source, to: destination, mint: mint.to_account_info(), authority: signer,
    }), amount, mint.decimals)
}
fn quote_total_atoms(resource_micro: u64, quote_atoms_per_potato: u64) -> Result<u64> {
    let total = (resource_micro as u128).checked_mul(quote_atoms_per_potato as u128).ok_or(GameError::MathOverflow)? / MICRO;
    u64::try_from(total).map_err(|_| error!(GameError::MathOverflow))
}
fn approve(amount: u64, maximum: u64) -> Result<()> {
    require!(amount <= maximum, GameError::SkrPriceChanged);
    Ok(())
}

pub(crate) fn create_field(ctx: Context<CreateFieldSkr>, _id: u64, field_type: u8, max: u64) -> Result<()> {
    require!(!ctx.accounts.config.paused, GameError::Paused);
    let amount = cost(&ctx.accounts.pricing, 0, field_type, 1)?;
    approve(amount, max)?;
    transfer(&ctx.accounts.token_program, &ctx.accounts.skr_mint, ctx.accounts.user_skr.to_account_info(),
        ctx.accounts.treasury_skr.to_account_info(), ctx.accounts.owner.to_account_info(), amount)?;
    let now = Clock::get()?.unix_timestamp;
    let f = &mut ctx.accounts.field;
    f.owner = ctx.accounts.owner.key(); f.level = 1; f.durability = MAX_DURABILITY;
    f.last_harvest = now; f.tax_paid_until = now.checked_add(INITIAL_TAX_GRACE).ok_or(GameError::MathOverflow)?;
    f.fertilizer_until = 0; f.is_active = true; f.field_type = field_type; f.bump = ctx.bumps.field; f.mutation_type = 0;
    ctx.accounts.config.field_count = ctx.accounts.config.field_count.checked_add(1).ok_or(GameError::MathOverflow)?;
    emit!(FieldCreated { owner: f.owner, field: f.key(), field_type });
    emit!(SkrPayment { payer: f.owner, skr_mint: ctx.accounts.skr_mint.key(), action: 0, amount_atoms: amount });
    Ok(())
}

pub(crate) fn service_field(ctx: Context<ServiceFieldSkr>, action: u8, max: u64) -> Result<()> {
    require!(!ctx.accounts.config.paused, GameError::Paused);
    require!((1..=4).contains(&action), GameError::InvalidAmount);
    let f = &mut ctx.accounts.field;
    require!(f.is_active, GameError::FieldInactive);
    let now = Clock::get()?.unix_timestamp;
    let amount = cost(&ctx.accounts.pricing, action, f.field_type, f.level)?;
    approve(amount, max)?;
    match action {
        1 => { require!(f.durability < MAX_DURABILITY, GameError::NothingToRepair); f.durability = MAX_DURABILITY; }
        2 => {
            require!(f.level < MAX_FIELD_LEVEL, GameError::MaxLevelReached);
            f.level = f.level.checked_add(1).ok_or(GameError::MathOverflow)?;
            if f.mutation_type == 0 {
                let slot = Clock::get()?.slot;
                let seed = anchor_lang::solana_program::keccak::hashv(&[f.key().as_ref(), &slot.to_le_bytes()]);
                let roll = seed.0[0] as u64 % 100;
                if roll < 3 { f.mutation_type = 1; } else if roll < 5 { f.mutation_type = 2; }
            }
        }
        3 => { let until = extend_timer(f.tax_paid_until, now, TAX_PERIOD)?;
            require!(until <= now.saturating_add(MAX_TAX_PREPAY), GameError::PrepayLimitReached); f.tax_paid_until = until; }
        4 => { let until = extend_timer(f.fertilizer_until, now, FERTILIZER_DURATION)?;
            require!(until <= now.saturating_add(MAX_FERTILIZER_PREPAY), GameError::PrepayLimitReached); f.fertilizer_until = until; }
        _ => unreachable!(),
    }
    transfer(&ctx.accounts.token_program, &ctx.accounts.skr_mint, ctx.accounts.user_skr.to_account_info(),
        ctx.accounts.treasury_skr.to_account_info(), ctx.accounts.owner.to_account_info(), amount)?;
    // Old resource-cost events keep their POTATO semantics: no POTATO was burned.
    match action {
        1 => emit!(FieldRepaired { field: f.key(), cost_micro: 0 }),
        2 => emit!(FieldUpgraded { field: f.key(), new_level: f.level, cost_micro: 0 }),
        3 => emit!(TaxPaid { field: f.key(), paid_until: f.tax_paid_until, cost_micro: 0 }),
        _ => emit!(FertilizerApplied { field: f.key(), active_until: f.fertilizer_until, cost_micro: 0 }),
    }
    emit!(SkrPayment { payer: f.owner, skr_mint: ctx.accounts.skr_mint.key(), action, amount_atoms: amount });
    Ok(())
}

pub(crate) fn register_referrer(ctx: Context<RegisterReferrerSkr>, referrer: Pubkey, max: u64) -> Result<()> {
    require!(!ctx.accounts.config.paused, GameError::Paused);
    require!(referrer != ctx.accounts.owner.key() && referrer != Pubkey::default(), GameError::Unauthorized);
    let amount = cost(&ctx.accounts.pricing, 5, 1, 1)?;
    approve(amount, max)?;
    transfer(&ctx.accounts.token_program, &ctx.accounts.skr_mint, ctx.accounts.user_skr.to_account_info(),
        ctx.accounts.treasury_skr.to_account_info(), ctx.accounts.owner.to_account_info(), amount)?;
    let r = &mut ctx.accounts.referral;
    r.owner = ctx.accounts.owner.key(); r.referrer = referrer; r.bump = ctx.bumps.referral;
    emit!(ReferrerRegistered { owner: r.owner, referrer });
    emit!(SkrPayment { payer: r.owner, skr_mint: ctx.accounts.skr_mint.key(), action: 5, amount_atoms: amount });
    Ok(())
}

pub(crate) fn create_order(ctx: Context<CreateSkrOrder>, _id: u64, amount_micro: u64, price: u64) -> Result<()> {
    require!(!ctx.accounts.config.paused, GameError::Paused);
    require!(ctx.accounts.skr_mint.decimals == 6, GameError::InvalidMintDecimals);
    require!(ctx.accounts.pricing.market_min_atoms > 0, GameError::SkrPriceNotConfigured);
    require!(amount_micro >= MIN_ORDER_AMOUNT_MICRO, GameError::OrderTooSmall);
    require!(price > 0, GameError::InvalidPrice);
    let total = quote_total_atoms(amount_micro, price)?;
    require!(total >= ctx.accounts.pricing.market_min_atoms, GameError::InvalidPrice);
    let now = Clock::get()?.unix_timestamp;
    let profile = &mut ctx.accounts.seller_profile;
    require!(profile.last_cancel_at == 0 || now >= profile.last_cancel_at.saturating_add(CANCEL_COOLDOWN), GameError::CancelCooldown);
    profile.seller = ctx.accounts.seller.key(); profile.bump = ctx.bumps.seller_profile;
    let order = &mut ctx.accounts.order;
    order.seller = ctx.accounts.seller.key(); order.potato_mint = ctx.accounts.potato_mint.key();
    order.skr_mint = ctx.accounts.skr_mint.key(); order.amount_micro = amount_micro; order.price_skr_atoms = price;
    order.fee_bps = calculate_fee_bps(amount_micro) as u16;
    order.created_at = now; order.expires_at = now.checked_add(ORDER_TTL).ok_or(GameError::MathOverflow)?;
    order.escrow_bump = ctx.bumps.escrow; order.bump = ctx.bumps.order;
    let stats = &mut ctx.accounts.market_stats;
    stats.skr_mint = order.skr_mint; stats.bump = ctx.bumps.market_stats;
    token::transfer(CpiContext::new(ctx.accounts.token_program.to_account_info(), Transfer {
        from: ctx.accounts.seller_potato.to_account_info(), to: ctx.accounts.escrow.to_account_info(), authority: ctx.accounts.seller.to_account_info(),
    }), amount_micro)?;
    emit!(SkrOrderCreated { order: order.key(), seller: order.seller, skr_mint: order.skr_mint, amount_micro, price_skr_atoms: price });
    Ok(())
}

pub(crate) fn fill_order<'info>(ctx: Context<'_, '_, '_, 'info, FillSkrOrder<'info>>, max: u64) -> Result<()> {
    require!(!ctx.accounts.config.paused, GameError::Paused);
    let now = Clock::get()?.unix_timestamp;
    let order = &ctx.accounts.order;
    require!(now < order.expires_at, GameError::OrderExpired);
    require!(order.seller != ctx.accounts.buyer.key(), GameError::SelfTradeBlocked);
    let total = quote_total_atoms(order.amount_micro, order.price_skr_atoms)?;
    approve(total, max)?;
    let mut fee_bps = order.fee_bps as u64;
    // Optional accounts: [0] seller license, [1] buyer referral, [2] referrer's SKR token account.
    if let Some(account) = ctx.remaining_accounts.first() {
        let expected = Pubkey::find_program_address(&[b"license", order.seller.as_ref()], ctx.program_id).0;
        if account.key() == expected && account.owner == ctx.program_id {
            if let Ok(license) = ExportLicense::try_deserialize(&mut &account.try_borrow_data()?[..]) {
                if license.owner == order.seller && license.expires_at > now { fee_bps = fee_bps.saturating_sub(300); }
            }
        }
    }
    let mut reward = 0u64;
    if let Some(account) = ctx.remaining_accounts.get(1) {
        let expected = Pubkey::find_program_address(&[b"referral", ctx.accounts.buyer.key().as_ref()], ctx.program_id).0;
        if account.key() == expected && account.owner == ctx.program_id {
            if let Ok(referral) = Referral::try_deserialize(&mut &account.try_borrow_data()?[..]) {
                if referral.owner == ctx.accounts.buyer.key() && referral.referrer != order.seller && referral.referrer != referral.owner {
                    fee_bps = fee_bps.saturating_sub(100);
                    if let Some(ata) = ctx.remaining_accounts.get(2) {
                        if ata.owner == &token::ID && ata.is_writable {
                            if let Ok(account) = TokenAccount::try_deserialize(&mut &ata.try_borrow_data()?[..]) {
                                if account.owner == referral.referrer && account.mint == order.skr_mint {
                                    reward = ((total as u128) * 50 / BPS) as u64;
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    let fee = ((total as u128) * fee_bps as u128 / BPS) as u64;
    reward = reward.min(fee);
    let seller_amount = total.checked_sub(fee).ok_or(GameError::MathOverflow)?;
    let treasury_amount = fee - reward;
    transfer(&ctx.accounts.token_program, &ctx.accounts.skr_mint, ctx.accounts.buyer_skr.to_account_info(),
        ctx.accounts.seller_skr.to_account_info(), ctx.accounts.buyer.to_account_info(), seller_amount)?;
    transfer(&ctx.accounts.token_program, &ctx.accounts.skr_mint, ctx.accounts.buyer_skr.to_account_info(),
        ctx.accounts.treasury_skr.to_account_info(), ctx.accounts.buyer.to_account_info(), treasury_amount)?;
    if reward > 0 { transfer(&ctx.accounts.token_program, &ctx.accounts.skr_mint, ctx.accounts.buyer_skr.to_account_info(),
        ctx.remaining_accounts[2].clone(), ctx.accounts.buyer.to_account_info(), reward)?; }
    let order_key = order.key();
    let seeds: &[&[u8]] = &[b"skr_escrow", order_key.as_ref(), &[order.escrow_bump]];
    token::transfer(CpiContext::new_with_signer(ctx.accounts.token_program.to_account_info(), Transfer {
        from: ctx.accounts.escrow.to_account_info(), to: ctx.accounts.buyer_potato.to_account_info(), authority: ctx.accounts.escrow.to_account_info(),
    }, &[seeds]), order.amount_micro)?;
    // Return any unsolicited POTATO dust as well, so a dust transfer cannot lock the order.
    let dust = ctx.accounts.escrow.amount.saturating_sub(order.amount_micro);
    if dust > 0 { token::transfer(CpiContext::new_with_signer(ctx.accounts.token_program.to_account_info(), Transfer {
        from: ctx.accounts.escrow.to_account_info(), to: ctx.accounts.seller_potato.to_account_info(), authority: ctx.accounts.escrow.to_account_info(),
    }, &[seeds]), dust)?; }
    token::close_account(CpiContext::new_with_signer(ctx.accounts.token_program.to_account_info(), CloseAccount {
        account: ctx.accounts.escrow.to_account_info(), destination: ctx.accounts.seller.to_account_info(), authority: ctx.accounts.escrow.to_account_info(),
    }, &[seeds]))?;
    let stats = &mut ctx.accounts.market_stats;
    if stats.last_update.div_euclid(SECONDS_PER_DAY) != now.div_euclid(SECONDS_PER_DAY) { stats.volume_24h_micro = 0; }
    stats.last_update = now; stats.volume_24h_micro = stats.volume_24h_micro.checked_add(order.amount_micro).ok_or(GameError::MathOverflow)?;
    stats.total_skr_atoms = stats.total_skr_atoms.checked_add(total).ok_or(GameError::MathOverflow)?;
    stats.total_trades = stats.total_trades.checked_add(1).ok_or(GameError::MathOverflow)?;
    emit!(SkrOrderFilled { order: order.key(), buyer: ctx.accounts.buyer.key(), seller: order.seller, skr_mint: order.skr_mint,
        amount_micro: order.amount_micro, total_skr_atoms: total, seller_skr_atoms: seller_amount, treasury_skr_atoms: treasury_amount, referrer_skr_atoms: reward });
    Ok(())
}

pub(crate) fn cancel_order(ctx: Context<CancelSkrOrder>) -> Result<()> {
    refund(&ctx.accounts.token_program, &ctx.accounts.order, &ctx.accounts.escrow, &ctx.accounts.seller_potato, &ctx.accounts.seller.to_account_info())?;
    ctx.accounts.seller_profile.last_cancel_at = Clock::get()?.unix_timestamp;
    emit!(SkrOrderClosed { order: ctx.accounts.order.key(), expired: false }); Ok(())
}
pub(crate) fn expire_order(ctx: Context<CloseExpiredSkrOrder>) -> Result<()> {
    require!(Clock::get()?.unix_timestamp >= ctx.accounts.order.expires_at, GameError::OrderNotExpired);
    refund(&ctx.accounts.token_program, &ctx.accounts.order, &ctx.accounts.escrow, &ctx.accounts.seller_potato, &ctx.accounts.seller.to_account_info())?;
    emit!(SkrOrderClosed { order: ctx.accounts.order.key(), expired: true }); Ok(())
}
fn refund<'info>(program: &Program<'info, Token>, order: &Account<'info, SkrOrder>, escrow: &Account<'info, TokenAccount>,
    destination: &Account<'info, TokenAccount>, seller: &AccountInfo<'info>) -> Result<()> {
    let key = order.key(); let seeds: &[&[u8]] = &[b"skr_escrow", key.as_ref(), &[order.escrow_bump]];
    token::transfer(CpiContext::new_with_signer(program.to_account_info(), Transfer { from: escrow.to_account_info(),
        to: destination.to_account_info(), authority: escrow.to_account_info() }, &[seeds]), escrow.amount)?;
    token::close_account(CpiContext::new_with_signer(program.to_account_info(), CloseAccount {
        account: escrow.to_account_info(), destination: seller.clone(), authority: escrow.to_account_info() }, &[seeds]))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn zero_is_disabled_and_skr_cost_is_checked() {
        let mut p = SkrPricing { skr_mint: Pubkey::new_unique(), prices: [0; 6], market_min_atoms: 0, bump: 0 };
        assert!(cost(&p, 0, 1, 1).is_err());
        p.prices = [1_000_000; 6];
        assert_eq!(cost(&p, 0, 0, 1).unwrap(), 400_000);
        assert_eq!(cost(&p, 1, 2, 30).unwrap(), 20_000_000);
        assert_eq!(cost(&p, 2, 1, 3).unwrap(), 3_000_000);
        assert_eq!(cost(&p, 3, 1, 10).unwrap(), 5_000_000);
        assert_eq!(cost(&p, 5, 0, 1).unwrap(), 1_000_000);
        p.prices[2] = u64::MAX; assert!(cost(&p, 2, 2, 50).is_err());
        assert!(approve(2, 1).is_err()); assert!(approve(1, 1).is_ok());
    }
}
