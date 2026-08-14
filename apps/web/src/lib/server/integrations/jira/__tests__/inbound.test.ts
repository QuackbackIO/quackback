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

function bearerJwt(secret = SECRET) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const payload = Buffer.from(JSON.stringify({ iss: 'jira' })).toString('base64url')
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
})
