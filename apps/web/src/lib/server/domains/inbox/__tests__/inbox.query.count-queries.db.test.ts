/**
 * Real-Postgres proof that `countInboxScopes` issues one round trip for the
 * conversation scopes (mine/unassigned/pair, merged via FILTER) and one for
 * the ticket-type breakdown, not a query per scope. The `inbox.query.test.ts`
 * suite (rollback-transaction fixture) already proves the VALUES are right;
 * this proves the STATEMENT COUNT, which that fixture's `db` mock can't see
 * (it swaps in a plain testDb with no counting logger attached).
 */
import { describe, expect, it } from 'vitest'

if (!process.env.BASE_URL?.startsWith('http')) process.env.BASE_URL = 'http://localhost:3000'
process.env.SECRET_KEY ??= 'test-secret-key-with-at-least-32-characters'

import { db, sql } from '@/lib/server/db'
import { currentRequestMetrics, openRequestMetrics } from '@/lib/server/request-metrics'
import { runWithLogContext } from '@/lib/server/log-context'
import { countInboxScopes } from '../inbox.query'
import { PERMISSIONS, type PermissionKey } from '@/lib/shared/permissions'
import type { Actor } from '@/lib/server/policy/types'

let available = false
try {
  await db.execute(sql`select 1`)
  available = true
} catch {
  // Local/unit-only runs without Postgres skip this integration proof.
}

function fullPermissionActor(): Actor {
  return {
    principalId: null,
    role: 'admin',
    principalType: 'user',
    segmentIds: new Set(),
    permissions: new Set<PermissionKey>([
      PERMISSIONS.CONVERSATION_VIEW_ALL,
      PERMISSIONS.TICKET_VIEW_ALL,
    ]),
  }
}

describe.skipIf(!available)('countInboxScopes against Postgres', () => {
  it('issues exactly 2 statements for an actor who can view both kinds', async () => {
    const metrics = await runWithLogContext({ request_id: 'count-inbox-scopes-1' }, async () => {
      openRequestMetrics()
      await countInboxScopes(fullPermissionActor())
      return currentRequestMetrics()
    })
    // One merged conversation-scopes query (mine/unassigned/pair via FILTER)
    // plus one grouped ticket-type query. Was 4 before the FILTER merge: a
    // regression back to a query per scope would show up here as 4 again.
    expect(metrics?.dbQueries).toBe(2)
  })

  it('issues exactly 1 statement for a conversation-only actor', async () => {
    const actor: Actor = {
      principalId: null,
      role: 'member',
      principalType: 'user',
      segmentIds: new Set(),
      permissions: new Set<PermissionKey>([PERMISSIONS.CONVERSATION_VIEW_ALL]),
    }
    const metrics = await runWithLogContext({ request_id: 'count-inbox-scopes-2' }, async () => {
      openRequestMetrics()
      await countInboxScopes(actor)
      return currentRequestMetrics()
    })
    expect(metrics?.dbQueries).toBe(1)
  })
})
