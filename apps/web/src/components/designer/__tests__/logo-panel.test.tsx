// @vitest-environment happy-dom
/**
 * The logo, its own element in the header: a pick on the page opens it, with
 * its icon and title (or a full logo image) summed up and leading to the
 * brand kit, their one writer, then its height (16 to 64 px) and its colours.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import { defaultDesign, type PortalDesign } from '@/lib/shared/design/schema'

vi.mock('@/lib/server/functions/uploads', () => {
  const presign = async ({ data }: { data: { filename: string } }) => ({
    uploadUrl: `/upload/${data.filename}?sig=x`,
    key: `design/${data.filename}`,
  })
  return {
    getWordmarkUploadUrlFn: presign,
    getFaviconUploadUrlFn: presign,
    getShareImageUploadUrlFn: presign,
    checkS3ConfiguredFn: async () => ({ configured: true }),
  }
})
vi.mock('@/lib/client/image-palette', () => ({
  imageInk: async () => null,
  imagePalette: async () => ['#0058A3', '#FFFFFF'],
}))
vi.stubGlobal(
  'fetch',
  vi.fn(async () => new Response(null, { status: 200 }))
)

const { LogoPanel } = await import('../logo-panel')

function renderPanel(start: PortalDesign) {
  const seen = { design: start, labels: [] as string[], up: 0, kit: [] as string[] }
  function Harness() {
    const [design, setDesign] = useState(start)
    return (
      <LogoPanel
        crumbs={[
          { label: 'Home', onSelect: () => {} },
          { label: 'Header and menu', onSelect: () => (seen.up += 1) },
          { label: 'Logo' },
        ]}
        design={design}
        logoUrl="/workspace-logo.png"
        onBrandKit={(row) => seen.kit.push(row)}
        update={(change, label) => {
          const next = structuredClone(design)
          change(next)
          seen.design = next
          seen.labels.push(label ?? '')
          setDesign(next)
        }}
      />
    )
  }
  const view = render(<Harness />)
  return { seen, view }
}

afterEach(cleanup)

describe('the logo’s panel', () => {
  it('is the header’s logo, on every page, with its rows in order', () => {
    renderPanel(defaultDesign())
    expect(screen.getByRole('heading', { level: 2, name: 'Logo' })).toBeTruthy()
    expect(screen.getByRole('navigation', { name: 'Where it is' }).textContent).toContain(
      'Header and menu'
    )
    const rows = [...document.querySelectorAll('[data-property-row] > :first-child')].map(
      (label) => label.textContent
    )
    expect(rows.slice(0, 3)).toEqual(['Icon', 'Title', 'Height'])
    expect(rows).toContain('Logo colours')
  })

  it('sums up its icon and title, which the brand kit writes, and leads there', () => {
    const start = defaultDesign()
    start.brand.logo.name = 'Acme'
    const { seen } = renderPanel(start)
    // Nothing here writes them: no title field, no upload, no full logo switch.
    expect(screen.queryByRole('textbox', { name: 'Title' })).toBeNull()
    expect(screen.queryByLabelText('Replace icon')).toBeNull()
    expect(screen.queryByRole('switch', { name: 'Use a full logo image instead' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Title: Acme' }))
    fireEvent.click(screen.getByRole('button', { name: 'Icon: Workspace logo' }))
    expect(seen.kit).toEqual(['logo-title', 'logo-icon'])
  })

  it('sums up a full logo in their place, and leads to it in the brand kit', () => {
    const start = defaultDesign()
    start.brand.logo.display = 'wordmark'
    start.brand.logo.wordmark.light = { key: 'logos/full.svg' }
    const { seen } = renderPanel(start)
    expect(screen.queryByRole('button', { name: /^Icon:/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Full logo: Image' }))
    expect(seen.kit).toEqual(['logo-full'])
  })

  it('sets its height from 16 to 64 px, 32 storing nothing', () => {
    const { seen } = renderPanel(defaultDesign())
    const height = screen.getByLabelText('Height') as HTMLInputElement
    expect(height.placeholder).toBe('32')
    fireEvent.change(height, { target: { value: '48' } })
    fireEvent.blur(height)
    expect(seen.design.brand.logo.height).toBe(48)
    expect(seen.labels.at(-1)).toBe('Logo height')
    fireEvent.change(height, { target: { value: '200' } })
    fireEvent.blur(height)
    expect(seen.design.brand.logo.height).toBe(64)
    fireEvent.click(screen.getByRole('button', { name: 'Reset to 32 px' }))
    expect(seen.design.brand.logo).not.toHaveProperty('height')
  })

  it('has no height while the logo is its title alone', () => {
    const start = defaultDesign()
    start.brand.logo.display = 'name'
    renderPanel(start)
    expect(screen.queryByLabelText('Height')).toBeNull()
  })

  it('shows the logo’s colours and clears them', () => {
    const start = defaultDesign()
    start.brand.logoColours = ['#0f766e', '#7a1f35']
    const { seen } = renderPanel(start)
    const row = screen.getByRole('img', { name: /^Logo colours: / }).closest('[data-property-row]')!
    fireEvent.click(within(row as HTMLElement).getByRole('button', { name: 'Clear' }))
    expect(seen.design.brand.logoColours).toBeUndefined()
  })
})
