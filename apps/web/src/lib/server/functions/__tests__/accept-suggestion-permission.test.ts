/**
 * Accepting a merge suggestion merges two posts, so it needs post.merge as
 * well as suggestion.manage, like merging by hand (FBA-M-11).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PERMISSIONS } from '@/lib/shared/permissions'
import type { PermissionKey } from '@/lib/server/db'

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
  held: [] as string[],
  acceptMergeSuggestion: vi.fn(),
}))

function deny(permission: string) {
  if (!hoisted.held.includes(permission)) {
    throw new Error(`Access denied: Requires permission '${permission}', role member lacks it`)
  }
}

vi.mock('@/lib/server/functions/auth-helpers', () => {
  const ctx = () => ({
    principal: { id: 'principal_x', role: 'member', type: 'user' },
    permissions: [...hoisted.held] as PermissionKey[],
    scope: 'dashboard',
  })
  return {
    requireAuth: vi.fn(async (opts?: { permission?: string }) => {
      if (opts?.permission) deny(opts.permission)
      return ctx()
    }),
    assertPermission: (_auth: unknown, permission: string) => deny(permission),
  }
})

vi.mock('@/lib/server/domains/merge-suggestions/merge-suggestion.service', () => ({
  acceptMergeSuggestion: hoisted.acceptMergeSuggestion,
  dismissMergeSuggestion: vi.fn(),
}))

const { acceptSuggestionFn } = await import('../feedback')
const { createId } = await import('@quackback/ids')

const call = (id: string) =>
  (acceptSuggestionFn as unknown as (a: { data: { id: string } }) => Promise<unknown>)({
    data: { id },
  })

describe('acceptSuggestionFn', () => {
  beforeEach(() => {
    hoisted.acceptMergeSuggestion.mockReset()
  })

  it('refuses a caller with suggestion.manage but not post.merge, and merges nothing', async () => {
    hoisted.held = [PERMISSIONS.SUGGESTION_MANAGE]
    await expect(call(createId('post_merge_suggestion'))).rejects.toThrow(/post\.merge/)
    expect(hoisted.acceptMergeSuggestion).not.toHaveBeenCalled()
  })

  it('accepts for a caller holding both', async () => {
    hoisted.held = [PERMISSIONS.SUGGESTION_MANAGE, PERMISSIONS.POST_MERGE]
    await expect(call(createId('post_merge_suggestion'))).resolves.toEqual({ success: true })
    expect(hoisted.acceptMergeSuggestion).toHaveBeenCalledOnce()
  })
})
