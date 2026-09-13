import { Keypair, Connection, PublicKey, Transaction } from '@solana/web3.js';
import { AnchorProvider, Program, BN } from '@coral-xyz/anchor';
import * as anchor from '@coral-xyz/anchor';

interface SentinelResult {
  allowed: boolean;
  reason?: string;
  simulation?: any;
}

/**
 * AI-агент с защитой Sentinel
 * Все транзакции проходят через firewall перед подписанием
 */
export class GuardedAgent {
  private connection: Connection;
  private keypair: Keypair;
  private provider: AnchorProvider;
  private program: Program;
  private sentinelUrl: string;

  constructor(
    rpcUrl: string,
    keypair: Keypair,
    programId: PublicKey,
    idl: any,
    sentinelUrl: string
  ) {
    this.connection = new Connection(rpcUrl, 'confirmed');
    this.keypair = keypair;
    this.sentinelUrl = sentinelUrl;

    // Создаём провайдер с кошельком агента
    const wallet = {
      publicKey: keypair.publicKey,
      signTransaction: async (tx: Transaction) => {
        tx.partialSign(keypair);
        return tx;
      },
      signAllTransactions: async (txs: Transaction[]) => {
        txs.forEach(tx => tx.partialSign(keypair));
        return txs;
      },
    };

    this.provider = new AnchorProvider(this.connection, wallet as any, {
      commitment: 'confirmed',
    });

    this.program = new Program(idl, programId, this.provider);
  }

  /**
   * Проверяет транзакцию через Sentinel перед подписанием
   */
  private async validateWithSentinel(
    tx: Transaction,
    intent: string
  ): Promise<SentinelResult> {
    try {
      const serialized = tx.serialize({ requireAllSignatures: false }).toString('base64');

      const response = await fetch(`${this.sentinelUrl}/simulate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transaction: serialized, intent }),
      });

      if (response.status === 403) {
        const data = await response.json();
        return {
          allowed: false,
          reason: data.reason || 'Blocked by Sentinel',
        };
      }

      if (!response.ok) {
        throw new Error(`Sentinel error: ${response.status}`);
      }

      const result = await response.json();
      return {
        allowed: true,
        simulation: result.simulation,
      };
    } catch (error: any) {
      console.error('❌ Sentinel validation failed:', error.message);
      // В dev-режиме разрешаем, в prod - блокируем
      return { allowed: process.env.NODE_ENV !== 'production' };
    }
  }

  /**
   * Безопасно отправляет транзакцию с проверкой Sentinel
   */
  async sendGuardedTransaction(
    tx: Transaction,
    intent: string
  ): Promise<string | null> {
    console.log(`\n🤖 Agent action: ${intent}`);

    // Шаг 1: Проверка через Sentinel
    const validation = await this.validateWithSentinel(tx, intent);

    if (!validation.allowed) {
      console.error(`🚫 BLOCKED by Sentinel: ${validation.reason}`);
      return null;
    }

    console.log('✅ Sentinel approved');

    // Шаг 2: Подписываем и отправляем
    try {
      tx.partialSign(this.keypair);
      const signature = await this.connection.sendRawTransaction(tx.serialize());
      await this.connection.confirmTransaction(signature);

      console.log(`✅ Transaction sent: ${signature}`);
      return signature;
    } catch (error: any) {
      console.error(`❌ Transaction failed:`, error.message);
      return null;
    }
  }

  /**
   * Собирает урожай с поля
   */
  async harvest(fieldPda: PublicKey): Promise<boolean> {
    try {
      const tx = await this.program.methods
        .harvest()
        .accounts({
          user: this.keypair.publicKey,
          field: fieldPda,
        })
        .transaction();

      const signature = await this.sendGuardedTransaction(tx, `Harvest field ${fieldPda.toString().slice(0, 8)}`);
      return signature !== null;
    } catch (error: any) {
      console.error('Harvest error:', error.message);
      return false;
    }
  }

  /**
   * Покупает ордер на маркетплейсе
   */
  async fillOrder(orderPda: PublicKey, buyerPotatoAta: PublicKey): Promise<boolean> {
    try {
      const tx = await this.program.methods
        .fillOrder()
        .accounts({
          buyer: this.keypair.publicKey,
          order: orderPda,
          buyerPotatoAta,
        })
        .transaction();

      const signature = await this.sendGuardedTransaction(tx, `Fill order ${orderPda.toString().slice(0, 8)}`);
      return signature !== null;
    } catch (error: any) {
      console.error('Fill order error:', error.message);
      return false;
    }
  }

  /**
   * Получает баланс токенов агента
   */
  async getBalance(tokenMint: PublicKey): Promise<number> {
    try {
      const ata = await this.getATA(tokenMint);
      const account = await this.connection.getTokenAccountBalance(ata);
      return parseFloat(account.value.uiAmountString || '0');
    } catch {
      return 0;
    }
  }

  /**
   * Получает ATA агента для токена
   */
  async getATA(tokenMint: PublicKey): Promise<PublicKey> {
    const { PublicKey } = await import('@solana/web3.js');
    const [ata] = await PublicKey.findProgramAddress(
      [
        this.keypair.publicKey.toBuffer(),
        new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA').toBuffer(),
        tokenMint.toBuffer(),
      ],
      new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL')
    );
    return ata;
  }

  /**
   * Получает все поля агента
   */
  async getFields(): Promise<any[]> {
    try {
      const fields = await this.program.account.field.all([
        {
          memcmp: {
            offset: 8,
            bytes: this.keypair.publicKey.toBase58(),
          },
        },
      ]);
      return fields;
    } catch (error) {
      console.error('Get fields error:', error);
      return [];
    }
  }

  /**
   * Получает публичный ключ агента
   */
  getPublicKey(): PublicKey {
    return this.keypair.publicKey;
  }
}
