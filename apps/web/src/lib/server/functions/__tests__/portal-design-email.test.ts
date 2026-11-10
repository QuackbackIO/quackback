/**
 * The publish review's sign-in email sample: branding permission, drawn from
 * the draft (what will go live), and a refusal as a value when it cannot be.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultDesign } from '@/lib/shared/design/schema'

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    const chain = { validator: () => chain, handler: (fn: unknown) => fn }
    return chain
  },
}))

const hoisted = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  getDesignState: vi.fn(),
  render: vi.fn(),
}))
vi.mock('../auth-helpers', () => ({ requireAuth: hoisted.requireAuth }))
vi.mock('@/lib/server/domains/design/design.service', () => ({
  getDesignState: hoisted.getDesignState,
}))
vi.mock('@/lib/server/storage/s3', () => ({ getEmailSafeUrl: () => null }))
vi.mock('@quackback/email', () => ({ renderSignInEmailSample: hoisted.render }))

import { getSignInEmailSampleFn } from '../portal-design-email'

const sample = getSignInEmailSampleFn as unknown as () => Promise<
  { ok: true; html: string } | { ok: false; message: string }
>

describe('getSignInEmailSampleFn', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hoisted.requireAuth.mockResolvedValue({ settings: { name: 'Acme', logoKey: null } })
    hoisted.render.mockResolvedValue('<html>sample</html>')
  })

  it('needs the branding permission', async () => {
    hoisted.getDesignState.mockResolvedValue(null)
    await sample()
    expect(hoisted.requireAuth).toHaveBeenCalledWith({ permission: 'settings.branding' })
  })

  it('draws the draft in its brand colour', async () => {
    const draft = defaultDesign()
    draft.brand.light.accent = '#0c862c'
    hoisted.getDesignState.mockResolvedValue({ draft, published: null })
    expect(await sample()).toEqual({ ok: true, html: '<html>sample</html>' })
    expect(hoisted.render).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceName: 'Acme',
        brand: expect.objectContaining({ accent: '#0c862c' }),
      })
    )
  })

  it('refuses as a value without a design', async () => {
    hoisted.getDesignState.mockResolvedValue(null)
    expect(await sample()).toEqual({ ok: false, message: 'No design to show yet.' })
  })
})
