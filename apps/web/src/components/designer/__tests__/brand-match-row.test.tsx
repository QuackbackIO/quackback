// @vitest-environment happy-dom
/**
 * Theme > Brand kit leads with Match your brand: the website (prefilled from
 * what the workspace knows) and up to three screenshots, run as the same
 * brand match Ask AI runs. Without Quackback AI it is Use from your
 * website: what the site gives, checked, used as one step. Once a match has
 * run the row stays, quieter.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { defaultDesign, type PortalDesign } from '@/lib/shared/design/schema'

const ai = vi.hoisted(() => ({ available: true }))
vi.mock('@/lib/client/queries/portal-design', () => ({
  portalDesignQueries: {
    aiStatus: () => ({
      queryKey: ['ai-status'],
      queryFn: async () => ({ available: ai.available }),
    }),
  },
}))

const site = vi.hoisted(() => ({ read: vi.fn() }))
vi.mock('@/lib/server/functions/site-brand', () => ({ readSiteBrandFn: site.read }))

const { BrandMatchProvider, BrandMatchRow } = await import('../brand-match-row')

afterEach(() => {
  cleanup()
  ai.available = true
})

function renderRow(
  design: PortalDesign,
  control: Partial<Parameters<typeof BrandMatchProvider>[0]['value']> | null = {}
) {
  const start = vi.fn()
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrap = (children: ReactNode) =>
    control === null ? (
      children
    ) : (
      <BrandMatchProvider value={{ busy: false, website: 'acme.test', start, ...control }}>
        {children}
      </BrandMatchProvider>
    )
  render(
    <QueryClientProvider client={client}>
      {wrap(<BrandMatchRow design={design} update={vi.fn()} />)}
    </QueryClientProvider>
  )
  return { start }
}

const png = (name: string) => new File(['x'], name, { type: 'image/png' })

describe('BrandMatchRow', () => {
  it('leads with the website the workspace knows, and matches it', async () => {
    const { start } = renderRow(defaultDesign())
    const field = await screen.findByLabelText('Your website')
    expect(field).toHaveProperty('value', 'acme.test')
    fireEvent.change(field, { target: { value: 'acme.example' } })
    fireEvent.click(screen.getByRole('button', { name: 'Match' }))
    expect(start).toHaveBeenCalledWith({ website: 'acme.example', screenshots: [] })
  })

  it('takes up to three screenshots, dropped or picked, and sends them with the website', async () => {
    const { start } = renderRow(defaultDesign(), { website: null })
    const drop = await screen.findByRole('button', { name: /screenshots/i })
    fireEvent.drop(drop, {
      dataTransfer: {
        files: [png('a.png'), png('b.png'), png('c.png'), png('d.png')],
        types: ['Files'],
      },
    })
    expect(await screen.findAllByRole('button', { name: /^Remove / })).toHaveLength(3)
    fireEvent.click(screen.getByRole('button', { name: 'Remove b.png' }))
    fireEvent.click(screen.getByRole('button', { name: 'Match' }))
    const sent = start.mock.calls[0]![0] as { website?: string; screenshots: File[] }
    expect(sent.website).toBeUndefined()
    expect(sent.screenshots.map((file) => file.name)).toEqual(['a.png', 'c.png'])
  })

  it('cannot match with nothing given, or while a match runs', async () => {
    renderRow(defaultDesign(), { website: null })
    expect(await screen.findByRole('button', { name: 'Match' })).toHaveProperty('disabled', true)
    cleanup()
    renderRow(defaultDesign(), { busy: true })
    expect(await screen.findByRole('button', { name: 'Matching…' })).toHaveProperty(
      'disabled',
      true
    )
  })

  it('stays after a match, quieter, and opens again on Match again', async () => {
    const design = defaultDesign()
    design.brand.matchedAt = '2026-11-07T12:00:00.000Z'
    const { start } = renderRow(design)
    const again = await screen.findByRole('button', { name: 'Match again' })
    expect(screen.queryByLabelText('Your website')).toBeNull()
    fireEvent.click(again)
    fireEvent.click(screen.getByRole('button', { name: 'Match' }))
    expect(start).toHaveBeenCalledWith({ website: 'acme.test', screenshots: [] })
  })

  it('shows nothing outside the builder', async () => {
    renderRow(defaultDesign(), null)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(screen.queryByText('Match your brand')).toBeNull()
  })
})

describe('BrandMatchRow without Quackback AI', () => {
  const offer = {
    host: 'acme.test',
    name: 'Acme',
    logo: { key: 'logos/logo.png', full: false },
    favicon: { key: 'logos/favicon.png' },
    shareImage: null,
    colour: '#0058a3',
  }

  function renderOff(design = defaultDesign()) {
    ai.available = false
    const update = vi.fn()
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <BrandMatchProvider value={{ busy: false, website: 'acme.test', start: vi.fn() }}>
          <BrandMatchRow design={design} update={update} />
        </BrandMatchProvider>
      </QueryClientProvider>
    )
    return { update }
  }

  it('reads the website, offers what it found checked, and uses the checked ones as one step', async () => {
    site.read.mockResolvedValue({ ok: true, offer })
    const { update } = renderOff()
    expect(await screen.findByText('Use from your website')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Read' }))
    expect(site.read).toHaveBeenCalledWith({ data: { url: 'acme.test' } })
    const logo = await screen.findByRole('button', { name: 'Logo' })
    expect(logo.getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: 'Favicon' }).getAttribute('aria-pressed')).toBe(
      'true'
    )
    expect(screen.queryByRole('button', { name: 'Share image' })).toBeNull()
    expect(screen.queryByText(/font/i)).toBeNull()
    // Unchecked, the favicon stays as it is.
    fireEvent.click(screen.getByRole('button', { name: 'Favicon' }))
    fireEvent.click(screen.getByRole('button', { name: 'Use' }))
    expect(update).toHaveBeenCalledTimes(1)
    const [change, label] = update.mock.calls[0]!
    expect(label).toBe('Use from your website')
    const draft = defaultDesign()
    change(draft)
    expect(draft.brand.logo.mark.light).toEqual({ key: 'logos/logo.png' })
    expect(draft.brand.light.accent).toBe('#0058a3')
    expect(draft.brand.favicon ?? null).toBeNull()
    expect(draft.brand.matchedAt).toBeTruthy()
  })

  it('says a refusal plainly', async () => {
    site.read.mockResolvedValue({
      ok: false,
      code: 'SITE_UNREADABLE',
      message: 'That website could not be read.',
    })
    renderOff()
    fireEvent.click(await screen.findByRole('button', { name: 'Read' }))
    expect(await screen.findByText('That website could not be read.')).toBeTruthy()
  })

  it('stays after use, quieter', async () => {
    const design = defaultDesign()
    design.brand.matchedAt = '2026-11-07T12:00:00.000Z'
    renderOff(design)
    fireEvent.click(await screen.findByRole('button', { name: 'Use again' }))
    expect(screen.getByLabelText('Your website')).toBeTruthy()
  })
})
