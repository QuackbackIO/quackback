import { describe, expect, it } from 'vitest'
import { PERMISSIONS, type PermissionKey } from '@/lib/shared/permissions'
import {
  compareSearchResults,
  mergeSearchResults,
  searchableKinds,
  searchExcerpt,
  searchResultsHref,
  type SearchResult,
} from '../ask-search'

const row = (over: Partial<SearchResult> & Pick<SearchResult, 'id'>): SearchResult => ({
  kind: 'post',
  title: over.id,
  href: `/x/${over.id}`,
  score: 0,
  ...over,
})

describe('ranking across kinds', () => {
  it('puts a title match of any kind above a body-only match of any other kind', () => {
    const results = mergeSearchResults(
      [row({ id: 'post-body', kind: 'post', score: 0.9 })],
      [row({ id: 'person-prefix', kind: 'person', score: 2 })],
      [row({ id: 'article-exact', kind: 'article', score: 3.05 })],
      [row({ id: 'ticket-contains', kind: 'ticket', score: 1.2 })]
    )
    expect(results.map((result) => result.id)).toEqual([
      'article-exact',
      'person-prefix',
      'ticket-contains',
      'post-body',
    ])
  })

  it('breaks a tie by the most recent update, then kind, then id', () => {
    const results = [
      row({ id: 'b', kind: 'ticket', score: 1, updatedAt: '2026-01-01T00:00:00Z' }),
      row({ id: 'a', kind: 'ticket', score: 1, updatedAt: '2026-01-01T00:00:00Z' }),
      row({ id: 'c', kind: 'company', score: 1, updatedAt: '2026-01-01T00:00:00Z' }),
      row({ id: 'new', kind: 'post', score: 1, updatedAt: '2026-06-01T00:00:00Z' }),
    ].sort(compareSearchResults)
    expect(results.map((result) => result.id)).toEqual(['new', 'c', 'a', 'b'])
  })

  it('keeps one row for a record found by keyword and by meaning, at its higher score', () => {
    const results = mergeSearchResults(
      [row({ id: 'p1', score: 0.2, excerpt: 'keyword passage' })],
      [row({ id: 'p1', score: 0.8, excerpt: 'semantic passage' }), row({ id: 'p2', score: 0.5 })]
    )
    expect(results).toEqual([
      expect.objectContaining({ id: 'p1', score: 0.8, excerpt: 'keyword passage' }),
      expect.objectContaining({ id: 'p2', score: 0.5 }),
    ])
  })

  it('never merges records of different kinds that share an id', () => {
    expect(
      mergeSearchResults(
        [row({ id: 'same', kind: 'person' })],
        [row({ id: 'same', kind: 'teammate' })]
      )
    ).toHaveLength(2)
  })
})

describe('searchableKinds', () => {
  const all = {
    feedback: true,
    helpCenter: true,
    changelog: true,
    supportInbox: true,
    supportTickets: true,
  }
  const holding =
    (...keys: PermissionKey[]) =>
    (key: PermissionKey) =>
      keys.includes(key)

  it('offers each record kind only with its product on and its page permission', () => {
    expect(searchableKinds(holding(), all)).toEqual(['article'])
    expect(
      searchableKinds(
        holding(
          PERMISSIONS.POST_VIEW_PRIVATE,
          PERMISSIONS.CHANGELOG_VIEW_DRAFT,
          PERMISSIONS.CONVERSATION_VIEW,
          PERMISSIONS.TICKET_VIEW,
          PERMISSIONS.PEOPLE_VIEW,
          PERMISSIONS.MEMBER_VIEW,
          PERMISSIONS.COMPANY_VIEW
        ),
        all
      )
    ).toEqual([
      'post',
      'conversation',
      'ticket',
      'article',
      'changelog',
      'person',
      'teammate',
      'company',
    ])
  })

  it('offers posts and changelog only to those who can open them in the admin', () => {
    // The feedback modal needs post.view_private and the changelog editor
    // changelog.view_draft, so without them a result would not open.
    expect(searchableKinds(holding(PERMISSIONS.CHANGELOG_MANAGE), all)).toEqual(['article'])
    expect(searchableKinds(holding(PERMISSIONS.POST_VIEW_PRIVATE), all)).toContain('post')
    expect(searchableKinds(holding(PERMISSIONS.CHANGELOG_VIEW_DRAFT), all)).toContain('changelog')
  })

  it('needs people.view as well as company.view for companies, which open on the Users page', () => {
    expect(searchableKinds(holding(PERMISSIONS.COMPANY_VIEW), {})).not.toContain('company')
  })

  it('drops kinds whose product is off', () => {
    expect(
      searchableKinds(holding(PERMISSIONS.CONVERSATION_VIEW, PERMISSIONS.TICKET_VIEW), {
        feedback: false,
        helpCenter: false,
        changelog: false,
        supportInbox: false,
        supportTickets: false,
      })
    ).toEqual([])
  })
})

describe('searchExcerpt', () => {
  it('returns short text whole, without markup', () => {
    expect(searchExcerpt('<p>Refunds take **five** days</p>', 'refund')).toBe(
      'Refunds take five days'
    )
  })

  it('centres a long text on the first matched word', () => {
    const text = `${'Opening words. '.repeat(30)}The refund arrives within five days. ${'Closing words. '.repeat(30)}`
    const excerpt = searchExcerpt(text, 'refund')
    expect(excerpt.startsWith('…')).toBe(true)
    expect(excerpt.endsWith('…')).toBe(true)
    expect(excerpt).toContain('The refund arrives')
    expect(excerpt.length).toBeLessThanOrEqual(202)
  })

  it('starts at the beginning when no word is found', () => {
    const excerpt = searchExcerpt('a'.repeat(400), 'zebra')
    expect(excerpt.startsWith('a')).toBe(true)
    expect(excerpt.endsWith('…')).toBe(true)
  })
})

it('builds the results page link, encoded and with an optional kind', () => {
  expect(searchResultsHref(' refund & returns ')).toBe('/admin/search?q=refund%20%26%20returns')
  expect(searchResultsHref('acme', 'company')).toBe('/admin/search?q=acme&kind=company')
})
