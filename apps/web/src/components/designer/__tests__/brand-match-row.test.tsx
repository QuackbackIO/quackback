// @vitest-environment happy-dom
/**
 * Theme > Brand kit leads with Match your brand: the website (prefilled from
 * what the workspace knows) and up to three screenshots, run as the same
 * brand match Ask AI runs. Once a match has run the row stays, quieter.
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
      dataTransfer: { files: [png('a.png'), png('b.png'), png('c.png'), png('d.png')], types: ['Files'] },
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
