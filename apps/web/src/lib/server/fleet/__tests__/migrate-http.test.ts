import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/server/fleet/migrator', () => ({
  migrateDirect: vi.fn(),
  planWorkspace: vi.fn(),
  requireWorkspace: vi.fn(),
  runReconcilePass: vi.fn(),
}))

vi.mock('@/lib/server/fleet/schema-state', () => ({
  explainUnclaimed: vi.fn(),
}))

vi.mock('@quackback/db/schema-version', () => ({
  BUNDLED_MIGRATIONS: [
    { when: 100, tag: '0001_one' },
    { when: 200, tag: '0002_two' },
  ],
  latestBundledVersion: () => 200,
  tagForVersion: (when: number) => (when === 200 ? '0002_two' : String(when)),
}))

import { handleMigrateBundle, handleMigratePlan, handleMigratePost } from '../migrate-http'
import { migrateDirect, planWorkspace, requireWorkspace, runReconcilePass } from '../migrator'
import { explainUnclaimed } from '../schema-state'

const TOKEN = 'fleet-internal-test-token'

function req(path: string, init: RequestInit = {}): Request {
  return new Request(`http://worker.example${path}`, init)
}

function authed(path: string, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers)
  headers.set('authorization', `Bearer ${TOKEN}`)
  return req(path, { ...init, headers })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('QUACKBACK_FLEET_INTERNAL_TOKEN', TOKEN)
  vi.stubEnv('QUACKBACK_ROLE', 'worker')
})

afterEach(() => {
  vi.unstubAllEnvs()
})

function postMigrate(body: unknown, init: RequestInit = {}): Request {
  return authed('/api/internal/fleet/migrate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    ...init,
  })
}

describe('role gate', () => {
  it('404s on a web replica so the public serving tier does not advertise the executor', async () => {
    vi.stubEnv('QUACKBACK_ROLE', 'web')
    const res = await handleMigrateBundle(authed('/api/internal/fleet/migrate/bundle'))
    expect(res.status).toBe(404)
  })

  it('404s POST /migrate on web before any DDL path runs', async () => {
    vi.stubEnv('QUACKBACK_ROLE', 'web')
    const res = await handleMigratePost(
      postMigrate({
        tenantId: 'inst_1',
        databaseUrl: 'postgresql://qb_x:s3cret@postgres.railway.internal:5432/qb_x',
      })
    )
    expect(res.status).toBe(404)
    expect(migrateDirect).not.toHaveBeenCalled()
    expect(runReconcilePass).not.toHaveBeenCalled()
  })

  it('answers on worker', async () => {
    const res = await handleMigrateBundle(authed('/api/internal/fleet/migrate/bundle'))
    expect(res.status).toBe(200)
  })
})

describe('auth', () => {
  it('401s without the fleet-internal token', async () => {
    const res = await handleMigrateBundle(req('/api/internal/fleet/migrate/bundle'))
    expect(res.status).toBe(401)
  })

  it('401s with the wrong token', async () => {
    const res = await handleMigrateBundle(
      req('/api/internal/fleet/migrate/bundle', { headers: { authorization: 'Bearer nope' } })
    )
    expect(res.status).toBe(401)
  })

  it('401s when the fleet token is unset even if a Bearer is presented', async () => {
    vi.stubEnv('QUACKBACK_FLEET_INTERNAL_TOKEN', '')
    const res = await handleMigratePost(
      postMigrate({ tenantId: 'inst_1', databaseUrl: 'postgresql://u:p@h/db' })
    )
    expect(res.status).toBe(401)
    expect(migrateDirect).not.toHaveBeenCalled()
  })

  it('401s a per-workspace CP token — that credential is a different bridge', async () => {
    const res = await handleMigratePost(
      req('/api/internal/fleet/migrate', {
        method: 'POST',
        headers: {
          authorization: 'Bearer cp-internal-token',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ tenantId: 'inst_1', databaseUrl: 'postgresql://u:p@h/db' }),
      })
    )
    expect(res.status).toBe(401)
    expect(migrateDirect).not.toHaveBeenCalled()
  })
})

describe('GET bundle', () => {
  it('returns this image’s lineage tip', async () => {
    const res = await handleMigrateBundle(authed('/api/internal/fleet/migrate/bundle'))
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({
      latestVersion: 200,
      latestTag: '0002_two',
      count: 2,
    })
  })
})

describe('POST migrate', () => {
  it('400s without a workspace key', async () => {
    const res = await handleMigratePost(postMigrate({}))
    expect(res.status).toBe(400)
  })

  it('400s when the JSON value is not an object', async () => {
    const res = await handleMigratePost(
      authed('/api/internal/fleet/migrate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: 'null',
      })
    )
    expect(res.status).toBe(400)
    expect(migrateDirect).not.toHaveBeenCalled()
  })

  it('400s a password-less DSN before connecting', async () => {
    const res = await handleMigratePost(
      postMigrate({
        tenantId: 'inst_1',
        databaseUrl: 'postgresql://qb_x@postgres.railway.internal:5432/qb_x',
      })
    )
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({ error: 'invalid_dsn' })
    expect(migrateDirect).not.toHaveBeenCalled()
  })

  it('413s a body larger than the cap even when Content-Length is understated', async () => {
    const res = await handleMigratePost(
      authed('/api/internal/fleet/migrate', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'content-length': '12' },
        body: `{"tenantId":"inst_1","pad":"${'x'.repeat(70 * 1024)}"}`,
      })
    )
    expect(res.status).toBe(413)
    expect(migrateDirect).not.toHaveBeenCalled()
  })

  it('uses the DSN path for provision (tenantId + databaseUrl)', async () => {
    vi.mocked(migrateDirect).mockResolvedValue({
      workspaceKey: 'inst_1',
      ok: true,
      code: 'reconciled',
      detail: 'applied 2',
      replaySet: ['0001_one', '0002_two'],
      durationMs: 12,
      before: { count: 0, max: 0, versions: new Set() },
      after: { count: 2, max: 200, versions: new Set([100, 200]) },
      gap: null,
      replayVerdicts: [],
      healedIndexes: [],
      unhealableIndexes: [],
      postconditions: null,
      lastStep: 'migrate',
    })
    const dsn = 'postgresql://qb_x:s3cret@postgres.railway.internal:5432/qb_x'
    const res = await handleMigratePost(
      postMigrate({
        tenantId: 'inst_1',
        databaseUrl: dsn,
        allowMutatingReplay: true,
      })
    )
    expect(res.status).toBe(200)
    expect(migrateDirect).toHaveBeenCalledWith('inst_1', dsn)
    expect(migrateDirect).toHaveBeenCalledTimes(1)
    expect(runReconcilePass).not.toHaveBeenCalled()
    const body = await res.json()
    expect(body).toMatchObject({ ok: true, code: 'reconciled', workspaceKey: 'inst_1' })
    expect(JSON.stringify(body)).not.toContain('postgresql://')
    expect(JSON.stringify(body)).not.toContain('s3cret')
  })

  it('reconciles via the lease when no DSN is supplied', async () => {
    vi.mocked(runReconcilePass).mockResolvedValue({
      claimed: 1,
      reconciled: 1,
      healed: 0,
      alreadyCurrent: 0,
      failed: 0,
      refusedRecords: 0,
      reaped: { requeued: 0, terminated: 0 },
      outcomes: [
        {
          workspaceKey: 'inst_1',
          ok: true,
          code: 'already_current',
          detail: 'up to date',
          replaySet: [],
          durationMs: 3,
          before: { count: 2, max: 200, versions: new Set() },
          after: { count: 2, max: 200, versions: new Set() },
          gap: null,
          replayVerdicts: [],
          healedIndexes: [],
          unhealableIndexes: [],
          postconditions: null,
          lastStep: 'preflight',
        },
      ],
    })
    const res = await handleMigratePost(
      authed('/api/internal/fleet/migrate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspaceKey: 'inst_1' }),
      })
    )
    expect(res.status).toBe(200)
    expect(runReconcilePass).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceKey: 'inst_1', concurrency: 1, maxWorkspaces: 1 })
    )
    expect(runReconcilePass).toHaveBeenCalledWith(
      expect.not.objectContaining({ allowMutatingReplay: true })
    )
    expect(migrateDirect).not.toHaveBeenCalled()
  })

  it('409s when the workspace cannot be claimed', async () => {
    vi.mocked(runReconcilePass).mockResolvedValue({
      claimed: 0,
      reconciled: 0,
      healed: 0,
      alreadyCurrent: 0,
      failed: 0,
      refusedRecords: 0,
      reaped: { requeued: 0, terminated: 0 },
      outcomes: [],
    })
    vi.mocked(explainUnclaimed).mockResolvedValue({
      kind: 'blocked',
      detail: 'inst_1 is blocked',
    })
    const res = await handleMigratePost(
      authed('/api/internal/fleet/migrate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspaceKey: 'inst_1' }),
      })
    )
    expect(res.status).toBe(409)
    await expect(res.json()).resolves.toMatchObject({ error: 'blocked' })
  })
})

describe('POST plan', () => {
  it('returns the same preflight the run uses', async () => {
    vi.mocked(requireWorkspace).mockResolvedValue({ workspaceKey: 'inst_1' } as never)
    vi.mocked(planWorkspace).mockResolvedValue({
      applied: { count: 2, max: 200, versions: new Set() },
      gap: null,
      replaySet: [],
      verdicts: [],
      refusal: null,
    })
    const res = await handleMigratePlan(
      authed('/api/internal/fleet/migrate/plan', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspaceKey: 'inst_1' }),
      })
    )
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({
      workspaceKey: 'inst_1',
      replaySet: [],
      refusal: null,
    })
  })
})
