// @vitest-environment happy-dom
/**
 * The full review shows what visitors also get from the brand: the sign-in
 * email, rendered by the server in the draft's colours, read only.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'

const sample = vi.hoisted(() => ({ fn: vi.fn(), card: vi.fn() }))
vi.mock('@/lib/server/functions/portal-design-email', () => ({
  getSignInEmailSampleFn: sample.fn,
  getShareCardSampleFn: sample.card,
}))

vi.mock('@/lib/client/hooks/use-root-context', () => ({
  useWorkspaceSettings: () => ({ name: 'Acme Corp' }),
  useBaseUrl: () => 'https://acme.test',
}))

import { defaultDesign } from '@/lib/shared/design/schema'
import { VisitorsAlsoSee } from '../visitors-also-see'

afterEach(() => {
  cleanup()
  sample.fn.mockReset()
  sample.card.mockReset()
  sample.card.mockResolvedValue({ ok: false, message: 'x' })
})

sample.card.mockResolvedValue({ ok: false, message: 'x' })

describe('VisitorsAlsoSee', () => {
  it('shows the sign-in email sample whole, in a frame that runs nothing and never scrolls', async () => {
    sample.fn.mockResolvedValue({ ok: true, html: '<p>Sign in to Acme</p>' })
    render(<VisitorsAlsoSee />)
    const frame = await screen.findByTitle('Sign-in email')
    expect(frame.getAttribute('srcdoc')).toContain('Sign in to Acme')
    // Read for its height only: no scripts, forms or navigation.
    expect(frame.getAttribute('sandbox')).toBe('allow-same-origin')
    expect(frame.getAttribute('scrolling')).toBe('no')
    expect(frame.parentElement!.hasAttribute('inert')).toBe(true)
  })

  it('says it shows what visitors get after publishing', () => {
    sample.fn.mockResolvedValue({ ok: false, message: 'x' })
    render(<VisitorsAlsoSee />)
    expect(
      screen.getByRole('heading', { level: 3, name: 'Visitors also get, after you publish' })
    ).toBeTruthy()
  })

  it('says so quietly when the sample cannot be drawn', async () => {
    sample.fn.mockResolvedValue({ ok: false, message: 'The email sample could not be drawn.' })
    render(<VisitorsAlsoSee />)
    await waitFor(() =>
      expect(screen.getByText('The email sample could not be drawn.')).toBeTruthy()
    )
    expect(screen.queryByTitle('Sign-in email')).toBeNull()
  })

  it('shows a link to the portal as a shared post shows it, from the draft', async () => {
    sample.fn.mockResolvedValue({ ok: true, html: '<p>Sign in</p>' })
    const design = defaultDesign()
    design.brand.logo.name = 'GitHub'
    render(<VisitorsAlsoSee design={design} />)
    const preview = await screen.findByRole('figure', { name: 'Link preview' })
    expect(preview.textContent).toContain('GitHub')
    expect(preview.textContent).toContain('acme.test')
  })

  it('shows the card the server draws for the draft, not a sketch of it', async () => {
    sample.fn.mockResolvedValue({ ok: true, html: '<p>Sign in</p>' })
    sample.card.mockResolvedValue({ ok: true, src: 'data:image/png;base64,AAAA' })
    render(<VisitorsAlsoSee design={defaultDesign()} />)
    const preview = await screen.findByRole('figure', { name: 'Link preview' })
    await waitFor(() =>
      expect(preview.querySelector('img')?.getAttribute('src')).toBe('data:image/png;base64,AAAA')
    )
    expect(screen.queryByTestId('link-preview-card')).toBeNull()
  })
})
