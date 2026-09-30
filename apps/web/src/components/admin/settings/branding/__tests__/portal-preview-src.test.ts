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
import { portalPreviewSrc } from '../portal-preview'

type Validate = (search: Record<string, unknown>) => Record<string, unknown>

const layoutSearch = (PortalLayout.options as unknown as { validateSearch: Validate })
  .validateSearch
const homeSearch = (PortalHome.options as unknown as { validateSearch: { parse: Validate } })
  .validateSearch

describe('portalPreviewSrc', () => {
  it.each(['light', 'dark'] as const)('is the canonical portal home address (%s)', (theme) => {
    const src = portalPreviewSrc(theme)
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
