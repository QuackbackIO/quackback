import { createHmac } from 'crypto'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { jiraInboundHandler } from '../inbound'

const SECRET = 'jira-client-secret'

vi.mock('@/lib/server/domains/platform-credentials/platform-credential.service', () => ({
  getPlatformCredentials: vi.fn(async () => ({ clientSecret: SECRET })),
}))

beforeEach(() => {
  vi.clearAllMocks()
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

  it('rejects an expired JWT', async () => {
    const token = bearerJwt(SECRET, { exp: Math.floor(Date.now() / 1000) - 30 })
    const request = new Request('https://app.example.com/hook', {
      headers: { Authorization: `Bearer ${token}` },
    })
    const result = await jiraInboundHandler.verifySignature(request, '', '')
    expect(result).toBeInstanceOf(Response)
    expect((result as Response).status).toBe(401)
  })

  it('rejects a JWT with no exp claim', async () => {
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
    const payload = Buffer.from(JSON.stringify({ iss: 'jira' })).toString('base64url')
    const data = `${header}.${payload}`
    const signature = createHmac('sha256', SECRET).update(data).digest('base64url')
    const request = new Request('https://app.example.com/hook', {
      headers: { Authorization: `Bearer ${data}.${signature}` },
    })
    const result = await jiraInboundHandler.verifySignature(request, '', '')
    expect(result).toBeInstanceOf(Response)
    expect((result as Response).status).toBe(401)
  })
})

describe('jiraInboundHandler.parseStatusChange', () => {
  it('extracts a status change from jira:issue_updated', async () => {
    const result = await jiraInboundHandler.parseStatusChange(
      JSON.stringify({
        webhookEvent: 'jira:issue_updated',
        issue: { key: 'PROJ-12' },
        changelog: { items: [{ field: 'assignee' }, { field: 'status', toString: 'Done' }] },
      }),
      {},
      {}
    )
    expect(result).toEqual({
      externalId: 'PROJ-12',
      externalStatus: 'Done',
      eventType: 'jira:issue_updated',
    })
  })

  it('ignores updates that are not a status change', async () => {
    const result = await jiraInboundHandler.parseStatusChange(
      JSON.stringify({
        webhookEvent: 'jira:issue_updated',
        issue: { key: 'PROJ-12' },
        changelog: { items: [{ field: 'summary', toString: 'new title' }] },
      }),
      {},
      {}
    )
    expect(result).toBeNull()
  })

  it('ignores non-update events', async () => {
    const result = await jiraInboundHandler.parseStatusChange(
      JSON.stringify({
        webhookEvent: 'jira:issue_created',
        issue: { key: 'PROJ-12' },
        changelog: { items: [{ field: 'status', toString: 'To Do' }] },
      }),
      {},
      {}
    )
    expect(result).toBeNull()
  })
})
