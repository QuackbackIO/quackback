/**
 * The help center sitemap.
 *
 * Journeys: HC-P-20.
 */
import { test, expect } from '../../support/fixtures'
import { supportDb } from '../../support/db'
import {
  articlePath,
  collectionPath,
  gateToSegments,
  hcApi,
  hcArticle,
  hcCategory,
  hcSegment,
} from '../../product/help-center'

test(
  'HC-P-20 /hc/sitemap.xml lists public collections and published articles only',
  { tag: '@core' },
  async ({ request, marker, playwright }) => {
    const hc = await hcApi(playwright)
    const open = await hcCategory(hc, `Mapped ${marker}`)
    const closed = await hcCategory(hc, `Unmapped ${marker}`, { isPublic: false })
    const live = await hcArticle(hc, {
      categoryId: open.id,
      title: `Live ${marker}`,
      publish: true,
    })
    const hidden = [
      await hcArticle(hc, { categoryId: open.id, title: `Draft ${marker}` }),
      await hcArticle(hc, { categoryId: closed.id, title: `Private ${marker}`, publish: true }),
      await hcArticle(hc, { categoryId: open.id, title: `Gated ${marker}`, publish: true }),
      await hcArticle(hc, { categoryId: open.id, title: `Deleted ${marker}`, publish: true }),
      await hcArticle(hc, { categoryId: open.id, title: `Future ${marker}`, publish: true }),
    ]
    await gateToSegments({ kind: 'article', uuid: hidden[2].uuid }, [(await hcSegment(marker)).id])
    await hc.delete(`/api/v1/help-center/articles/${hidden[3].id}`)
    await supportDb()`UPDATE kb_articles SET published_at = NOW() + interval '1 day'
      WHERE id = ${hidden[4].uuid}`

    const res = await request.get('/hc/sitemap.xml')
    expect(res.status()).toBe(200)
    expect(res.headers()['content-type']).toContain('application/xml')
    expect(res.headers()['cache-control']).toBe('public, max-age=3600')
    expect(res.headers()['vary']).toMatch(/Host/i)
    const xml = await res.text()
    const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => new URL(m[1]).pathname)
    expect(locs).toContain('/hc')
    expect(locs).toContain(articlePath(live))
    expect(locs).toContain(collectionPath(open))
    expect(locs).not.toContain(collectionPath(closed))
    for (const a of hidden) expect(locs, a.title).not.toContain(articlePath(a))
    const entry = xml.split('<url>').find((u) => u.includes(articlePath(live)))
    expect(entry).toMatch(/<lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/)
  }
)
