/**
 * GitHub's guarded issue write: it reads the issue, writes nothing when the
 * issue changed on GitHub since the baseline (its state differs, or its
 * timeline since shows a change to what we write), and otherwise writes only
 * what differs: labels through the add and remove endpoints, the rest in one
 * PATCH, last. A body is replaced only while it carries this connection's
 * marker for the ticket.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { githubIssueStateName, updateGitHubIssue } from '../issue-update'
import { ticketIssueMarker } from '../ticket-issue'
import type { IssueUpdateArgs } from '@/lib/server/integrations/types'

const TICKET = 'ticket_01h455vb4pex5vsknk084sn02q'
const INTEGRATION = 'integration_01h455vb4pex5vsknk084sn02q'
const BASELINE = new Date('2026-10-01T10:00:00Z')

type Call = { method: string; path: string; search: string; body?: Record<string, unknown> }

let calls: Call[]
let issue: Record<string, unknown>
let timeline: Array<Record<string, unknown>>

function baseIssue(over: Record<string, unknown> = {}) {
  return {
    number: 7,
    state: 'open',
    state_reason: null,
    title: 'Export fails',
    body: `Steps\n\n${ticketIssueMarker(TICKET, INTEGRATION)}`,
    updated_at: '2026-10-01T09:00:00Z',
    labels: [{ name: 'bug' }, { name: 'on-hold' }, { name: 'priority:low' }],
    assignees: [],
    ...over,
  }
}

beforeEach(() => {
  calls = []
  issue = baseIssue()
  timeline = []
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = new URL(String(input))
    const call: Call = {
      method: init?.method ?? 'GET',
      path: url.pathname,
      search: url.search,
      ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}),
    }
    calls.push(call)
    if (call.path.endsWith('/timeline')) return Response.json(timeline)
    if (call.method === 'GET') return Response.json(issue)
    if (call.method === 'PATCH')
      return Response.json({ ...issue, ...call.body, updated_at: '2026-10-02T12:00:00Z' })
    if (call.method === 'DELETE') return new Response(null, { status: 200 })
    return Response.json([])
  })
})
afterEach(() => vi.restoreAllMocks())

function args(over: Partial<IssueUpdateArgs> = {}): IssueUpdateArgs {
  return {
    auth: { accessToken: 'tok', channelId: 'acme/api' },
    issueId: '7',
    ticketId: TICKET,
    integrationId: INTEGRATION,
    baseline: { state: 'Open', at: BASELINE },
    change: {},
    beforeWrite: vi.fn(async () => true),
    ...over,
  }
}

const writes = () => calls.filter((c) => c.method !== 'GET')

describe('githubIssueStateName', () => {
  it('names states as the inbound parser does', () => {
    expect(githubIssueStateName({ state: 'open' })).toBe('Open')
    expect(githubIssueStateName({ state: 'closed', state_reason: 'completed' })).toBe('Closed')
    expect(githubIssueStateName({ state: 'closed', state_reason: 'not_planned' })).toBe(
      'Closed (not planned)'
    )
  })
})

describe('updateGitHubIssue', () => {
  it('closes as completed with only the changed fields, then swaps only our status label', async () => {
    const a = args({
      change: {
        state: { state: 'closed', stateReason: 'completed' },
        labels: { add: [], remove: ['on-hold', 'waiting-on-customer'] },
      },
    })
    const result = await updateGitHubIssue(a)
    expect(result).toEqual({
      outcome: 'updated',
      version: '2026-10-02T12:00:00Z',
      state: 'Closed',
      changed: ['state', 'labels'],
    })
    expect(a.beforeWrite).toHaveBeenCalledOnce()
    expect(writes().map((c) => `${c.method} ${c.path}`)).toEqual([
      'DELETE /repos/acme/api/issues/7/labels/on-hold',
      'PATCH /repos/acme/api/issues/7',
    ])
    expect(writes()[1].body).toEqual({ state: 'closed', state_reason: 'completed' })
  })

  it('closes as not planned, and reopens a closed issue', async () => {
    await updateGitHubIssue(
      args({ change: { state: { state: 'closed', stateReason: 'not_planned' } } })
    )
    expect(writes()[0].body).toEqual({ state: 'closed', state_reason: 'not_planned' })

    calls = []
    issue = baseIssue({ state: 'closed', state_reason: 'completed' })
    const result = await updateGitHubIssue(
      args({ baseline: { state: 'Closed', at: BASELINE }, change: { state: { state: 'open' } } })
    )
    expect(writes()[0].body).toEqual({ state: 'open', state_reason: 'reopened' })
    expect(result).toMatchObject({ outcome: 'updated', state: 'Open' })
  })

  it('adds a missing label and leaves every label it was not asked to remove', async () => {
    const result = await updateGitHubIssue(
      args({
        change: {
          state: { state: 'open' },
          labels: { add: ['waiting-on-customer'], remove: ['waiting-on-customer', 'on-hold'] },
        },
      })
    )
    expect(writes().map((c) => `${c.method} ${c.path}`)).toEqual([
      'DELETE /repos/acme/api/issues/7/labels/on-hold',
      'POST /repos/acme/api/issues/7/labels',
    ])
    expect(writes()[1].body).toEqual({ labels: ['waiting-on-customer'] })
    // No PATCH: the issue is read again for its new version.
    expect(calls.at(-1)).toMatchObject({ method: 'GET', path: '/repos/acme/api/issues/7' })
    expect(result).toMatchObject({ outcome: 'updated', changed: ['labels'] })
  })

  it('swaps the priority label', async () => {
    await updateGitHubIssue(
      args({
        change: {
          labels: {
            add: ['priority:high'],
            remove: ['priority:low', 'priority:medium', 'priority:high', 'priority:urgent'],
          },
        },
      })
    )
    expect(writes().map((c) => `${c.method} ${c.path}`)).toEqual([
      'DELETE /repos/acme/api/issues/7/labels/priority%3Alow',
      'POST /repos/acme/api/issues/7/labels',
    ])
  })

  it('writes nothing when nothing differs', async () => {
    const a = args({ change: { state: { state: 'open' }, title: 'Export fails' } })
    expect(await updateGitHubIssue(a)).toEqual({
      outcome: 'unchanged',
      version: '2026-10-01T09:00:00Z',
      state: 'Open',
      changed: [],
    })
    expect(a.beforeWrite).not.toHaveBeenCalled()
    expect(writes()).toEqual([])
  })

  it('refuses, writing nothing, when the state differs from the one last seen', async () => {
    issue = baseIssue({ state: 'closed', state_reason: 'completed' })
    const a = args({ change: { title: 'Renamed' } })
    expect(await updateGitHubIssue(a)).toEqual({ outcome: 'conflict', reason: 'state' })
    expect(a.beforeWrite).not.toHaveBeenCalled()
    expect(writes()).toEqual([])
  })

  it('refuses when the timeline since the baseline changes what we write', async () => {
    issue = baseIssue({ updated_at: '2026-10-01T11:00:00Z' })
    timeline = [
      { event: 'labeled', created_at: '2026-09-30T08:00:00Z' },
      { event: 'renamed', created_at: '2026-10-01T10:30:00Z' },
    ]
    const a = args({ change: { title: 'Renamed' } })
    expect(await updateGitHubIssue(a)).toEqual({ outcome: 'conflict', reason: 'activity' })
    expect(calls.some((c) => c.path.endsWith('/timeline'))).toBe(true)
    expect(writes()).toEqual([])
  })

  it('writes when the issue only gained comments since the baseline', async () => {
    issue = baseIssue({ updated_at: '2026-10-01T11:00:00Z' })
    timeline = [
      { event: 'labeled', created_at: '2026-09-30T08:00:00Z' },
      { event: 'commented', created_at: '2026-10-01T10:30:00Z' },
      { event: 'cross-referenced', created_at: '2026-10-01T10:40:00Z' },
    ]
    const result = await updateGitHubIssue(args({ change: { title: 'Renamed' } }))
    expect(result).toMatchObject({ outcome: 'updated', changed: ['title'] })
    expect(writes()[0].body).toEqual({ title: 'Renamed' })
  })

  it('treats a timeline longer than it reads as a conflict', async () => {
    issue = baseIssue({ updated_at: '2026-10-01T11:00:00Z' })
    timeline = Array.from({ length: 100 }, () => ({
      event: 'commented',
      created_at: '2026-10-01T10:30:00Z',
    }))
    expect(await updateGitHubIssue(args({ change: { title: 'Renamed' } }))).toEqual({
      outcome: 'conflict',
      reason: 'activity',
    })
    expect(calls.filter((c) => c.path.endsWith('/timeline'))).toHaveLength(10)
  })

  it('replaces the body only while it carries our marker for this ticket', async () => {
    const body = `New body\n\n${ticketIssueMarker(TICKET, INTEGRATION)}`
    await updateGitHubIssue(args({ change: { title: 'Renamed', body } }))
    expect(writes()[0].body).toEqual({ title: 'Renamed', body })

    for (const written of [
      'Written by a person',
      `Ours once\n\n${ticketIssueMarker('ticket_01h455vb4pex5vsknk084sn02r', INTEGRATION)}`,
    ]) {
      calls = []
      issue = baseIssue({ body: written })
      await updateGitHubIssue(args({ change: { title: 'Renamed', body } }))
      expect(writes()[0].body).toEqual({ title: 'Renamed' })
    }
  })

  it('sets assignees, and clears them with an empty list', async () => {
    await updateGitHubIssue(args({ change: { assignees: ['octocat'] } }))
    expect(writes()[0].body).toEqual({ assignees: ['octocat'] })

    calls = []
    issue = baseIssue({ assignees: [{ login: 'octocat' }] })
    await updateGitHubIssue(args({ change: { assignees: [] } }))
    expect(writes()[0].body).toEqual({ assignees: [] })

    calls = []
    await updateGitHubIssue(args({ change: { assignees: ['OctoCat'] } }))
    expect(writes()).toEqual([])
  })

  it('writes nothing when the dispatch is declined', async () => {
    const a = args({
      change: { title: 'Renamed' },
      beforeWrite: vi.fn(async () => false),
    })
    expect(await updateGitHubIssue(a)).toEqual({ outcome: 'cancelled' })
    expect(writes()).toEqual([])
  })
})
