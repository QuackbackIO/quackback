import { createHmac } from 'crypto'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { jiraInboundHandler } from '../inbound'

const SECRET = 'jira-client-secret'

vi.mock('@/lib/server/domains/platform-credentials/platform-credential.service', () => ({
  getPlatformCredentials: vi.fn(async () => ({ clientSecret: SECRET })),
}))

vi.mock('@/integrations/jira/server/issues', () => ({
  getJiraIssueStatus: vi.fn(),
}))

import { getJiraIssueStatus } from '@/integrations/jira/server/issues'

const config = {
  cloudId: 'cloud-1',
  siteUrl: 'https://acme.atlassian.net',
  channelId: '10000:10004',
}
const secrets = { accessToken: 'jira-token' }

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getJiraIssueStatus).mockReset()
  vi.mocked(getJiraIssueStatus).mockResolvedValue({
    key: 'PROJ-12',
    status: 'Done',
    projectId: '10000',
    projectKey: 'PROJ',
    updated: '2026-11-24T13:07:35.977+0000',
  })
})

function bearerJwt(secret = SECRET, claims: Record<string, unknown> = {}) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const payload = Buffer.from(
    JSON.stringify({ iss: 'jira', exp: Math.floor(Date.now() / 1000) + 3600, ...claims })
  ).toString('base64url')
  const data = `${header}.${payload}`
  const signature = createHmac('sha256', secret).update(data).digest('base64url')
  return `${data}.${signature}`
}

describe('jiraInboundHandler.verifySignature', () => {
  it('accepts a bearer JWT signed with the Jira client secret', async () => {
    const token = bearerJwt()
    const request = new Request('https://app.example.com/hook', {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(await jiraInboundHandler.verifySignature(request, '', '')).toBe(true)
  })

  it('rejects a missing bearer token', async () => {
    const request = new Request('https://app.example.com/hook')
    const result = await jiraInboundHandler.verifySignature(request, '', '')
    expect(result).toBeInstanceOf(Response)
    expect((result as Response).status).toBe(401)
  })

  it('rejects a JWT signed with the wrong secret', async () => {
    const token = bearerJwt('other-secret')
    const request = new Request('https://app.example.com/hook', {
      headers: { Authorization: `Bearer ${token}` },
    })
    const result = await jiraInboundHandler.verifySignature(request, '', '')
    expect(result).toBeInstanceOf(Response)
    expect((result as Response).status).toBe(401)
  })

  it('does not require X-Hub-Signature', async () => {
    const token = bearerJwt()
    const request = new Request('https://app.example.com/hook', {
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(request.headers.get('X-Hub-Signature')).toBeNull()
    expect(await jiraInboundHandler.verifySignature(request, '', '')).toBe(true)
  })

  it('rejects an expired JWT beyond clock skew', async () => {
    const token = bearerJwt(SECRET, { exp: Math.floor(Date.now() / 1000) - 120 })
    const request = new Request('https://app.example.com/hook', {
      headers: { Authorization: `Bearer ${token}` },
    })
    const result = await jiraInboundHandler.verifySignature(request, '', '')
    expect(result).toBeInstanceOf(Response)
    expect((result as Response).status).toBe(401)
  })

  it('accepts a JWT with no exp claim when the signature is valid', async () => {
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
    const payload = Buffer.from(JSON.stringify({ iss: 'jira' })).toString('base64url')
    const data = `${header}.${payload}`
    const signature = createHmac('sha256', SECRET).update(data).digest('base64url')
    const request = new Request('https://app.example.com/hook', {
      headers: { Authorization: `Bearer ${data}.${signature}` },
    })
    expect(await jiraInboundHandler.verifySignature(request, '', '')).toBe(true)
  })
})

describe('jiraInboundHandler.parseStatusChange', () => {
  /** A trimmed `jira:issue_updated` delivery. */
  function statusPayload(
    overrides: { issue?: Record<string, unknown>; items?: unknown[]; webhookEvent?: string } = {}
  ) {
    return {
      timestamp: 1795525655977,
      webhookEvent: overrides.webhookEvent ?? 'jira:issue_updated',
      issue: overrides.issue ?? { id: '10042', key: 'PROJ-12' },
      changelog: {
        items: overrides.items ?? [
          { field: 'assignee' },
          { field: 'status', fromString: 'In Progress', toString: 'Done' },
        ],
      },
    }
  }

  function parse(
    payload: unknown,
    cfg: Record<string, unknown> = config,
    sec: Record<string, unknown> = secrets
  ) {
    return jiraInboundHandler.parseStatusChange(JSON.stringify(payload), cfg, sec)
  }

  it('declares automatic status handling', () => {
    expect(jiraInboundHandler.statusMode).toBe('automatic')
  })

  it('reads the issue back by its stable id from the connected site', async () => {
    // externalId stays the event key: links store the key the issue had when linked.
    expect(await parse(statusPayload())).toEqual({
      externalId: 'PROJ-12',
      externalStatus: 'Done',
      eventType: 'jira:issue_updated',
      destinationId: '10000:10004',
      occurredAt: '2026-11-24T13:07:35.977Z',
    })
    expect(getJiraIssueStatus).toHaveBeenCalledWith('jira-token', 'cloud-1', '10042')
  })

  it('reads back by key when the event has no issue id', async () => {
    await parse(statusPayload({ issue: { key: 'PROJ-12' } }))
    expect(getJiraIssueStatus).toHaveBeenCalledWith('jira-token', 'cloud-1', 'PROJ-12')
  })

  it('uses the read-back status and time, not the unsigned event', async () => {
    vi.mocked(getJiraIssueStatus).mockResolvedValue({
      status: 'In Review',
      projectId: '10000',
      projectKey: 'PROJ',
      updated: '2026-11-24T14:00:00.000-0530',
    })
    expect(await parse(statusPayload())).toMatchObject({
      externalStatus: 'In Review',
      occurredAt: '2026-11-24T19:30:00.000Z',
    })
  })

  it('returns null when the event key names a different issue than its id', async () => {
    vi.mocked(getJiraIssueStatus).mockResolvedValue({
      key: 'PROJ-7',
      status: 'Done',
      projectId: '10000',
      projectKey: 'PROJ',
    })
    expect(await parse(statusPayload())).toBeNull()
  })

  it('matches the read-back key case-insensitively', async () => {
    const result = await parse(statusPayload({ issue: { id: '10042', key: 'proj-12' } }))
    expect(result).toMatchObject({ externalId: 'proj-12', destinationId: '10000:10004' })
  })

  it('omits the destination when the read-back has no key', async () => {
    vi.mocked(getJiraIssueStatus).mockResolvedValue({
      status: 'Done',
      projectId: '10000',
      projectKey: 'PROJ',
    })
    const result = await parse(statusPayload())
    expect(result).toMatchObject({ externalStatus: 'Done' })
    expect(result).not.toHaveProperty('destinationId', expect.anything())
  })

  it('returns null when the issue belongs to another project', async () => {
    vi.mocked(getJiraIssueStatus).mockResolvedValue({
      status: 'Done',
      projectId: '10001',
      projectKey: 'OTHER',
      updated: '2026-11-24T13:07:35.977+0000',
    })
    expect(await parse(statusPayload())).toBeNull()
  })

  it('does not match a numeric project id against a project key', async () => {
    vi.mocked(getJiraIssueStatus).mockResolvedValue({
      status: 'Done',
      projectId: '10001',
      projectKey: '10000',
    })
    expect(await parse(statusPayload())).toBeNull()
  })

  it('matches a legacy project key reference case-insensitively', async () => {
    const cfg = { ...config, channelId: 'proj' }
    expect(await parse(statusPayload(), cfg)).toMatchObject({ destinationId: 'proj' })
    vi.mocked(getJiraIssueStatus).mockResolvedValue({
      status: 'Done',
      projectId: '10000',
      projectKey: 'OTHER',
    })
    expect(await parse(statusPayload(), cfg)).toBeNull()
  })

  it('omits the destination when no project is configured', async () => {
    const result = await parse(statusPayload(), { cloudId: 'cloud-1' })
    expect(result).toMatchObject({ externalStatus: 'Done' })
    expect(result).not.toHaveProperty('destinationId', expect.anything())
  })

  it('omits the destination when the read-back has no project', async () => {
    vi.mocked(getJiraIssueStatus).mockResolvedValue({ status: 'Done' })
    const result = await parse(statusPayload())
    expect(result).toMatchObject({ externalStatus: 'Done' })
    expect(result).not.toHaveProperty('destinationId', expect.anything())
  })

  it('returns null for an issue that is gone or not visible', async () => {
    vi.mocked(getJiraIssueStatus).mockResolvedValue(null)
    expect(await parse(statusPayload())).toBeNull()
  })

  it('returns null when the read-back has no status', async () => {
    vi.mocked(getJiraIssueStatus).mockResolvedValue({ projectId: '10000', projectKey: 'PROJ' })
    expect(await parse(statusPayload())).toBeNull()
  })

  it('throws other read-back failures so the receipt is retried', async () => {
    vi.mocked(getJiraIssueStatus).mockRejectedValue(
      Object.assign(new Error('Rate limited by Jira API.'), { status: 429 })
    )
    await expect(parse(statusPayload())).rejects.toThrow('Rate limited')
  })

  it('omits the revision time when it is missing or invalid', async () => {
    for (const updated of [undefined, 'not-a-date']) {
      vi.mocked(getJiraIssueStatus).mockResolvedValue({
        status: 'Done',
        projectId: '10000',
        projectKey: 'PROJ',
        updated,
      })
      const result = await parse(statusPayload())
      expect(result).not.toHaveProperty('occurredAt', expect.anything())
    }
  })

  it('falls back to review without a cloud id or token', async () => {
    for (const [cfg, sec] of [
      [{ channelId: '10000:10004' }, secrets],
      [config, {}],
    ]) {
      expect(await parse(statusPayload(), cfg, sec)).toEqual({
        externalId: 'PROJ-12',
        externalStatus: 'Done',
        eventType: 'jira:issue_updated',
      })
    }
    expect(getJiraIssueStatus).not.toHaveBeenCalled()
  })

  it('ignores updates that are not a status change', async () => {
    const payload = statusPayload({ items: [{ field: 'summary', toString: 'new title' }] })
    expect(await parse(payload)).toBeNull()
    expect(getJiraIssueStatus).not.toHaveBeenCalled()
  })

  it('ignores non-update events', async () => {
    expect(await parse(statusPayload({ webhookEvent: 'jira:issue_created' }))).toBeNull()
    expect(getJiraIssueStatus).not.toHaveBeenCalled()
  })

  it('ignores events without an issue key', async () => {
    expect(await parse(statusPayload({ issue: { id: '10042' } }))).toBeNull()
    expect(getJiraIssueStatus).not.toHaveBeenCalled()
  })
})
