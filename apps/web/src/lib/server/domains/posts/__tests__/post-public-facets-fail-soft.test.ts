/**
 * FBP-L-17: the filter panel counts are extra. When the count query fails,
 * the portal feed still loads, without counts (null), and the error is logged
 * rather than thrown.
 */
import { expect, it, vi } from 'vitest'
import type { Actor } from '@/lib/server/policy'

vi.mock('@/lib/server/db', async (original) => {
  const actual = await original<typeof import('@/lib/server/db')>()
  const broken = new Proxy(
    {},
    {
      get() {
        return () => {
          throw new Error('facet query failed')
        }
      },
    }
  )
  return { ...actual, db: broken }
})

const { countPublicPostFacets, countPublicPostFacetsOrNull } = await import('../post.public.facets')

const ANONYMOUS = {
  principalType: 'anonymous',
  principalId: null,
  role: 'user',
} as unknown as Actor

it('the strict count throws when its query fails', async () => {
  await expect(countPublicPostFacets({}, ANONYMOUS)).rejects.toThrow('facet query failed')
})

it('the feed variant answers null instead, so the feed loads without counts', async () => {
  await expect(countPublicPostFacetsOrNull({}, ANONYMOUS)).resolves.toBeNull()
})
