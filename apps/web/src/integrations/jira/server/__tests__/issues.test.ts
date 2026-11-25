import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/server/integrations/sync/transport', () => ({
  integrationFetch: vi.fn(),
}))

import { integrationFetch } from '@/lib/server/integrations/sync/transport'
import { getJiraIssueStatus } from '../issues'

beforeEach(() => {
  vi.mocked(integrationFetch).mockReset()
})

describe('getJiraIssueStatus', () => {
  it('reads status, project and update time with the OAuth token', async () => {
    vi.mocked(integrationFetch).mockResolvedValue(
      Response.json({
        id: '10042',
        key: 'NEW-3',
        fields: {
          status: { name: 'Done' },
          project: { id: '10000', key: 'PROJ' },
          updated: '2026-11-24T13:07:35.977+0000',
        },
      })
    )
    expect(await getJiraIssueStatus('jira-token', 'cloud-1', '10042')).toEqual({
      key: 'NEW-3',
      status: 'Done',
      projectId: '10000',
      projectKey: 'PROJ',
      updated: '2026-11-24T13:07:35.977+0000',
    })
    const [url, init] = vi.mocked(integrationFetch).mock.calls[0]
    expect(url).toBe(
      'https://api.atlassian.com/ex/jira/cloud-1/rest/api/3/issue/10042?fields=status,project,updated'
    )
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer jira-token')
  })

  it('returns null when the issue is gone or not visible', async () => {
    vi.mocked(integrationFetch).mockResolvedValue(new Response('{}', { status: 404 }))
    expect(await getJiraIssueStatus('jira-token', 'cloud-1', 'PROJ-12')).toBeNull()
  })

  it('throws other failures with their status', async () => {
    for (const status of [401, 429, 500]) {
      vi.mocked(integrationFetch).mockResolvedValue(new Response('nope', { status }))
      await expect(getJiraIssueStatus('jira-token', 'cloud-1', 'PROJ-12')).rejects.toMatchObject({
        status,
      })
    }
  })
})
