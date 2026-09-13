import { GuardedAgent } from './GuardedAgent';
import { PublicKey } from '@solana/web3.js';

interface NPCConfig {
  name: string;
  personality: 'aggressive' | 'conservative' | 'balanced';
  harvestInterval: number; // секунды
  maxOrdersToFill: number;
}

/**
 * NPC-фермер: автономный агент который играет в игру
 * Все действия проходят через Sentinel для безопасности
 */
export class NPCFarmer {
  private agent: GuardedAgent;
  private config: NPCConfig;
  private tokenMint: PublicKey;
  private running: boolean = false;

  constructor(agent: GuardedAgent, tokenMint: PublicKey, config: NPCConfig) {
    this.agent = agent;
    this.tokenMint = tokenMint;
    this.config = config;
  }

  /**
   * Запускает цикл действий NPC
   */
  async start(): Promise<void> {
    this.running = true;
    console.log(`\n🤖 NPC "${this.config.name}" started`);
    console.log(`   Personality: ${this.config.personality}`);
    console.log(`   Harvest interval: ${this.config.harvestInterval}s`);

    while (this.running) {
      try {
        await this.tick();
        await this.sleep(this.config.harvestInterval * 1000);
      } catch (error: any) {
        console.error(`❌ NPC tick error:`, error.message);
        await this.sleep(5000);
      }
    }
  }

  /**
   * Останавливает NPC
   */
  stop(): void {
    this.running = false;
    console.log(`\n🛑 NPC "${this.config.name}" stopped`);
  }

  /**
   * Один цикл действий
   */
  private async tick(): Promise<void> {
    console.log(`\n[${this.config.name}] Tick started`);

    // 1. Собираем урожай со всех полей
    const fields = await this.agent.getFields();
    console.log(`📊 Found ${fields.length} fields`);

    for (const field of fields) {
      const success = await this.agent.harvest(field.publicKey);
      if (success) {
        console.log(`✅ Harvested field ${field.publicKey.toString().slice(0, 8)}`);
      }
      await this.sleep(1000); // Пауза между действиями
    }

    // 2. Проверяем баланс
    const balance = await this.agent.getBalance(this.tokenMint);
    console.log(`💰 Balance: ${balance.toFixed(2)} POTATO`);

    // 3. Логируем в Sentinel (все транзакции автоматически логируются)
    console.log(`✅ Tick completed`);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
