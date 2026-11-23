/**
 * The portal preview frames the portal home at the exact address the portal
 * routes canonicalize its search to. Any other spelling (a missing default,
 * `preview=1` for the boolean) answers with a redirect first, one more round
 * trip before the preview can start loading.
 */
import { describe, expect, it } from 'vitest'
import { defaultParseSearch } from '@tanstack/react-router'
import { Route as PortalLayout } from '@/routes/_portal'
import { Route as PortalHome } from '@/routes/_portal/index'
import { Route as PortalRoadmap } from '@/routes/_portal/roadmap.index'
import { portalPreviewSrc } from '../portal-preview'

type Validate = (search: Record<string, unknown>) => Record<string, unknown>

const layoutSearch = (PortalLayout.options as unknown as { validateSearch: Validate })
  .validateSearch
const homeSearch = (PortalHome.options as unknown as { validateSearch: { parse: Validate } })
  .validateSearch

const roadmapSearch = (PortalRoadmap.options as unknown as { validateSearch: { parse: Validate } })
  .validateSearch

describe('portalPreviewSrc', () => {
  it.each(['light', 'dark'] as const)('is the canonical portal home address (%s)', (theme) => {
    const src = portalPreviewSrc(theme, '/')
    expect(src.startsWith('/?')).toBe(true)
    const search = defaultParseSearch(src.slice(1))

    const canonical = Object.fromEntries(
      Object.entries({ ...layoutSearch(search), ...homeSearch.parse(search) }).filter(
        ([, value]) => value !== undefined
      )
    )
    expect(canonical).toEqual(search)
    expect(search).toMatchObject({ theme, preview: true })
  })
})

describe('portalPreviewSrc for the other pages', () => {
  it.each([
    ['/roadmap', (search: Record<string, unknown>) => roadmapSearch.parse(search)],
    ['/changelog', () => ({})],
    ['/hc', () => ({})],
  ] as const)('frames %s at its canonical address', (path, pageSearch) => {
    const src = portalPreviewSrc('dark', path)
    const [pathname, query] = src.split('?')
    expect(pathname).toBe(path)
    const search = defaultParseSearch(query!)
    const canonical = Object.fromEntries(
      Object.entries({ ...layoutSearch(search), ...pageSearch(search) }).filter(
        ([, value]) => value !== undefined
      )
    )
    expect(canonical).toEqual(search)
    expect(search).toMatchObject({ theme: 'dark', preview: true })
  })
})
