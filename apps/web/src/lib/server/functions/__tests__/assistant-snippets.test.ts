/**
 * Snippet server fns: permission gate + boundary validation. createServerFn
 * is stubbed to a directly-callable fn (mirrors assistant-guidance.test.ts)
 * so the real zod validator runs on each call.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PERMISSIONS } from '@/lib/shared/permissions'

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    let _schema: { parse: (v: unknown) => unknown } | null = null
    let _handler: ((args: { data: unknown }) => Promise<unknown>) | null = null
    const fn = async (args?: { data: unknown }) => {
      if (!_handler) throw new Error('handler not registered')
      return _handler({ data: _schema ? _schema.parse(args?.data) : args?.data })
    }
    fn.validator = (schema: { parse: (v: unknown) => unknown }) => {
      _schema = schema
      return fn
    }
    fn.handler = (h: (args: { data: unknown }) => Promise<unknown>) => {
      _handler = h
      return fn
    }
    return fn
  },
}))

const hoisted = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  createSnippet: vi.fn(),
  listSnippets: vi.fn(),
  updateSnippet: vi.fn(),
  deleteSnippet: vi.fn(),
}))

vi.mock('@/lib/server/functions/auth-helpers', () => ({ requireAuth: hoisted.requireAuth }))
vi.mock('@/lib/server/domains/assistant/snippet.service', () => ({
  createSnippet: hoisted.createSnippet,
  listSnippets: hoisted.listSnippets,
  updateSnippet: hoisted.updateSnippet,
  deleteSnippet: hoisted.deleteSnippet,
}))

import {
  listSnippetsFn,
  createSnippetFn,
  updateSnippetFn,
  deleteSnippetFn,
} from '../assistant-snippets'

beforeEach(() => {
  vi.clearAllMocks()
  hoisted.requireAuth.mockResolvedValue({ principal: { id: 'principal_admin' } })
  hoisted.listSnippets.mockResolvedValue([])
})

describe('permission gates', () => {
  it('every fn gates on assistant.manage', async () => {
    await listSnippetsFn()
    expect(hoisted.requireAuth).toHaveBeenLastCalledWith({
      permission: PERMISSIONS.ASSISTANT_MANAGE,
    })

    hoisted.createSnippet.mockResolvedValue({ id: 'assistant_snippet_1' })
    await createSnippetFn({ data: { title: 'Refund window', content: 'Refunds within 30 days.' } })
    expect(hoisted.requireAuth).toHaveBeenLastCalledWith({
      permission: PERMISSIONS.ASSISTANT_MANAGE,
    })

    hoisted.updateSnippet.mockResolvedValue({ id: 'assistant_snippet_1' })
    await updateSnippetFn({ data: { id: 'assistant_snippet_1', enabled: false } })
    expect(hoisted.requireAuth).toHaveBeenLastCalledWith({
      permission: PERMISSIONS.ASSISTANT_MANAGE,
    })

    hoisted.deleteSnippet.mockResolvedValue(undefined)
    await deleteSnippetFn({ data: { id: 'assistant_snippet_1' } })
    expect(hoisted.requireAuth).toHaveBeenLastCalledWith({
      permission: PERMISSIONS.ASSISTANT_MANAGE,
    })
  })

  it('propagates an auth rejection without touching the domain layer', async () => {
    hoisted.requireAuth.mockRejectedValue(new Error('Access denied'))
    await expect(listSnippetsFn()).rejects.toThrow('Access denied')
    expect(hoisted.listSnippets).not.toHaveBeenCalled()
  })
})

describe('listSnippetsFn', () => {
  it('returns every snippet (enabled or not)', async () => {
    hoisted.listSnippets.mockResolvedValue([{ id: 'assistant_snippet_1', enabled: false }])
    const result = await listSnippetsFn()
    expect(hoisted.listSnippets).toHaveBeenCalledWith()
    expect(result).toEqual([{ id: 'assistant_snippet_1', enabled: false }])
  })
})

describe('createSnippetFn', () => {
  it('rejects a title over 120 characters at the boundary', async () => {
    await expect(
      createSnippetFn({ data: { title: 'x'.repeat(121), content: 'Body.' } })
    ).rejects.toThrow()
    expect(hoisted.createSnippet).not.toHaveBeenCalled()
  })

  it('rejects content over 2000 characters at the boundary', async () => {
    await expect(
      createSnippetFn({ data: { title: 'Title', content: 'x'.repeat(2001) } })
    ).rejects.toThrow()
    expect(hoisted.createSnippet).not.toHaveBeenCalled()
  })

  it('rejects an unknown audience at the boundary', async () => {
    await expect(
      createSnippetFn({
        data: { title: 'Title', content: 'Body.', audience: 'super-secret' } as never,
      })
    ).rejects.toThrow()
    expect(hoisted.createSnippet).not.toHaveBeenCalled()
  })

  it('passes a valid snippet through with the caller as creator', async () => {
    hoisted.createSnippet.mockResolvedValue({ id: 'assistant_snippet_1' })
    const result = await createSnippetFn({
      data: { title: 'Refund window', content: 'Refunds within 30 days.', audience: 'public' },
    })
    expect(result).toEqual({ id: 'assistant_snippet_1' })
    expect(hoisted.createSnippet).toHaveBeenCalledWith({
      title: 'Refund window',
      content: 'Refunds within 30 days.',
      audience: 'public',
      enabled: undefined,
      createdById: 'principal_admin',
    })
  })
})

describe('updateSnippetFn', () => {
  it('rejects an unknown audience at the boundary', async () => {
    await expect(
      updateSnippetFn({ data: { id: 'assistant_snippet_1', audience: 'super-secret' } as never })
    ).rejects.toThrow()
    expect(hoisted.updateSnippet).not.toHaveBeenCalled()
  })

  it('passes a partial patch through to the domain layer', async () => {
    hoisted.updateSnippet.mockResolvedValue({ id: 'assistant_snippet_1', enabled: false })
    const result = await updateSnippetFn({
      data: { id: 'assistant_snippet_1', enabled: false },
    })
    expect(result).toEqual({ id: 'assistant_snippet_1', enabled: false })
    expect(hoisted.updateSnippet).toHaveBeenCalledWith('assistant_snippet_1', {
      title: undefined,
      content: undefined,
      audience: undefined,
      enabled: false,
    })
  })
})

describe('deleteSnippetFn', () => {
  it('deletes by id', async () => {
    hoisted.deleteSnippet.mockResolvedValue(undefined)
    const result = await deleteSnippetFn({ data: { id: 'assistant_snippet_1' } })
    expect(result).toEqual({ id: 'assistant_snippet_1' })
    expect(hoisted.deleteSnippet).toHaveBeenCalledWith('assistant_snippet_1')
  })
})
