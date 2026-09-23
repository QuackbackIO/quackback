/**
 * Tests for the Linear workflow-state listing behind the status-mapping UI.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fetchLinearStatuses } from '@/integrations/linear/server/statuses'

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('fetchLinearStatuses', () => {
  it('lists every public team’s workflow state names once, even with a team configured', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        data: {
          workflowStates: {
            nodes: [
              { id: 'product-triage', name: 'Triage' },
              { id: 'product-progress', name: 'In Progress' },
              { id: 'desktop-progress', name: 'In Progress' },
              { id: 'desktop-done', name: 'Done' },
            ],
          },
        },
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const states = await fetchLinearStatuses({
      accessToken: 'lin_test_token',
      config: { channelId: 'team-product' },
    })

    // Status sync follows an issue into any public team, and mappings are
    // keyed by state NAME, so the picker has to offer every team's names —
    // each once, because the same name in two teams is one mapping.
    expect(states).toEqual([
      { id: 'Triage', name: 'Triage' },
      { id: 'In Progress', name: 'In Progress' },
      { id: 'Done', name: 'Done' },
    ])
    const { query } = JSON.parse(String((fetchMock.mock.calls[0][1] as { body: string }).body))
    expect(query).toContain('workflowStates')
    expect(query).not.toContain('team(')
  })
})
