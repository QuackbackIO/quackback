import type { ChannelDescriptor } from './types'

/** `owner/repo#201` from an issue html_url, or null. */
export function githubIssueRefFromUrl(url: unknown): string | null {
  if (typeof url !== 'string' || !url) return null
  const match = url.match(/github\.com\/([^/]+\/[^/]+)\/issues\/(\d+)/i)
  if (!match) return null
  return `${match[1]}#${match[2]}`
}

export interface GitHubIssuePerson {
  principalId: string
  displayName: string
  avatarUrl: string | null
}

/** Distinct authors on a GitHub issue thread (visitor + agent, not notes). */
export function githubIssuePeopleFromMessages(
  messages: Array<{
    senderType: string
    isInternal?: boolean
    author?: { principalId: string; displayName: string | null; avatarUrl: string | null } | null
  }>
): GitHubIssuePerson[] {
  const people: GitHubIssuePerson[] = []
  for (const message of messages) {
    if (message.senderType === 'system' || message.isInternal || !message.author) continue
    if (people.some((person) => person.principalId === message.author!.principalId)) continue
    people.push({
      principalId: message.author.principalId,
      displayName: message.author.displayName ?? 'GitHub user',
      avatarUrl: message.author.avatarUrl,
    })
  }
  return people
}

export const githubDescriptor: ChannelDescriptor = {
  id: 'github',
  label: 'GitHub',
  icon: 'github',
  surface: 'theirs',
  threading: 'per-thread',
  reopenOnReply: 'never',
  accountRoles: ['connection'],
  richText: 'limited',
  addressing: 'thread',
  closeSurface: 'native',
  nativeObject: 'issue',
}
