/**
 * Unit tests for GET /api/export/runs/{runId}/download: audited, expiring
 * download of the finished workspace export ZIP.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createId } from '@quackback/ids'

const hoisted = vi.hoisted(() => ({
  mockValidateAccess: vi.fn(),
  mockGetExportRun: vi.fn(),
  mockGetTierLimits: vi.fn(),
  mockRecordAuditEvent: vi.fn(),
  mockGeneratePresignedGetUrl: vi.fn(),
  mockGetS3Object: vi.fn(),
  mockConfig: { s3Proxy: false as boolean },
}))

vi.mock('@/lib/server/functions/workspace', () => ({
  validateApiWorkspaceAccess: hoisted.mockValidateAccess,
}))

vi.mock('@/lib/server/auth', () => ({
  canAccess: (role: string, allowed: string[]) => allowed.includes(role),
}))

vi.mock('@/lib/server/domains/export/export-run.service', () => ({
  getExportRun: hoisted.mockGetExportRun,
}))

vi.mock('@/lib/server/domains/settings/tier-limits.service', () => ({
  getTierLimits: hoisted.mockGetTierLimits,
}))

vi.mock('@/lib/server/audit/log', () => ({
  recordAuditEvent: hoisted.mockRecordAuditEvent,
}))

vi.mock('@/lib/server/storage/s3', () => ({
  generatePresignedGetUrl: hoisted.mockGeneratePresignedGetUrl,
  getS3Object: hoisted.mockGetS3Object,
}))

vi.mock('@/lib/server/config', () => ({
  config: hoisted.mockConfig,
}))

import { handleDownloadExportRun } from '../runs.$runId.download'

function makeRequest(): Request {
  return { url: 'https://app.test/api/export/runs/x/download', headers: new Headers() } as Request
}

const RUN_ID = createId('export_run')

function completedRun(overrides: Record<string, unknown> = {}) {
  return {
    id: RUN_ID,
    status: 'completed',
    fileName: 'quackback-export-acme-2026-07-17.zip',
    s3Key: `exports/${RUN_ID}.zip`,
    sizeBytes: 4200,
    expiresAt: new Date(Date.now() + 86400_000),
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  hoisted.mockConfig.s3Proxy = false
  hoisted.mockValidateAccess.mockResolvedValue({
    success: true,
    principal: { id: 'principal_admin', role: 'admin', type: 'user' },
    user: { id: 'user_admin', email: 'admin@example.com' },
    settings: { slug: 'acme' },
  })
  hoisted.mockGetTierLimits.mockResolvedValue({ features: { analyticsExports: true } })
  hoisted.mockRecordAuditEvent.mockResolvedValue(undefined)
  hoisted.mockGeneratePresignedGetUrl.mockResolvedValue('https://s3.test/presigned')
})

describe('GET /api/export/runs/{runId}/download', () => {
  it('rejects non-admins', async () => {
    hoisted.mockValidateAccess.mockResolvedValue({
      success: true,
      principal: { id: 'principal_member', role: 'member', type: 'user' },
      user: { id: 'user_member', email: 'member@example.com' },
      settings: { slug: 'acme' },
    })
    const res = await handleDownloadExportRun(RUN_ID, makeRequest())
    expect(res.status).toBe(403)
  })

  it('rejects when the tier gate is off', async () => {
    hoisted.mockGetTierLimits.mockResolvedValue({ features: { analyticsExports: false } })
    const res = await handleDownloadExportRun(RUN_ID, makeRequest())
    expect(res.status).toBe(402)
  })

  it('400s on a malformed run id', async () => {
    const res = await handleDownloadExportRun('not-a-typeid', makeRequest())
    expect(res.status).toBe(400)
  })

  it('409s while the export is not ready', async () => {
    hoisted.mockGetExportRun.mockResolvedValue(completedRun({ status: 'running', s3Key: null }))
    const res = await handleDownloadExportRun(RUN_ID, makeRequest())
    expect(res.status).toBe(409)
  })

  it('410s once the artifact has expired', async () => {
    hoisted.mockGetExportRun.mockResolvedValue(
      completedRun({ expiresAt: new Date(Date.now() - 1000) })
    )
    const res = await handleDownloadExportRun(RUN_ID, makeRequest())
    expect(res.status).toBe(410)
    expect(hoisted.mockGeneratePresignedGetUrl).not.toHaveBeenCalled()
  })

  it('audits and 302s to a short-lived presigned URL with a friendly filename', async () => {
    hoisted.mockGetExportRun.mockResolvedValue(completedRun())
    const res = await handleDownloadExportRun(RUN_ID, makeRequest())

    expect(res.status).toBe(302)
    expect(res.headers.get('Location')).toBe('https://s3.test/presigned')
    expect(hoisted.mockGeneratePresignedGetUrl).toHaveBeenCalledWith(
      `exports/${RUN_ID}.zip`,
      900,
      'quackback-export-acme-2026-07-17.zip'
    )
    expect(hoisted.mockRecordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'export.workspace.downloaded',
        target: { type: 'export', id: RUN_ID },
      })
    )
  })

  it('streams through the server when S3 proxy mode is on', async () => {
    hoisted.mockConfig.s3Proxy = true
    hoisted.mockGetExportRun.mockResolvedValue(completedRun())
    hoisted.mockGetS3Object.mockResolvedValue({
      body: new ReadableStream(),
      contentType: 'application/zip',
    })

    const res = await handleDownloadExportRun(RUN_ID, makeRequest())
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('application/zip')
    expect(res.headers.get('Content-Disposition')).toContain('quackback-export-acme-2026-07-17.zip')
    expect(hoisted.mockGeneratePresignedGetUrl).not.toHaveBeenCalled()
  })
})
