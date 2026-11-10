/**
 * Matching a brand from screenshots: a fixed workflow with bounded model
 * steps, not a free-roaming agent. The server runs the stages; a model acts
 * only inside one (finding elements, choosing colour roles, the hero, the
 * words), and image tools measure everything a tool can.
 *
 * 1. Observe: the element finder on each screenshot, in parallel.
 * 2. Measure: colours and their roles, type and geometry, the logo cut.
 * 3. Fonts: the headline's and subtitle's faces matched to bundled fonts,
 *    whose cap height and weight then size the headline.
 * 4. Decide: the decision table and the colour roles by rule; then the
 *    families the rules leave open (colour roles where ambiguous, and the
 *    hero, in parallel); beside them from the screenshots' read, the words:
 *    the brand's voice read from every word seen, a set of words from each
 *    writing angle at once, and a words critic choosing among them.
 * 5. Validate and apply: conflicts settled by rules, every change through
 *    applyDesignChanges (schema, contrast), as one draft step.
 * 6. Reply: what changed with its evidence, questions the screenshots could
 *    not settle, what was left as is, and follow-ups.
 *
 * A stage that fails falls back (to the rules' defaults, or the previous
 * whole-look path when nothing could be read) and says so; the whole match
 * is bounded in time, and a stage out of time keeps what is done.
 *
 * With the brand's website read too (brand-site.ts), what its code names
 * leads where the pixels can only guess: its fonts, its logo and favicon
 * files, its exact colours and its name. The pixels still decide the look.
 *
 * 7. The verified critic loop runs after, from the builder: the result
 * carries `target`, what was measured as a fingerprint by the rig's roles;
 * the builder reads the drawn preview, the server scores the two and a
 * critic compares the picture with the screenshots (brand-check.ts).
 */
import { applyDesignChanges } from '@/lib/shared/design/apply-changes'
import { logoTitle } from '@/lib/shared/design/match-brand'
import { logger } from '@/lib/server/logger'
import { heroSurface } from '../extract/hero-surface'
import { decodeDataUrlOrNull as decode } from '../extract/image'
import { designFromMeasures } from '../extract/measured-design'
import { classifyRoles } from '../extract/roles-classifier'
import { rolesToDesign } from '../extract/roles-design'
import { sitePageFill } from '../extract/page-fill-decide'
import {
  colourChanges,
  headlineAccentChanges,
  heroChanges,
  logoChanges,
  pageBackgroundChanges,
  reconcile,
  typeAndShapeChanges,
  wordsChanges,
  type BrandChange,
} from './brand-decide'
import { detailChanges, measureDetails } from './brand-details'
import { chooseFaces, matchTypeOffThread, type TypeMatches } from './brand-fonts'
import {
  cleanShots,
  measurable,
  onlyDimmed,
  headerColour,
  measureTone,
  primaryShot,
  withTypeMatch,
  type Shot,
} from './brand-measure'
import { brandReply } from './brand-reply'
import { measureOffThread } from './measure-stage'
import { targetFingerprint } from './brand-target'
import { heroCrop } from './brand-crops'
import { headlineInkChanges } from './colour-changes'
import * as heroPhoto from './brand-photo'
import type { DesignAiResult } from './design-ai'
import { readableHero } from './hero-fallbacks'
import { heroLayout } from './hero-geometry'
import type { HeroEvidence } from './hero-family'
import {
  agreedLook,
  decideHero,
  defaultHero,
  heroSignals,
  ruleHero,
  type HeroDecision,
} from './hero-rules'
import type { WordsAnswer } from './words-evidence'
import { readVoice, wordsEvidenceOf } from './words-family'
import { writeWords } from './words-pick'
import {
  faceHints,
  siteAssetChanges,
  siteFontChanges,
  siteFontPlan,
  unmatchedSiteFont,
  withUnmatchedFont,
  siteName,
  withSiteColours,
} from './brand-site'
import { siteLogoFor, siteNotes, siteUseOf, siteWithin, storeSiteAssets } from './brand-site-use'

export type { SiteAssetStore, SiteUse } from './brand-site-use'
export type {
  BrandMatchDeps,
  BrandMatchInput,
  BrandMatchResult,
  BrandShotInput,
} from './brand-match-types'
import type { BrandMatchDeps, BrandMatchInput, BrandMatchResult } from './brand-match-types'

const log = logger.child({ module: 'brand-match' })

/** The stages, as the chat shows them while they run. */
export const BRAND_STEPS = {
  capture: 'Capturing your site',
  site: 'Reading your site',
  read: 'Reading your screenshots',
  measure: 'Measuring colours and type',
  fonts: 'Matching fonts',
  hero: 'Choosing the hero',
  words: 'Writing in your voice',
} as const
export type BrandStep = keyof typeof BRAND_STEPS

/** The whole match, and each model stage, in ms. */
export const BUDGET = {
  total: 40_000,
  find: 18_000,
  fonts: 8_000,
  decide: 10_000,
  /** The voice read, alongside measuring, the fonts and the hero. */
  voice: 10_000,
  /** The writers, at once, and the words critic. */
  words: 16_000,
  logo: 5_000,
}
/** A stage with less time than this left is skipped. */
const LEAST = 1_500

/** A promise held to a time; null when it runs out or fails. */
async function within<T>(promise: Promise<T>, ms: number, what: string): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<null>((done) => {
    timer = setTimeout(() => done(null), Math.max(0, ms))
  })
  try {
    return await Promise.race([promise, timeout])
  } catch (err) {
    log.warn({ err }, `brand match: ${what} failed`)
    return null
  } finally {
    clearTimeout(timer)
  }
}

/** Lets a step's event reach the chat before a stretch of measuring. */
const yieldToStream = () => new Promise<void>((done) => setImmediate(done))

export async function brandMatch(
  input: BrandMatchInput,
  deps: BrandMatchDeps,
  onStep: (step: BrandStep) => void = () => {}
): Promise<DesignAiResult | BrandMatchResult> {
  const now = deps.now ?? Date.now
  const start = now()
  const left = () => start + BUDGET.total - now()
  const timings: BrandMatchResult['timings'] = {}
  const failed: string[] = []
  let mark = start
  const done = (step: BrandStep | 'apply') => {
    timings[step] = now() - mark
    mark = now()
  }

  // 1. Observe.
  onStep('read')
  const decoded = input.shots.map((shot, index) => ({ shot, index, img: decode(shot.analysis) }))
  const found = await Promise.all(
    decoded.map(({ img }) =>
      img ? within(deps.find(img), Math.min(BUDGET.find, left()), 'finder') : Promise.resolve(null)
    )
  )
  const shots: Shot[] = decoded.flatMap(({ shot, index, img }) => {
    const f = found[index]
    return img && f
      ? [
          {
            index,
            img,
            strip: decode(shot.strip),
            hero: decode(shot.hero),
            width: shot.width,
            height: shot.height,
            found: f,
            ...(shot.told && { told: shot.told }),
          },
        ]
      : []
  })
  done('read')
  // The site, read beside the finder; a read that failed or met a bot wall is left out.
  const site = await siteWithin(input.site, Math.max(1_000, Math.min(15_000, left() - 15_000)))
  const plan = siteFontPlan(site?.facts)
  const name = siteName(site?.facts) ?? input.name
  if (!shots.length) {
    log.warn(
      { images: input.shots.length },
      'brand match: no screenshot could be read; whole-look fallback'
    )
    const result = await deps.fallback()
    if (!result.ok) return result
    return {
      ...result,
      reply: `${result.reply} I could not read your screenshots closely, so this is a first look from them.`,
    }
  }

  // The brand's voice, read from every word on the screenshots while the rest is measured.
  const primary = primaryShot(shots)!
  // The voice read keeps its own evidence: with the site's description and language
  // in it, the brand bench's words came out no better, only drawn afresh.
  const wordsEvidence = wordsEvidenceOf(input, [primary, ...shots.filter((s) => s !== primary)])
  const voiceRead = within(
    readVoice(wordsEvidence, deps.family, heroCrop(primary)),
    Math.min(BUDGET.voice, left()),
    'voice read'
  )
  // The words need only what was read: every angle's words, then the critic's choice,
  // written once the voice is read, beside measuring, the fonts and the hero.
  const write = (voice: Awaited<typeof voiceRead>, ms: number) =>
    ms > LEAST ? writeWords({ ev: wordsEvidence, voice, call: deps.family, ms, now }) : null
  const writing = within(
    voiceRead.then((voice) => write(voice, Math.min(BUDGET.words, left()))),
    BUDGET.total,
    'words'
  )

  // 2. Measure.
  onStep('measure')
  await yieldToStream()
  // Every pixel walked on a worker thread, so other requests are served meanwhile.
  const measures = await (deps.measure ?? measureOffThread)(shots, primary)
  const { colours: measuredColours, pageReadings, logo } = measures
  const { evidence } = measuredColours
  // The site's colours settle a role the rules left open where they name the measured one.
  const ruled = site
    ? withSiteColours(measuredColours.roles, site.facts.colours).roles
    : measuredColours.roles
  let geometry = measures.geometry
  done('measure')

  // 3. Fonts: CPU on a worker thread, skipped when the match is short of time.
  onStep('fonts')
  let type: TypeMatches | null = null
  if (left() > 12_000) {
    const match = deps.matchType ?? ((shot, deadlineMs) => matchTypeOffThread(shot, { deadlineMs }))
    type = await within(
      match(primary, Math.min(BUDGET.fonts, left() - 10_000)),
      BUDGET.fonts,
      'fonts'
    )
    // Each face under the category the finder read and the weights the portal loads.
    if (type) type = chooseFaces(type, primary.found.output, faceHints(plan))
    if (type) geometry = withTypeMatch(geometry, type.headline)
  }
  if (!type?.headline) failed.push('I could not match your fonts, so they are as they were.')
  if (onlyDimmed(shots))
    failed.push(
      'A pop-up dims your screenshots, so the colours may be a little off. A clean screenshot works better.'
    )
  const measured = designFromMeasures(geometry)
  done('fonts')

  // 4. Decide: colour roles and the hero in parallel; composition and wording last.
  onStep('hero')
  // The hero as the page shows it: lifted from a pop-up's layer where it was taken under one.
  const seen = { ...primary, img: measurable(primary) }
  const surface = heroSurface(seen.img, primary.found.snapped)
  const heroEvidence: HeroEvidence = {
    behind: primary.found.output.behind_headline,
    behindWords: primary.found.output.behind_headline_evidence,
    measured: agreedLook(ruled.hero.look, surface, primary.found.output.behind_headline),
    measuredColour: evidence.shots[0]?.heroColour ?? null,
    measuredRole: ruled.hero.role,
    brandColour: ruled.identity.value,
    secondColour: ruled.highlight.value,
    page: ruled.page,
    header: headerColour(seen),
    intensity: ruled.intensity,
    ...heroSignals({ width: primary.img.width, hero: primary.found.snapped.hero }, evidence, ruled),
    surface,
  }
  const decideMs = Math.min(BUDGET.decide, left())
  const [classified, hero] = await Promise.all([
    ruled.open.length && deps.roles && decideMs > LEAST
      ? within(
          classifyRoles(
            evidence,
            ruled,
            deps.roles,
            cleanShots(shots).map((s) => ({ img: measurable(s) }))
          ),
          decideMs,
          'colour roles'
        )
      : Promise.resolve(null),
    decideMs > LEAST
      ? within(decideHero(heroEvidence, deps.family, heroCrop(seen)), decideMs, 'hero')
      : Promise.resolve(null),
  ])
  const sited = site ? withSiteColours(classified ?? ruled, site.facts.colours) : null
  const roles = sited?.roles ?? classified ?? ruled
  // Out of time, the rules' hero stands where they settle it, else the measured default.
  const ruledHero = hero ? null : ruleHero(heroEvidence)
  if (!hero && !ruledHero) failed.push('I could not settle the hero, so it follows your colours.')
  const heroDecided = hero ?? ruledHero ?? defaultHero(heroEvidence)
  done('hero')

  onStep('words')
  // The words being written; the hero photo (never from a screenshot under a pop-up's
  // dimming), the logo and the site's favicon and share picture stored meanwhile.
  const [written, photo, { agreement, siteLogo, logoKey }, assetKeys] = await Promise.all([
    writing,
    heroPhoto.photoStage(primary, deps.storePhoto, left() - LEAST, BUDGET.logo),
    // The logo, stored for the design: the site's own file where it is the one the
    // screenshot shows, else the cut.
    (async () => {
      const { agreement, siteLogo } =
        site && logo && deps.storeAsset && left() > LEAST
          ? await siteLogoFor(site, logo, deps.storeAsset)
          : { agreement: null, siteLogo: null }
      const cut = !siteLogo && logo && left() > LEAST ? deps.storeLogo(logo.cut.png) : null
      return {
        agreement,
        siteLogo,
        logoKey: siteLogo ?? (cut && (await within(cut, Math.min(BUDGET.logo, left()), 'logo'))),
      }
    })(),
    storeSiteAssets(site, input.design, deps.storeAsset),
  ])
  const words: WordsAnswer | null = written?.answer ?? null
  if (!words)
    failed.push('I could not write new words, so Home and the headlines are as they were.')
  done('words')

  // 5. Validate and apply.
  const colour = rolesToDesign(roles)
  const pageFill = sitePageFill(pageReadings, { scheme: roles.scheme, text: roles.text })
  const title = logo ? logoTitle(primary.found.output.logo_text, name, input.workspaceName) : null
  const layout = heroLayout({
    width: primary.img.width,
    height: primary.img.height,
    boxes: primary.found.snapped,
  })
  const wordChanges = words
    ? wordsChanges(words, input.design, input.allows.gates, input.allows.language ?? 'en')
    : []
  const tone = measureTone(seen)
  // The finer details: the subtitle's and headings' ink, labels, a field's corners.
  const details = measureDetails(seen, geometry, tone?.main ?? geometry.headline?.ink)
  const changesWith = (hero: HeroDecision): BrandChange[] =>
    reconcile([
      ...colourChanges(roles, colour, input.design.mode),
      ...pageBackgroundChanges(pageFill, input.design.layout.background),
      // A headline in a colour of its own (a two-tone headline's main part) keeps it.
      ...headlineInkChanges(tone?.main ?? geometry.headline?.ink, roles),
      ...typeAndShapeChanges(measured, type),
      // The site's faces where the fitting set none.
      ...siteFontChanges(plan, input.design, { heading: !!type?.headline, body: !!type?.body }),
      ...detailChanges(details, roles.scheme),
      ...heroChanges({
        hero,
        layout,
        hasBandImage: !!input.design.brand.heroImage || !!photo.placed,
        extras: colour.brand.light.extra,
      }),
      ...heroPhoto.photoChanges(photo, hero.band, input.design.brand.heroImage),
      ...wordChanges,
      // A two-tone headline's second part, set apart on the headlines just written.
      ...headlineAccentChanges(tone, wordChanges, input.allows.language ?? 'en'),
      ...(logo && logoKey ? logoChanges(logo, logoKey, title) : []).map((c) =>
        siteLogo && c.why.startsWith('cut from') ? { ...c, why: agreement!.why } : c
      ),
      ...siteAssetChanges(input.design, assetKeys),
    ])
  // A hero no text reads on in these colours gives way to the first fallback the design keeps.
  const drawn = readableHero(heroDecided, (hero) => {
    const changes = changesWith(hero)
    return {
      changes,
      ...applyDesignChanges(
        input.design,
        changes.map(({ path, value }) => ({ path, value })),
        'site',
        {
          ...input.allows,
          links: new Set(),
          files: new Set([
            ...heroPhoto.photoFiles(photo, logoKey),
            ...[assetKeys.favicon, assetKeys.shareImage].filter((k): k is string => !!k),
          ]),
        }
      ),
    }
  })
  const { changes, ...applied } = drawn.result
  if (drawn.hero !== heroDecided)
    log.info(
      { from: heroDecided.band, to: drawn.hero.band },
      'brand match: hero unreadable; fell back'
    )
  if (applied.refused.length) log.info({ refused: applied.refused }, 'brand match left changes out')
  const why = new Map(changes.map((c) => [c.path, c.why]))
  done('apply')

  // 6. Reply.
  const band = applied.design.layout.hero
  const said = brandReply({
    shots: input.shots.length,
    roles,
    heading: changes.find((c) => c.path === 'brand.fonts.heading')
      ? applied.design.brand.fonts.heading.kind === 'bundled'
        ? applied.design.brand.fonts.heading.id
        : null
      : null,
    band,
    // Said where it stands: set now, or already as measured.
    pageBackground:
      pageFill && !applied.refused.some((r) => r.path === 'layout.background') ? pageFill : null,
    failed,
    logo: !logo ? 'not_found' : logoKey ? 'placed' : 'not_stored',
    faceClose: type?.headline ? type.headline.close : null,
    ...heroPhoto.photoSaid(photo, applied.design),
  })
  // The site's own face no bundled face is, offered for upload under the reply.
  const unmatched = site ? unmatchedSiteFont(plan, applied.design) : null
  const siteUse = site
    ? siteUseOf(site, applied.applied, {
        logo: siteLogo ? 'site' : logoKey ? 'cut' : null,
        logoWhy: agreement?.why ?? null,
        fonts: plan,
        snapped: sited?.snapped ?? [],
      })
    : null
  log.info(
    { timings, changes: applied.applied.length, total: now() - start, site: !!site },
    'brand matched'
  )
  // The fonts drawn are only the nearest: the site's own face, or a headline no face fits.
  const fontsNearest = !!unmatched || type?.headline?.close === false
  return {
    ok: true,
    reply: said.reply,
    design: withUnmatchedFont(applied.design, unmatched),
    ...(siteUse && { site: siteUse }),
    ...(unmatched && { font: unmatched }),
    ...(fontsNearest && { fontsNearest }),
    applied: applied.applied.map((c) => ({ ...c, why: why.get(c.path) })),
    skipped: applied.skipped,
    outOfScope: false,
    readability: [],
    asks: said.asks,
    notes: siteUse ? [...said.notes, ...siteNotes(siteUse)] : said.notes,
    chips: said.chips,
    logo:
      logo && logoKey
        ? { image: logo.index, box: logo.box, full: logo.placement.use === 'full_logo', title }
        : null,
    timings,
    target: {
      measured,
      roles,
      fingerprint: targetFingerprint({ measured, roles, headlineInk: geometry.headline?.ink }),
      checkable: left() > LEAST,
      paths: [
        ...new Set(
          changes.map((c) => c.path).filter((p) => !applied.refused.some((r) => r.path === p))
        ),
      ],
    },
  }
}
