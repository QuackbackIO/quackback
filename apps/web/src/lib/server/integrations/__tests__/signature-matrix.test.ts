import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { githubInboundHandler } from '../github/inbound'
import { jiraInboundHandler } from '../jira/inbound'
import { asanaInboundHandler } from '../asana/inbound'
import { gitlabInboundHandler } from '../gitlab/inbound'
import { trelloInboundHandler } from '../trello/inbound'
import { clickupInboundHandler } from '../clickup/inbound'
import { azureDevOpsInboundHandler } from '../azure-devops/inbound'

const body = JSON.stringify({ event: 'test' })
const secret = 'webhook-secret'
const url = 'https://feedback.example.com/api/integrations/test/webhook'

const cases = [
  {
    name: 'GitHub',
    handler: githubInboundHandler,
    header: 'X-Hub-Signature-256',
    valid: `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`,
    // Same "sha256=<hex>" shape as valid, but 4 hex chars short — exercises the
    // length guard (signature.length === expected.length) ahead of timingSafeEqual,
    // which would otherwise throw on mismatched buffer lengths.
    lengthMismatch: `sha256=${createHmac('sha256', secret).update(body).digest('hex').slice(0, -4)}`,
  },
  {
    name: 'Jira',
    handler: jiraInboundHandler,
    header: 'X-Hub-Signature',
    valid: `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`,
    lengthMismatch: `sha256=${createHmac('sha256', secret).update(body).digest('hex').slice(0, -4)}`,
  },
  {
    name: 'Asana',
    handler: asanaInboundHandler,
    header: 'X-Hook-Signature',
    valid: createHmac('sha256', secret).update(body).digest('hex'),
    lengthMismatch: createHmac('sha256', secret).update(body).digest('hex').slice(0, -4),
  },
  {
    name: 'GitLab',
    handler: gitlabInboundHandler,
    header: 'X-Gitlab-Token',
    valid: secret,
    // A shorter-but-still-plausible token, not the raw secret with characters
    // swapped — isolates the length-mismatch branch of the guard.
    lengthMismatch: secret.slice(0, -2),
  },
  {
    name: 'Trello',
    handler: trelloInboundHandler,
    header: 'x-trello-webhook',
    valid: createHmac('sha1', secret)
      .update(body + url)
      .digest('base64'),
    lengthMismatch: createHmac('sha1', secret)
      .update(body + url)
      .digest('base64')
      .slice(0, -4),
  },
  {
    name: 'ClickUp',
    handler: clickupInboundHandler,
    header: 'X-Signature',
    valid: createHmac('sha256', secret).update(body).digest('hex'),
    lengthMismatch: createHmac('sha256', secret).update(body).digest('hex').slice(0, -4),
  },
  {
    name: 'Azure DevOps',
    handler: azureDevOpsInboundHandler,
    header: 'Authorization',
    valid: `Basic ${Buffer.from(`quackback:${secret}`).toString('base64')}`,
    // Same Basic-auth shape, but the decoded password is shorter than the
    // configured secret — isolates the password.length === secret.length guard.
    lengthMismatch: `Basic ${Buffer.from(`quackback:${secret.slice(0, -2)}`).toString('base64')}`,
  },
] as const

describe.each(cases)('$name inbound signature', ({ handler, header, valid, lengthMismatch }) => {
  const verify = handler.verifySignature!

  it('accepts a valid signature', async () => {
    expect(await verify(new Request(url, { headers: { [header]: valid } }), body, secret)).toBe(
      true
    )
  })

  it.each([
    ['missing', undefined],
    ['tampered', valid.slice(0, -1) + (valid.endsWith('a') ? 'b' : 'a')],
    // Non-hex/non-base64 short garbage — fails the length guard trivially,
    // never reaches timingSafeEqual.
    ['malformed', 'x'],
    // Valid format/encoding, but a different length than expected — isolates
    // the length guard from the tampered (same-length, wrong-content) case
    // above, so a regression that dropped the length check (and let
    // timingSafeEqual throw on mismatched buffer lengths) would be caught here.
    ['length mismatch', lengthMismatch],
  ])('rejects %s signatures without throwing', async (_label, value) => {
    const headers = value === undefined ? undefined : { [header]: value }
    const result = await verify(new Request(url, { headers }), body, secret)
    expect(result).toBeInstanceOf(Response)
    expect((result as Response).status).toBe(401)
  })
})
