/**
 * Unit tests for GET /api/export/conversations (§I3): admin-only,
 * audit-logged NDJSON export of full conversation content.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const hoisted = vi.hoisted(() => ({
  mockValidateAccess: vi.fn(),
  mockListConversationsForExport: vi.fn(),
  mockGetTierLimits: vi.fn(),
  mockRecordAuditEvent: vi.fn(),
}))

vi.mock('@/lib/server/functions/workspace', () => ({
  validateApiWorkspaceAccess: hoisted.mockValidateAccess,
}))

vi.mock('@/lib/server/auth', () => ({
  canAccess: (role: string, allowed: string[]) => allowed.includes(role),
}))

vi.mock('@/lib/server/domains/conversation/conversation.export', () => ({
  listConversationsForExport: hoisted.mockListConversationsForExport,
}))

vi.mock('@/lib/server/domains/settings/tier-limits.service', () => ({
  getTierLimits: hoisted.mockGetTierLimits,
}))

vi.mock('@/lib/server/audit/log', () => ({
  recordAuditEvent: hoisted.mockRecordAuditEvent,
}))

import { handleExportConversations } from '../export.conversations'

function makeRequest(): Request {
  return { url: 'https://app.test/api/export/conversations', headers: new Headers() } as Request
}

beforeEach(() => {
  vi.clearAllMocks()
  hoisted.mockValidateAccess.mockResolvedValue({
    success: true,
    principal: { id: 'principal_admin', role: 'admin', type: 'user' },
    user: { id: 'user_admin', email: 'admin@example.com' },
    settings: { slug: 'acme' },
  })
  hoisted.mockGetTierLimits.mockResolvedValue({ features: { analyticsExports: true } })
  hoisted.mockRecordAuditEvent.mockResolvedValue(undefined)
})

describe('GET /api/export/conversations', () => {
  it('rejects non-admins', async () => {
    hoisted.mockValidateAccess.mockResolvedValue({
      success: true,
      principal: { id: 'principal_member', role: 'member', type: 'user' },
      user: { id: 'user_member', email: 'member@example.com' },
      settings: { slug: 'acme' },
    })
    const res = await handleExportConversations(makeRequest())
    expect(res.status).toBe(403)
    expect(hoisted.mockListConversationsForExport).not.toHaveBeenCalled()
  })

  it('streams NDJSON and records an audit event', async () => {
    hoisted.mockListConversationsForExport.mockResolvedValue([
      { id: 'conversation_1', status: 'open', channel: 'widget' },
      { id: 'conversation_2', status: 'closed', channel: 'widget' },
    ])

    const res = await handleExportConversations(makeRequest())

    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('application/x-ndjson')
    const body = await res.text()
    const lines = body.split('\n')
    expect(lines).toHaveLength(2)
    expect(JSON.parse(lines[0])).toMatchObject({ id: 'conversation_1' })

    expect(hoisted.mockRecordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'export.conversations.downloaded',
        metadata: { count: 2 },
      })
    )
  })
})
