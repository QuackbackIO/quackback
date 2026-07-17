/**
 * Unit tests for POST /api/export/workspace: starts the async workspace
 * export. Admin-only, tier-gated, one active run per deployment.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const hoisted = vi.hoisted(() => ({
  mockValidateAccess: vi.fn(),
  mockFindActiveExportRun: vi.fn(),
  mockCreateExportRun: vi.fn(),
  mockFailExportRun: vi.fn(),
  mockEnqueue: vi.fn(),
  mockGetTierLimits: vi.fn(),
  mockRecordAuditEvent: vi.fn(),
}))

vi.mock('@/lib/server/functions/workspace', () => ({
  validateApiWorkspaceAccess: hoisted.mockValidateAccess,
}))

vi.mock('@/lib/server/auth', () => ({
  canAccess: (role: string, allowed: string[]) => allowed.includes(role),
}))

vi.mock('@/lib/server/domains/export/export-run.service', () => ({
  findActiveExportRun: hoisted.mockFindActiveExportRun,
  createExportRun: hoisted.mockCreateExportRun,
  failExportRun: hoisted.mockFailExportRun,
}))

vi.mock('@/lib/server/domains/export/export-queue', () => ({
  enqueueWorkspaceExportJob: hoisted.mockEnqueue,
}))

vi.mock('@/lib/server/domains/settings/tier-limits.service', () => ({
  getTierLimits: hoisted.mockGetTierLimits,
}))

vi.mock('@/lib/server/audit/log', () => ({
  recordAuditEvent: hoisted.mockRecordAuditEvent,
}))

import { handleStartWorkspaceExport } from '../workspace'

function makeRequest(): Request {
  return { url: 'https://app.test/api/export/workspace', headers: new Headers() } as Request
}

const RUN = { id: 'export_run_01h455vb4pex5vsknk084sn02q', status: 'pending' }

beforeEach(() => {
  vi.clearAllMocks()
  hoisted.mockValidateAccess.mockResolvedValue({
    success: true,
    principal: { id: 'principal_admin', role: 'admin', type: 'user' },
    user: { id: 'user_admin', email: 'admin@example.com' },
    settings: { slug: 'acme' },
  })
  hoisted.mockGetTierLimits.mockResolvedValue({ features: { analyticsExports: true } })
  hoisted.mockFindActiveExportRun.mockResolvedValue(null)
  hoisted.mockCreateExportRun.mockResolvedValue(RUN)
  hoisted.mockEnqueue.mockResolvedValue(undefined)
  hoisted.mockRecordAuditEvent.mockResolvedValue(undefined)
})

describe('POST /api/export/workspace', () => {
  it('rejects non-admins', async () => {
    hoisted.mockValidateAccess.mockResolvedValue({
      success: true,
      principal: { id: 'principal_member', role: 'member', type: 'user' },
      user: { id: 'user_member', email: 'member@example.com' },
      settings: { slug: 'acme' },
    })
    const res = await handleStartWorkspaceExport(makeRequest())
    expect(res.status).toBe(403)
    expect(hoisted.mockCreateExportRun).not.toHaveBeenCalled()
  })

  it('rejects when the tier gate is off', async () => {
    hoisted.mockGetTierLimits.mockResolvedValue({ features: { analyticsExports: false } })
    const res = await handleStartWorkspaceExport(makeRequest())
    expect(res.status).toBe(402)
    expect(hoisted.mockCreateExportRun).not.toHaveBeenCalled()
  })

  it('returns 409 while another export is in flight', async () => {
    hoisted.mockFindActiveExportRun.mockResolvedValue({ id: 'export_run_active' })
    const res = await handleStartWorkspaceExport(makeRequest())
    expect(res.status).toBe(409)
    expect(hoisted.mockCreateExportRun).not.toHaveBeenCalled()
  })

  it('maps the unique-index race to 409', async () => {
    hoisted.mockCreateExportRun.mockRejectedValue({ code: '23505' })
    const res = await handleStartWorkspaceExport(makeRequest())
    expect(res.status).toBe(409)
    expect(hoisted.mockEnqueue).not.toHaveBeenCalled()
  })

  it('creates the run, enqueues the job, audits, and returns 202', async () => {
    const res = await handleStartWorkspaceExport(makeRequest())

    expect(res.status).toBe(202)
    const body = await res.json()
    expect(body.runId).toBe(RUN.id)

    expect(hoisted.mockCreateExportRun).toHaveBeenCalledWith({
      fileName: expect.stringMatching(/^quackback-export-acme-\d{4}-\d{2}-\d{2}\.zip$/),
      initiatedByPrincipalId: 'principal_admin',
    })
    expect(hoisted.mockEnqueue).toHaveBeenCalledWith({ runId: RUN.id, workspaceSlug: 'acme' })
    expect(hoisted.mockRecordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'export.workspace.requested',
        metadata: { runId: RUN.id },
      })
    )
  })

  it('fails the run instead of orphaning it when enqueue fails', async () => {
    hoisted.mockEnqueue.mockRejectedValue(new Error('redis down'))
    const res = await handleStartWorkspaceExport(makeRequest())
    expect(res.status).toBe(500)
    expect(hoisted.mockFailExportRun).toHaveBeenCalledWith(RUN.id, 'Failed to queue the export job')
  })
})
