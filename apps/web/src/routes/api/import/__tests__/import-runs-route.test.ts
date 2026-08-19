/**
 * Unit tests for the import run history + polling routes (§I1):
 * GET /api/import/runs and GET /api/import/runs/{runId}.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const hoisted = vi.hoisted(() => ({
  mockValidateAccess: vi.fn(),
  mockListImportRuns: vi.fn(),
  mockGetImportRun: vi.fn(),
}))

vi.mock('@/lib/server/functions/workspace', () => ({
  validateApiWorkspaceAccess: hoisted.mockValidateAccess,
}))

vi.mock('@/lib/server/auth', () => ({
  canAccess: (role: string, allowed: string[]) => allowed.includes(role),
}))

// The gate resolves the caller's assignment-derived set; model it with the
// legacy preset expansion (equivalent for preset holders).
vi.mock('@/lib/server/policy/permissions', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/server/policy/permissions')>()
  return {
    ...original,
    permissionsForPrincipal: vi.fn(async (_id: unknown, role: 'admin' | 'member' | 'user') =>
      original.permissionsForLegacyRole(role)
    ),
  }
})

vi.mock('@/lib/server/domains/import/import-run.service', () => ({
  listImportRuns: hoisted.mockListImportRuns,
  getImportRun: hoisted.mockGetImportRun,
}))

import { handleListImportRuns } from '../runs'
import { handleGetImportRun } from '../runs.$runId'

beforeEach(() => {
  vi.clearAllMocks()
  hoisted.mockValidateAccess.mockResolvedValue({
    success: true,
    principal: { id: 'principal_admin', role: 'admin' },
  })
})

describe('GET /api/import/runs', () => {
  it('denies non-admins', async () => {
    hoisted.mockValidateAccess.mockResolvedValue({
      success: true,
      principal: { id: 'principal_member', role: 'member' },
    })
    const res = await handleListImportRuns()
    expect(res.status).toBe(403)
    expect(hoisted.mockListImportRuns).not.toHaveBeenCalled()
  })

  it('returns the run history for admins', async () => {
    const runs = [{ id: 'import_run_1', status: 'completed' }]
    hoisted.mockListImportRuns.mockResolvedValue(runs)

    const res = await handleListImportRuns()

    expect(res.status).toBe(200)
    const body = (await res.json()) as { runs: unknown[] }
    expect(body.runs).toEqual(runs)
  })
})

describe('GET /api/import/runs/{runId}', () => {
  it('rejects a malformed run id', async () => {
    const res = await handleGetImportRun('not-a-typeid')
    expect(res.status).toBe(400)
    expect(hoisted.mockGetImportRun).not.toHaveBeenCalled()
  })

  it('returns 404 when the run does not exist', async () => {
    const { NotFoundError } = await import('@/lib/shared/errors')
    hoisted.mockGetImportRun.mockRejectedValue(
      new NotFoundError('IMPORT_RUN_NOT_FOUND', 'Import run not found')
    )

    const res = await handleGetImportRun('import_run_01h455vb4pex5vsknk084sn02q')

    expect(res.status).toBe(404)
  })

  it('returns the run for a valid id', async () => {
    const run = { id: 'import_run_01h455vb4pex5vsknk084sn02q', status: 'running' }
    hoisted.mockGetImportRun.mockResolvedValue(run)

    const res = await handleGetImportRun('import_run_01h455vb4pex5vsknk084sn02q')

    expect(res.status).toBe(200)
    const body = (await res.json()) as { run: unknown }
    expect(body.run).toEqual(run)
  })
})
