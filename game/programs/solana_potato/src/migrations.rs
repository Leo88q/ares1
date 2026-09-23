//! Pure account-layout transformations. Never resize an unknown account type,
//! never reset already-migrated data, and validate before any rent transfer.
use super::*;
use anchor_lang::Discriminator;

fn check_layout(data: &[u8], discriminator: &[u8], sizes: &[usize]) -> Result<()> {
    require!(sizes.contains(&data.len()), GameError::BadProof);
    require!(data.starts_with(discriminator), GameError::BadProof);
    Ok(())
}

pub(crate) fn config(data: &[u8]) -> Result<Vec<u8>> {
    check_layout(data, GameConfig::DISCRIMINATOR, &[156, 164, 228, 260])?;
    let result = if data.len() == 260 {
        data.to_vec()
    } else if data.len() == 228 {
        // F-02: guardian appended after bump; Pubkey::default() = no guardian.
        let mut out = vec![0; 260];
        out[..228].copy_from_slice(data);
        out
    } else {
        let mut out = vec![0; 260];
        out[..104].copy_from_slice(&data[..104]);
        out[104..136].copy_from_slice(SKR_MINT.as_ref());
        out[136..168].copy_from_slice(&data[8..40]); // initial reward signer = authority
        out[168..218].copy_from_slice(&data[104..154]); // numeric fields before snapshot
        if data.len() == 164 {
            out[218..226].copy_from_slice(&data[154..162]);
        } // v1 has no snapshot: initialize to zero, not from paused/bump bytes
        out[226..228].copy_from_slice(&data[data.len() - 2..]);
        out // [228..260] guardian defaults to Pubkey::default()
    };
    GameConfig::try_deserialize(&mut &result[..])?;
    Ok(result)
}

/// F-02: pads the legacy 97-byte AdminState (pre two-step withdrawals) to the
/// current 145-byte layout; new pending-withdraw fields default to zero.
pub(crate) fn admin_state(data: &[u8]) -> Result<Vec<u8>> {
    check_layout(data, AdminState::DISCRIMINATOR, &[97, 145])?;
    let mut out = data.to_vec();
    out.resize(145, 0);
    AdminState::try_deserialize(&mut &out[..])?;
    Ok(out)
}

pub(crate) fn authority(data: &[u8], signer: &Pubkey) -> Result<()> {
    let normalized = config(data)?;
    let config = GameConfig::try_deserialize(&mut &normalized[..])?;
    require_keys_eq!(config.authority, *signer, GameError::Unauthorized);
    Ok(())
}

pub(crate) fn field(data: &[u8]) -> Result<Vec<u8>> {
    check_layout(data, Field::DISCRIMINATOR, &[69, 70])?;
    let mut out = data.to_vec();
    out.resize(70, 0);
    Field::try_deserialize(&mut &out[..])?;
    Ok(out)
}

pub(crate) fn epoch(data: &[u8]) -> Result<Vec<u8>> {
    check_layout(data, Epoch::DISCRIMINATOR, &[41, 49])?;
    let mut out = data.to_vec();
    out.resize(49, 0);
    Epoch::try_deserialize(&mut &out[..])?;
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn current_config() -> Vec<u8> {
        let config = GameConfig {
            authority: Pubkey::new_unique(), pending_authority: Pubkey::new_unique(),
            potato_mint: Pubkey::new_unique(), skr_mint: Pubkey::new_unique(),
            reward_signer: Pubkey::new_unique(), max_supply_micro: 1_000_000,
            daily_mint_cap_micro: 20_000, base_yield_micro_per_day: 6_000,
            global_multiplier_bps: 10_000, field_count: 7, epoch_id: 42,
            total_burned_micro: 123_456, last_total_burned_micro: 9_876,
            paused: true, bump: 253, guardian: Pubkey::new_unique(),
        };
        let mut data = Vec::new();
        config.try_serialize(&mut data).unwrap();
        data
    }

    #[test]
    fn config_migrations_preserve_every_legacy_byte_and_are_idempotent() {
        let current = current_config();
        assert_eq!(current.len(), 260);
        for size in [156, 164, 228] {
            let mut legacy = current[..104].to_vec();
            legacy.extend_from_slice(&current[168..218]);
            if size == 164 { legacy.extend_from_slice(&current[218..226]); }
            if size == 228 {
                legacy = current[..228].to_vec();
            } else {
                legacy.extend_from_slice(&current[226..228]);
            }
            assert_eq!(legacy.len(), size);
            let result = config(&legacy).unwrap();
            let mut expected = current.clone();
            expected[104..136].copy_from_slice(SKR_MINT.as_ref());
            expected[136..168].copy_from_slice(&current[8..40]);
            if size == 156 { expected[218..226].fill(0); }
            if size != 228 { expected[228..260].fill(0); } // no guardian in legacy layouts
            assert_eq!(result, expected);
            assert_eq!(config(&result).unwrap(), result);
        }
        // Preserve custom SKR/reward signer/snapshot/guardian in already-current accounts.
        assert_eq!(config(&current).unwrap(), current);
    }

    #[test]
    fn admin_state_migration_pads_legacy_layout() {
        let state = AdminState {
            window_start: 1_700_000_000,
            withdrawn_potato_micro: 11,
            withdrawn_sol_lamports: 22,
            withdrawn_skr_atoms: 33,
            pending_skr_mint: Pubkey::new_unique(),
            pending_skr_mint_at: 44,
            pending_presale_price: 55,
            pending_presale_price_at: 66,
            bump: 200,
            pending_withdraw_potato: 77,
            pending_withdraw_potato_at: 88,
            pending_withdraw_sol: 99,
            pending_withdraw_sol_at: 111,
            pending_withdraw_skr: 222,
            pending_withdraw_skr_at: 333,
        };
        let mut bytes = Vec::new();
        state.try_serialize(&mut bytes).unwrap();
        assert_eq!(bytes.len(), 145);
        assert_eq!(admin_state(&bytes).unwrap(), bytes);
        let legacy = &bytes[..97];
        let padded = admin_state(legacy).unwrap();
        assert_eq!(padded.len(), 145);
        assert_eq!(&padded[..97], legacy);
        assert_eq!(&padded[97..], &[0u8; 48]);
        assert!(admin_state(&bytes[..96]).is_err());
        assert!(admin_state(&bytes[..146]).is_err());
        assert!(admin_state(&vec![0; 97]).is_err()); // bad discriminator
    }

    #[test]
    fn migrations_reject_malformed_data_and_wrong_authority() {
        let current = current_config();
        assert!(authority(&current, &Pubkey::new_unique()).is_err());
        let signer = Pubkey::new_from_array(current[8..40].try_into().unwrap());
        assert!(authority(&current, &signer).is_ok());
        for size in [0, 8, 40, 104, 155, 157, 163, 165, 227, 229, 259, 261] {
            assert!(config(&vec![0; size]).is_err(), "size {size} must be rejected");
        }
        let mut corrupt = current.clone(); corrupt[0] ^= 1;
        assert!(config(&corrupt).is_err());
        corrupt = current; corrupt[226] = 2; // invalid Borsh boolean
        assert!(config(&corrupt).is_err());
        assert!(field(&vec![0; 69]).is_err());
        assert!(epoch(&vec![0; 41]).is_err());
        assert!(admin_state(&vec![0; 97]).is_err());
    }

    #[test]
    fn field_and_epoch_migrations_preserve_nonzero_current_extensions() {
        let f = Field { owner: Pubkey::new_unique(), level: 3, durability: 74,
            last_harvest: 100, tax_paid_until: 200, fertilizer_until: 150,
            is_active: true, field_type: 2, bump: 254, mutation_type: 2 };
        let mut bytes = Vec::new(); f.try_serialize(&mut bytes).unwrap();
        assert_eq!(field(&bytes).unwrap(), bytes);
        let migrated = field(&bytes[..69]).unwrap();
        assert_eq!(&migrated[..69], &bytes[..69]);
        assert_eq!(migrated[69], 0);
        assert!(field(&bytes[..68]).is_err());
        let e = Epoch { id: 42, mint_cap_micro: 100, minted_micro: 9,
            start_time: 123, bump: 255, granted_micro: 17 };
        bytes.clear(); e.try_serialize(&mut bytes).unwrap();
        assert_eq!(epoch(&bytes).unwrap(), bytes);
        let migrated = epoch(&bytes[..41]).unwrap();
        assert_eq!(&migrated[..41], &bytes[..41]);
        assert_eq!(&migrated[41..], &[0; 8]);
        assert!(epoch(&bytes[..40]).is_err());
        assert!(field(&bytes).is_err());
    }
}
