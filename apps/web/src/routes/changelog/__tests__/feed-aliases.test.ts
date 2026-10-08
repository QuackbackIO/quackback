import { describe, expect, it } from 'vitest'

type Handler = (ctx: { request: Request }) => Promise<Response> | Response

const loaders = {
  '/changelog/rss': () => import('../rss'),
  '/changelog/rss.xml': () => import('../rss[.]xml'),
}

describe('changelog feed aliases', () => {
  it.each(Object.keys(loaders) as (keyof typeof loaders)[])(
    '%s permanently redirects to /changelog/feed',
    async (path) => {
      const { Route } = await loaders[path]()
      const handlers = Route.options.server!.handlers as unknown as { GET: Handler }
      const res = await handlers.GET({
        request: new Request(`https://example.test${path}?x=1`),
      })
      expect(res.status).toBe(308)
      const target = new URL(res.headers.get('location')!, 'https://example.test')
      expect(target.pathname).toBe('/changelog/feed')
      expect(target.search).toBe('')
    }
  )
})
