// @vitest-environment happy-dom
/**
 * Publish asks before imported brand assets go live: each is listed, can be
 * left out, and the one button is the confirmation. Nothing is ticked for
 * the person; Cancel publishes nothing.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: ReactNode }) => <a>{children}</a>,
}))
vi.mock('@/components/admin/upgrade', () => ({ UpgradeModal: () => null }))

const { PortalEditorDialogs } = await import('../editor-dialogs')
type Editor = Parameters<typeof PortalEditorDialogs>[0]['editor']

const files = [{ key: 'fonts/s.woff2', weight: 400, style: 'normal' as const }]
const brand = {
  host: 'northwind.com',
  logo: { kind: 'wide' as const, stagedKey: 'header-logos/n.svg', url: '/n.svg' },
  icon: { key: 'logos/n.png', faviconKey: 'favicons/n.png', url: '/n.png' },
  siteFont: { family: 'Calibre', licence: 'commercial' as const, files },
}

function show() {
  const dismissAssetCheck = vi.fn()
  const onPublishAssets = vi.fn()
  const editor = {
    blocker: { status: 'idle' },
    conflict: null,
    planRefusal: null,
    changes: [],
    assetCheck: { brand, assets: ['logo', 'icon', 'font'], parkCss: false },
    dismissAssetCheck,
  } as unknown as Editor
  render(<PortalEditorDialogs editor={editor} onPublishAssets={onPublishAssets} />)
  return { dismissAssetCheck, onPublishAssets }
}

afterEach(cleanup)

describe('the brand assets confirmation at Publish', () => {
  it('lists each asset with its picture or name, and nothing ticked', () => {
    show()
    const dialog = screen.getByRole('alertdialog')
    expect(dialog).toHaveTextContent('Can you use these?')
    expect(dialog).toHaveTextContent('They came from northwind.com.')
    expect([...dialog.querySelectorAll('img')].map((img) => img.getAttribute('src'))).toEqual([
      '/n.svg',
      '/n.png',
    ])
    expect(dialog).toHaveTextContent('Calibre, text font')
    expect(screen.queryByRole('checkbox')).toBeNull()
    expect(dialog.textContent).not.toContain('—')
  })

  it('confirms them all with the one button', () => {
    const { onPublishAssets } = show()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm and publish' }))
    expect(onPublishAssets).toHaveBeenCalledWith(['logo', 'icon', 'font'], [])
  })

  it('leaves one out, puts it back, and publishes without what stays out', () => {
    const { onPublishAssets } = show()
    fireEvent.click(screen.getByRole('button', { name: 'Leave out Icon' }))
    fireEvent.click(screen.getByRole('button', { name: 'Leave out Logo' }))
    fireEvent.click(screen.getByRole('button', { name: 'Put back Logo' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm and publish' }))
    expect(onPublishAssets).toHaveBeenCalledWith(['logo', 'font'], ['icon'])
  })

  it('says so when everything is left out', () => {
    const { onPublishAssets } = show()
    for (const name of ['Logo', 'Icon', 'Calibre, text font'])
      fireEvent.click(screen.getByRole('button', { name: `Leave out ${name}` }))
    fireEvent.click(screen.getByRole('button', { name: 'Publish without them' }))
    expect(onPublishAssets).toHaveBeenCalledWith([], ['logo', 'icon', 'font'])
  })

  it('publishes nothing on Cancel', () => {
    const { dismissAssetCheck, onPublishAssets } = show()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(dismissAssetCheck).toHaveBeenCalled()
    expect(onPublishAssets).not.toHaveBeenCalled()
  })
})
