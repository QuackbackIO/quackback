/**
 * The portal design document: the one typed value that Appearance, presets,
 * AI, REST and MCP read and write. Every choice comes from DESIGN_OPTIONS.
 */
import { z } from 'zod'
import { roadmapIdSchema, typeIdSchema } from '@quackback/ids/zod'
import { tiptapContentSchema } from '@/lib/shared/schemas/posts'
import { isSafeThemeValue } from '@/lib/shared/theme/safe-theme-value'
import { normaliseColor } from './color'
import { BLOCK_WIDTHS, BUNDLED_FONT_IDS, DESIGN_OPTIONS } from './options'

const helpCenterCategoryIdSchema = typeIdSchema('kb_category')

/** hex, rgb(), hsl() or oklch(), stored in one canonical form; anything else is refused. */
const color = z.string().transform((value, ctx) => {
  const normalised = normaliseColor(value)
  if (normalised === null) {
    ctx.addIssue({ code: 'custom', message: `"${value}" is not a colour a design can use` })
    return z.NEVER
  }
  return normalised
})

const locale = z.string().min(2).max(16)
const localizedUpTo = (max: number) =>
  z.record(
    locale,
    z.string().trim().max(max).refine(isSafeThemeValue, 'Not allowed in display text')
  )
/** locale -> text. */
const localized = localizedUpTo(280)
/** A storage key, never a URL. */
const asset = z.object({ key: z.string().min(1).max(512) }).strict()
const label = z.string().trim().min(1).max(40)
const httpUrl = z
  .string()
  .trim()
  .max(2048)
  .regex(/^https?:\/\/[^\s]+$/i, 'Links must be http or https')

const palette = z
  .object({
    accent: color,
    background: color,
    ink: color,
    /** Cards. Derived when missing. */
    surface: color.optional(),
    /** Raised surfaces such as chips and the vote box. Derived when missing. */
    raised: color.optional(),
    /** Secondary text. Derived to 4.5:1 when missing. */
    muted: color.optional(),
    border: color.optional(),
    /** A second brand colour, for bands and highlights. Dark keeps light's when missing. */
    support: color.optional(),
  })
  .strict()

const fontId = z.enum(BUNDLED_FONT_IDS)

/**
 * Where an uploaded font file is kept: a woff2 under `fonts/` in the
 * workspace's storage. The key is written into the page's CSS, so it holds
 * only characters that cannot end a `url()`, and no segment starts with a dot.
 */
export const UPLOADED_FONT_KEY =
  /^fonts\/(?:[a-z0-9_-][a-z0-9._-]*\/)*[a-z0-9_-][a-z0-9._-]*\.woff2$/

const font = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('bundled'), id: fontId }).strict(),
  z
    .object({
      kind: z.literal('uploaded'),
      family: z
        .string()
        .max(64)
        .regex(/^[\p{L}\p{N} ._-]+$/u),
      files: z
        .array(
          z
            .object({
              key: z.string().max(512).regex(UPLOADED_FONT_KEY),
              weight: z.number().int().min(100).max(900),
              style: z.enum(['normal', 'italic']),
            })
            .strict()
        )
        .min(1)
        .max(6),
      /** Metrics for size-adjust, and the stack for scripts the upload lacks. */
      fallback: fontId,
    })
    .strict(),
])

const sort = z.enum(DESIGN_OPTIONS.sort)
const width = z.enum(DESIGN_OPTIONS.blockWidth)
const headline = z
  .object({
    title: localized,
    subtitle: localized,
    /** A phrase of the title, by locale, set apart in the accent colour or highlighted. */
    accent: z
      .object({ style: z.enum(DESIGN_OPTIONS.headlineAccent), text: localizedUpTo(60) })
      .strict()
      .optional(),
  })
  .strict()
  .nullable()
const link = z.object({ label, url: httpUrl }).strict()

/** Home blocks. `roadmapId: null` is the first public roadmap; empty `categoryIds` the first public categories. */
const homeBlock = z
  .discriminatedUnion('type', [
    z.object({ type: z.literal('welcome'), width, body: tiptapContentSchema }).strict(),
    z.object({ type: z.literal('composer'), width }).strict(),
    z
      .object({
        type: z.literal('ideas'),
        width,
        sort,
        count: z.union([z.literal(3), z.literal(5)]),
      })
      .strict(),
    z.object({ type: z.literal('roadmap'), width, roadmapId: roadmapIdSchema.nullable() }).strict(),
    z
      .object({
        type: z.literal('updates'),
        width,
        count: z.union([z.literal(2), z.literal(3), z.literal(4)]),
      })
      .strict(),
    z.object({ type: z.literal('help_search'), width }).strict(),
    z
      .object({
        type: z.literal('help_topics'),
        width,
        categoryIds: z.array(helpCenterCategoryIdSchema).max(8),
      })
      .strict(),
    z.object({ type: z.literal('status'), width }).strict(),
    z.object({ type: z.literal('contact'), width }).strict(),
    z
      .object({
        type: z.literal('links'),
        width,
        /** Its heading; without one it reads "Links". */
        title: label.optional(),
        links: z.array(link).min(1).max(6),
      })
      .strict(),
  ])
  .superRefine((block, ctx) => {
    if (!BLOCK_WIDTHS[block.type].includes(block.width))
      ctx.addIssue({
        code: 'custom',
        message: `A ${block.type} block cannot be ${block.width} width`,
        path: ['width'],
      })
  })

const PAGE_TYPES = ['feedback', 'roadmap', 'changelog', 'help', 'support', 'status'] as const
const navItem = z.discriminatedUnion('type', [
  z.object({ type: z.enum(PAGE_TYPES), shown: z.boolean(), label: label.optional() }).strict(),
  z
    .object({
      type: z.literal('link'),
      id: z.string().min(1).max(40),
      label,
      url: httpUrl,
      newTab: z.boolean(),
    })
    .strict(),
])

export const portalDesignV2 = z
  .object({
    version: z.literal(2),
    /** The preset a design started from. Provenance only, never read back. */
    basedOn: z.string().max(40).optional(),
    mode: z.enum(DESIGN_OPTIONS.mode),
    brand: z
      .object({
        light: palette,
        /** Keys left out are worked out for dark. */
        dark: palette.partial().optional(),
        fonts: z
          .object({
            heading: font,
            body: font,
            /** The page headlines' own face, such as a poster face; absent is the heading font. */
            display: font.optional(),
            headingWeight: z.union(
              DESIGN_OPTIONS.headingWeight.map((w) => z.literal(w)) as [
                z.ZodLiteral<500>,
                z.ZodLiteral<600>,
                z.ZodLiteral<700>,
                z.ZodLiteral<800>,
              ]
            ),
            /** Absent fields read as standard, normal and sentence: today's type. */
            scale: z.enum(DESIGN_OPTIONS.typeScale).optional(),
            tracking: z.enum(DESIGN_OPTIONS.tracking).optional(),
            headlineCase: z.enum(DESIGN_OPTIONS.textCase).optional(),
            labelCase: z.enum(DESIGN_OPTIONS.textCase).optional(),
            /** Page headlines in the ink, or in the brand colour. */
            headlineColour: z.enum(DESIGN_OPTIONS.inkOrAccent).optional(),
          })
          .strict(),
        logo: z
          .object({
            mark: z.object({ light: asset.nullable(), dark: asset.nullable() }).strict(),
            wordmark: z.object({ light: asset.nullable(), dark: asset.nullable() }).strict(),
            display: z.enum(DESIGN_OPTIONS.logoDisplay),
            /** The wordmark's ink when it is one colour throughout. */
            tone: z.enum(DESIGN_OPTIONS.logoTone).optional(),
            /** The name as a wordmark: its colour, its case, and a part of it in the brand colour. */
            nameColour: z.enum(DESIGN_OPTIONS.inkOrAccent).optional(),
            nameCase: z.enum(DESIGN_OPTIONS.textCase).optional(),
            nameAccent: z.string().trim().max(30).optional(),
            name: z.string().trim().max(60).optional(),
          })
          .strict(),
        /** An image for the band, such as a photo or a pattern. */
        bandImage: asset.optional(),
        /** The logo's own colours, for status markers in the brand's colours. */
        logoColours: z.array(color).max(6).optional(),
        favicon: asset.nullable(),
        shareImage: asset.nullable(),
      })
      .strict(),
    shape: z
      .object({
        corners: z.enum(DESIGN_OPTIONS.corners),
        /** Absent follows the corners. */
        buttons: z.enum(DESIGN_OPTIONS.buttons).optional(),
        /** The band's call to action in the brand colour or the second; absent is the brand colour. */
        action: z.enum(DESIGN_OPTIONS.action).optional(),
      })
      .strict(),
    layout: z
      .object({
        header: z.enum(DESIGN_OPTIONS.header),
        nav: z.enum(DESIGN_OPTIONS.nav),
        band: z.enum(DESIGN_OPTIONS.band),
        /** How a blend band runs; absent is linear. */
        blend: z.enum(DESIGN_OPTIONS.blend).optional(),
        /** Absent follows the header: centred under a centred header, else left. */
        bandAlign: z.enum(DESIGN_OPTIONS.bandAlign).optional(),
        /** Absent is full. */
        bandShape: z.enum(DESIGN_OPTIONS.bandShape).optional(),
        /** The header in the band's colour, so the two read as one. */
        headerOnBand: z.boolean().optional(),
        /** Absent is coloured dots. */
        status: z.enum(DESIGN_OPTIONS.status).optional(),
        /** Absent is neutral. */
        tint: z.enum(DESIGN_OPTIONS.tint).optional(),
        /** Where the band's image sits; absent is beside the words. */
        imagePlace: z.enum(DESIGN_OPTIONS.imagePlace).optional(),
        /** What part of the image stays when it is cropped; absent is the centre. */
        imageFocus: z.enum(DESIGN_OPTIONS.imageFocus).optional(),
        /** The other pages' titles on the band, as Home's headline is; absent is plain. */
        pageTitles: z.enum(DESIGN_OPTIONS.pageTitles).optional(),
        /** Art in the brand's colours for a band without an image; absent is none. */
        bandArt: z.enum(DESIGN_OPTIONS.bandArt).optional(),
        cards: z.enum(DESIGN_OPTIONS.cards),
        density: z.enum(DESIGN_OPTIONS.density),
        width: z.enum(DESIGN_OPTIONS.width),
        filters: z.enum(DESIGN_OPTIONS.filters),
      })
      .strict(),
    pages: z
      .object({
        home: z
          .object({
            headline,
            blocks: z.array(homeBlock).max(12),
            /** Where its composer block shows; absent is on the grid. */
            composer: z.enum(DESIGN_OPTIONS.composerPlace).optional(),
          })
          .strict(),
        feedback: z
          .object({
            headline,
            welcome: z.object({ show: z.boolean(), body: tiptapContentSchema }).strict(),
            defaultSort: sort,
            copy: z
              .object({
                prompt: localizedUpTo(60),
                submit: localizedUpTo(24),
                emptyTitle: localizedUpTo(60),
              })
              .partial()
              .strict(),
          })
          .strict(),
        /** The other pages' own titles; a page left out keeps its usual one. */
        titles: z.partialRecord(z.enum(DESIGN_OPTIONS.titledPage), headline.unwrap()).optional(),
      })
      .strict(),
    nav: z
      .object({
        home: z.object({ on: z.boolean(), tab: z.boolean(), label: label.optional() }).strict(),
        items: z.array(navItem).min(1).max(16),
      })
      .strict(),
    vocabulary: z
      .object({ post: z.enum(DESIGN_OPTIONS.postWord), board: z.enum(DESIGN_OPTIONS.boardWord) })
      .strict(),
    /** The workspace's own CSS, in the tenant layer. */
    css: z.string().max(50_000).optional(),
  })
  .strict()
  .superRefine((doc, ctx) => {
    if (!doc.nav.home.on && !doc.nav.items.some((item) => item.type !== 'link' && item.shown))
      ctx.addIssue({
        code: 'custom',
        message: 'With Home off, the menu must show a page',
        path: ['nav', 'items'],
      })
  })

export const portalDesign = portalDesignV2
export type PortalDesign = z.output<typeof portalDesignV2>

const EMPTY_DOC = { type: 'doc', content: [{ type: 'paragraph' }] }

/** Today's portal, as a design: what an unbranded workspace renders. */
export function defaultDesign(): PortalDesign {
  return {
    version: 2,
    mode: 'auto',
    brand: {
      light: { accent: 'oklch(0.886 0.176 86)', background: '#ffffff', ink: '#0a0a0a' },
      fonts: {
        heading: { kind: 'bundled', id: 'inter' },
        body: { kind: 'bundled', id: 'inter' },
        headingWeight: 600,
      },
      logo: {
        mark: { light: null, dark: null },
        wordmark: { light: null, dark: null },
        display: 'mark_and_name',
      },
      favicon: null,
      shareImage: null,
    },
    shape: { corners: 'rounded' },
    layout: {
      header: 'stacked',
      nav: 'tabs',
      band: 'none',
      cards: 'bordered',
      density: 'comfortable',
      width: 'default',
      filters: 'end',
    },
    pages: {
      home: { headline: null, blocks: [] },
      feedback: {
        headline: null,
        welcome: { show: false, body: structuredClone(EMPTY_DOC) },
        defaultSort: 'trending',
        copy: {},
      },
    },
    nav: {
      home: { on: false, tab: false },
      items: PAGE_TYPES.map((type) => ({ type, shown: true })),
    },
    vocabulary: { post: 'idea', board: 'board' },
  }
}
