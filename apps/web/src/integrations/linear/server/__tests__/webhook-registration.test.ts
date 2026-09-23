/**
 * Tests for Linear webhook registration.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { registerLinearWebhook } from '@/integrations/linear/server/webhook-registration'

const CALLBACK = 'https://feedback.example.com/api/integrations/linear/webhook'

function graphqlResponse(body: unknown) {
  return { ok: true, status: 200, json: async () => body }
}

function requestBody(call: unknown[]): { query: string; variables?: Record<string, unknown> } {
  const init = call[1] as { body?: string } | undefined
  return JSON.parse(init?.body ?? '{}')
}

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('registerLinearWebhook', () => {
  it('subscribes to every public team, not only the team issues are created in', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      graphqlResponse({
        data: { webhookCreate: { success: true, webhook: { id: 'hook-1' } } },
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await registerLinearWebhook('lin_test_token', CALLBACK, 'signing-secret')

    expect(result).toEqual({ webhookId: 'hook-1' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const { variables } = requestBody(fetchMock.mock.calls[0])
    // An issue keeps its Linear UUID when it is moved to another team, so the
    // linked post can still be found — but a team-scoped webhook stops
    // delivering the moment the issue leaves that team, and every later state
    // change is lost. The subscription therefore covers every public team.
    expect(variables?.input).toEqual({
      url: CALLBACK,
      resourceTypes: ['Issue'],
      secret: 'signing-secret',
      allPublicTeams: true,
    })
    expect(variables?.input).not.toHaveProperty('teamId')
  })

  it('keeps the all-teams scope when it reclaims a stale hook at the same url', async () => {
    const creates: Record<string, unknown>[] = []
    const fetchMock = vi.fn(async (_url: string, init?: { body?: string }) => {
      const { query, variables } = JSON.parse(init?.body ?? '{}')
      if (query.includes('webhookCreate')) {
        creates.push(variables.input)
        return creates.length === 1
          ? graphqlResponse({ errors: [{ message: 'url not unique' }] })
          : graphqlResponse({
              data: { webhookCreate: { success: true, webhook: { id: 'hook-2' } } },
            })
      }
      if (query.includes('webhookDelete')) {
        expect(variables).toEqual({ id: 'stale-hook' })
        return graphqlResponse({ data: { webhookDelete: { success: true } } })
      }
      return graphqlResponse({
        data: { webhooks: { nodes: [{ id: 'stale-hook', url: CALLBACK }] } },
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await registerLinearWebhook('lin_test_token', CALLBACK, 'signing-secret')

    expect(result).toEqual({ webhookId: 'hook-2' })
    expect(creates).toHaveLength(2)
    for (const input of creates) {
      expect(input).toMatchObject({ allPublicTeams: true })
      expect(input).not.toHaveProperty('teamId')
    }
  })
})
