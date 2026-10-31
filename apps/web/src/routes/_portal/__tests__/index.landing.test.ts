/**
 * The portal's root: Home when it is on, else the first page the menu shows.
 * An old link to the feed at the root follows it to /feedback once Home leads,
 * and the legacy theme keeps the feed at the root.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { defaultDesign } from '@/lib/shared/design/schema'

const hoisted = vi.hoisted(() => ({
  feeds: [] as string[],
  prefetched: 0,
  preloaded: 0,
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: object) => ({ options }),
  redirect: (options: object) => ({ redirect: options }),
}))
vi.mock('@/lib/server/functions/powered-by', () => ({ getShowPoweredByFn: async () => false }))
vi.mock('@/components/public/home/home-prefetch', () => ({
  prefetchHome: () => {
    hoisted.prefetched++
  },
}))
vi.mock('../feedback', async () => {
  const paths = await import('@/lib/shared/design/paths')
  return {
    feedHead: () => ({}),
    feedSearchSchema: z.object({}).passthrough(),
    loadFeed: async (_context: unknown, _location: unknown, canonical: string) => {
      hoisted.feeds.push(canonical)
      return { workspaceName: 'Acme', baseUrl: '', canonicalPath: canonical, showPoweredBy: false }
    },
    portalPathsOf: (context: {
      settings: { portalDesign?: { engine: string; nav?: unknown } }
    }) => {
      const design = context.settings.portalDesign
      return {
        settings:
          design?.engine === 'v2' ? { engine: 'v2', nav: design.nav } : { engine: 'legacy' },
        gates: paths.portalPageGates(
          { featureFlags: { feedback: true, helpCenter: true } as never },
          false
        ),
      }
    },
    Route: {
      options: {
        component: Object.assign(() => null, {
          preload: async () => {
            hoisted.preloaded++
          },
        }),
      },
    },
  }
})

const { Route } = (await import('../index')) as unknown as {
  Route: { options: { loader: (args: unknown) => Promise<unknown> } }
}

function load(settings: unknown, search: Record<string, unknown> = {}) {
  return Route.options.loader({
    context: { settings, session: null, baseUrl: '', queryClient: {} },
    location: { search },
  })
}

function v2(edit: (doc: ReturnType<typeof defaultDesign>) => void = () => {}) {
  const doc = defaultDesign()
  edit(doc)
  return {
    name: 'Acme',
    portalDesign: {
      engine: 'v2',
      nav: doc.nav,
      home: doc.pages.home,
      feedback: { defaultSort: 'trending' },
    },
  }
}

beforeEach(() => {
  hoisted.feeds = []
  hoisted.prefetched = 0
  hoisted.preloaded = 0
})

describe('the portal root', () => {
  it('shows the feed on the legacy theme, loading its chunk here', async () => {
    expect(await load({ name: 'Acme' })).toMatchObject({ landing: 'feed', canonicalPath: '/' })
    expect(hoisted.feeds).toEqual(['/'])
    expect(hoisted.preloaded).toBe(1)
  })

  it('shows Home when it is on, starting its blocks’ data', async () => {
    expect(await load(v2((doc) => (doc.nav.home.on = true)))).toMatchObject({ landing: 'home' })
    expect(hoisted.prefetched).toBe(1)
    expect(hoisted.feeds).toEqual([])
  })

  it('sends an old feed link on to /feedback for good once Home leads', async () => {
    await expect(
      load(
        v2((doc) => (doc.nav.home.on = true)),
        { board: 'bugs' }
      )
    ).rejects.toEqual({
      redirect: { to: '/feedback', search: { board: 'bugs' }, statusCode: 301 },
    })
  })

  it('sends the root to the first page in the menu, for now', async () => {
    const settings = v2((doc) => {
      doc.nav.items = [
        { type: 'help', shown: true },
        { type: 'feedback', shown: true },
      ]
    })
    await expect(load(settings)).rejects.toEqual({ redirect: { href: '/hc', statusCode: 302 } })
  })

  it('sends a workspace that is not set up to onboarding', async () => {
    await expect(load(null)).rejects.toEqual({ redirect: { to: '/onboarding' } })
  })
})
