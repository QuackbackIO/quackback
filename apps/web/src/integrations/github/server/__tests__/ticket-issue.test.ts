/**
 * A ticket as a GitHub issue: the narrative with app-relative links made
 * absolute, an attachments section (images inline, other files linked), a
 * footer with status, priority and the "View in Quackback" link and nothing
 * about the requester, the hidden marker, the priority and channel labels,
 * and a body that stays under GitHub's size limit however long the narrative.
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/server/config', () => ({ getBaseUrl: () => 'https://help.acme.test' }))

import { buildGitHubTicketIssue, GITHUB_ISSUE_BODY_LIMIT } from '../ticket-issue'
import { stripQuackbackFooter } from '@/lib/server/domains/conversation/conversation.github-inbound-store'
import type { TicketIssueSource } from '@/lib/server/integrations/types'

const ticket = (over: Partial<TicketIssueSource> = {}): TicketIssueSource => ({
  ticketId: 'ticket_01',
  number: 42,
  title: 'Export fails on large CSVs',
  narrative: 'It breaks when exporting. See ![shot](/api/files/abc.png)',
  attachments: [],
  status: 'Open',
  priority: 'high',
  channel: 'email',
  url: 'https://help.acme.test/admin/inbox?i=ticket_01',
  ...over,
})

describe('buildGitHubTicketIssue', () => {
  it('writes the narrative, a footer without the requester, and our marker', () => {
    const issue = buildGitHubTicketIssue(ticket(), { integrationId: 'integration_9' })
    expect(issue.title).toBe('Export fails on large CSVs')
    expect(issue.bodyMarkdown).toContain(
      'It breaks when exporting. See ![shot](https://help.acme.test/api/files/abc.png)'
    )
    expect(issue.bodyMarkdown).toContain('**Status:** Open')
    expect(issue.bodyMarkdown).toContain('**Priority:** High')
    expect(issue.bodyMarkdown).toContain(
      '[View in Quackback](https://help.acme.test/admin/inbox?i=ticket_01)'
    )
    expect(issue.bodyMarkdown).not.toMatch(/requester|@/i)
    expect(issue.bodyMarkdown.trimEnd()).toMatch(
      /<!-- quackback:ticket-issue ticketId=ticket_01 integrationId=integration_9 -->$/
    )
    // The inbound side strips exactly what we add, should the body ever come back.
    expect(stripQuackbackFooter(issue.bodyMarkdown)).toBe(
      'It breaks when exporting. See ![shot](https://help.acme.test/api/files/abc.png)'
    )
  })

  it('labels the priority and the source channel, leaving out what is unset', () => {
    expect(buildGitHubTicketIssue(ticket(), { integrationId: 'i' }).labels).toEqual([
      'priority:high',
      'channel:email',
    ])
    const plain = buildGitHubTicketIssue(ticket({ priority: 'none', channel: null }), {
      integrationId: 'i',
    })
    expect(plain.labels).toEqual([])
    expect(plain.bodyMarkdown).toContain('**Priority:** None')
  })

  it('lists attachments, showing images inline and linking other files', () => {
    const issue = buildGitHubTicketIssue(
      ticket({
        attachments: [
          { name: 'screen [1].png', url: '/api/files/s.png', contentType: 'image/png' },
          { name: 'export.csv', url: 'https://cdn.acme.test/e.csv', contentType: 'text/csv' },
        ],
      }),
      { integrationId: 'i' }
    )
    expect(issue.bodyMarkdown).toContain(
      [
        '### Attachments',
        '',
        '![screen  1 .png](https://help.acme.test/api/files/s.png)',
        '[export.csv](https://cdn.acme.test/e.csv)',
      ].join('\n')
    )
    expect(issue.bodyMarkdown.indexOf('### Attachments')).toBeLessThan(
      issue.bodyMarkdown.indexOf('---')
    )
  })

  it('stays under the body limit, cutting the narrative and keeping the footer whole', () => {
    const issue = buildGitHubTicketIssue(
      ticket({
        narrative: 'x'.repeat(70_000),
        attachments: Array.from({ length: 400 }, (_, i) => ({
          name: `file-${i}.pdf`,
          url: `https://cdn.acme.test/files/${'f'.repeat(40)}-${i}.pdf`,
          contentType: 'application/pdf',
        })),
      }),
      { integrationId: 'i' }
    )
    expect(issue.bodyMarkdown.length).toBeLessThanOrEqual(GITHUB_ISSUE_BODY_LIMIT)
    expect(issue.bodyMarkdown).toMatch(/x\.\.\.\n\n### Attachments/)
    expect(issue.bodyMarkdown).toMatch(/_\d+ more in Quackback_/)
    expect(issue.bodyMarkdown).toContain('[View in Quackback]')
    expect(issue.bodyMarkdown).toContain('<!-- quackback:ticket-issue ticketId=ticket_01')
  })

  it('never cuts through an image link', () => {
    const image = `![big](https://cdn.acme.test/${'a'.repeat(200)}.png)`
    const issue = buildGitHubTicketIssue(
      ticket({ narrative: `${'y'.repeat(GITHUB_ISSUE_BODY_LIMIT - 300)} ${image}` }),
      { integrationId: 'i' }
    )
    expect(issue.bodyMarkdown).not.toContain('![big](https://cdn.acme.test/aaa')
    expect(issue.bodyMarkdown.length).toBeLessThanOrEqual(GITHUB_ISSUE_BODY_LIMIT)
  })
})
