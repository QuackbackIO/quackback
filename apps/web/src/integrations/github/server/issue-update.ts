/**
 * GitHub's guarded issue write, for repositories that update their issues
 * automatically (`applyAutomatically`, see `sync/issue-updates.ts`).
 *
 * Compare, then write:
 *
 * 1. Read the issue.
 * 2. Write nothing, and report a conflict for review, when it changed on
 *    GitHub since we last saw it: its state differs from the one recorded on
 *    the link, or it was updated after then and its timeline since shows a
 *    change to what we write (closed or reopened, renamed, labelled or
 *    unlabelled, assigned or unassigned, transferred). Comments and
 *    cross-references move `updated_at` without touching what we write, so
 *    they alone are no conflict (our own reply comments among them).
 * 3. Write only what differs: labels through the add and remove endpoints
 *    (removing only labels present, and only the ones asked for), then one
 *    PATCH with the changed fields, last, so its response is the issue's new
 *    version. A body is replaced only while it still carries the marker this
 *    connection wrote for this ticket.
 *
 * GitHub has no conditional write for issues (no If-Match), so a change
 * landing between the read and the writes is not detected. That window is
 * a request's length; it is why this is an opt-in per repository.
 */
import { integrationFetch } from '@/lib/server/integrations/sync/transport'
import { issueError } from '@/lib/server/integrations/message-utils'
import type { IssueUpdateArgs, IssueUpdateResult } from '@/lib/server/integrations/types'
import { githubHeaders, numericId, rejected, repository } from './ticket-comment'
import { ticketReferenceIn } from './ticket-issue'

const GITHUB_API = 'https://api.github.com'

/** Timeline events that change something this write sets. */
const CONFLICTING_EVENTS = new Set([
  'closed',
  'reopened',
  'renamed',
  'labeled',
  'unlabeled',
  'assigned',
  'unassigned',
  'transferred',
])

/** How far back the timeline is read before giving up and asking for a review. */
const TIMELINE_PAGES = 10
const TIMELINE_PAGE_SIZE = 100

interface GitHubIssue {
  number: number
  state: 'open' | 'closed'
  state_reason?: string | null
  title: string
  body: string | null
  updated_at: string
  labels: Array<{ name?: string } | string>
  assignees?: Array<{ login: string }> | null
  pull_request?: unknown
}

/** The issue's state as the inbound parser names it (`GITHUB_ISSUE_STATES`). */
export function githubIssueStateName(issue: Pick<GitHubIssue, 'state' | 'state_reason'>): string {
  if (issue.state !== 'closed') return 'Open'
  return issue.state_reason === 'not_planned' ? 'Closed (not planned)' : 'Closed'
}

function labelNames(issue: GitHubIssue): string[] {
  return issue.labels
    .map((label) => (typeof label === 'string' ? label : label.name))
    .filter((name): name is string => typeof name === 'string')
}

const lower = (value: string) => value.toLowerCase()

async function readIssue(auth: Record<string, unknown>, ownerRepo: string, number: string) {
  const response = await integrationFetch(`${GITHUB_API}/repos/${ownerRepo}/issues/${number}`, {
    headers: githubHeaders(auth.accessToken),
  })
  if (!response.ok) throw await rejected(response, ownerRepo)
  const issue = (await response.json()) as GitHubIssue
  if (issue.pull_request || String(issue.number) !== number)
    throw issueError('Expected an issue', { retryable: false, status: 422 })
  return issue
}

/**
 * Whether the timeline since `since` holds a change to what we write. True
 * too when it is longer than we read: what cannot be checked is a conflict.
 */
async function changedSince(
  auth: Record<string, unknown>,
  ownerRepo: string,
  number: string,
  since: Date
): Promise<boolean> {
  for (let page = 1; page <= TIMELINE_PAGES; page++) {
    const response = await integrationFetch(
      `${GITHUB_API}/repos/${ownerRepo}/issues/${number}/timeline?per_page=${TIMELINE_PAGE_SIZE}&page=${page}`,
      { headers: githubHeaders(auth.accessToken) }
    )
    if (!response.ok) throw await rejected(response, ownerRepo)
    const events = (await response.json()) as Array<{ event?: string; created_at?: string }>
    for (const event of events) {
      if (!event.event || !CONFLICTING_EVENTS.has(event.event)) continue
      const at = Date.parse(event.created_at ?? '')
      // An event without a time cannot be placed before the baseline.
      if (!Number.isFinite(at) || at > since.getTime()) return true
    }
    if (events.length < TIMELINE_PAGE_SIZE) return false
  }
  return true
}

export async function updateGitHubIssue(args: IssueUpdateArgs): Promise<IssueUpdateResult> {
  const { auth, change, baseline } = args
  const ownerRepo = repository(auth)
  const number = numericId(args.issueId, 'issue number')
  const issue = await readIssue(auth, ownerRepo, number)

  const state = githubIssueStateName(issue)
  if (baseline.state && baseline.state !== state) return { outcome: 'conflict', reason: 'state' }
  if (
    Date.parse(issue.updated_at) > baseline.at.getTime() &&
    (await changedSince(auth, ownerRepo, number, baseline.at))
  )
    return { outcome: 'conflict', reason: 'activity' }

  const patch: Record<string, unknown> = {}
  const changed: string[] = []
  if (change.state) {
    const reason =
      change.state.state === 'closed' ? (change.state.stateReason ?? 'completed') : null
    const sameReason =
      change.state.state === 'open' || (issue.state_reason ?? 'completed') === reason
    if (issue.state !== change.state.state || !sameReason) {
      patch.state = change.state.state
      if (reason) patch.state_reason = reason
      else if (issue.state === 'closed') patch.state_reason = 'reopened'
      changed.push('state')
    }
  }
  if (change.title !== undefined && change.title !== issue.title) {
    patch.title = change.title
    changed.push('title')
  }
  if (change.body !== undefined && change.body !== (issue.body ?? '')) {
    const ours = ticketReferenceIn(issue.body)
    if (ours?.ticketId === args.ticketId && ours.integrationId === args.integrationId) {
      patch.body = change.body
      changed.push('body')
    }
  }
  if (change.assignees) {
    const current = (issue.assignees ?? []).map((a) => lower(a.login)).sort()
    const next = [...new Set(change.assignees.map(lower))].sort()
    if (current.join('\n') !== next.join('\n')) {
      patch.assignees = change.assignees
      changed.push('assignees')
    }
  }
  const present = new Set(labelNames(issue).map(lower))
  const add = [...new Set(change.labels?.add ?? [])].filter((name) => !present.has(lower(name)))
  const wanted = new Set((change.labels?.add ?? []).map(lower))
  const remove = labelNames(issue).filter(
    (name) =>
      !wanted.has(lower(name)) &&
      (change.labels?.remove ?? []).some((r) => lower(r) === lower(name))
  )
  if (add.length || remove.length) changed.push('labels')

  if (changed.length === 0)
    return { outcome: 'unchanged', version: issue.updated_at, state, changed }
  if (!(await args.beforeWrite())) return { outcome: 'cancelled' }

  const base = `${GITHUB_API}/repos/${ownerRepo}/issues/${number}`
  const headers = githubHeaders(auth.accessToken)
  for (const name of remove) {
    // 404: the label is already off the issue.
    const response = await integrationFetch(
      `${base}/labels/${encodeURIComponent(name)}`,
      { method: 'DELETE', headers },
      { settled: [404] }
    )
    if (!response.ok && response.status !== 404) throw await rejected(response, ownerRepo)
  }
  if (add.length) {
    // GitHub creates a label the repository does not have yet.
    const response = await integrationFetch(`${base}/labels`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ labels: add }),
    })
    if (!response.ok) throw await rejected(response, ownerRepo)
  }
  let updated: GitHubIssue
  if (Object.keys(patch).length) {
    const response = await integrationFetch(base, {
      method: 'PATCH',
      headers,
      body: JSON.stringify(patch),
    })
    if (!response.ok) throw await rejected(response, ownerRepo)
    updated = (await response.json()) as GitHubIssue
  } else updated = await readIssue(auth, ownerRepo, number)
  return {
    outcome: 'updated',
    version: updated.updated_at,
    state: githubIssueStateName(updated),
    changed,
  }
}
