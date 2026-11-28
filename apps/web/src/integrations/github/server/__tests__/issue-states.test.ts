/**
 * The issue states GitHub sync maps: a close says whether the work was done
 * or dropped, and a not-planned close maps like a plain close until it has a
 * mapping of its own.
 */
import { describe, expect, it } from 'vitest'
import { githubInboundHandler } from '../inbound'
import { fetchGitHubStatuses } from '../statuses'
import {
  resolveStatusMapping,
  resolveTicketStatusMapping,
} from '@/lib/server/integrations/status-mapping'

const delivery = (action: string, stateReason: string | null = null) =>
  JSON.stringify({
    action,
    issue: { number: 7, updated_at: '2026-10-14T10:00:00Z', state_reason: stateReason },
    repository: { full_name: 'acme/api' },
  })

describe('GitHub issue states', () => {
  it('offers the not-planned close for mapping', async () => {
    expect((await fetchGitHubStatuses()).map((s) => s.name)).toEqual([
      'Open',
      'Closed',
      'Closed (not planned)',
    ])
  })

  it('reports a not-planned close with Closed as its fallback', async () => {
    expect(
      await githubInboundHandler.parseStatusChange(delivery('closed', 'not_planned'), {}, {})
    ).toMatchObject({ externalStatus: 'Closed (not planned)', fallbackStatus: 'Closed' })
    const completed = await githubInboundHandler.parseStatusChange(
      delivery('closed', 'completed'),
      {},
      {}
    )
    expect(completed).toMatchObject({ externalStatus: 'Closed' })
    expect(completed).not.toHaveProperty('fallbackStatus')
    expect(
      await githubInboundHandler.parseStatusChange(delivery('reopened'), {}, {})
    ).toMatchObject({ externalStatus: 'Open' })
  })

  it('maps a status without an entry through its fallback, but not an ignored one', () => {
    const closedOnly = { Closed: 'ticket_status_resolved' }
    expect(resolveTicketStatusMapping('Closed (not planned)', closedOnly, 'Closed')).toBe(
      'ticket_status_resolved'
    )
    expect(
      resolveTicketStatusMapping(
        'Closed (not planned)',
        { ...closedOnly, 'Closed (not planned)': 'ticket_status_wont_do' },
        'Closed'
      )
    ).toBe('ticket_status_wont_do')
    expect(
      resolveStatusMapping(
        'Closed (not planned)',
        { Closed: 'post_status_done', 'Closed (not planned)': null },
        'Closed'
      )
    ).toBeNull()
    expect(resolveStatusMapping('Closed (not planned)', closedOnly)).toBeNull()
  })
})
