import { useState, useEffect, useCallback } from 'react';
import { Connection, PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';
import { chainConfig } from '../content';

declare global {
  interface Window {
    solana?: {
      isPhantom?: boolean;
      connect: () => Promise<{ publicKey: PublicKey }>;
      disconnect: () => Promise<void>;
      signTransaction: (tx: any) => Promise<any>;
      publicKey?: PublicKey;
    };
  }
}

interface WalletState {
  connected: boolean;
  publicKey: PublicKey | null;
  balanceSkr: bigint;
  connecting: boolean;
  error: string | null;
}

export function useLandingWallet() {
  const [state, setState] = useState<WalletState>({
    connected: false,
    publicKey: null,
    balanceSkr: 0n,
    connecting: false,
    error: null,
  });

  const connection = new Connection(chainConfig.rpcUrl, 'confirmed');

  const connect = useCallback(async () => {
    if (!window.solana?.isPhantom) {
      setState(s => ({ ...s, error: 'Установите Phantom Wallet' }));
      return;
    }
    setState(s => ({ ...s, connecting: true, error: null }));
    try {
      const resp = await window.solana.connect();
      const pubkey = resp.publicKey;
      setState(s => ({ ...s, connected: true, publicKey: pubkey, connecting: false }));
      localStorage.setItem('wallet_connected', 'true');
    } catch (err: any) {
      setState(s => ({ ...s, error: err.message, connecting: false }));
    }
  }, []);

  const disconnect = useCallback(async () => {
    try {
      await window.solana?.disconnect();
    } catch {}
    setState({ connected: false, publicKey: null, balanceSkr: 0n, connecting: false, error: null });
    localStorage.removeItem('wallet_connected');
  }, []);

  const fetchBalance = useCallback(async () => {
    if (!state.publicKey) return;
    try {
      const skrMint = new PublicKey(chainConfig.skrMint);
      const ata = getAssociatedTokenAddressSync(skrMint, state.publicKey);
      const acc = await connection.getAccountInfo(ata);
      const balance = acc ? acc.data.readBigUInt64LE(64) : 0n;
      setState(s => ({ ...s, balanceSkr: balance }));
    } catch (err: any) {
      console.error('fetchBalance error:', err);
    }
  }, [state.publicKey, connection]);

  useEffect(() => {
    if (localStorage.getItem('wallet_connected') === 'true' && window.solana?.publicKey) {
      setState(s => ({ ...s, connected: true, publicKey: window.solana!.publicKey! }));
    }
  }, []);

  useEffect(() => {
    if (state.connected && state.publicKey) {
      fetchBalance();
      const interval = setInterval(fetchBalance, 10_000);
      return () => clearInterval(interval);
    }
  }, [state.connected, state.publicKey, fetchBalance]);

  return { ...state, connect, disconnect, fetchBalance, connection };
}
