import { describe, it, expect, vi, afterEach } from 'vitest'
import { getWorkItemStatus } from '@/integrations/azure-devops/server/api'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('getWorkItemStatus', () => {
  it('reads state, project and change date from the organization with the PAT', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json({
        id: 2580,
        fields: {
          'System.State': 'Closed',
          'System.TeamProject': 'Fabrikam',
          'System.ChangedDate': '2026-11-24T13:07:35.977Z',
        },
      })
    )

    const result = await getWorkItemStatus('test-pat', 'contoso', '2580')

    expect(result).toEqual({
      state: 'Closed',
      project: 'Fabrikam',
      changedDate: '2026-11-24T13:07:35.977Z',
    })
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toBe(
      'https://dev.azure.com/contoso/_apis/wit/workitems/2580?fields=System.State,System.TeamProject,System.ChangedDate&api-version=7.1'
    )
    expect(init?.method).toBe('GET')
    expect(new Headers(init?.headers).get('Authorization')).toBe(
      `Basic ${Buffer.from(':test-pat').toString('base64')}`
    )
  })

  it('leaves missing or non-string fields undefined', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json({ id: 2580, fields: { 'System.State': 3 } })
    )
    expect(await getWorkItemStatus('test-pat', 'contoso', '2580')).toEqual({
      state: undefined,
      project: undefined,
      changedDate: undefined,
    })
  })

  it('throws with the HTTP status so the caller can tell a deleted work item from a failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 404 }))
    await expect(getWorkItemStatus('test-pat', 'contoso', '2580')).rejects.toMatchObject({
      status: 404,
    })
  })
})
