import pg from 'pg';
import { createHash } from 'node:crypto';
import { SafeError, type Config } from './config.js';
import { initialCursor, type Checkpoint, type CursorState, type ObservedTransaction, type Store } from './model.js';
export interface EventQuery {
  limit: number; cursorId: string; before?: string; after?: string;
  commitment?: 'finalized'; programId?: string; eventType?: string;
  slotFrom?: number; slotTo?: number; signature?: string;
}
export class PgStore implements Store {
  readonly pool: pg.Pool;
  readonly streamId: string;
  constructor(readonly config: Config) {
    this.streamId = `${config.cluster}:${config.programId}:${config.source}`;
    this.pool = new pg.Pool({ connectionString: config.databaseUrl, max: 5,
      connectionTimeoutMillis: 5000, statement_timeout: 15000, idleTimeoutMillis: 10000 });
    this.pool.on('connect', client => client.on('error', () => { /* active query rejects; keep EventEmitter from crashing process */ }));
    this.pool.on('error', () => { /* readiness DB probe detects failure; never log connection strings */ });
  }
  async initialize() {
    const version = await this.pool.query('SELECT version FROM watchtower.schema_version');
    if (version.rows[0]?.version !== 1) throw new SafeError('SCHEMA_MISMATCH');
    await this.pool.query('INSERT INTO watchtower.cursors(stream_id,state) VALUES($1,$2) ON CONFLICT DO NOTHING',
      [this.streamId, initialCursor()]);
  }
  async checkpoint(): Promise<Checkpoint> {
    const result = await this.pool.query('SELECT version,state FROM watchtower.cursors WHERE stream_id=$1', [this.streamId]);
    if (!result.rows[0]) throw new SafeError('MISSING_CHECKPOINT');
    return result.rows[0];
  }
  async savePage(transactions: ObservedTransaction[], next: CursorState, expectedVersion: number): Promise<void> {
    const db = await this.pool.connect();
    let failed = false;
    try {
      await db.query('BEGIN');
      const lock = await db.query('SELECT version FROM watchtower.cursors WHERE stream_id=$1 FOR UPDATE', [this.streamId]);
      if (lock.rows[0]?.version !== expectedVersion) throw new SafeError('STALE_CURSOR');
      for (const tx of transactions) {
        const fingerprint = createHash('sha256').update(JSON.stringify({ slot: tx.slot, signature: tx.signature,
          blockTime: tx.blockTime, frames: tx.frames })).digest('hex');
        const inserted = await db.query(`INSERT INTO watchtower.transactions
          (cluster,signature,slot,block_time,program_id,source,commitment,fingerprint,raw)
          VALUES($1,$2,$3,to_timestamp($4),$5,$6,'finalized',$7,$8) ON CONFLICT DO NOTHING RETURNING signature`,
        [this.config.cluster, tx.signature, tx.slot, tx.blockTime, this.config.programId, this.config.source, fingerprint, tx.raw]);
        if (inserted.rowCount === 0) {
          const old = await db.query('SELECT fingerprint,program_id,source FROM watchtower.transactions WHERE cluster=$1 AND signature=$2',
            [this.config.cluster, tx.signature]);
          if (old.rows[0]?.fingerprint !== fingerprint || old.rows[0]?.program_id !== this.config.programId || old.rows[0]?.source !== this.config.source) {
            throw new SafeError('FINALIZED_RECONCILIATION_MISMATCH');
          }
          continue;
        }
        for (const frame of tx.frames) {
          const raw = await db.query(`INSERT INTO watchtower.raw_events
            (cluster,slot,signature,instruction_index,inner_index,program_id,source,applied,payload)
            VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
          [this.config.cluster, tx.slot, tx.signature, frame.instructionIndex, frame.innerIndex,
            this.config.programId, this.config.source, frame.applied, frame]);
          for (const event of frame.events) {
            await db.query(`INSERT INTO watchtower.normalized_events
              (raw_id,log_index,event_type,category,parser_version,payload) VALUES($1,$2,$3,$4,$5,$6)`,
            [raw.rows[0].id, event.logIndex, event.decoded.eventType, event.decoded.category, event.decoded.parserVersion, event.decoded]);
          }
        }
      }
      await db.query(`UPDATE watchtower.cursors SET state=$2,version=version+1,updated_at=now() WHERE stream_id=$1`, [this.streamId, next]);
      await db.query(`INSERT INTO watchtower.reconciliation_state(stream_id,finalized_slot) VALUES($1,$2)
        ON CONFLICT(stream_id) DO UPDATE SET finalized_slot=EXCLUDED.finalized_slot,checked_at=now()`, [this.streamId, next.reconciledSlot]);
      if (transactions.length) await db.query(`INSERT INTO watchtower.audit_records(stream_id,event_type,detail)
        VALUES($1,'FinalizedReconciled',$2)`, [this.streamId, { transactions: transactions.length, slot: next.reconciledSlot }]);
      await db.query('COMMIT');
    } catch (error) { failed = true; await db.query('ROLLBACK').catch(() => {}); throw error; }
    finally { db.release(failed); }
  }
  async gap(code: string) {
    // Only internal stable codes reach here, never RPC error bodies/URLs.
    const db = await this.pool.connect();
    let failed = false;
    try {
      await db.query('BEGIN');
      const changed = await db.query(`INSERT INTO watchtower.data_quality(stream_id,code) VALUES($1,$2)
        ON CONFLICT(stream_id,code) DO UPDATE SET resolved=false,last_seen=now()
        WHERE watchtower.data_quality.resolved RETURNING code`, [this.streamId, code]);
      if (changed.rowCount) await db.query(`INSERT INTO watchtower.audit_records(stream_id,event_type,detail)
        VALUES($1,'IndexerGapDetected',$2)`, [this.streamId, { code }]);
      await db.query('UPDATE watchtower.data_quality SET last_seen=now() WHERE stream_id=$1 AND code=$2', [this.streamId, code]);
      if (changed.rowCount && code.startsWith('RPC_')) await db.query(`INSERT INTO watchtower.audit_records(stream_id,event_type,detail)
        VALUES($1,'RpcError',$2)`, [this.streamId, { code }]);
      await db.query('COMMIT');
    } catch (error) { failed = true; await db.query('ROLLBACK').catch(() => {}); throw error; }
    finally { db.release(failed); }
  }
  async heal() {
    // Called only after the exact blocking page has committed successfully.
    await this.pool.query(`WITH healed AS (
      UPDATE watchtower.data_quality SET resolved=true,last_seen=now() WHERE stream_id=$1 AND NOT resolved RETURNING code
    ) INSERT INTO watchtower.audit_records(stream_id,event_type,detail)
      SELECT $1,'IndexerGapHealed',jsonb_build_object('code',code) FROM healed`, [this.streamId]);
  }
  async issues() {
    return (await this.pool.query(`SELECT code,first_seen,last_seen FROM watchtower.data_quality
      WHERE stream_id=$1 AND NOT resolved ORDER BY code`, [this.streamId])).rows;
  }
  async list(query: EventQuery) {
    const args: unknown[] = [this.config.cluster, this.config.programId, this.config.source, query.cursorId];
    const where = ['r.cluster=$1', 'r.program_id=$2', 'r.source=$3', 'n.id>$4'];
    const filter = (sql: string, value: unknown) => { if (value !== undefined) { args.push(value); where.push(`${sql}$${args.length}`); } };
    filter('t.block_time<', query.before); filter('t.block_time>', query.after);
    filter('r.program_id=', query.programId); filter('n.event_type=', query.eventType);
    filter('r.slot>=', query.slotFrom); filter('r.slot<=', query.slotTo); filter('r.signature=', query.signature);
    args.push(query.limit + 1);
    const result = await this.pool.query(`SELECT n.id,n.log_index AS "logIndex",n.payload AS event,r.signature,
      r.slot::text AS slot,r.instruction_index AS "instructionIndex",r.inner_index AS "innerIndex",
      r.applied,t.block_time AS "blockTime",r.program_id AS "programId",t.commitment
      FROM watchtower.normalized_events n JOIN watchtower.raw_events r ON r.id=n.raw_id
      JOIN watchtower.transactions t ON t.cluster=r.cluster AND t.signature=r.signature
      WHERE ${where.join(' AND ')} ORDER BY n.id LIMIT $${args.length}`, args);
    const more = result.rows.length > query.limit;
    return { rows: result.rows.slice(0, query.limit), more };
  }
  async daily(before: string, after: string, limit: number) {
    return (await this.pool.query(`SELECT day::text,event_type AS "eventType",event_count AS "eventCount"
      FROM watchtower.daily_projections WHERE cluster=$1 AND program_id=$2 AND source=$3 AND day>=$4::date AND day<=$5::date
      ORDER BY day,event_type LIMIT $6`, [this.config.cluster, this.config.programId, this.config.source, after, before, limit])).rows;
  }
  async counts(category: string) {
    return (await this.pool.query(`SELECT n.event_type AS "eventType",count(*)::text AS "observedEventCount"
      FROM watchtower.normalized_events n JOIN watchtower.raw_events r ON r.id=n.raw_id
      WHERE r.cluster=$1 AND r.program_id=$2 AND r.source=$3 AND r.applied AND n.category=$4 GROUP BY n.event_type`,
    [this.config.cluster, this.config.programId, this.config.source, category])).rows;
  }
  async close() { await this.pool.end(); }
}
