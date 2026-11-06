/**
 * Suggesting teammates for GitHub accounts, with GitHub's API stubbed: the
 * assignable people of every repository are read page by page (bots left
 * out), unmatched accounts are compared by public email, then login, then
 * name; an ambiguous tier suggests nothing, each teammate is suggested once,
 * and accounts or teammates already matched are skipped. A login lookup
 * refuses what is not a GitHub login and returns null for a missing user.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getGitHubUser, listGitHubAssignees, suggestGitHubPeople } from '../people'

type User = {
  id: number
  login: string
  type?: string
  name?: string | null
  email?: string | null
}

let calls: string[]
function github(assignees: Record<string, User[][]>, profiles: Record<string, User>) {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = new URL(String(input))
    calls.push(`${url.pathname}${url.search}`)
    const repo = /^\/repos\/(.+)\/assignees$/.exec(url.pathname)?.[1]
    if (repo)
      return Response.json(assignees[repo]?.[Number(url.searchParams.get('page')) - 1] ?? [])
    const login = /^\/users\/(.+)$/.exec(url.pathname)?.[1]
    if (login && profiles[login]) return Response.json(profiles[login])
    return new Response('Not Found', { status: 404 })
  })
}

const teammates = [
  { principalId: 'principal_jane', name: 'Jane Doe', email: 'jane@acme.test' },
  { principalId: 'principal_ravi', name: 'Ravi Kumar', email: 'rkumar@acme.test' },
  { principalId: 'principal_lee', name: 'Lee Wong', email: 'lee@acme.test' },
  { principalId: 'principal_lee2', name: 'Lee Wong', email: 'lee.w@acme.test' },
]

describe('GitHub people', () => {
  beforeEach(() => {
    calls = []
  })
  afterEach(() => vi.restoreAllMocks())

  it('reads every page of assignees and leaves bots out', async () => {
    const page = Array.from({ length: 100 }, (_, i) => ({ id: i + 1, login: `u${i + 1}` }))
    github(
      {
        'acme/app': [
          page,
          [
            { id: 500, login: 'ci', type: 'Bot' },
            { id: 501, login: 'z' },
          ],
        ],
      },
      {}
    )
    const found = await listGitHubAssignees('tok', 'acme/app')
    expect(found).toHaveLength(101)
    expect(found.at(-1)).toEqual({ id: '501', login: 'z', name: null, avatarUrl: null })
    expect(calls).toEqual([
      '/repos/acme/app/assignees?per_page=100&page=1',
      '/repos/acme/app/assignees?per_page=100&page=2',
    ])
  })

  it('suggests by email, then login, then name, once per teammate and never ambiguously', async () => {
    github(
      {
        'acme/app': [
          [
            { id: 1, login: 'octojane' },
            { id: 2, login: 'rkumar' },
          ],
        ],
        'acme/api': [
          [
            { id: 3, login: 'lw' },
            { id: 4, login: 'janed' },
            { id: 1, login: 'octojane' },
          ],
        ],
      },
      {
        octojane: { id: 1, login: 'octojane', name: 'J', email: 'JANE@acme.test' },
        rkumar: { id: 2, login: 'rkumar', name: null, email: null },
        lw: { id: 3, login: 'lw', name: 'Lee Wong', email: null },
        janed: { id: 4, login: 'janed', name: 'Jane Doe', email: null },
      }
    )
    const result = await suggestGitHubPeople({
      accessToken: 'tok',
      repositories: ['acme/app', 'acme/api'],
      teammates,
      mappedAccountIds: new Set(),
      mappedPrincipalIds: new Set(),
    })
    expect(result.scanned).toBe(4)
    expect(result.suggestions.map((s) => [s.account.login, s.principalId, s.reason])).toEqual([
      ['octojane', 'principal_jane', 'email'],
      ['rkumar', 'principal_ravi', 'login'],
      // "janed" matches Jane by name, but Jane is already suggested by email;
      // "lw" matches two teammates named Lee Wong, so nobody is suggested.
    ])
  })

  it('skips accounts and teammates already matched', async () => {
    github(
      {
        'acme/app': [
          [
            { id: 1, login: 'octojane' },
            { id: 2, login: 'rkumar' },
          ],
        ],
      },
      {
        octojane: { id: 1, login: 'octojane', email: 'jane@acme.test' },
        rkumar: { id: 2, login: 'rkumar' },
      }
    )
    const result = await suggestGitHubPeople({
      accessToken: 'tok',
      repositories: ['acme/app'],
      teammates,
      mappedAccountIds: new Set(['1']),
      mappedPrincipalIds: new Set(['principal_ravi']),
    })
    expect(result.suggestions).toEqual([])
    // The matched account is never looked up.
    expect(calls).not.toContain('/users/octojane')
  })

  it('looks a login up, refusing what GitHub could not have', async () => {
    github({}, { octo: { id: 7, login: 'Octo', name: 'Octo Cat', email: 'o@x.test' } })
    expect(await getGitHubUser('tok', 'octo')).toEqual({
      id: '7',
      login: 'Octo',
      name: 'Octo Cat',
      avatarUrl: null,
      email: 'o@x.test',
    })
    expect(await getGitHubUser('tok', 'ghost')).toBeNull()
    expect(await getGitHubUser('tok', '../repos/x')).toBeNull()
    expect(calls).toEqual(['/users/octo', '/users/ghost'])
  })
})
