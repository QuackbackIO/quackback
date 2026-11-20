/**
 * The paths that read a teammate's role straight from the principal row, not
 * through `requireAuth`, and a paused seat (the plan has fewer team seats than
 * members, after the grace): workspace import and export access, the current
 * user's role, the admin uploads and the Slack agent's actor.
 *
 * The plan limits answer is a stand-in keyed on the principal it is asked
 * about, exactly as the real `isSeatPaused`; the real answer (owner and
 * billing rights never paused, inert in grace and without plan billing) is proved
 * against a database in plan-limits.team.db.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SEAT_PAUSED_DENIAL } from '@/lib/shared/billing/seat-paused'

const hoisted = vi.hoisted(() => ({
  paused: new Set<string>(),
  principal: { id: 'principal_1', role: 'admin', type: 'user' },
}))

vi.mock('@/lib/server/domains/plan-limits/plan-limits.service', () => ({
  isSeatPaused: async (principalId: string) => hoisted.paused.has(principalId),
}))
const session = {
  session: { scope: 'dashboard' },
  user: { id: 'user_1', email: 'alex@example.com', name: 'Alex' },
}
vi.mock('@/lib/server/auth/session', () => ({ getSession: async () => session }))
vi.mock('@/lib/server/auth', () => ({ auth: { api: { getSession: async () => session } } }))
vi.mock('@/lib/server/auth/request-session', () => ({
  IDENTITY_MEMO_PREFIX: 'identity:',
  getRequestPrincipal: async () => hoisted.principal,
}))
vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: {
    query: {
      settings: { findFirst: async () => ({ id: 'workspace_1' }) },
      principal: { findFirst: async () => hoisted.principal },
    },
  },
}))
vi.mock('@/lib/server/domains/files/files.upload', () => ({
  handleFileUploadRequest: async () => Response.json({ ok: true }, { status: 200 }),
}))
vi.mock('@/lib/server/storage/s3', () => ({
  isS3Usable: () => false,
  uploadMediaFromFormData: async () => ({}),
}))
vi.mock('@/lib/server/policy/permissions', () => ({
  permissionsForPrincipal: async () => new Set(['settings.manage']),
}))
vi.mock('@/lib/server/logger', () => ({
  logger: { child: () => ({ debug: vi.fn(), error: vi.fn(), warn: vi.fn(), info: vi.fn() }) },
}))

const { validateApiWorkspaceAccess, getCurrentUserRole } = await import('../workspace')
const { handleAgentFileUpload } = await import('@/routes/api/upload/file')
const { handleAdminUpload } = await import('@/routes/api/upload/image')
const { slackMemberActor } = await import('@/integrations/slack/server/agent/identity')

const upload = () => new Request('http://test/api/upload', { method: 'POST' })

beforeEach(() => {
  hoisted.paused.clear()
})

describe('a seat holder', () => {
  it('keeps workspace access, their role, the uploads and a full Slack actor', async () => {
    expect(await validateApiWorkspaceAccess()).toMatchObject({ success: true })
    expect(await getCurrentUserRole()).toBe('admin')
    expect((await handleAgentFileUpload({ request: upload() })).status).toBe(200)
    // Storage is off here, so a holder gets as far as the storage check.
    expect((await handleAdminUpload({ request: upload() })).status).toBe(503)
    const actor = await slackMemberActor({
      id: 'principal_1' as never,
      role: 'admin',
      displayName: null,
    })
    expect(actor.role).toBe('admin')
    expect([...(actor.permissions ?? [])]).toEqual(['settings.manage'])
  })
})

describe('a paused seat', () => {
  beforeEach(() => {
    hoisted.paused.add('principal_1')
  })

  it('gets the paused-seat 403 for workspace import and export', async () => {
    expect(await validateApiWorkspaceAccess()).toEqual({
      success: false,
      error: SEAT_PAUSED_DENIAL,
      status: 403,
    })
  })

  it('is a portal user to the current-role read', async () => {
    expect(await getCurrentUserRole()).toBe('user')
  })

  it('cannot upload as a teammate', async () => {
    for (const handler of [handleAgentFileUpload, handleAdminUpload]) {
      const res = await handler({ request: upload() })
      expect(res.status).toBe(403)
      expect(await res.json()).toEqual({ error: SEAT_PAUSED_DENIAL })
    }
  })

  it('acts in Slack as a portal user with no team authority', async () => {
    const actor = await slackMemberActor({
      id: 'principal_1' as never,
      role: 'admin',
      displayName: null,
    })
    expect(actor.role).toBe('user')
    expect(actor.permissions?.size).toBe(0)
  })
})
