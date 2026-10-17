/**
 * The Approvals page's server functions: a decision comes from the person's
 * session, a refusal comes back as a code the page can word, and the waiting
 * summary is the viewer's own.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ConflictError, ForbiddenError } from '@/lib/shared/errors'

vi.mock('@tanstack/react-start', () => ({
  createServerOnlyFn: <T>(fn: T) => fn,
  createServerFn: () => {
    let _handler: ((args: { data: unknown }) => Promise<unknown>) | null = null
    const fn = (args: { data: unknown }) => {
      if (!_handler) throw new Error('handler not registered')
      return _handler(args)
    }
    fn.validator = () => fn
    fn.handler = (h: (args: { data: unknown }) => Promise<unknown>) => {
      _handler = h
      return fn
    }
    return fn
  },
}))

const hoisted = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  policyActorFromAuth: vi.fn(),
  approveApproval: vi.fn(),
  rejectApproval: vi.fn(),
  getApprovalForViewer: vi.fn(),
  approvalViewOf: vi.fn(),
  railCountsFor: vi.fn(),
  listApprovalsForViewer: vi.fn(),
  listDecidedApprovalsForViewer: vi.fn(),
  pageApprovalsForViewer: vi.fn(),
  hasRecentSignIn: vi.fn(),
}))

vi.mock('@/lib/server/functions/auth-helpers', () => ({
  requireAuth: hoisted.requireAuth,
  policyActorFromAuth: hoisted.policyActorFromAuth,
}))
vi.mock('@/lib/server/auth/recent-sign-in', () => ({
  hasRecentSignIn: hoisted.hasRecentSignIn,
}))
vi.mock('@/lib/server/domains/assistant/approvals.service', () => ({
  approveApproval: hoisted.approveApproval,
  rejectApproval: hoisted.rejectApproval,
}))
vi.mock('@/lib/server/domains/assistant/approvals.queue', () => ({
  getApprovalForViewer: hoisted.getApprovalForViewer,
  approvalViewOf: hoisted.approvalViewOf,
  railCountsFor: hoisted.railCountsFor,
  listApprovalsForViewer: hoisted.listApprovalsForViewer,
  listDecidedApprovalsForViewer: hoisted.listDecidedApprovalsForViewer,
  pageApprovalsForViewer: hoisted.pageApprovalsForViewer,
}))

import {
  approveApprovalFn,
  approveApprovalFromEmailFn,
  listApprovalsFn,
  rejectApprovalFn,
} from '../approvals'
import { getRailCountsFn } from '../approval-counts'

const actor = { principalId: 'principal_ada', role: 'admin', principalType: 'user' }

beforeEach(() => {
  vi.clearAllMocks()
  hoisted.requireAuth.mockResolvedValue({ principal: { id: 'principal_ada' } })
  hoisted.policyActorFromAuth.mockResolvedValue(actor)
  hoisted.hasRecentSignIn.mockResolvedValue(false)
  hoisted.getApprovalForViewer.mockResolvedValue({ id: 'assistant_action_1', status: 'executed' })
  hoisted.approvalViewOf.mockImplementation(async (row: { id: string; status: string }) => ({
    ...row,
    shown: true,
  }))
})

describe('approveApprovalFn', () => {
  it('decides as the signed-in person, bound to the hash shown, and returns the request', async () => {
    hoisted.approveApproval.mockResolvedValue({ id: 'assistant_action_1', status: 'executed' })
    const result = await approveApprovalFn({
      data: { approvalId: 'assistant_action_1', contentHash: 'digest' },
    })
    expect(hoisted.approveApproval).toHaveBeenCalledWith(actor, 'assistant_action_1', {
      contentHash: 'digest',
      via: 'app',
      freshSignIn: false,
    })
    expect(result).toEqual({
      ok: true,
      approval: { id: 'assistant_action_1', status: 'executed', shown: true },
    })
  })

  it('answers from the settled request, even when the viewer can no longer read it', async () => {
    // The change moved the item out of this teammate's view; it still ran.
    hoisted.approveApproval.mockResolvedValue({ id: 'assistant_action_1', status: 'executed' })
    hoisted.getApprovalForViewer.mockRejectedValue(new Error('This request was not found.'))
    await expect(
      approveApprovalFn({ data: { approvalId: 'assistant_action_1', contentHash: 'digest' } })
    ).resolves.toEqual({
      ok: true,
      approval: { id: 'assistant_action_1', status: 'executed', shown: true },
    })
    expect(hoisted.approvalViewOf).toHaveBeenCalledWith({
      id: 'assistant_action_1',
      status: 'executed',
    })
  })

  it('returns a stale content hash as a refusal value instead of throwing', async () => {
    hoisted.approveApproval.mockRejectedValue(
      new ConflictError('APPROVAL_CONTENT_CHANGED', 'This request changed. Review it again.')
    )
    await expect(
      approveApprovalFn({ data: { approvalId: 'assistant_action_1', contentHash: 'old' } })
    ).resolves.toEqual({
      ok: false,
      code: 'APPROVAL_CONTENT_CHANGED',
      message: 'This request changed. Review it again.',
    })
    expect(hoisted.getApprovalForViewer).not.toHaveBeenCalled()
  })

  it('returns a high-risk request without a recent sign-in as RECENT_SIGN_IN_REQUIRED', async () => {
    hoisted.approveApproval.mockRejectedValue(
      new ForbiddenError('APPROVAL_SIGN_IN_REQUIRED', 'Sign in again to decide this request.')
    )
    expect(
      await approveApprovalFn({ data: { approvalId: 'assistant_action_1', contentHash: 'd' } })
    ).toEqual({
      ok: false,
      code: 'RECENT_SIGN_IN_REQUIRED',
      message: 'Sign in again to decide this request.',
    })
  })

  it('passes a recent sign-in the server confirmed for the caller', async () => {
    const auth = { principal: { id: 'principal_ada' }, user: { id: 'user_ada' } }
    hoisted.requireAuth.mockResolvedValue(auth)
    hoisted.hasRecentSignIn.mockResolvedValue(true)
    hoisted.approveApproval.mockResolvedValue({ id: 'assistant_action_1', status: 'executed' })
    await approveApprovalFn({ data: { approvalId: 'assistant_action_1', contentHash: 'd' } })
    expect(hoisted.hasRecentSignIn).toHaveBeenCalledWith(auth)
    expect(hoisted.approveApproval.mock.calls[0]![2]).toMatchObject({ freshSignIn: true })
  })

  it('never takes a recent sign-in from the request', async () => {
    hoisted.approveApproval.mockResolvedValue({ id: 'assistant_action_1', status: 'executed' })
    const forged = { approvalId: 'assistant_action_1', contentHash: 'd', freshSignIn: true }
    await approveApprovalFn({ data: forged })
    expect(hoisted.approveApproval.mock.calls[0]![2]).toMatchObject({ freshSignIn: false })
  })

  it('lets an unexpected failure through', async () => {
    hoisted.approveApproval.mockRejectedValue(new Error('connection reset'))
    await expect(
      approveApprovalFn({ data: { approvalId: 'assistant_action_1', contentHash: 'd' } })
    ).rejects.toThrow('connection reset')
  })
})

describe('rejectApprovalFn', () => {
  it('rejects with the reason and returns the request', async () => {
    hoisted.rejectApproval.mockResolvedValue({ id: 'assistant_action_1', status: 'rejected' })
    hoisted.getApprovalForViewer.mockResolvedValue({ id: 'assistant_action_1', status: 'rejected' })
    const result = await rejectApprovalFn({
      data: { approvalId: 'assistant_action_1', contentHash: 'digest', reason: 'Not now' },
    })
    expect(hoisted.rejectApproval).toHaveBeenCalledWith(actor, 'assistant_action_1', {
      contentHash: 'digest',
      reason: 'Not now',
      via: 'app',
    })
    expect(result).toEqual({
      ok: true,
      approval: { id: 'assistant_action_1', status: 'rejected', shown: true },
    })
    expect(hoisted.getApprovalForViewer).not.toHaveBeenCalled()
  })

  it('returns a refusal as its code', async () => {
    hoisted.rejectApproval.mockRejectedValue(
      new ForbiddenError('APPROVAL_SELF_DECISION', 'The requester cannot decide its own request.')
    )
    expect(
      await rejectApprovalFn({ data: { approvalId: 'assistant_action_1', contentHash: 'd' } })
    ).toEqual({
      ok: false,
      code: 'APPROVAL_SELF_DECISION',
      message: 'The requester cannot decide its own request.',
    })
  })
})

describe('reads', () => {
  it('reads the unread count and what waits on the signed-in person together', async () => {
    hoisted.requireAuth.mockResolvedValue({ principal: { id: 'principal_ada' } })
    hoisted.railCountsFor.mockResolvedValue({ unread: 3, waiting: { count: 2, latest: [] } })
    expect(await getRailCountsFn()).toEqual({ unread: 3, waiting: { count: 2, latest: [] } })
    expect(hoisted.railCountsFor).toHaveBeenCalledWith('principal_ada', expect.any(Function))
  })

  it('pages through the waiting or the decided requests', async () => {
    const page = { items: [{ id: 'assistant_action_2' }], nextCursor: 'assistant_action_2' }
    hoisted.pageApprovalsForViewer.mockResolvedValue(page)
    expect(await listApprovalsFn({ data: {} })).toEqual(page)
    expect(hoisted.pageApprovalsForViewer).toHaveBeenLastCalledWith(actor, {
      view: 'waiting',
      limit: undefined,
      cursor: undefined,
    })
    await listApprovalsFn({ data: { view: 'decided', cursor: 'assistant_action_2' } })
    expect(hoisted.pageApprovalsForViewer).toHaveBeenLastCalledWith(actor, {
      view: 'decided',
      limit: undefined,
      cursor: 'assistant_action_2',
    })
  })
})

it('email approval uses the same authority, digest and server-confirmed sign-in', async () => {
  hoisted.hasRecentSignIn.mockResolvedValue(true)
  hoisted.approveApproval.mockResolvedValue({ id: 'assistant_action_1', status: 'executed' })
  await approveApprovalFromEmailFn({
    data: { approvalId: 'assistant_action_1', contentHash: 'digest' },
  })
  expect(hoisted.approveApproval).toHaveBeenCalledWith(actor, 'assistant_action_1', {
    contentHash: 'digest',
    via: 'email',
    freshSignIn: true,
  })
})
