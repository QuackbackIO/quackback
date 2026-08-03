import { createHmac } from 'crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = {
  ensureNotSuspended: vi.fn(),
  findManyIntegrations: vi.fn(),
  findFirstPostExternalLink: vi.fn(),
  parseStatusChange: vi.fn(),
  handleGitHubTicketEvent: vi.fn(),
  handleGitHubIssueCommentEvent: vi.fn(),
  changeStatus: vi.fn(),
  decryptSecrets: vi.fn(),
  eq: vi.fn(),
  and: vi.fn(),
}

vi.mock('@/lib/server/middleware/suspension-guard', () => ({
  ensureNotSuspended: (...args: unknown[]) => mocks.ensureNotSuspended(...args),
}))

vi.mock('@/lib/server/db', () => ({
  db: {
    query: {
      integrations: { findMany: (...args: unknown[]) => mocks.findManyIntegrations(...args) },
      postExternalLinks: {
        findFirst: (...args: unknown[]) => mocks.findFirstPostExternalLink(...args),
      },
    },
  },
  integrations: { integrationType: 'integrationType', status: 'status' },
  postExternalLinks: { integrationType: 'integrationType', externalId: 'externalId' },
  eq: (...args: unknown[]) => mocks.eq(...args),
  and: (...args: unknown[]) => mocks.and(...args),
}))

vi.mock('../index', () => ({
  getIntegration: vi.fn(() => ({
    inbound: {
      parseStatusChange: (...args: unknown[]) => mocks.parseStatusChange(...args),
    },
  })),
}))

vi.mock('../github/ticket-inbound', () => ({
  handleGitHubTicketEvent: (...args: unknown[]) => mocks.handleGitHubTicketEvent(...args),
  handleGitHubIssueCommentEvent: (...args: unknown[]) =>
    mocks.handleGitHubIssueCommentEvent(...args),
}))

vi.mock('../encryption', () => ({
  decryptSecrets: (...args: unknown[]) => mocks.decryptSecrets(...args),
}))

vi.mock('@/lib/server/domains/posts/post.status', () => ({
  changeStatus: (...args: unknown[]) => mocks.changeStatus(...args),
}))

import { handleInboundWebhook } from '../inbound-webhook-handler'

const WEBHOOK_SECRET = 'github-webhook-secret'

function makeGitHubIssuePayload(action: string) {
  return {
    action,
    issue: {
      number: 42,
      title: 'Feedback item',
      body: 'Body',
      html_url: 'https://github.com/org/repo/issues/42',
      state: action === 'closed' ? 'closed' : 'open',
      state_reason: action === 'closed' ? 'completed' : null,
    },
    repository: { full_name: 'org/repo' },
    sender: { login: 'octocat' },
  }
}

function makeGitHubIssueCommentPayload(action: string) {
  return {
    action,
    issue: {
      number: 42,
      html_url: 'https://github.com/org/repo/issues/42',
    },
    comment: {
      id: 1001,
      body: 'A public GitHub reply',
      html_url: 'https://github.com/org/repo/issues/42#issuecomment-1001',
      user: { login: 'octocat' },
    },
    repository: { full_name: 'org/repo' },
    sender: { login: 'octocat' },
  }
}

function makeSignedGitHubRequest(payload: unknown, event = 'issues'): Request {
  const body = JSON.stringify(payload)
  const signature = `sha256=${createHmac('sha256', WEBHOOK_SECRET).update(body).digest('hex')}`
  return new Request('https://app.example.com/api/integrations/github/webhook', {
    method: 'POST',
    headers: { 'X-Hub-Signature-256': signature, 'X-GitHub-Event': event },
    body,
  })
}

function mockGitHubIntegration(configOverrides: Record<string, unknown> = {}) {
  mocks.findManyIntegrations.mockResolvedValue([
    {
      id: 'integration_gh1',
      principalId: 'principal_bot1',
      integrationType: 'github',
      status: 'active',
      secrets: null,
      config: {
        channelId: 'org/repo',
        webhookSecret: WEBHOOK_SECRET,
        syncDirection: 'bidirectional',
        statusMappings: { Open: 'status_open', Closed: 'status_closed' },
        ...configOverrides,
      },
    },
  ])
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.ensureNotSuspended.mockResolvedValue(undefined)
  mocks.eq.mockReturnValue({})
  mocks.and.mockReturnValue({})
  mocks.decryptSecrets.mockReturnValue({})
  mockGitHubIntegration()
  mocks.findFirstPostExternalLink.mockResolvedValue({ postId: 'post_1' })
  mocks.parseStatusChange.mockResolvedValue({
    externalId: '42',
    externalStatus: 'Closed',
    eventType: 'issues.closed',
  })
  mocks.handleGitHubTicketEvent.mockResolvedValue(true)
  mocks.handleGitHubIssueCommentEvent.mockResolvedValue(true)
  mocks.changeStatus.mockResolvedValue({})
})

describe('handleInboundWebhook — GitHub post status sync', () => {
  it('still applies post status mappings when the ticket handler handles the issue event', async () => {
    const response = await handleInboundWebhook(
      makeSignedGitHubRequest(makeGitHubIssuePayload('closed')),
      'github'
    )

    expect(response.status).toBe(200)
    expect(mocks.handleGitHubTicketEvent).toHaveBeenCalled()
    expect(mocks.parseStatusChange).toHaveBeenCalled()
    expect(mocks.changeStatus).toHaveBeenCalledWith(
      'post_1',
      'status_closed',
      expect.objectContaining({
        principalId: 'principal_bot1',
        displayName: 'github Integration',
      })
    )
  })

  it('ignores unmapped GitHub statuses', async () => {
    mockGitHubIntegration({ statusMappings: { Open: 'status_open' } })

    const response = await handleInboundWebhook(
      makeSignedGitHubRequest(makeGitHubIssuePayload('closed')),
      'github'
    )

    expect(response.status).toBe(200)
    expect(mocks.changeStatus).not.toHaveBeenCalled()
  })

  it('routes issue_comment events to ticket comment sync without post status parsing', async () => {
    const response = await handleInboundWebhook(
      makeSignedGitHubRequest(makeGitHubIssueCommentPayload('created'), 'issue_comment'),
      'github'
    )

    expect(response.status).toBe(200)
    expect(mocks.handleGitHubIssueCommentEvent).toHaveBeenCalled()
    expect(mocks.handleGitHubTicketEvent).not.toHaveBeenCalled()
    expect(mocks.parseStatusChange).not.toHaveBeenCalled()
    expect(mocks.changeStatus).not.toHaveBeenCalled()
  })

  it('returns 500 when issue_comment ticket sync fails', async () => {
    mocks.handleGitHubIssueCommentEvent.mockRejectedValueOnce(new Error('comment sync failed'))

    const response = await handleInboundWebhook(
      makeSignedGitHubRequest(makeGitHubIssueCommentPayload('created'), 'issue_comment'),
      'github'
    )

    expect(response.status).toBe(500)
    expect(mocks.parseStatusChange).not.toHaveBeenCalled()
  })

  it('returns 500 when issue ticket sync fails and no post status mapping applies', async () => {
    mocks.handleGitHubTicketEvent.mockRejectedValueOnce(new Error('ticket sync failed'))
    mocks.parseStatusChange.mockResolvedValueOnce(null)

    const response = await handleInboundWebhook(
      makeSignedGitHubRequest(makeGitHubIssuePayload('edited')),
      'github'
    )

    expect(response.status).toBe(500)
    expect(mocks.parseStatusChange).toHaveBeenCalled()
  })

  it('keeps legacy post status sync working when issue ticket sync fails', async () => {
    mocks.handleGitHubTicketEvent.mockRejectedValueOnce(new Error('ticket sync failed'))

    const response = await handleInboundWebhook(
      makeSignedGitHubRequest(makeGitHubIssuePayload('closed')),
      'github'
    )

    expect(response.status).toBe(200)
    expect(mocks.changeStatus).toHaveBeenCalledWith(
      'post_1',
      'status_closed',
      expect.objectContaining({ principalId: 'principal_bot1' })
    )
  })
})
