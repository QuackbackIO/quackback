import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  deleteJiraWebhook,
  jiraProjectRef,
  listJiraWebhookIds,
  refreshJiraWebhooks,
  registerJiraWebhook,
} from '../webhook-registration'

beforeEach(() => {
  vi.restoreAllMocks()
})

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('refreshJiraWebhooks', () => {
  it('extends the webhook with PUT to the refresh endpoint and returns the new expiry', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ expirationDate: 1_800_000_000_000, invalidWebhooks: [] }))
    vi.spyOn(globalThis, 'fetch').mockImplementation(fetchMock)

    const result = await refreshJiraWebhooks('tok', 'cloud-1', ['42'])

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.atlassian.com/ex/jira/cloud-1/rest/api/3/webhook/refresh')
    expect(init.method).toBe('PUT')
    expect(init.headers.Authorization).toBe('Bearer tok')
    expect(JSON.parse(init.body)).toEqual({ webhookIds: [42] })
    expect(result).toEqual({ expiresAt: new Date(1_800_000_000_000), invalidWebhookIds: [] })
  })

  it('reads an ISO expiry date from the response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ expirationDate: '2026-12-01T00:00:00.000Z' })
    )

    const result = await refreshJiraWebhooks('tok', 'cloud-1', ['42'])

    expect(result.expiresAt?.toISOString()).toBe('2026-12-01T00:00:00.000Z')
  })

  it('reports the ids Jira could not refresh as invalid', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ expirationDate: 1_800_000_000_000, invalidWebhooks: [42] })
    )

    const result = await refreshJiraWebhooks('tok', 'cloud-1', ['42'])

    expect(result.invalidWebhookIds).toEqual(['42'])
  })

  it('treats a 404 as every requested webhook being gone', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ errorMessages: [] }, 404))

    const result = await refreshJiraWebhooks('tok', 'cloud-1', ['42'])

    expect(result).toEqual({ expiresAt: null, invalidWebhookIds: ['42'] })
  })

  it('leaves the expiry unknown when the response carries no usable date', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ expirationDate: 'soon' }))

    const result = await refreshJiraWebhooks('tok', 'cloud-1', ['42'])

    expect(result.expiresAt).toBeNull()
    expect(result.invalidWebhookIds).toEqual([])
  })

  it('throws with the status code on other failures so the caller can retry later', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ message: 'nope' }, 401))

    await expect(refreshJiraWebhooks('tok', 'cloud-1', ['42'])).rejects.toThrow(
      'Jira API error 401'
    )
  })

  it('refuses a webhook id that is not numeric before sending anything', async () => {
    const fetchMock = vi.fn()
    vi.spyOn(globalThis, 'fetch').mockImplementation(fetchMock)

    await expect(refreshJiraWebhooks('tok', 'cloud-1', ['42; drop'])).rejects.toThrow(
      'Invalid Jira webhook ID'
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('jiraProjectRef', () => {
  it('takes the project half of the stored project:issueType composite', () => {
    expect(jiraProjectRef('10000:10004')).toBe('10000')
    expect(jiraProjectRef('PROJ')).toBe('PROJ')
    expect(jiraProjectRef(undefined)).toBe('')
  })
})

describe('registerJiraWebhook', () => {
  it('bounds the registration with a timeout so a stalled Jira cannot hold the job', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ webhookRegistrationResult: [{ createdWebhookId: 99 }] }))
    vi.spyOn(globalThis, 'fetch').mockImplementation(fetchMock)

    await registerJiraWebhook('tok', 'cloud-1', 'https://tenant.example/hook', '10000')

    expect(fetchMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal)
  })

  it('registers with project = KEY and no secret field', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ webhookRegistrationResult: [{ createdWebhookId: 42 }] }),
    })
    vi.spyOn(globalThis, 'fetch').mockImplementation(fetchMock)

    const result = await registerJiraWebhook(
      'tok',
      'cloud-1',
      'https://app.example.com/hook',
      'PROJ'
    )

    expect(result).toEqual({ webhookId: '42' })
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.webhooks[0].jqlFilter).toBe('project = PROJ')
    expect(body).not.toHaveProperty('secret')
    expect(JSON.stringify(body)).not.toContain('EMPTY')
  })

  it('surfaces Jira registration errors from a 200 body', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        webhookRegistrationResult: [{ errors: ['Operator is not is unsupported'] }],
      }),
    } as Response)

    await expect(
      registerJiraWebhook('tok', 'cloud-1', 'https://app.example.com/hook', 'PROJ')
    ).rejects.toThrow('Operator is not is unsupported')
  })

  it('accepts a numeric project id from the settings composite', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ webhookRegistrationResult: [{ createdWebhookId: 7 }] }),
    })
    vi.spyOn(globalThis, 'fetch').mockImplementation(fetchMock)

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

describe('listJiraWebhookIds', () => {
  it('reads every page of the webhook list and returns each id as a string', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ values: [{ id: 1 }, { id: 2 }], isLast: false }))
      .mockResolvedValueOnce(jsonResponse({ values: [{ id: 42 }], isLast: true }))
    vi.spyOn(globalThis, 'fetch').mockImplementation(fetchMock)

    const ids = await listJiraWebhookIds('tok', 'cloud-1')

    expect([...ids].sort()).toEqual(['1', '2', '42'])
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const [firstUrl, firstInit] = fetchMock.mock.calls[0]
    expect(firstUrl).toBe(
      'https://api.atlassian.com/ex/jira/cloud-1/rest/api/3/webhook?startAt=0&maxResults=100'
    )
    expect(firstInit.method).toBe('GET')
    expect(firstInit.headers.Authorization).toBe('Bearer tok')
    expect(fetchMock.mock.calls[1][0]).toContain('startAt=100')
  })

  it('throws when Jira cannot list the webhooks, so no refresh is taken as proven', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ message: 'nope' }, 500))

    await expect(listJiraWebhookIds('tok', 'cloud-1')).rejects.toThrow('Jira API error 500')
  })
})

describe('deleteJiraWebhook', () => {
  it('bounds the delete with a timeout so a stalled Jira cannot hold the job', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    vi.spyOn(globalThis, 'fetch').mockImplementation(fetchMock)

    await deleteJiraWebhook('tok', 'cloud-1', '99')

    expect(fetchMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal)
  })

  it('rejects when Jira refuses the delete, so a caller can see the webhook is still there', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('boom', { status: 500 }))

    await expect(deleteJiraWebhook('tok', 'cloud-1', '99')).rejects.toThrow('Jira API error 500')
  })

  it('resolves when Jira no longer has the webhook', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 404 }))

    await expect(deleteJiraWebhook('tok', 'cloud-1', '99')).resolves.toBeUndefined()
  })
})
