/**
 * Making, listing and revoking preview links each need the branding
 * permission, checked before any link is read or written.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PERMISSIONS } from '@/lib/shared/permissions'

const hoisted = vi.hoisted(() => ({
  granted: [] as string[],
  handlers: [] as Array<(input: { data: unknown }) => Promise<unknown>>,
  create: vi.fn(async () => ({ ok: true })),
  list: vi.fn(async () => []),
  revoke: vi.fn(async () => ({ ok: true })),
}))

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    const builder = {
      validator: () => builder,
      handler(fn: (input: { data: unknown }) => Promise<unknown>) {
        hoisted.handlers.push(fn)
        return fn
      },
    }
    return builder
  },
}))
vi.mock('../auth-helpers', () => ({
  requireAuth: async ({ permission }: { permission: string }) => {
    if (!hoisted.granted.includes(permission)) throw new Error('Forbidden')
    return { principal: { id: 'principal_1' }, permissions: hoisted.granted }
  },
}))
vi.mock('@/lib/server/domains/design/design-author', () => ({
  designAuthor: async () => ({ principalId: 'principal_1' }),
}))
vi.mock('@/lib/server/domains/design/preview-links', () => ({
  createPreviewLink: hoisted.create,
  listPreviewLinks: hoisted.list,
  revokePreviewLink: hoisted.revoke,
}))

await import('../portal-design-preview')
const [list, create, revoke] = hoisted.handlers
const calls = [
  () => list!({ data: undefined }),
  () => create!({ data: undefined }),
  () => revoke!({ data: { id: 'portal_design_preview_1' } }),
]

beforeEach(() => {
  hoisted.create.mockClear()
  hoisted.list.mockClear()
  hoisted.revoke.mockClear()
})

describe('preview link server functions', () => {
  it('turn away a teammate who may not change the branding, touching no link', async () => {
    hoisted.granted = [PERMISSIONS.SETTINGS_MANAGE]
    for (const call of calls) await expect(call()).rejects.toThrow('Forbidden')
    expect(hoisted.create).not.toHaveBeenCalled()
    expect(hoisted.list).not.toHaveBeenCalled()
    expect(hoisted.revoke).not.toHaveBeenCalled()
  })

  it('let in someone who may change the branding', async () => {
    hoisted.granted = [PERMISSIONS.SETTINGS_BRANDING]
    for (const call of calls) await call()
    expect(hoisted.create).toHaveBeenCalledTimes(1)
    expect(hoisted.list).toHaveBeenCalledTimes(1)
    expect(hoisted.revoke).toHaveBeenCalledWith('portal_design_preview_1', {
      principalId: 'principal_1',
    })
  })
})
