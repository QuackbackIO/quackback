// @vitest-environment happy-dom
/**
 * The editor's publish flow: a clean draft has nothing to publish, a publish
 * makes the draft the new live baseline, a plan refusal of the Advanced CSS
 * rules can publish everything else with the rules parked, and someone else's
 * change can be loaded into the draft or published over.
 */
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LoadedPortal } from '../portal-draft'
import { editLogo, editTheme } from '../portal-draft'

const { mutateAsync, track } = vi.hoisted(() => ({ mutateAsync: vi.fn(), track: vi.fn() }))

vi.mock('@/lib/client/analytics', () => ({ track: (...args: unknown[]) => track(...args) }))

vi.mock('@/lib/client/mutations/settings', () => ({
  usePublishPortalCustomisation: () => ({ mutateAsync }),
}))
vi.mock('@tanstack/react-router', () => ({
  useBlocker: () => ({ status: 'idle' }),
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import { conflictPartNames, usePortalEditor } from '../use-portal-editor'

const loaded: LoadedPortal = {
  theme: { themeMode: 'user' },
  customCss: '',
  portal: { nav: { items: [{ id: 'feedback', type: 'feedback' }] } } as LoadedPortal['portal'],
  helpCenter: null,
}

const planRefusal = (feature: string) =>
  Object.assign(new Error(`${feature} is a Business feature. Upgrade to Business to enable it.`), {
    code: 'TIER_LIMIT',
    name: 'TierLimitError',
  })

beforeEach(() => mutateAsync.mockReset())

describe('usePortalEditor', () => {
  it('has nothing to publish while clean', async () => {
    const { result } = renderHook(() => usePortalEditor(loaded))
    expect(result.current.dirty).toBe(false)
    await act(() => result.current.publish())
    expect(mutateAsync).not.toHaveBeenCalled()
  })

  it('makes the published draft the new baseline', async () => {
    mutateAsync.mockResolvedValue({ ok: true, parts: ['theme'], published: {} })
    const { result } = renderHook(() => usePortalEditor(loaded))
    act(() => result.current.update((d) => ({ ...d, buttonShape: 'corners' })))
    expect(result.current.changes).toEqual(['Buttons'])

    await act(() => result.current.publish())

    expect(mutateAsync).toHaveBeenCalledTimes(1)
    expect(result.current.dirty).toBe(false)
    // Counted with the parts it changed, never their values.
    expect(track).toHaveBeenCalledWith('portal_customise_published', { parts: ['theme'] })
  })

  it('publishes the rest after a refusal of the Advanced CSS rules, rules parked', async () => {
    const { result } = renderHook(() => usePortalEditor(loaded))
    act(() =>
      result.current.update((d) => editTheme.setCssText(d, `${d.cssText}\n\n.x { color: red; }`))
    )
    mutateAsync.mockRejectedValueOnce(planRefusal('Custom CSS'))
    await act(() => result.current.publish())
    expect(result.current.planRefusal?.customCss).toBe(true)

    mutateAsync.mockResolvedValueOnce({ ok: true, parts: ['theme'], published: {} })
    await act(() => result.current.publishRest())

    expect(mutateAsync.mock.calls[1]![0].customCss).toBeUndefined()
    expect(result.current.parked).toBe(true)
    expect(result.current.dirty).toBe(false)
  })

  it('loads their change into the draft for the parts they changed', async () => {
    const { result } = renderHook(() => usePortalEditor(loaded))
    act(() => result.current.update((d) => ({ ...d, nav: d.nav.slice().reverse() })))
    const theirNav = { items: [{ id: 'roadmap', type: 'roadmap' }] }
    mutateAsync.mockRejectedValueOnce(
      Object.assign(new Error('changed'), {
        conflict: {
          ok: false,
          code: 'SETTINGS_CHANGED',
          message: 'changed',
          parts: ['portal.nav'],
          current: { portal: { nav: theirNav } },
        },
      })
    )
    await act(() => result.current.publish())
    expect(result.current.conflict?.parts).toEqual(['portal.nav'])

    act(() => result.current.loadTheirs())

    expect(result.current.draft.nav[0]).toEqual({ id: 'roadmap', type: 'roadmap' })
    expect(result.current.dirty).toBe(false)
    expect(result.current.conflict).toBeNull()
  })

  it('publishes over their change with their values as before', async () => {
    const { result } = renderHook(() => usePortalEditor(loaded))
    act(() => result.current.update((d) => ({ ...d, nav: d.nav.slice().reverse() })))
    const theirNav = { items: [{ id: 'roadmap', type: 'roadmap' }] }
    mutateAsync.mockRejectedValueOnce(
      Object.assign(new Error('changed'), {
        conflict: {
          ok: false,
          code: 'SETTINGS_CHANGED',
          message: 'changed',
          parts: ['portal.nav'],
          current: { portal: { nav: theirNav } },
        },
      })
    )
    await act(() => result.current.publish())
    mutateAsync.mockResolvedValueOnce({ ok: true, parts: ['portal.nav'], published: {} })

    await act(() => result.current.keepMine())

    expect(mutateAsync.mock.calls[1]![0].before.portal.nav).toEqual(theirNav)
    expect(result.current.dirty).toBe(false)
  })

  it('counts a header colour on its own as a change to publish', () => {
    const { result } = renderHook(() => usePortalEditor(loaded))
    act(() => result.current.update((d) => editTheme.setColour(d, 'header', 'light', '#0b1f3a')))
    expect(result.current.changes).toEqual(['Colours'])
    expect(result.current.dirty).toBe(true)
  })

  it('discards back to live as one undoable step', () => {
    const { result } = renderHook(() => usePortalEditor(loaded))
    act(() => result.current.update((d) => ({ ...d, buttonShape: 'corners' })))
    act(() => result.current.discard())
    expect(result.current.dirty).toBe(false)
    act(() => result.current.undo())
    expect(result.current.draft.buttonShape).toBe('corners')
  })

  it('loads their wide logo into the draft when they changed it', async () => {
    const { result } = renderHook(() => usePortalEditor(loaded))
    act(() => result.current.update((d) => editLogo.setUploadedWide(d, 'header-logos/mine.svg')))
    mutateAsync.mockRejectedValueOnce(
      Object.assign(new Error('changed'), {
        conflict: {
          ok: false,
          code: 'SETTINGS_CHANGED',
          message: 'changed',
          parts: ['logo.wideKey', 'logo.headerDisplayMode'],
          current: {
            logo: { wideKey: 'header-logos/theirs.png', headerDisplayMode: 'custom_logo' },
          },
        },
      })
    )
    await act(() => result.current.publish())
    act(() => result.current.loadTheirs())

    expect(result.current.draft.logo).toEqual({
      wideKey: 'header-logos/theirs.png',
      mode: 'custom_logo',
      icon: null,
    })
    expect(result.current.dirty).toBe(false)
  })

  it('loads their icon into the draft when they changed it, naming it Icon', async () => {
    const { result } = renderHook(() => usePortalEditor(loaded))
    const theirs = { key: 'logos/theirs.png', faviconKey: 'favicons/theirs.png' }
    act(() =>
      result.current.update((d) =>
        editLogo.setUploadedIcon(d, { key: 'logos/mine.png', faviconKey: 'favicons/mine.png' })
      )
    )
    mutateAsync.mockRejectedValueOnce(
      Object.assign(new Error('changed'), {
        conflict: {
          ok: false,
          code: 'SETTINGS_CHANGED',
          message: 'changed',
          parts: ['logo.icon'],
          current: { logo: { icon: theirs } },
        },
      })
    )
    await act(() => result.current.publish())
    expect(conflictPartNames(['logo.icon'])).toEqual(['Icon'])
    act(() => result.current.loadTheirs())
    expect(result.current.draft.logo.icon).toEqual(theirs)
    expect(result.current.dirty).toBe(false)
  })

  it('keeps the wide logo it published as before when the next publish changes only the mode', async () => {
    const { result } = renderHook(() => usePortalEditor(loaded))
    act(() => result.current.update((d) => editLogo.setUploadedWide(d, 'header-logos/w.svg')))
    mutateAsync.mockResolvedValueOnce({
      ok: true,
      parts: ['logo.wideKey', 'logo.headerDisplayMode'],
      published: { logo: { wideKey: 'header-logos/w.svg', headerDisplayMode: 'custom_logo' } },
    })
    await act(() => result.current.publish())
    act(() => result.current.update((d) => editLogo.showSquare(d)))
    mutateAsync.mockResolvedValueOnce({
      ok: true,
      parts: ['logo.headerDisplayMode'],
      published: { logo: { headerDisplayMode: 'logo_and_name' } },
    })
    await act(() => result.current.publish())
    act(() => result.current.update((d) => editLogo.removeWide(d)))
    mutateAsync.mockResolvedValueOnce({ ok: true, parts: [], published: {} })
    await act(() => result.current.publish())

    expect(mutateAsync.mock.calls[2]![0].before.logo).toEqual({ wideKey: 'header-logos/w.svg' })
  })

  describe('imported brand assets at Publish', () => {
    const brand = {
      host: 'northwind.com',
      logo: { kind: 'wide' as const, stagedKey: 'header-logos/n.svg', url: '/n.svg' },
      icon: { key: 'logos/n.png', faviconKey: 'favicons/n.png', url: '/n.png' },
    }
    const withImport = (portalOnSite = false) => {
      const hook = renderHook(() => usePortalEditor(loaded))
      act(() => hook.result.current.setImportedBrand({ ...brand, portalOnSite }))
      act(() =>
        hook.result.current.update((d) =>
          editLogo.setUploadedIcon(editLogo.setUploadedWide(d, brand.logo.stagedKey), {
            key: brand.icon.key,
            faviconKey: brand.icon.faviconKey,
          })
        )
      )
      return hook
    }
    const ok = (parts: string[]) => ({ ok: true, parts, published: {} })

    it('asks before putting them live, and publishes nothing until confirmed', async () => {
      const { result } = withImport()
      await act(() => result.current.publish())
      expect(mutateAsync).not.toHaveBeenCalled()
      expect(result.current.assetCheck).toMatchObject({ assets: ['logo', 'icon'], parkCss: false })
      // Cancel publishes nothing and keeps the draft.
      act(() => result.current.dismissAssetCheck())
      expect(result.current.assetCheck).toBeNull()
      expect(result.current.dirty).toBe(true)
    })

    it('records the confirmation as clicked, never pre-ticked, and does not ask again', async () => {
      const { result } = withImport()
      await act(() => result.current.publish())
      mutateAsync.mockResolvedValue(ok(['logo.wideKey', 'logo.icon']))
      await act(() => result.current.publish({ confirmed: ['logo', 'icon'] }))
      expect(mutateAsync).toHaveBeenCalledTimes(1)
      expect(mutateAsync.mock.calls[0]![0].brandAssets).toEqual({
        host: 'northwind.com',
        assets: ['logo', 'icon'],
        preTicked: [],
      })
      expect(result.current.assetCheck).toBeNull()
      // Live now: a later publish of something else asks nothing and records nothing.
      act(() => result.current.update((d) => ({ ...d, buttonShape: 'corners' })))
      await act(() => result.current.publish())
      expect(mutateAsync).toHaveBeenCalledTimes(2)
      expect(result.current.assetCheck).toBeNull()
      expect(mutateAsync.mock.calls[1]![0].brandAssets).toBeUndefined()
    })

    it('asks only about what is not confirmed yet, for a retry after someone else’s change', async () => {
      const { result } = withImport()
      await act(() => result.current.publish())
      mutateAsync.mockRejectedValueOnce(
        Object.assign(new Error('changed'), {
          conflict: {
            ok: false,
            code: 'SETTINGS_CHANGED',
            message: 'changed',
            parts: ['portal.nav'],
            current: {},
          },
        })
      )
      await act(() => result.current.publish({ confirmed: ['logo', 'icon'] }))
      expect(result.current.conflict).not.toBeNull()
      mutateAsync.mockResolvedValueOnce(ok(['logo.wideKey', 'logo.icon']))
      await act(() => result.current.keepMine())
      expect(result.current.assetCheck).toBeNull()
      expect(mutateAsync).toHaveBeenCalledTimes(2)
      expect(mutateAsync.mock.calls[1]![0].brandAssets?.assets).toEqual(['logo', 'icon'])
    })

    it('publishes the draft it is given, with dropped assets left out', async () => {
      const { result } = withImport()
      await act(() => result.current.publish())
      const dropped = {
        ...result.current.draft,
        logo: { ...result.current.draft.logo, icon: null },
      }
      act(() => result.current.update(() => dropped))
      mutateAsync.mockResolvedValue(ok(['logo.wideKey']))
      await act(() => result.current.publish({ draft: dropped, confirmed: ['logo'] }))
      const input = mutateAsync.mock.calls[0]![0]
      expect(input.logo.icon).toBeUndefined()
      expect(input.brandAssets).toEqual({ host: 'northwind.com', assets: ['logo'], preTicked: [] })
      expect(result.current.dirty).toBe(false)
    })

    it('opens the confirmation when the server refuses unconfirmed assets, never the conflict', async () => {
      // The editor took the domain as the site's own; the server did not.
      const { result } = withImport(true)
      mutateAsync.mockRejectedValueOnce(
        Object.assign(new Error('confirm'), {
          conflict: {
            ok: false,
            code: 'BRAND_ASSETS_UNCONFIRMED',
            message: 'confirm',
            assets: ['logo'],
          },
        })
      )
      await act(() => result.current.publish())
      expect(result.current.conflict).toBeNull()
      expect(result.current.assetCheck).toMatchObject({ assets: ['logo'] })
      // Confirmed by a click now: recorded as such, not as a pre-tick.
      mutateAsync.mockResolvedValueOnce(ok(['logo.wideKey', 'logo.icon']))
      await act(() => result.current.publish({ confirmed: ['logo'] }))
      expect(mutateAsync.mock.calls[1]![0].brandAssets).toEqual({
        host: 'northwind.com',
        assets: ['logo', 'icon'],
        preTicked: ['icon'],
      })
      expect(result.current.assetCheck).toBeNull()
    })

    it('asks nothing on the site’s own domain, and records the assets as pre-ticked', async () => {
      const { result } = withImport(true)
      mutateAsync.mockResolvedValue(ok(['logo.wideKey', 'logo.icon']))
      await act(() => result.current.publish())
      expect(result.current.assetCheck).toBeNull()
      expect(mutateAsync.mock.calls[0]![0].brandAssets).toEqual({
        host: 'northwind.com',
        assets: ['logo', 'icon'],
        preTicked: ['logo', 'icon'],
      })
    })
  })

  describe('Before, After and Live', () => {
    it('shows the draft, with nothing to compare, while nothing has changed', () => {
      const { result } = renderHook(() => usePortalEditor(loaded))
      expect(result.current.view).toBe('after')
      expect(result.current.shown).toBe(result.current.draft)
      expect(result.current.canBefore).toBe(false)
      expect(result.current.canLive).toBe(false)
      // A view that is not on offer is not taken.
      act(() => result.current.setView('before'))
      act(() => result.current.setView('live'))
      expect(result.current.view).toBe('after')
    })

    it('Before shows the draft as it was just before the last change', () => {
      const { result } = renderHook(() => usePortalEditor(loaded))
      act(() => result.current.update((d) => ({ ...d, buttonShape: 'corners' })))
      const first = result.current.draft
      act(() => result.current.update((d) => editTheme.setRadius(d, 0)))
      expect(result.current.canBefore).toBe(true)
      act(() => result.current.setView('before'))
      expect(result.current.view).toBe('before')
      expect(result.current.shown).toBe(first)
      // Only the preview looks back: the draft, and what would publish, stay.
      expect(result.current.draft).not.toBe(first)
      expect(result.current.changes).toEqual(['Corners', 'Buttons'])
    })

    it('Live shows the published look', () => {
      const { result } = renderHook(() => usePortalEditor(loaded))
      act(() => result.current.update((d) => ({ ...d, buttonShape: 'corners' })))
      expect(result.current.canLive).toBe(true)
      act(() => result.current.setView('live'))
      expect(result.current.view).toBe('live')
      expect(result.current.shown).toBe(result.current.baseline)
      expect(result.current.shown.buttonShape).toBe('pill')
    })

    it('goes back to After on any new edit, and on undo', () => {
      const { result } = renderHook(() => usePortalEditor(loaded))
      act(() => result.current.update((d) => ({ ...d, buttonShape: 'corners' })))
      act(() => result.current.setView('live'))
      act(() => result.current.update((d) => editTheme.setRadius(d, 0)))
      expect(result.current.view).toBe('after')
      expect(result.current.shown).toBe(result.current.draft)
      act(() => result.current.setView('before'))
      act(() => result.current.undo())
      expect(result.current.view).toBe('after')
    })

    it('has no Live to compare once the draft is the published look again', async () => {
      mutateAsync.mockResolvedValue({ ok: true, parts: ['theme'], published: {} })
      const { result } = renderHook(() => usePortalEditor(loaded))
      act(() => result.current.update((d) => ({ ...d, buttonShape: 'corners' })))
      act(() => result.current.setView('live'))
      await act(() => result.current.publish())
      expect(result.current.canLive).toBe(false)
      expect(result.current.view).toBe('after')
      // The step before the publish is still there to look back at.
      expect(result.current.canBefore).toBe(true)
      act(() => result.current.update((d) => ({ ...d, buttonShape: 'pill' })))
      act(() => result.current.discard())
      expect(result.current.canLive).toBe(false)
    })
  })
})
