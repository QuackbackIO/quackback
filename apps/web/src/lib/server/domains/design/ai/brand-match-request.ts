/**
 * A brand match asked for in Ask AI: the screenshots as the builder sends
 * them (bounded here), the brand's website when one is given, the checks
 * every Appearance request passes (AI set up, allowance left), the match,
 * and its changes saved to the draft as one step. The stages are reported
 * as they start, for the chat to show.
 *
 * A website with screenshots is read beside them. A website alone is
 * captured (cached by host, within the workspace's limits) and matched as a
 * screenshot with the site read; where no capture can be had (captures not
 * set up, used up, or the site walls off headless browsers) the match is
 * made from the site's code alone and offers to take a screenshot for the
 * look. Nothing here fails because a site could not be read: the match goes
 * on with what it has.
 */
import { z } from 'zod'
import type { AuthContext } from '@/lib/server/functions/auth-helpers'
import { SUPPORTED_LOCALES } from '@/lib/shared/i18n'
import type { PortalDesign } from '@/lib/shared/design/schema'
import type { BrandMatchDeps, BrandMatchInput, BrandShotInput, BrandStep } from './brand-match'
import type { SiteRead } from '../site/types'

const hexColour = z.string().regex(/^#[0-9a-f]{6}$/i)
const dataUrl = (types: string, max: number) =>
  z
    .string()
    .max(max)
    .regex(new RegExp(`^data:image/(${types});base64,[A-Za-z0-9+/=]+$`))

/** One screenshot: its colours and the picture the model sees, the analysis image and the header strip. */
export const brandShotSchema = z.object({
  palette: z.array(hexColour).max(6),
  /** At most 1024px on its longest side, JPEG, for the model to look at. */
  image: dataUrl('jpeg', 700_000).optional(),
  /** At CSS-pixel width (a retina capture halved), at most 2400px tall, JPEG or PNG, for the tools. */
  analysis: dataUrl('jpeg|png', 6_000_000),
  /** The top of the page, up to about 900 CSS px, at its own resolution, PNG, for the logo and the fonts. */
  strip: dataUrl('png', 7_000_000).optional(),
  /**
   * The first screen, up to about 1100 CSS px, at its own resolution (at most
   * 3200px wide), JPEG, for a hero photo the strip does not hold: sent only
   * when the strip is shorter than the first screen.
   */
  hero: dataUrl('jpeg', 5_000_000).optional(),
  /** The screenshot's own size in pixels. */
  width: z.number().int().min(16).max(12_000),
  height: z.number().int().min(16).max(40_000),
  /** What the builder warned about it before sending, kept anyway: read as dimmed or bannered. */
  told: z.object({ dimmed: z.boolean().optional(), banner: z.boolean().optional() }).optional(),
})

export const brandMatchRequest = z
  .object({
    message: z.string().trim().max(2000),
    images: z.array(brandShotSchema).max(3),
    /** The brand's website, as typed: a domain or a URL. */
    url: z.string().trim().min(1).max(2048).optional(),
    /** Capture the website again though a capture of it is kept (Capture again). */
    recapture: z.boolean().optional(),
    /** The brand's name as its logo shows it, read before sending. */
    brand: z.string().trim().min(1).max(60).optional(),
    locale: z.enum(SUPPORTED_LOCALES).optional(),
  })
  .refine((r) => r.images.length > 0 || !!r.url, { message: 'A screenshot or a website' })
export type BrandMatchRequest = z.infer<typeof brandMatchRequest>

/**
 * Runs a brand match for the person signed in, saving its changes to the
 * draft. `signal` is the request's: once the builder has gone (it has
 * already said the match failed), nothing is saved, so the draft and what
 * the builder said agree.
 */
export async function runBrandMatchRequest(
  data: BrandMatchRequest,
  auth: AuthContext,
  onStep: (step: BrandStep) => void,
  signal?: AbortSignal
) {
  const [{ designAiModel, allowanceRefusal }, actions, { designAuthor }, { designAllowances }] =
    await Promise.all([
      import('./design-ai'),
      import('../design.actions'),
      import('../design-author'),
      import('../design-allowances'),
    ])
  const model = designAiModel()
  if (!model)
    return {
      ok: false as const,
      code: 'AI_UNAVAILABLE' as const,
      message: 'Quackback AI is not set up for this workspace.',
    }
  const limited = await allowanceRefusal()
  if (limited) return limited
  const [{ brandMatch }, { brandMatchDeps }, { matchBrand }] = await Promise.all([
    import('./brand-match'),
    import('./brand-calls'),
    import('./brand-start'),
  ])
  const [current, allows] = await Promise.all([actions.readDraftForChange(), designAllowances()])
  const website = data.url ? await websiteFor(data, auth, onStep) : null
  if (website && 'refused' in website) return website.refused
  const images = website?.capture
    ? [{ palette: website.palette, image: website.capture.image }]
    : data.images.map(({ palette, image }) => ({ palette, ...(image && { image }) }))
  const name = data.brand ?? allows.name
  const fallback = () =>
    matchBrand({
      design: current.design,
      images,
      name,
      hasMark: allows.hasMark || !!current.design.brand.logo.mark.light,
      allows,
    })
  const deps = brandMatchDeps(model, fallback)
  const shots = website?.capture
    ? [website.capture.shot]
    : data.images.map(({ analysis, strip, hero, width, height, told }) => ({
        analysis,
        ...(strip && { strip }),
        ...(hero && { hero }),
        width,
        height,
        ...(told && { told }),
      }))
  const matched =
    shots.length > 0
      ? await brandMatch(
          {
            design: current.design,
            shots,
            name,
            workspaceName: allows.name ?? '',
            allows,
            ...(data.locale && { locale: data.locale }),
            ...(website && { site: website.site }),
          },
          deps,
          onStep
        )
      : await siteOnly(website!, current.design, allows, deps)
  // Stamped on every path (screenshots, a capture, the site's code alone), so the
  // builder knows a match has run (brand.matchedAt) and offers it more quietly.
  const stamped = matched.ok ? stampMatched(matched, new Date()) : matched
  // A capture is not the person's screenshot: the reply names the site it came from.
  const result =
    stamped.ok && website?.capture
      ? {
          ...stamped,
          reply: stamped.reply.replace(
            /from your screenshots?\b/,
            `from a capture of ${website.capture.view.host}`
          ),
          capture: website.capture.view,
        }
      : stamped
  if (!result.ok || result.applied.length === 0) return result
  if (signal?.aborted)
    return {
      ok: false as const,
      code: 'CANCELLED' as const,
      message: 'The builder stopped listening before the match finished, so nothing changed.',
    }
  const saved = await actions.saveDesignDraft(
    result.design,
    { ...(await designAuthor(auth)), via: 'ai' },
    current.revision,
    'brand-match'
  )
  if (!saved.ok)
    return saved.code === 'REVISION_MISMATCH'
      ? {
          ...saved,
          message: 'The draft changed while this was worked on, so nothing changed. Ask again.',
        }
      : saved
  return { ...result, report: saved.report, revision: saved.revision }
}

/** A match's design, recording when the match ran (brand.matchedAt). */
function stampMatched<T extends { design: PortalDesign }>(result: T, at: Date): T {
  const { design } = result
  return {
    ...result,
    design: { ...design, brand: { ...design.brand, matchedAt: at.toISOString() } },
  }
}

type Website =
  | { refused: { ok: false; code: 'INVALID_URL' | 'SITE_UNREADABLE'; message: string } }
  | {
      site: SiteRead | Promise<SiteRead | null> | null
      /** The capture, as a screenshot for the match and as the builder shows it. */
      capture: { shot: BrandShotInput; image: string; view: CaptureView } | null
      palette: string[]
      /** Why there is no capture, when there is none. */
      because: string | null
    }

/** The capture a match was made from, for the conversation to show. */
export interface CaptureView {
  host: string
  /** The page as captured, a JPEG data URL at most 1024 px on its longest side. */
  image: string
  cached: boolean
  capturedAt: string
  /** When Capture again is allowed: a day after the capture. */
  againFrom: string
}

const AGAIN_AFTER_MS = 24 * 60 * 60 * 1000

/** The brand's site: read beside screenshots, or captured and read when it comes alone. */
async function websiteFor(
  data: BrandMatchRequest,
  auth: AuthContext,
  onStep: (step: BrandStep) => void
): Promise<Website> {
  const [{ siteHost }, { readSite, liveSiteFetcher }] = await Promise.all([
    import('../site/host'),
    import('../site/site-read'),
  ])
  const host = siteHost(data.url!)
  if (!host)
    return {
      refused: {
        ok: false,
        code: 'INVALID_URL',
        message: 'That address is not a public website I can read.',
      },
    }
  const live = () => readSite(host.url, liveSiteFetcher).catch(() => null)
  if (data.images.length) {
    onStep('site')
    return { site: live(), capture: null, palette: [], because: null }
  }
  onStep('capture')
  const [{ getSiteCapture }, { shotFromCapture }] = await Promise.all([
    import('../site/capture-service'),
    import('../site/capture-shots'),
  ])
  const captured = await getSiteCapture({
    url: host.url,
    principalId: auth.principal.id,
    recapture: !!data.recapture,
    loadImage: true,
  })
  // A capture kept from before was read then; its images are read again (no capture is made).
  const site = captured.read ?? (captured.ok || captured.facts ? live() : null)
  const facts = captured.facts
  const palette = facts ? facts.colours.slice(0, 6).map((c) => c.hex) : []
  const shot = captured.ok && captured.image.png ? shotFromCapture(captured.image.png) : null
  if (captured.ok && shot) {
    const at = captured.capturedAt.getTime()
    return {
      site,
      palette,
      because: null,
      capture: {
        shot: { ...shot.shot, ...(shot.dimmed && { told: { dimmed: true } }) },
        image: shot.jpeg,
        view: {
          host: captured.host,
          image: shot.jpeg,
          cached: captured.cached,
          capturedAt: new Date(at).toISOString(),
          againFrom: new Date(at + AGAIN_AFTER_MS).toISOString(),
        },
      },
    }
  }
  const read = await site
  if (!read?.facts || read.failed === 'challenge')
    return {
      refused: {
        ok: false,
        code: 'SITE_UNREADABLE',
        message: captured.ok
          ? 'I could not read that site. Paste a screenshot of it instead.'
          : `${captured.message.replace(/\.$/, '')}. I could not read the site's code either, so paste a screenshot of it instead.`,
      },
    }
  return {
    site: read,
    palette,
    because: captured.ok ? null : captured.message,
    capture: null,
  }
}

/** A match from the site's code alone. */
async function siteOnly(
  website: Extract<Website, { site: unknown }>,
  design: PortalDesign,
  allows: BrandMatchInput['allows'],
  deps: BrandMatchDeps
) {
  const { siteOnlyMatch } = await import('./brand-site-match')
  const read = (await website.site) as SiteRead & { facts: NonNullable<SiteRead['facts']> }
  return siteOnlyMatch(
    { design, allows, site: read },
    { fallback: deps.fallback, ...(deps.storeAsset && { storeAsset: deps.storeAsset }) },
    website.because
  )
}
