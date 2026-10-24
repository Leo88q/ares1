import { getItem, setItem, removeItem } from '../utils/consent';
import { useState, useEffect, useCallback, useMemo } from 'react';
import { Connection, PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';
import { chainConfig } from '../content';
import { t } from '../i18n';

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

  // 2026-10-02 (audit): one Connection per hook instance, not one per render.
  const connection = useMemo(() => new Connection(chainConfig.rpcUrl, 'confirmed'), []);

  const connect = useCallback(async () => {
    if (!window.solana?.isPhantom) {
      setState(s => ({ ...s, error: t('Установите Phantom Wallet') }));
      return;
    }
    setState(s => ({ ...s, connecting: true, error: null }));
    try {
      const resp = await window.solana.connect();
      const pubkey = resp.publicKey;
      setState(s => ({ ...s, connected: true, publicKey: pubkey, connecting: false }));
      setItem("functional", "wallet_connected", "true");
    } catch (err: any) {
      setState(s => ({ ...s, error: err.message, connecting: false }));
    }
  }, []);

  const disconnect = useCallback(async () => {
    try {
      await window.solana?.disconnect();
    } catch {}
    setState({ connected: false, publicKey: null, balanceSkr: 0n, connecting: false, error: null });
    removeItem("functional", "wallet_connected");
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
    // Phantom injects `solana.publicKey` asynchronously after a refresh: never
    // assert non-null here, read it once into a local.
    const injected = window.solana?.publicKey;
    if (getItem("functional", "wallet_connected") === "true" && injected) {
      setState(s => ({ ...s, connected: true, publicKey: injected }));
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
