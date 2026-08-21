/**
 * `isProvisionedWorkspace` — the fact that decides whether arriving at a
 * workspace is a way to take ownership of it.
 *
 * Run against real Postgres because every input is a row read with real SQL:
 * a column that may not exist on the database being asked, a `text` column
 * holding JSON that this code parses itself, and the number of rows in
 * `settings`. A double answers all three from one stub and therefore cannot
 * tell them apart.
 *
 * ## What these are actually about: the direction on "cannot tell"
 *
 * The module's own rule is that a caller who could not read the answer must not
 * act as though the answer were "no". It held that rule for a failed query and
 * broke it for the input that matters most — a metadata bag that reads back but
 * does not parse — where a `catch` returned "not provisioned", i.e. **open to
 * whoever arrives first**.
 *
 * That is not theoretical. Workspaces provisioned by current control-plane code
 * carry their stamp ONLY in that bag (the dedicated column is NULL on them), and
 * `telemetry/instance-id.ts` used to read the whole bag, add a key, and write
 * the whole object back with no lock — so a lost race left a provisioned
 * workspace reading as self-hosted permanently.
 *
 * Every refusing case below is paired with the control that separates "this
 * predicate is deciding on the input" from "this predicate refuses everything".
 *
 * The stamp column ships in migration 0258 and the local development database
 * predates it, so it is added inside the test transaction: the column, the
 * values and the `to_jsonb` read are the real ones and all roll back.
 */
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'
import { createId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { settings, sql } from '@/lib/server/db'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

// No workspace scope in this process: the pooled short-circuit at the top of
// the predicate would otherwise answer before any row is read, and the cohort
// this file is about is the single-tenant one that never has a scope.
vi.mock('../workspace-context', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../workspace-context')>()),
  getCurrentWorkspace: () => undefined,
}))

const { isProvisionedWorkspace } = await import('../provenance')

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: settings.id }).from(settings).limit(0)
    // Migration 0258's column, probed rather than created. `ALTER TABLE` from
    // inside the fixture's transaction would hold ACCESS EXCLUSIVE on
    // `settings` for the whole test, and two suites doing that at once deadlock.
    await db.execute(sql`select cloud_workspace_key from settings limit 0`)
  },
})

async function seed(metadata: string | null): Promise<void> {
  await testDb.insert(settings).values({
    id: createId('workspace'),
    name: 'Acme',
    slug: `acme-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date(),
    metadata,
  })
}

async function stampColumn(value: string | null): Promise<void> {
  await testDb.execute(sql`UPDATE settings SET cloud_workspace_key = ${value}`)
}

describe.skipIf(!fixture.available)('isProvisionedWorkspace', () => {
  beforeEach(async () => {
    await fixture.begin()
    vi.clearAllMocks()
  })
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  describe('the two live stamp homes', () => {
    // What current provisioning writes: the bag, with the column NULL.
    it('reads the bag as provisioned even with the column null', async () => {
      await seed(JSON.stringify({ cloudTenant: { v: 1, workspaceKey: 'ws_acme', stampedAt: '' } }))
      await stampColumn(null)

      expect(await isProvisionedWorkspace(testDb)).toBe(true)
    })

    // The older bag shape, which names the workspace differently under the same
    // declared version. The predicate is presence-only for exactly this reason.
    it('reads the older bag shape as provisioned too', async () => {
      await seed(JSON.stringify({ cloudTenant: { v: 1, tenantId: 'ws_acme', stampedAt: '' } }))

      expect(await isProvisionedWorkspace(testDb)).toBe(true)
    })

    it('reads the dedicated column as provisioned with no bag at all', async () => {
      await seed(null)
      await stampColumn('ws_acme')

      expect(await isProvisionedWorkspace(testDb)).toBe(true)
    })

    // The control for all three: a settings row with neither is an install.
    it('reads a row with neither as self-hosted', async () => {
      await seed(JSON.stringify({ instanceId: 'abc' }))
      await stampColumn(null)

      expect(await isProvisionedWorkspace(testDb)).toBe(false)
    })

    // The product's first run, before anything has been set up.
    it('reads no settings row at all as self-hosted', async () => {
      expect(await isProvisionedWorkspace(testDb)).toBe(false)
    })
  })

  describe('when the fact cannot be determined', () => {
    // The bag that reads but does not parse. A provisioned workspace whose only
    // stamp is in here must not become claimable because nobody can read it.
    it('does not read an unparseable bag as self-hosted', async () => {
      await seed('{"cloudTenant": {"v": 1, "workspaceKey": "ws_acme"')

      expect(await isProvisionedWorkspace(testDb)).toBe(true)
    })

    it('does not read a bag holding a non-object as self-hosted', async () => {
      await seed('"just a string"')

      expect(await isProvisionedWorkspace(testDb)).toBe(true)
    })

    // A `settings` table with more than one row is a database this code cannot
    // reason about, and the arbitrary row a bare LIMIT 1 returns is chosen by
    // the planner. Half of those answers hand the workspace to a stranger.
    it('does not pick an arbitrary row out of a non-singleton settings table', async () => {
      await seed(JSON.stringify({ cloudTenant: { v: 1, workspaceKey: 'ws_acme', stampedAt: '' } }))
      await seed(null)

      expect(await isProvisionedWorkspace(testDb)).toBe(true)
    })

    // Same shape, opposite order, so a suite that happened to be right because
    // of insertion order fails here.
    it('answers the same way whichever unstamped row was inserted first', async () => {
      await seed(null)
      await seed(JSON.stringify({ cloudTenant: { v: 1, workspaceKey: 'ws_acme', stampedAt: '' } }))

      expect(await isProvisionedWorkspace(testDb)).toBe(true)
    })

    // The control that stops the two above from being "more than one row is
    // always provisioned for some other reason": two rows, neither stamped, is
    // still not an answer anybody can act on.
    it('refuses a non-singleton table even when nothing in it is stamped', async () => {
      await seed(null)
      await seed(null)

      expect(await isProvisionedWorkspace(testDb)).toBe(true)
    })

    // An empty bag is a determinate answer, not an unreadable one.
    it('still reads an empty metadata string as self-hosted', async () => {
      await seed('')

      expect(await isProvisionedWorkspace(testDb)).toBe(false)
    })
  })
})
