import { useState } from 'react';
import { PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddress } from '@solana/spl-token';
import { useSolana } from '../contexts/SolanaContext';
import { useGame } from '../contexts/GameContext';
import { ixRegisterReferrer, pdas } from '../utils/anchorClient';

const POTATO_MINT = '48D2uN5dwrpQuCJcb8Bge1hRkJVCRcS4J1JicAoAvMha';

export function useReferral() {
  const { publicKey, sendIx, programId, connected, ready } = useSolana();
  const { notify } = useGame();
  const [loading, setLoading] = useState(false);

  const registerReferrer = async (referrerPubkey: string) => {
    if (!publicKey || !connected || !ready || !programId) {
      notify('warning', 'Подключите кошелёк');
      return;
    }

    try {
      setLoading(true);
      const referrer = new PublicKey(referrerPubkey);

      if (referrer.equals(publicKey)) {
        notify('warning', 'Нельзя пригласить самого себя');
        return;
      }

      const [referral] = PublicKey.findProgramAddressSync(
        [Buffer.from('referral'), publicKey.toBuffer()],
        programId,
      );

      const { config } = pdas(programId);
      const userPotato = await getAssociatedTokenAddress(
        new PublicKey(POTATO_MINT),
        publicKey,
      );

      const ix = await ixRegisterReferrer(
        programId,
        {
          referral,
          config,
          potatoMint: new PublicKey(POTATO_MINT),
          userPotato,
          owner: publicKey,
        },
        referrer,
      );

      await sendIx([ix]);

      notify('success', 'Реферер зарегистрирован!', `Пригласил: ${referrerPubkey.slice(0, 8)}...`);
    } catch (error: any) {
      console.error('Register referrer error:', error);
      notify('error', 'Ошибка регистрации реферера', error.message || 'Попробуйте снова');
    } finally {
      setLoading(false);
    }
  };

  return { registerReferrer, loading };
}
