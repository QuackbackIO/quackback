/**
 * Which linked issues hear a ticket's status, priority, assignee and title
 * changes: every active link of a provider with the guarded write contract,
 * never a link without a connection, never back to the integration whose own
 * principal made the change, and nothing integration sync applied. Whether
 * the link's repository updates its issues is queueing's to decide (see
 * issue-autoupdate.db.test).
 */
import { describe, it, expect } from 'vitest'
import {
  buildIssueUpdateTargets,
  issueUpdateResolver,
  type IssueUpdateLinkRow,
} from '../issue-update.resolver'

const GITHUB_PRINCIPAL = 'prn_github_service'

const link = (over: Partial<IssueUpdateLinkRow> = {}): IssueUpdateLinkRow => ({
  linkId: 'lnk_api',
  integrationId: 'int_github',
  integrationType: 'github',
  integrationPrincipalId: GITHUB_PRINCIPAL,
  ...over,
})

const updatesIssues = (type: string) => type === 'github'

describe('buildIssueUpdateTargets', () => {
  it('routes a teammate change to every link of a guarded provider', () => {
    const targets = buildIssueUpdateTargets({
      links: [
        link(),
        link({ linkId: 'lnk_linear', integrationType: 'linear', integrationId: 'int_linear' }),
        link({ linkId: 'lnk_orphan', integrationId: null }),
      ],
      actorType: 'user',
      actorId: 'prn_alice',
      source: 'admin',
      updatesIssues,
    })
    expect(targets).toEqual([
      {
        type: 'issue_update',
        target: { linkId: 'lnk_api' },
        config: { integrationId: 'int_github' },
        deliveryKey: 'issue-update:lnk_api',
      },
    ])
  })

  it('never sends a change back to the integration whose principal made it', () => {
    expect(
      buildIssueUpdateTargets({
        links: [link()],
        actorType: 'service',
        actorId: GITHUB_PRINCIPAL,
        source: undefined,
        updatesIssues,
      })
    ).toEqual([])
  })

  it('ignores anything integration sync applied', () => {
    expect(
      buildIssueUpdateTargets({
        links: [link()],
        actorType: 'service',
        actorId: 'prn_linear_service',
        source: 'integration-sync',
        updatesIssues,
      })
    ).toEqual([])
  })
})

describe('issueUpdateResolver', () => {
  it('listens to the four ticket events', () => {
    for (const type of [
      'ticket.status_changed',
      'ticket.priority_changed',
      'ticket.assigned',
      'ticket.updated',
    ])
      expect(issueUpdateResolver.interestedIn(type)).toBe(true)
    expect(issueUpdateResolver.interestedIn('ticket.replied')).toBe(false)
  })

  it('resolves nothing for a ticket.updated that left the title alone', async () => {
    const targets = await issueUpdateResolver.resolve({
      eventId: 'evt_1' as never,
      seq: 1n,
      type: 'ticket.updated',
      entityType: 'ticket',
      entityId: 'ticket_1',
      actorType: 'user',
      actorId: 'prn_alice',
      payload: { changedKeys: ['description'] },
      context: { depth: 0 },
      schemaVersion: 1,
      occurredAt: new Date(),
    })
    expect(targets).toEqual([])
  })
})
