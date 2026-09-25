/**
 * The members page's loader warms everything the page reads on first paint,
 * the roles catalogue included (every row's actions menu lists the custom
 * roles, and the Roles tab shows them), so the page renders complete from the
 * document and the browser fetches nothing more for it.
 */
import { describe, expect, it, vi } from 'vitest'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { Route } from '../admin/settings.members'

type LoaderFn = (ctx: { context: Record<string, unknown> }) => Promise<unknown>
const loader = (Route as unknown as { options: { loader: LoaderFn } }).options.loader

describe('members settings loader', () => {
  it('warms the roster, the teams and the roles catalogue', async () => {
    const keys: string[] = []
    const queryClient = {
      ensureQueryData: vi.fn((opts: { queryKey: readonly unknown[] }) => {
        keys.push(JSON.stringify(opts.queryKey))
        return Promise.resolve(undefined)
      }),
    }
    await loader({
      context: {
        queryClient,
        permissions: [PERMISSIONS.MEMBER_VIEW],
        settings: { name: 'Acme' },
        principal: { id: 'principal_1', role: 'admin', userId: 'user_1' },
      },
    })
    expect(keys).toEqual(
      expect.arrayContaining([
        JSON.stringify(['settings', 'team']),
        JSON.stringify(['settings', 'teams']),
        JSON.stringify(['settings', 'roles']),
      ])
    )
  })
})
