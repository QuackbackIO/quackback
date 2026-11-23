/**
 * Sync history recovery actions on seeded operation rows: what a manager may
 * do once, and every refusal.
 *
 * Journeys: INT-I-45.
 *
 * The rows are review rows (`conflict`, a status proposal on a post), which
 * the worker never claims, and the action used is Cancel, which never calls
 * the provider. This file owns the Jira row and runs its tests in order.
 */
import { randomUUID } from 'node:crypto'
import { test, expect } from '../../support/fixtures'
import { supportDb } from '../../support/db'
import { callServerFn, personApi } from '../../support/server-fns'
import {
  createPost,
  removeIntegration,
  seedIntegration,
  syncHash,
  type SeededIntegration,
} from '../../product/integrations'

test.describe.configure({ mode: 'serial' })

let jira: SeededIntegration

test.beforeAll(async () => {
  jira = await seedIntegration('jira', { statusSyncEnabled: true })
})

test.afterAll(async () => {
  if (jira) await removeIntegration(jira)
})

/** A status proposal waiting for review on `postId`, as the ledger stores one. */
async function seedConflict(postId: string): Promise<string> {
  const id = randomUUID()
  const installation = `${jira.id}:${jira.connectedAt.toISOString()}`
  const destination = { scope: {}, target: syncHash({ channelId: 'ENG' }) }
  await supportDb()`
    INSERT INTO integration_sync_operations (id, operation_key, integration_id, installation,
      provider, direction, kind, source_type, source_id, destination, destination_key, state,
      version, error_code)
    VALUES (${id}, ${`sync:${syncHash({ e2e: id })}`}, ${jira.id}, ${installation}, 'jira',
      'outbound', 'status', 'post', ${postId}, ${supportDb().json(destination)},
      ${syncHash(destination)}, 'conflict', 1, 'review_required')`
  return id
}

test(
  'INT-I-45 recovery actions run once per action id and refuse stale, foreign and unpermitted requests',
  { tag: '@smoke' },
  async ({ playwright, marker, people }) => {
    const post = await createPost(marker, people.people.admin.principalId)
    const first = await seedConflict(post.id)
    const second = await seedConflict(post.id)
    const admin = await personApi(playwright, 'admin')
    const contributor = await personApi(playwright, 'contributor')
    try {
      const recover = (api: typeof admin, data: Record<string, unknown>) =>
        callServerFn<{ success: boolean }>(api, 'recoverIntegrationSyncFn', data)
      const actionId = randomUUID()

      // A teammate without integration.manage is refused.
      const refused = await recover(contributor, {
        id: first,
        version: 1,
        actionId: randomUUID(),
        action: 'cancel',
      })
      expect(refused.ok).toBe(false)
      expect(refused.error).toContain("'integration.manage'")

      // The manager cancels: one action row, the operation settles cancelled.
      const done = await recover(admin, { id: first, version: 1, actionId, action: 'cancel' })
      expect(done.ok, done.error).toBe(true)
      expect(done.data).toEqual({ success: true })
      const [op] = await supportDb()<{ state: string; version: number }[]>`
        SELECT state, version FROM integration_sync_operations WHERE id = ${first}`
      expect(op.state).toBe('cancelled')

      // The same request again (a double click, a retry): success, nothing more.
      const replay = await recover(admin, { id: first, version: 1, actionId, action: 'cancel' })
      expect(replay.data).toEqual({ success: true })
      const actions = await supportDb()`
        SELECT id FROM integration_sync_actions WHERE operation_id = ${first}`
      expect(actions).toHaveLength(1)
      const [after] = await supportDb()<{ version: number }[]>`
        SELECT version FROM integration_sync_operations WHERE id = ${first}`
      expect(after.version).toBe(op.version)

      // The action id of another operation is refused.
      const foreign = await recover(admin, { id: second, version: 1, actionId, action: 'cancel' })
      expect(foreign.ok).toBe(false)
      expect(foreign.code).toBe('SYNC_REQUEST_REJECTED')
      expect(foreign.error).toContain('Invalid recovery request')

      // A stale version is refused.
      const stale = await recover(admin, {
        id: second,
        version: 7,
        actionId: randomUUID(),
        action: 'cancel',
      })
      expect(stale.code).toBe('SYNC_REQUEST_REJECTED')
      expect(stale.error).toContain('This sync changed. Refresh and try again.')

      // A cancelled operation has nothing left to do.
      const gone = await recover(admin, {
        id: first,
        version: op.version,
        actionId: randomUUID(),
        action: 'cancel',
      })
      expect(gone.code).toBe('SYNC_REQUEST_REJECTED')
      expect(gone.error).toContain('This action is no longer available')

      // An operation that does not exist.
      const missing = await recover(admin, {
        id: randomUUID(),
        version: 1,
        actionId: randomUUID(),
        action: 'cancel',
      })
      expect(missing.code).toBe('SYNC_REQUEST_REJECTED')
      expect(missing.error).toContain('Sync item unavailable')

      // The second operation is untouched by all of it.
      const [untouched] = await supportDb()<{ state: string }[]>`
        SELECT state FROM integration_sync_operations WHERE id = ${second}`
      expect(untouched.state).toBe('conflict')
    } finally {
      await Promise.all([admin.dispose(), contributor.dispose()])
    }
  }
)
