/**
 * The publish review's sign-in email sample: branding permission, drawn from
 * the draft (what will go live), and a refusal as a value when it cannot be.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultDesign } from '@/lib/shared/design/schema'
import { decodePng, encodePng } from '@/lib/server/domains/design/extract/png'

function solid(width: number, height: number, [r, g, b]: number[]) {
  const data = new Uint8Array(width * height * 4)
  for (let i = 0; i < data.length; i += 4) data.set([r!, g!, b!, 255], i)
  return { width, height, data }
}

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
vi.mock('@/lib/server/storage/s3', () => ({
  getEmailSafeUrl: (key: string) => `https://files.example/${key}`,
  // The full logo, a blue 40x20 PNG, as storage holds it.
  getS3Object: async () => ({
    body: new Blob([encodePng(solid(40, 20, [20, 20, 220])) as BlobPart]).stream(),
  }),
}))
vi.mock('@/lib/server/config', () => ({ config: { baseUrl: 'https://acme.example' } }))
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

  describe("the header image, drawn from the draft rather than the live portal's /brand.png", () => {
    const header = () => hoisted.render.mock.calls.at(-1)![0].logoUrl as string
    const centre = (url: string) => {
      expect(url.startsWith('data:image/png;base64,')).toBe(true)
      const img = decodePng(new Uint8Array(Buffer.from(url.split(',')[1]!, 'base64')))
      const o = ((img.height / 2) * img.width + img.width / 2) * 4
      return [...img.data.subarray(o, o + 3)]
    }
    const edge = (url: string) => {
      const img = decodePng(new Uint8Array(Buffer.from(url.split(',')[1]!, 'base64')))
      const o = ((img.height / 2) * img.width + img.width - 20) * 4
      return [...img.data.subarray(o, o + 3)]
    }

    it("is the draft's initial tile, in the draft's colour", async () => {
      const draft = defaultDesign()
      draft.brand.light.accent = '#0c862c'
      const live = defaultDesign()
      live.brand.light.accent = '#dc1414'
      hoisted.getDesignState.mockResolvedValue({ draft, published: { document: live } })
      await sample()
      expect(header()).not.toContain('/brand.png')
      expect(edge(header())).toEqual([0x0c, 0x86, 0x2c])
    })

    it("is the draft's full logo when it has one and the live design has none", async () => {
      const draft = defaultDesign()
      draft.brand.logo.wordmark.light = { key: 'logos/full.png' }
      hoisted.getDesignState.mockResolvedValue({
        draft,
        published: { document: defaultDesign() },
      })
      await sample()
      expect(centre(header())).toEqual([20, 20, 220])
    })

    it('keeps a stored icon at its own address, as real emails do', async () => {
      const draft = defaultDesign()
      draft.brand.logo.mark.light = { key: 'design/icon.png' }
      hoisted.getDesignState.mockResolvedValue({ draft, published: null })
      await sample()
      expect(header()).toBe('https://files.example/design/icon.png')
    })
  })
})
