/**
 * First-request catch-up when a workspace ledger is behind this build.
 *
 * The CP's vendored migrator can mint a database that the serving image cannot
 * query (explicit column lists). This is the request-path backstop.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BUNDLED_MIGRATIONS, latestBundledVersion } from '@quackback/db/schema-version'
import { WorkspaceSchemaFloorRefusal } from '../schema-floor'

const readAppliedLedger = vi.fn()
const runMigrations = vi.fn()

vi.mock('@quackback/db/schema-version', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@quackback/db/schema-version')>()
  return { ...actual, readAppliedLedger: (...args: unknown[]) => readAppliedLedger(...args) }
})

vi.mock('@quackback/db/migrate', () => ({
  runMigrations: (...args: unknown[]) => runMigrations(...args),
}))

vi.mock('@/lib/server/logger', () => ({
  logger: { child: () => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn() }) },
}))

function ledger(tags: string[]) {
  const when = new Set(BUNDLED_MIGRATIONS.filter((e) => tags.includes(e.tag)).map((e) => e.when))
  return {
    versions: when,
    count: when.size,
    max: when.size === 0 ? 0 : Math.max(...when),
  }
}

function allBut(...omit: string[]) {
  return BUNDLED_MIGRATIONS.filter((e) => !omit.includes(e.tag)).map((e) => e.tag)
}

describe('ensureWorkspaceSchemaCurrent', () => {
  beforeEach(() => {
    readAppliedLedger.mockReset()
    runMigrations.mockReset()
  })

  it('does not migrate when the ledger already records every bundled migration', async () => {
    const { ensureWorkspaceSchemaCurrent } = await import('../ensure-schema-current')
    readAppliedLedger.mockResolvedValue({
      versions: new Set(BUNDLED_MIGRATIONS.map((e) => e.when)),
      count: BUNDLED_MIGRATIONS.length,
      max: latestBundledVersion(),
    })
    await ensureWorkspaceSchemaCurrent({
      workspaceKey: 'inst_x',
      sql: {} as never,
      directConnectionString: 'postgresql://role:pw@direct.example/db',
    })
    expect(runMigrations).not.toHaveBeenCalled()
  })

  it('migrates a mint whose vendor snapshot stopped short of this build', async () => {
    const { ensureWorkspaceSchemaCurrent, missingBundledMigrations } =
      await import('../ensure-schema-current')
    const behind = ledger(allBut('0271_widget_installed_sdk_version', '0272_kb_url_id'))
    expect(missingBundledMigrations(behind)).toEqual([
      '0271_widget_installed_sdk_version',
      '0272_kb_url_id',
    ])
    readAppliedLedger.mockResolvedValueOnce(behind).mockResolvedValueOnce({
      versions: new Set(BUNDLED_MIGRATIONS.map((e) => e.when)),
      count: BUNDLED_MIGRATIONS.length,
      max: latestBundledVersion(),
    })
    runMigrations.mockResolvedValue({
      healed: [],
      unhealable: [],
      postconditions: { ok: true, violations: [], covers: [], observed: {} },
    })

    await ensureWorkspaceSchemaCurrent({
      workspaceKey: 'inst_new',
      sql: {} as never,
      directConnectionString: 'postgresql://role:pw@direct.example/db',
    })
    expect(runMigrations).toHaveBeenCalledWith('postgresql://role:pw@direct.example/db')
  })

  it('refuses to serve when migrate reports failing post-conditions', async () => {
    const { ensureWorkspaceSchemaCurrent } = await import('../ensure-schema-current')
    readAppliedLedger.mockResolvedValue(ledger(allBut('0271_widget_installed_sdk_version')))
    runMigrations.mockResolvedValue({
      healed: [],
      unhealable: [],
      postconditions: {
        ok: false,
        violations: [
          {
            kind: 'missing_column',
            detail: 'column public.settings.widget_installed_sdk_version is missing',
          },
        ],
        covers: [],
        observed: {},
      },
    })

    await expect(
      ensureWorkspaceSchemaCurrent({
        workspaceKey: 'inst_broken',
        sql: {} as never,
        directConnectionString: 'postgresql://role:pw@direct.example/db',
      })
    ).rejects.toBeInstanceOf(WorkspaceSchemaFloorRefusal)
  })
})
