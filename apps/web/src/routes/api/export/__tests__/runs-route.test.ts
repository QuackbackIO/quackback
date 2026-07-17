/**
 * Unit tests for GET /api/export/runs and GET /api/export/runs/{runId}:
 * export history and single-run polling for the hub.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createId } from '@quackback/ids'

const hoisted = vi.hoisted(() => ({
  mockValidateAccess: vi.fn(),
  mockListExportRuns: vi.fn(),
  mockGetExportRun: vi.fn(),
}))

vi.mock('@/lib/server/functions/workspace', () => ({
  validateApiWorkspaceAccess: hoisted.mockValidateAccess,
}))

vi.mock('@/lib/server/auth', () => ({
  canAccess: (role: string, allowed: string[]) => allowed.includes(role),
}))

vi.mock('@/lib/server/domains/export/export-run.service', () => ({
  listExportRuns: hoisted.mockListExportRuns,
  getExportRun: hoisted.mockGetExportRun,
}))

import { NotFoundError } from '@/lib/shared/errors'
import { handleListExportRuns } from '../runs'
import { handleGetExportRun } from '../runs.$runId'

beforeEach(() => {
  vi.clearAllMocks()
  hoisted.mockValidateAccess.mockResolvedValue({
    success: true,
    principal: { id: 'principal_admin', role: 'admin', type: 'user' },
    user: { id: 'user_admin', email: 'admin@example.com' },
    settings: { slug: 'acme' },
  })
})

describe('GET /api/export/runs', () => {
  it('rejects non-admins', async () => {
    hoisted.mockValidateAccess.mockResolvedValue({
      success: true,
      principal: { id: 'principal_member', role: 'member', type: 'user' },
      user: { id: 'user_member', email: 'member@example.com' },
      settings: { slug: 'acme' },
    })
    const res = await handleListExportRuns()
    expect(res.status).toBe(403)
    expect(hoisted.mockListExportRuns).not.toHaveBeenCalled()
  })

  it('returns the run list', async () => {
    hoisted.mockListExportRuns.mockResolvedValue([{ id: 'export_run_a' }, { id: 'export_run_b' }])
    const res = await handleListExportRuns()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.runs).toHaveLength(2)
  })
})

describe('GET /api/export/runs/{runId}', () => {
  it('400s on a malformed run id', async () => {
    const res = await handleGetExportRun('not-a-typeid')
    expect(res.status).toBe(400)
    expect(hoisted.mockGetExportRun).not.toHaveBeenCalled()
  })

  it('404s on an unknown run', async () => {
    hoisted.mockGetExportRun.mockRejectedValue(new NotFoundError('EXPORT_RUN_NOT_FOUND', 'nope'))
    const res = await handleGetExportRun(createId('export_run'))
    expect(res.status).toBe(404)
  })

  it('returns the run', async () => {
    const id = createId('export_run')
    hoisted.mockGetExportRun.mockResolvedValue({ id, status: 'running' })
    const res = await handleGetExportRun(id)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.run.status).toBe('running')
  })
})
