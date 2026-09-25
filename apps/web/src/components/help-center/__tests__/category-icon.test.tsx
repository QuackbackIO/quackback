// @vitest-environment happy-dom
/**
 * CategoryIcon renders the icon a category stores (a heroicon export name).
 * The picker offers the whole 20px solid set, but a help-center page only
 * shows a handful of icons: rendering one of the common ones must not load
 * the full set (category-icon-map), and every icon the picker can store must
 * still render exactly as its heroicon does, including across hydration.
 */
import type { ReactElement } from 'react'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'
import { hydrateRoot } from 'react-dom/client'
import { renderToStaticMarkup, renderToString } from 'react-dom/server'
import { BookOpenIcon, BeakerIcon, FolderIcon } from '@heroicons/react/20/solid'
import type { HeroIcon } from '../category-icon-map'

const loads = { iconMap: 0 }

/** A fresh module registry whose full icon set counts each time it loads. */
function freshModules() {
  vi.resetModules()
  loads.iconMap = 0
  vi.doMock('../category-icon-map', async (importOriginal) => {
    loads.iconMap++
    return importOriginal()
  })
}

type CategoryIconModule = typeof import('../category-icon')

const CLASS = 'size-5 text-primary'
const markup = (Icon: HeroIcon) => renderToStaticMarkup(<Icon className={CLASS} />)

async function renderSettled(mod: CategoryIconModule, ui: ReactElement) {
  let result!: ReturnType<typeof render>
  await act(async () => {
    result = render(ui)
  })
  // Let a pending load of the full set land and the icon re-render.
  await act(async () => {
    await mod.loadCategoryIconMap().catch(() => {})
  })
  return result
}

beforeEach(() => {
  freshModules()
})

afterEach(() => {
  cleanup()
})

describe('CategoryIcon', () => {
  it('renders a common icon without loading the full icon set', async () => {
    const { CategoryIcon } = await import('../category-icon')

    const { container } = render(<CategoryIcon icon="BookOpenIcon" className={CLASS} />)

    expect(container.innerHTML).toBe(markup(BookOpenIcon))
    expect(loads.iconMap).toBe(0)
  })

  it('renders the default folder for a missing or non-heroicon value without loading the set', async () => {
    const { CategoryIcon } = await import('../category-icon')

    for (const icon of [null, '', '\u{1F4DA}', 'constructor', 'toString']) {
      const { container, unmount } = render(<CategoryIcon icon={icon} className={CLASS} />)
      expect(container.innerHTML, String(icon)).toBe(markup(FolderIcon))
      unmount()
    }
    expect(loads.iconMap).toBe(0)
  })

  it('loads the full set for an icon outside the common ones', async () => {
    const mod = await import('../category-icon')

    const { container } = await renderSettled(
      mod,
      <mod.CategoryIcon icon="BeakerIcon" className={CLASS} />
    )

    expect(container.innerHTML).toBe(markup(BeakerIcon))
    expect(loads.iconMap).toBe(1)
  })

  it('falls back to the folder for an unknown icon name', async () => {
    const mod = await import('../category-icon')

    const { container } = await renderSettled(
      mod,
      <mod.CategoryIcon icon="NotARealIcon" className={CLASS} />
    )

    expect(container.innerHTML).toBe(markup(FolderIcon))
  })

  it('renders every icon the picker offers exactly as its heroicon', async () => {
    const mod = await import('../category-icon')
    const { ICON_MAP, ALL_ICON_KEYS } = await import('../category-icon-map')
    expect(ALL_ICON_KEYS.length).toBeGreaterThan(300)

    for (const key of ALL_ICON_KEYS) {
      const { container, unmount } = await renderSettled(
        mod,
        <mod.CategoryIcon icon={key} className={CLASS} />
      )
      expect(container.innerHTML, key).toBe(markup(ICON_MAP[key]!))
      unmount()
    }
  })

  it('hydrates a server-rendered icon outside the common set without a mismatch', async () => {
    // The server holds the full set; the browser has not fetched it yet.
    const server = await import('../category-icon')
    await server.loadCategoryIconMap()
    const html = renderToString(<server.CategoryIcon icon="BeakerIcon" className={CLASS} />)
    expect(html).toContain(markup(BeakerIcon))

    freshModules()
    const client = await import('../category-icon')
    const container = document.createElement('div')
    container.innerHTML = html
    document.body.appendChild(container)
    const recoverable = vi.fn()

    await act(async () => {
      hydrateRoot(container, <client.CategoryIcon icon="BeakerIcon" className={CLASS} />, {
        onRecoverableError: recoverable,
      })
    })
    // While the set loads, the server's icon stays on screen.
    expect(container.querySelector('svg')?.outerHTML).toBe(markup(BeakerIcon))

    await act(async () => {
      await client.loadCategoryIconMap()
    })
    expect(loads.iconMap).toBe(1)
    expect(container.querySelector('svg')?.outerHTML).toBe(markup(BeakerIcon))
    expect(recoverable).not.toHaveBeenCalled()
    container.remove()
  })
})
