// @vitest-environment happy-dom
/**
 * The logo, its own element in the header: a pick on the page opens it, with
 * the icon, the title, a full logo image in their place, its height (16 to
 * 64 px) and its colours. The icon and title rows are the brand kit's own
 * rows, so the logo keeps one writer however it is reached. Every stored
 * logo field keeps working.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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
  const seen = { design: start, labels: [] as string[], up: 0 }
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
    expect(rows.slice(0, 4)).toEqual(['Icon', 'Title', 'Full logo', 'Height'])
    expect(rows).toContain('Logo colours')
  })

  it('sets the title, giving the workspace’s name back when emptied', () => {
    const { seen } = renderPanel(defaultDesign())
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Acme' } })
    expect(seen.design.brand.logo.name).toBe('Acme')
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: ' ' } })
    expect(seen.design.brand.logo).not.toHaveProperty('name')
  })

  it('drafts an uploaded icon with its colours, and Reset goes back to the workspace logo', async () => {
    const { seen } = renderPanel(defaultDesign())
    fireEvent.change(screen.getByLabelText('Replace icon'), {
      target: { files: [new File(['png'], 'mark.png', { type: 'image/png' })] },
    })
    await waitFor(() =>
      expect(seen.design.brand.logo.mark.light).toEqual({ key: 'design/mark.png' })
    )
    expect(seen.design.brand.logoColours).toEqual(['#0058a3', '#ffffff'])
    fireEvent.click(screen.getByRole('button', { name: 'Reset to workspace logo' }))
    expect(seen.design.brand.logo.mark.light).toBeNull()
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

  it('swaps in a full logo image and back, keeping a stored wordmark design as it is', () => {
    const { seen } = renderPanel(defaultDesign())
    const full = screen.getByRole('switch', { name: 'Use a full logo image instead' })
    fireEvent.click(full)
    expect(seen.design.brand.logo.display).toBe('wordmark')
    expect(screen.getByText('Shows icon and title')).toBeTruthy()
    fireEvent.click(full)
    expect(seen.design.brand.logo.display).toBe('mark_and_name')
    cleanup()
    const stored = defaultDesign()
    stored.brand.logo.display = 'wordmark'
    stored.brand.logo.wordmark.light = { key: 'logos/full.svg' }
    renderPanel(stored)
    expect(
      screen
        .getByRole('switch', { name: 'Use a full logo image instead' })
        .getAttribute('aria-checked')
    ).toBe('true')
    expect(screen.getByLabelText('Replace full logo')).toBeTruthy()
  })

  it('drafts an uploaded full logo with its colours', async () => {
    const start = defaultDesign()
    start.brand.logo.display = 'wordmark'
    const { seen } = renderPanel(start)
    fireEvent.change(screen.getByLabelText('Upload full logo'), {
      target: { files: [new File(['<svg/>'], 'wordmark.svg', { type: 'image/svg+xml' })] },
    })
    await waitFor(() =>
      expect(seen.design.brand.logo.wordmark.light).toEqual({ key: 'design/wordmark.svg' })
    )
    expect(seen.design.brand.logoColours).toEqual(['#0058a3', '#ffffff'])
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
