/**
 * Tests for platform archive/close functions.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { archiveExternalIssue, type ArchiveContext } from '../archive'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockFetch(status: number, body: unknown = {}) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  })
}

function baseCtx(overrides: Partial<ArchiveContext> = {}): ArchiveContext {
  return {
    externalId: 'ext-123',
    externalUrl: null,
    accessToken: 'tok_test',
    integrationConfig: {},
    ...overrides,
  }
}

/** Extract the parsed body from the most recent fetch call */
function lastFetchBody(fetchFn: ReturnType<typeof vi.fn>): unknown {
  const call = fetchFn.mock.calls[fetchFn.mock.calls.length - 1]
  const init = call[1] as RequestInit | undefined
  return init?.body ? JSON.parse(init.body as string) : undefined
}

beforeEach(() => {
  vi.restoreAllMocks()
})

// ---------------------------------------------------------------------------
// Registry / dispatcher
// ---------------------------------------------------------------------------

describe('archiveExternalIssue', () => {
  it('returns error for unsupported integration type', async () => {
    const result = await archiveExternalIssue('unknown_platform', baseCtx())
    expect(result.success).toBe(false)
    expect(result.error).toContain('Unsupported integration type')
  })

  it('catches thrown errors and returns failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')))
    const result = await archiveExternalIssue('linear', baseCtx())
    expect(result.success).toBe(false)
    expect(result.error).toBe('network down')
  })

  it('catches non-Error throws gracefully', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue('string error'))
    const result = await archiveExternalIssue('linear', baseCtx())
    expect(result.success).toBe(false)
    expect(result.error).toBe('Unknown error')
  })
})

// ---------------------------------------------------------------------------
// Linear
// ---------------------------------------------------------------------------

describe('linear archive', () => {
  it('uses GraphQL variables (not string interpolation)', async () => {
    const fetchMock = mockFetch(200, { data: { issueArchive: { success: true } } })
    vi.stubGlobal('fetch', fetchMock)

    await archiveExternalIssue('linear', baseCtx({ externalId: 'issue-abc' }))

    const body = lastFetchBody(fetchMock) as { query: string; variables: Record<string, string> }
    expect(body.query).toContain('$id: String!')
    expect(body.query).not.toContain('issue-abc')
    expect(body.variables).toEqual({ id: 'issue-abc' })
  })

  it('returns archived on success', async () => {
    vi.stubGlobal('fetch', mockFetch(200, { data: { issueArchive: { success: true } } }))
    const result = await archiveExternalIssue('linear', baseCtx())
    expect(result).toEqual({ success: true, action: 'archived' })
  })

  it('returns failure on 401', async () => {
    vi.stubGlobal('fetch', mockFetch(401))
    const result = await archiveExternalIssue('linear', baseCtx())
    expect(result).toEqual({ success: false, error: 'Auth expired' })
  })

  it('treats 404 as already archived', async () => {
    vi.stubGlobal('fetch', mockFetch(404))
    const result = await archiveExternalIssue('linear', baseCtx())
    expect(result).toEqual({ success: true, action: 'archived' })
  })

  it('returns GraphQL errors', async () => {
    vi.stubGlobal('fetch', mockFetch(200, { errors: [{ message: 'Issue not found' }] }))
    const result = await archiveExternalIssue('linear', baseCtx())
    expect(result).toEqual({ success: false, error: 'Issue not found' })
  })

  it('returns failure on non-OK response (e.g. 403, 429)', async () => {
    vi.stubGlobal('fetch', mockFetch(429, { message: 'rate limited' }))
    const result = await archiveExternalIssue('linear', baseCtx())
    expect(result.success).toBe(false)
    expect(result.error).toContain('Linear API 429')
  })
})

// ---------------------------------------------------------------------------
// GitHub
// ---------------------------------------------------------------------------

describe('github close', () => {
  const ghCtx = (overrides: Partial<ArchiveContext> = {}) =>
    baseCtx({
      externalId: '42',
      externalUrl: 'https://github.com/acme/repo/issues/42',
      ...overrides,
    })

  it('sends PATCH with state=closed to the correct URL', async () => {
    const fetchMock = mockFetch(200)
    vi.stubGlobal('fetch', fetchMock)

    await archiveExternalIssue('github', ghCtx())

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.github.com/repos/acme/repo/issues/42',
      expect.objectContaining({ method: 'PATCH' })
    )
    const body = lastFetchBody(fetchMock) as { state: string }
    expect(body.state).toBe('closed')
  })

  it('returns closed on success', async () => {
    vi.stubGlobal('fetch', mockFetch(200))
    const result = await archiveExternalIssue('github', ghCtx())
    expect(result).toEqual({ success: true, action: 'closed' })
  })

  it('fails when externalUrl is missing', async () => {
    const result = await archiveExternalIssue('github', ghCtx({ externalUrl: null }))
    expect(result.success).toBe(false)
    expect(result.error).toContain('Cannot determine repo')
  })

  it('treats 404 as already closed', async () => {
    vi.stubGlobal('fetch', mockFetch(404))
    const result = await archiveExternalIssue('github', ghCtx())
    expect(result).toEqual({ success: true, action: 'closed' })
  })

  it('treats 422 as already closed', async () => {
    vi.stubGlobal('fetch', mockFetch(422))
    const result = await archiveExternalIssue('github', ghCtx())
    expect(result).toEqual({ success: true, action: 'closed' })
  })
})

// ---------------------------------------------------------------------------
// GitLab
// ---------------------------------------------------------------------------

describe('gitlab close', () => {
  const glCtx = (overrides: Partial<ArchiveContext> = {}) =>
    baseCtx({
      externalId: '7',
      externalUrl: 'https://gitlab.com/my-org/my-project/-/issues/7',
      ...overrides,
    })

  it('sends PUT with state_event=close', async () => {
    const fetchMock = mockFetch(200)
    vi.stubGlobal('fetch', fetchMock)

    await archiveExternalIssue('gitlab', glCtx())

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('my-org%2Fmy-project'),
      expect.objectContaining({ method: 'PUT' })
    )
    const body = lastFetchBody(fetchMock) as { state_event: string }
    expect(body.state_event).toBe('close')
  })

  it('fails when externalUrl is missing', async () => {
    const result = await archiveExternalIssue('gitlab', glCtx({ externalUrl: null }))
    expect(result.success).toBe(false)
    expect(result.error).toContain('Cannot determine project')
  })
})

// ---------------------------------------------------------------------------
// Jira
// ---------------------------------------------------------------------------

describe('jira close', () => {
  const jiraCtx = (overrides: Partial<ArchiveContext> = {}) =>
    baseCtx({
      externalId: 'PROJ-123',
      integrationConfig: { cloudId: 'cloud-abc' },
      ...overrides,
    })

  it('fails when cloudId is missing', async () => {
    const result = await archiveExternalIssue('jira', jiraCtx({ integrationConfig: {} }))
    expect(result.success).toBe(false)
    expect(result.error).toContain('Missing Jira cloudId')
  })

  it('finds Done transition and executes it', async () => {
    const fetchMock = vi
      .fn()
      // First call: GET transitions
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          transitions: [
            { id: '1', name: 'In Progress', to: { statusCategory: { key: 'indeterminate' } } },
            { id: '5', name: 'Done', to: { statusCategory: { key: 'done' } } },
          ],
        }),
      })
      // Second call: POST transition
      .mockResolvedValueOnce({ ok: true, status: 204 })

    vi.stubGlobal('fetch', fetchMock)

    const result = await archiveExternalIssue('jira', jiraCtx())
    expect(result).toEqual({ success: true, action: 'closed' })
    expect(fetchMock).toHaveBeenCalledTimes(2)

    // Verify transition ID was sent
    const transitionBody = lastFetchBody(fetchMock) as { transition: { id: string } }
    expect(transitionBody.transition.id).toBe('5')
  })

  it('fails when no Done transition exists', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch(200, {
        transitions: [
          { id: '1', name: 'In Progress', to: { statusCategory: { key: 'indeterminate' } } },
        ],
      })
    )

    const result = await archiveExternalIssue('jira', jiraCtx())
    expect(result.success).toBe(false)
    expect(result.error).toContain('No terminal transition')
  })
})

// ---------------------------------------------------------------------------
// Monday
// ---------------------------------------------------------------------------

describe('monday archive', () => {
  it('uses GraphQL variables (not string interpolation)', async () => {
    const fetchMock = mockFetch(200, { data: { archive_item: { id: '123' } } })
    vi.stubGlobal('fetch', fetchMock)

    await archiveExternalIssue('monday', baseCtx({ externalId: '99999' }))

    const body = lastFetchBody(fetchMock) as { query: string; variables: Record<string, string> }
    expect(body.query).toContain('$itemId: ID!')
    expect(body.query).not.toContain('99999')
    expect(body.variables).toEqual({ itemId: '99999' })
  })

  it('sends bare token without Bearer prefix', async () => {
    const fetchMock = mockFetch(200, { data: { archive_item: { id: '1' } } })
    vi.stubGlobal('fetch', fetchMock)

    await archiveExternalIssue('monday', baseCtx({ accessToken: 'my-monday-token' }))

    const call = fetchMock.mock.calls[0]
    const headers = (call[1] as RequestInit).headers as Record<string, string>
    expect(headers.Authorization).toBe('my-monday-token')
  })

  it('returns failure on non-OK response (e.g. 403)', async () => {
    vi.stubGlobal('fetch', mockFetch(403, { error: 'forbidden' }))
    const result = await archiveExternalIssue('monday', baseCtx())
    expect(result.success).toBe(false)
    expect(result.error).toContain('Monday API 403')
  })
})

// ---------------------------------------------------------------------------
// Azure DevOps
// ---------------------------------------------------------------------------

describe('azure devops close', () => {
  it('fails when organizationName is missing', async () => {
    const result = await archiveExternalIssue('azure_devops', baseCtx())
    expect(result.success).toBe(false)
    expect(result.error).toContain('Missing Azure DevOps organizationName')
  })

  it('sends JSON Patch with System.State=Closed', async () => {
    const fetchMock = mockFetch(200)
    vi.stubGlobal('fetch', fetchMock)

    await archiveExternalIssue(
      'azure_devops',
      baseCtx({ integrationConfig: { organizationName: 'myorg' } })
    )

    const body = lastFetchBody(fetchMock) as Array<{ op: string; path: string; value: string }>
    expect(body).toEqual([{ op: 'add', path: '/fields/System.State', value: 'Closed' }])
  })
})

// ---------------------------------------------------------------------------
// Trello
// ---------------------------------------------------------------------------

describe('trello archive', () => {
  it('fails when apiKey is missing', async () => {
    const result = await archiveExternalIssue('trello', baseCtx())
    expect(result.success).toBe(false)
    expect(result.error).toContain('Missing Trello API key')
  })

  it('sends closed=true with api key and token in URL', async () => {
    const fetchMock = mockFetch(200)
    vi.stubGlobal('fetch', fetchMock)

    await archiveExternalIssue(
      'trello',
      baseCtx({
        externalId: 'card-abc',
        accessToken: 'trello-tok',
        integrationConfig: { apiKey: 'trello-key' },
      })
    )

    const url = fetchMock.mock.calls[0][0] as string
    expect(url).toContain('cards/card-abc')
    expect(url).toContain('key=trello-key')
    expect(url).toContain('token=trello-tok')
    expect(url).toContain('closed=true')
  })
})

// ---------------------------------------------------------------------------
// Simple platforms (Asana, ClickUp, Shortcut, Notion)
// ---------------------------------------------------------------------------

describe.each([
  { type: 'asana', action: 'closed' as const },
  { type: 'clickup', action: 'closed' as const },
  { type: 'shortcut', action: 'archived' as const },
  { type: 'notion', action: 'archived' as const },
])('$type archive/close', ({ type, action }) => {
  it(`returns ${action} on success`, async () => {
    vi.stubGlobal('fetch', mockFetch(200, { data: {} }))
    const result = await archiveExternalIssue(type, baseCtx())
    expect(result).toEqual({ success: true, action })
  })

  it('returns failure on 401', async () => {
    vi.stubGlobal('fetch', mockFetch(401))
    const result = await archiveExternalIssue(type, baseCtx())
    expect(result).toEqual({ success: false, error: 'Auth expired' })
  })

  it('treats 404 as already handled', async () => {
    vi.stubGlobal('fetch', mockFetch(404))
    const result = await archiveExternalIssue(type, baseCtx())
    expect(result.success).toBe(true)
  })
})
