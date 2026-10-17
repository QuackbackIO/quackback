import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { EventData } from '../types'
import type { HookContext } from '../hook-context'

const h = vi.hoisted(() => ({
  row: vi.fn(),
  deciders: vi.fn(),
  digest: vi.fn(),
  addresses: vi.fn(),
  preferences: vi.fn(),
}))
vi.mock('@/lib/server/domains/assistant/pending-actions.service', () => ({
  getPendingActionById: h.row,
}))
vi.mock('@/lib/server/domains/assistant/approvals.service', () => ({
  listEligibleDeciders: h.deciders,
  digestForDisplay: h.digest,
}))
vi.mock('@/lib/server/domains/subscriptions/subscription.service', () => ({
  batchGetNotificationPreferences: h.preferences,
}))
vi.mock('@/lib/server/email/recipient', () => ({ resolveContactRecipients: h.addresses }))
vi.mock('../targets', () => ({
  emailTarget: (email: string, unsubscribeUrl: string, config: object) => ({
    type: 'email',
    target: { email, unsubscribeUrl },
    config,
  }),
}))

import { getApprovalEmailTargets } from '../approval-email'

const event = {
  type: 'approval.requested',
  data: { approvalId: 'assistant_action_1' },
} as EventData
const context: HookContext = {
  portalBaseUrl: 'https://acme.test',
  workspaceName: 'Acme',
  logoUrl: null,
}

beforeEach(() => {
  vi.resetAllMocks()
  h.row.mockResolvedValue({ id: 'assistant_action_1', summary: 'Change branding' })
  h.deciders.mockResolvedValue(['principal_1', 'principal_2'])
  h.digest.mockResolvedValue('digest')
  h.addresses.mockResolvedValue(
    new Map([
      ['principal_1', 'one@acme.test'],
      ['principal_2', 'two@acme.test'],
    ])
  )
  h.preferences.mockResolvedValue(
    new Map([
      ['principal_1', {}],
      ['principal_2', {}],
    ])
  )
})

describe('approval email recipients', () => {
  it('emails eligible people with a link bound to the current content, without carrying a decision', async () => {
    const targets = await getApprovalEmailTargets(event, context)
    expect(targets).toHaveLength(2)
    expect(targets[0]).toMatchObject({
      type: 'email',
      target: { email: 'one@acme.test' },
      config: {
        summary: 'Change branding',
        reviewUrl:
          'https://acme.test/admin/approvals/confirm?id=assistant_action_1&d=digest&source=email',
      },
      deliveryKey: 'approval:assistant_action_1:principal_1:email',
    })
    expect(targets[0].config).not.toHaveProperty('approve')
  })

  it('honors the approval email preference and global email mute', async () => {
    h.preferences.mockResolvedValue(
      new Map([
        ['principal_1', { matrix: { approval_requested: { email: false } } }],
        ['principal_2', { emailMuted: true }],
      ])
    )
    expect(await getApprovalEmailTargets(event, context)).toEqual([])
  })

  it('does not notify when a request was decided or expired before dispatch', async () => {
    h.deciders.mockResolvedValue([])
    expect(await getApprovalEmailTargets(event, context)).toEqual([])
    expect(h.addresses).not.toHaveBeenCalled()
  })

  it('skips unreachable recipients', async () => {
    h.addresses.mockResolvedValue(new Map([['principal_2', 'two@acme.test']]))
    expect(await getApprovalEmailTargets(event, context)).toHaveLength(1)
  })
})
