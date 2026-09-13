import { useState } from 'react';
import { PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddressSync, createAssociatedTokenAccountIdempotentInstruction } from '@solana/spl-token';
import { useSolana } from '../contexts/SolanaContext';
import { useToast } from '../components/Toast';
import { describeError } from '../utils/errors';
import { ixRegisterReferrer, pdas } from '../utils/anchorClient';

/**
 * Регистрация реферера on-chain (PDA ["referral", owner], одноразово, burn 5 POTATO).
 * Mint берём из GameConfig, а не хардкод: программа и токен — разные адреса.
 */
export function useReferral() {
  const { publicKey, sendIx, programId, connected, ready, config } = useSolana();
  const { show } = useToast();
  const [loading, setLoading] = useState(false);

  const registerReferrer = async (referrerPubkey: string) => {
    if (!publicKey || !connected || !ready || !programId || !config) {
      show({ type: 'warning', title: 'Подключите кошелёк' });
      return;
    }

    try {
      setLoading(true);
      const referrer = new PublicKey(referrerPubkey);

      if (referrer.equals(publicKey)) {
        show({ type: 'warning', title: 'Нельзя пригласить самого себя' });
        return;
      }

      const [referral] = PublicKey.findProgramAddressSync(
        [Buffer.from('referral'), publicKey.toBuffer()],
        programId,
      );

      const { config: configPda } = pdas(programId);
      const userPotato = getAssociatedTokenAddressSync(config.potatoMint, publicKey, false);
      // ATA должна существовать до burn — создаём идемпотентно
      const ataIx = createAssociatedTokenAccountIdempotentInstruction(
        publicKey, userPotato, publicKey, config.potatoMint,
      );

      const ix = await ixRegisterReferrer(
        programId,
        {
          referral,
          config: configPda(),
          potatoMint: config.potatoMint,
          userPotato,
          owner: publicKey,
        },
        referrer,
      );

      await sendIx([ataIx, ix]);
      show({ type: 'success', title: 'Реферер зарегистрирован!', message: `Пригласил: ${referrerPubkey.slice(0, 8)}...` });
    } catch (error: unknown) {
      console.error('Register referrer error:', error);
      show({ type: 'error', title: 'Ошибка регистрации реферера', message: describeError(error) });
    } finally {
      setLoading(false);
    }
  };

  return { registerReferrer, loading };
}
