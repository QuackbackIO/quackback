// @vitest-environment happy-dom
/**
 * The full review shows what visitors also get from the brand: the sign-in
 * email, rendered by the server in the draft's colours, read only.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'

const sample = vi.hoisted(() => ({ fn: vi.fn() }))
vi.mock('@/lib/server/functions/portal-design-email', () => ({
  getSignInEmailSampleFn: sample.fn,
}))

import { VisitorsAlsoSee } from '../visitors-also-see'

afterEach(() => {
  cleanup()
  sample.fn.mockReset()
})

describe('VisitorsAlsoSee', () => {
  it('shows the sign-in email sample in a sandboxed frame', async () => {
    sample.fn.mockResolvedValue({ ok: true, html: '<p>Sign in to Acme</p>' })
    render(<VisitorsAlsoSee />)
    const frame = await screen.findByTitle('Sign-in email')
    expect(frame.getAttribute('srcdoc')).toContain('Sign in to Acme')
    expect(frame.getAttribute('sandbox')).toBe('')
  })

  it('says so quietly when the sample cannot be drawn', async () => {
    sample.fn.mockResolvedValue({ ok: false, message: 'The email sample could not be drawn.' })
    render(<VisitorsAlsoSee />)
    await waitFor(() =>
      expect(screen.getByText('The email sample could not be drawn.')).toBeTruthy()
    )
    expect(screen.queryByTitle('Sign-in email')).toBeNull()
  })
})
