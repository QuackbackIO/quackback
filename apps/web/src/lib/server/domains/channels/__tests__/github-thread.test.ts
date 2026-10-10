import { describe, expect, it } from 'vitest'
import { githubLoginsMatch, githubThreadKey, parseGitHubThreadKey } from '../github-thread'
import { githubIssuePeopleFromMessages, githubIssueRefFromUrl } from '@/lib/shared/channels/github'

describe('github thread key', () => {
  it('round-trips owner/repo#number', () => {
    expect(githubThreadKey('acme/api', 201)).toBe('acme/api#201')
    expect(parseGitHubThreadKey('acme/api#201')).toEqual({
      ownerRepo: 'acme/api',
      issueNumber: '201',
    })
  })

  it('rejects malformed keys', () => {
    expect(parseGitHubThreadKey('acme#201')).toBeNull()
    expect(parseGitHubThreadKey('#201')).toBeNull()
    expect(parseGitHubThreadKey('acme/api#')).toBeNull()
    expect(parseGitHubThreadKey('acme/api#n')).toBeNull()
  })
})

describe('githubLoginsMatch', () => {
  it('compares GitHub logins case-insensitively', () => {
    expect(githubLoginsMatch('Acme-Ops', 'acme-ops')).toBe(true)
    expect(githubLoginsMatch('acme-ops', 'acme-ops')).toBe(true)
    expect(githubLoginsMatch('acme-ops', 'other')).toBe(false)
    expect(githubLoginsMatch(null, 'acme-ops')).toBe(false)
    expect(githubLoginsMatch('acme-ops', undefined)).toBe(false)
  })
})

describe('githubIssuePeopleFromMessages', () => {
  it('lists distinct visitor and agent authors and skips notes', () => {
    expect(
      githubIssuePeopleFromMessages([
        {
          senderType: 'visitor',
          author: { principalId: 'p1', displayName: 'jane', avatarUrl: null },
        },
        {
          senderType: 'visitor',
          author: { principalId: 'p2', displayName: 'bob', avatarUrl: 'https://example/b.png' },
        },
        {
          senderType: 'visitor',
          author: { principalId: 'p1', displayName: 'jane', avatarUrl: null },
        },
        {
          senderType: 'agent',
          author: { principalId: 'p3', displayName: 'Alex', avatarUrl: null },
        },
        {
          senderType: 'agent',
          isInternal: true,
          author: { principalId: 'p4', displayName: 'Note', avatarUrl: null },
        },
        {
          senderType: 'system',
          author: { principalId: 'p5', displayName: 'sys', avatarUrl: null },
        },
      ])
    ).toEqual([
      { principalId: 'p1', displayName: 'jane', avatarUrl: null },
      { principalId: 'p2', displayName: 'bob', avatarUrl: 'https://example/b.png' },
      { principalId: 'p3', displayName: 'Alex', avatarUrl: null },
    ])
  })
})

describe('githubIssueRefFromUrl', () => {
  it('parses an issue html_url', () => {
    expect(githubIssueRefFromUrl('https://github.com/acme/api/issues/201')).toBe('acme/api#201')
  })

  it('returns null for unrelated urls', () => {
    expect(githubIssueRefFromUrl('https://github.com/acme/api')).toBeNull()
    expect(githubIssueRefFromUrl(null)).toBeNull()
  })
})
