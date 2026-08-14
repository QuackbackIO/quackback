import { describe, it, expect, vi, beforeEach } from 'vitest'
import { registerJiraWebhook } from '../webhook-registration'

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('registerJiraWebhook', () => {
  it('registers with project = KEY and no secret field', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ webhookRegistrationResult: [{ createdWebhookId: 42 }] }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await registerJiraWebhook('tok', 'cloud-1', 'https://app.example.com/hook', 'PROJ')

    expect(result).toEqual({ webhookId: '42' })
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.webhooks[0].jqlFilter).toBe('project = PROJ')
    expect(body).not.toHaveProperty('secret')
    expect(JSON.stringify(body)).not.toContain('EMPTY')
  })

  it('surfaces Jira registration errors from a 200 body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          webhookRegistrationResult: [{ errors: ['Operator is not is unsupported'] }],
        }),
      })
    )

    await expect(
      registerJiraWebhook('tok', 'cloud-1', 'https://app.example.com/hook', 'PROJ')
    ).rejects.toThrow('Operator is not is unsupported')
  })

  it('accepts a numeric project id from the settings composite', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ webhookRegistrationResult: [{ createdWebhookId: 7 }] }),
    })
    vi.stubGlobal('fetch', fetchMock)

    await registerJiraWebhook('tok', 'cloud-1', 'https://app.example.com/hook', '10000')
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).webhooks[0].jqlFilter).toBe(
      'project = 10000'
    )
  })

  it('rejects a project ref that is not a safe JQL token', async () => {
    await expect(
      registerJiraWebhook('tok', 'cloud-1', 'https://app.example.com/hook', 'PROJ OR 1=1')
    ).rejects.toThrow('Invalid Jira project reference')
  })
})
