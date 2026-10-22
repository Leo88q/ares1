import type { Pool } from '../gameops/pool.js'

interface ColonyPrivilegeRow {
  current_user: string
  challenge_read: boolean
  challenge_insert: boolean
  challenge_consume: boolean
  challenge_wallet_immutable: boolean
  challenge_no_delete: boolean
  entitlement_read: boolean
  entitlement_no_insert: boolean
  entitlement_no_update: boolean
  entitlement_no_delete: boolean
  colony_read: boolean
  colony_insert: boolean
  colony_state_update: boolean
  colony_owner_immutable: boolean
  colony_field_immutable: boolean
  colony_ruleset_immutable: boolean
  event_read: boolean
  event_insert: boolean
  event_no_update: boolean
  event_no_delete: boolean
  cleanup_execute: boolean
  no_schema_create: boolean
}

export interface ColonyDatabaseReadiness {
  ready: boolean
  role: string | null
  failures: string[]
}

/** Verify that the actual connection is running with the narrow Colony runtime grants. */
export async function checkColonyDatabaseRole(pool: Pool): Promise<ColonyDatabaseReadiness> {
  const result = await pool.query<ColonyPrivilegeRow>(`
    SELECT current_user AS current_user,
      has_table_privilege(current_user, 'game_ops.colony_auth_challenges', 'SELECT') AS challenge_read,
      has_table_privilege(current_user, 'game_ops.colony_auth_challenges', 'INSERT') AS challenge_insert,
      has_column_privilege(current_user, 'game_ops.colony_auth_challenges', 'consumed_at', 'UPDATE') AS challenge_consume,
      NOT has_column_privilege(current_user, 'game_ops.colony_auth_challenges', 'wallet', 'UPDATE') AS challenge_wallet_immutable,
      NOT has_table_privilege(current_user, 'game_ops.colony_auth_challenges', 'DELETE') AS challenge_no_delete,
      has_table_privilege(current_user, 'game_ops.colony_entitlements', 'SELECT') AS entitlement_read,
      NOT has_table_privilege(current_user, 'game_ops.colony_entitlements', 'INSERT') AS entitlement_no_insert,
      NOT has_table_privilege(current_user, 'game_ops.colony_entitlements', 'UPDATE') AS entitlement_no_update,
      NOT has_table_privilege(current_user, 'game_ops.colony_entitlements', 'DELETE') AS entitlement_no_delete,
      has_table_privilege(current_user, 'game_ops.colonies', 'SELECT') AS colony_read,
      has_table_privilege(current_user, 'game_ops.colonies', 'INSERT') AS colony_insert,
      has_column_privilege(current_user, 'game_ops.colonies', 'state', 'UPDATE') AS colony_state_update,
      NOT has_column_privilege(current_user, 'game_ops.colonies', 'owner_wallet', 'UPDATE') AS colony_owner_immutable,
      NOT has_column_privilege(current_user, 'game_ops.colonies', 'field_address', 'UPDATE') AS colony_field_immutable,
      NOT has_column_privilege(current_user, 'game_ops.colonies', 'ruleset_version', 'UPDATE') AS colony_ruleset_immutable,
      has_table_privilege(current_user, 'game_ops.colony_events', 'SELECT') AS event_read,
      has_table_privilege(current_user, 'game_ops.colony_events', 'INSERT') AS event_insert,
      NOT has_table_privilege(current_user, 'game_ops.colony_events', 'UPDATE') AS event_no_update,
      NOT has_table_privilege(current_user, 'game_ops.colony_events', 'DELETE') AS event_no_delete,
      has_function_privilege(current_user, 'game_ops.purge_expired_colony_challenges()', 'EXECUTE') AS cleanup_execute,
      NOT has_schema_privilege(current_user, 'game_ops', 'CREATE') AS no_schema_create
  `)
  const row = result.rows[0]
  if (!row) return { ready: false, role: null, failures: ['runtime role query returned no row'] }
  const failures: string[] = []
  if (row.current_user !== 'game_ops_writer') failures.push(`current_user must be game_ops_writer (got ${row.current_user})`)
  for (const [name, value] of Object.entries(row)) {
    if (name !== 'current_user' && value !== true) failures.push(`required runtime privilege invariant failed: ${name}`)
  }
  return { ready: failures.length === 0, role: row.current_user, failures }
}
