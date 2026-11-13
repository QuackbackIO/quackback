/**
 * GitHub accounts for matching to teammates: who can be assigned issues in
 * the synced repositories, one account looked up by login, and suggested
 * matches against the workspace's teammates. Suggestions are only proposals;
 * a teammate is matched when someone accepts one.
 */
import { integrationFetch } from '@/lib/server/integrations/sync/transport'
import { issueError } from '@/lib/server/integrations/message-utils'

const GITHUB_API = 'https://api.github.com'

/** Pages of 100 assignees read per repository. */
const ASSIGNEE_PAGES_PER_REPOSITORY = 3
/** Distinct accounts considered across all repositories. */
const MAX_ACCOUNTS = 300
/** Profile lookups (for a name and public email) per suggestion run. */
const MAX_PROFILE_LOOKUPS = 50

/** GitHub's login charset: alphanumerics and single hyphens, up to 39 characters. */
export const GITHUB_LOGIN_RE = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/

export interface GitHubAccount {
  /** GitHub's numeric user id, as a string. */
  id: string
  login: string
  name: string | null
  avatarUrl: string | null
}

export interface GitHubPersonSuggestion {
  account: GitHubAccount
  principalId: string
  teammateName: string | null
  teammateEmail: string | null
  /** What matched, strongest first: the public email, the login, or the name. */
  reason: 'email' | 'login' | 'name'
}

interface GitHubUserPayload {
  id: number
  login: string
  name?: string | null
  email?: string | null
  avatar_url?: string | null
  type?: string
}

async function githubGet(accessToken: string, path: string): Promise<Response> {
  return integrationFetch(`${GITHUB_API}${path}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'quackback',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  })
}

function account(user: GitHubUserPayload): GitHubAccount {
  return {
    id: String(user.id),
    login: user.login,
    name: user.name?.trim() || null,
    avatarUrl: user.avatar_url ?? null,
  }
}

/** The accounts that can be assigned issues in a repository (users, not bots), up to a cap. */
export async function listGitHubAssignees(
  accessToken: string,
  ownerRepo: string,
  pages = ASSIGNEE_PAGES_PER_REPOSITORY
): Promise<GitHubAccount[]> {
  const found: GitHubAccount[] = []
  for (let page = 1; page <= pages; page++) {
    const response = await githubGet(
      accessToken,
      `/repos/${ownerRepo}/assignees?per_page=100&page=${page}`
    )
    if (!response.ok)
      throw issueError(`Could not list the people of ${ownerRepo}`, { status: response.status })
    const batch = (await response.json()) as GitHubUserPayload[]
    found.push(...batch.filter((u) => u.type !== 'Bot').map(account))
    if (batch.length < 100) break
  }
  return found
}

/** One account by login, or null when GitHub has none. */
export async function getGitHubUser(
  accessToken: string,
  login: string
): Promise<(GitHubAccount & { email: string | null }) | null> {
  if (!GITHUB_LOGIN_RE.test(login)) return null
  const response = await githubGet(accessToken, `/users/${login}`)
  if (response.status === 404) return null
  if (!response.ok) throw issueError(`Could not look up @${login}`, { status: response.status })
  const user = (await response.json()) as GitHubUserPayload
  return { ...account(user), email: user.email?.trim() || null }
}

const normalizeName = (value: string | null | undefined) =>
  (value ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
const compact = (value: string | null | undefined) =>
  (value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')

/**
 * Suggest a teammate for each assignable account of the given repositories
 * that is not matched yet. An account's public email matching a teammate's
 * email is the strongest signal; then its login matching the local part of a
 * teammate's email or their name with spaces and punctuation removed; then
 * its display name matching a teammate's name. A tier that matches more than
 * one teammate suggests nothing, and each teammate is suggested once.
 */
export async function suggestGitHubPeople(input: {
  accessToken: string
  repositories: string[]
  teammates: Array<{ principalId: string; name: string | null; email: string | null }>
  mappedAccountIds: ReadonlySet<string>
  mappedPrincipalIds: ReadonlySet<string>
}): Promise<{ scanned: number; suggestions: GitHubPersonSuggestion[] }> {
  const accounts = new Map<string, GitHubAccount>()
  for (const repository of input.repositories) {
    if (accounts.size >= MAX_ACCOUNTS) break
    for (const found of await listGitHubAssignees(input.accessToken, repository))
      if (accounts.size < MAX_ACCOUNTS) accounts.set(found.id, found)
  }
  const teammates = input.teammates.filter((t) => !input.mappedPrincipalIds.has(t.principalId))
  const unmatched = [...accounts.values()].filter((a) => !input.mappedAccountIds.has(a.id))

  const candidates: GitHubPersonSuggestion[] = []
  for (const candidate of unmatched.slice(0, MAX_PROFILE_LOOKUPS)) {
    const profile = await getGitHubUser(input.accessToken, candidate.login)
    const person = profile ?? { ...candidate, email: null }
    const email = person.email?.toLowerCase() ?? null
    const tiers: Array<
      [GitHubPersonSuggestion['reason'], (t: (typeof teammates)[number]) => boolean]
    > = [
      ['email', (t) => !!email && t.email?.toLowerCase() === email],
      [
        'login',
        (t) =>
          compact(person.login) !== '' &&
          (compact(t.email?.split('@')[0]) === compact(person.login) ||
            compact(t.name) === compact(person.login)),
      ],
      ['name', (t) => !!person.name && normalizeName(t.name) === normalizeName(person.name)],
    ]
    for (const [reason, matches] of tiers) {
      const hits = teammates.filter(matches)
      if (hits.length === 0) continue
      if (hits.length === 1)
        candidates.push({
          account: {
            id: person.id,
            login: person.login,
            name: person.name,
            avatarUrl: person.avatarUrl,
          },
          principalId: hits[0].principalId,
          teammateName: hits[0].name,
          teammateEmail: hits[0].email,
          reason,
        })
      break
    }
  }

  const rank = { email: 0, login: 1, name: 2 } as const
  const suggested = new Set<string>()
  const suggestions = candidates
    .sort(
      (a, b) => rank[a.reason] - rank[b.reason] || a.account.login.localeCompare(b.account.login)
    )
    .filter((s) => (suggested.has(s.principalId) ? false : (suggested.add(s.principalId), true)))
  return { scanned: accounts.size, suggestions }
}
