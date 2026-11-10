/**
 * The portal design document: the one typed value that Appearance, presets,
 * AI, REST and MCP read and write. Every choice comes from DESIGN_OPTIONS.
 *
 * "Band" in a key (layout.band, layout.bandShape, brand.bandImage, home's
 * composer 'band', and the rest) is the hero, as people call it: the top of
 * each page with its headline (see hero.ts). The keys keep the older word so
 * stored designs and Quackback AI's structured output keep working.
 */
import { z } from 'zod'
import { tuneSchema } from './tune'
import {
  blockPhoneSheetSchema,
  blockStyleSheetSchema,
  darkStyleSheetSchema,
  phoneStyleSheetSchema,
  styleSheetSchema,
} from './style-tokens'
import { overridesSchema } from './style-overrides'
import {
  boardIdSchema,
  postStatusIdSchema,
  roadmapIdSchema,
  typeIdSchema,
} from '@quackback/ids/zod'
import { tiptapContentSchema } from '@/lib/shared/schemas/posts'
import { normaliseColor } from './color'
import { BUNDLED_FONT_IDS, DESIGN_OPTIONS } from './options'
import { GRID_COLUMNS, MAX_ROWS } from './home-grid'
import { withGridPlaces } from './home-legacy'
import { changelogChoicesSchema, helpChoicesSchema, roadmapChoicesSchema } from './page-choices'
import { pageBackgroundSchema, pageBackgroundsSchema } from './page-background'

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
/** Words visitors read. React escapes them and they never reach CSS, so only control characters are refused. */
const displayText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .refine(
      (text) => [...text].every((c) => c.charCodeAt(0) >= 0x20 && c.charCodeAt(0) !== 0x7f),
      'Not allowed in display text'
    )
const localizedUpTo = (max: number) => z.record(locale, displayText(max))
/** locale -> text. */
const localized = localizedUpTo(280)
/** A storage key, never a URL. */
const asset = z.object({ key: z.string().min(1).max(512) }).strict()

/**
 * A hero image cut from the customer's own screenshot by a brand match, so
 * the builder says to replace it with the original: the part of the
 * screenshot it came from (stored), and the share of that part it takes, so
 * it can be cropped again.
 */
export const screenshotSourceSchema = z
  .object({
    key: z.string().min(1).max(512),
    box: z
      .object({
        x: z.number().min(0).max(1),
        y: z.number().min(0).max(1),
        w: z.number().min(0.01).max(1),
        h: z.number().min(0.01).max(1),
      })
      .strict(),
  })
  .strict()

/**
 * The veil over a hero image behind the words, measured from the image:
 * black under white words or white under dark ones, its strength in percent,
 * and the colour the words read on at worst. Absent, the band's own colour
 * veils it.
 */
export const imageShadeSchema = z
  .object({
    tone: z.enum(['dark', 'light']),
    strength: z.number().int().min(0).max(90),
    under: color,
  })
  .strict()
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
    /** Up to two more brand colours, for bands and blocks. Dark keeps light's when missing. */
    extra: z.array(color).min(1).max(2).optional(),
  })
  .strict()

const fontId = z.enum(BUNDLED_FONT_IDS)

/**
 * Where an uploaded font file is kept: a woff2, woff, ttf or otf file under
 * `fonts/` in the workspace's storage. The key is written into the page's CSS, so it holds
 * only characters that cannot end a `url()`, and no segment starts with a dot.
 */
export const UPLOADED_FONT_KEY =
  /^fonts\/(?:[a-z0-9_-][a-z0-9._-]*\/)*[a-z0-9_-][a-z0-9._-]*\.(?:woff2|woff|ttf|otf)$/

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
const headline = z
  .object({
    title: localized,
    subtitle: localized,
    /**
     * A phrase of the title, by locale, set apart in the accent colour or
     * highlighted; `colour` draws it in another of the brand's colours.
     */
    accent: z
      .object({
        style: z.enum(DESIGN_OPTIONS.headlineAccent),
        text: localizedUpTo(60),
        colour: z.enum(DESIGN_OPTIONS.colourRole).optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .nullable()
const link = z.object({ label, url: httpUrl }).strict()

/** A Home block's own name, kept as blocks move, so what refers to a block follows it. */
export const BLOCK_ID = /^[a-z0-9]{8,24}$/
const blockId = z.string().regex(BLOCK_ID).optional()
/** A block's own heading, by language; absent is its usual one. */
const blockHeading = localizedUpTo(60).optional()
/** A block's own look over the site's; each field left out follows the site. */
const blockLook = z
  .object({
    tone: z.enum(DESIGN_OPTIONS.blockTone).optional(),
    align: z.enum(DESIGN_OPTIONS.blockAlign).optional(),
    /** The colour a tint or brand-colour look is drawn in; absent is the brand colour. */
    colour: z.enum(DESIGN_OPTIONS.colourRole).optional(),
    /** The look of its container and of what sits in it, by element and state, over the site's. */
    style: blockStyleSheetSchema.optional(),
    /** Phones' own sizes over its look, by element and state. */
    phone: blockPhoneSheetSchema.optional(),
  })
  .strict()
  .optional()
/**
 * A block's place on Home's twelve-column grid, in whole cells from the top
 * left: its column and row, and how many of each it takes. Rows are the least
 * it takes. Places are laid out again (kept in the grid, at the block's least
 * size, never overlapping, floated up) wherever they are drawn.
 */
const gridPlace = z
  .object({
    x: z
      .number()
      .int()
      .min(0)
      .max(GRID_COLUMNS - 1),
    y: z.number().int().min(0).max(999),
    w: z.number().int().min(1).max(GRID_COLUMNS),
    h: z.number().int().min(1).max(MAX_ROWS),
  })
  .strict()
const own = { id: blockId, heading: blockHeading, look: blockLook, grid: gridPlace }
/** A block's way on, such as "See all posts", in its own words; absent is its usual one. */
const linkWords = { link: localizedUpTo(40).optional() }
/**
 * What a block of the workspace's data does with nothing to show: hide, or
 * say its message (its own words, or its usual ones). Absent is as it always
 * was: Top posts says its message, the rest hide.
 */
const whenEmpty = {
  whenEmpty: z.enum(['hide', 'message']).optional(),
  emptyText: localizedUpTo(80).optional(),
}
const shown = z.boolean().optional()

/** Home blocks. `roadmapId: null` is the first public roadmap; empty `categoryIds` the first public categories; absent or empty `boardIds` every board. */
export const homeBlockSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('welcome'), ...own, body: tiptapContentSchema }).strict(),
  z.object({ type: z.literal('composer'), ...own }).strict(),
  z
    .object({
      type: z.literal('ideas'),
      ...own,
      sort,
      count: z.union([z.literal(3), z.literal(5), z.literal(10)]),
      /** Public boards to draw from; absent or empty is every board. */
      boardIds: z.array(boardIdSchema).max(10).optional(),
      /** What each post shows; absent is votes and status on, comments off. */
      showVotes: shown,
      showStatus: shown,
      showComments: shown,
      ...linkWords,
      ...whenEmpty,
    })
    .strict(),
  z
    .object({
      type: z.literal('roadmap'),
      ...own,
      roadmapId: roadmapIdSchema.nullable(),
      /** The columns it shows, by their statuses; absent or empty is every column. */
      statusIds: z.array(postStatusIdSchema).max(12).optional(),
      /** Posts in each column; absent is 2. */
      perColumn: z.union([z.literal(2), z.literal(3), z.literal(5)]).optional(),
      /** Each post's votes beside it; absent is off. */
      showVotes: shown,
      ...linkWords,
      ...whenEmpty,
    })
    .strict(),
  z
    .object({
      type: z.literal('updates'),
      ...own,
      count: z.union([z.literal(2), z.literal(3), z.literal(4)]),
      /** Each entry's date (absent is on) and the start of its words (absent is off). */
      showDate: shown,
      showSummary: shown,
      ...linkWords,
      ...whenEmpty,
    })
    .strict(),
  z
    .object({
      type: z.literal('help_search'),
      ...own,
      /** How many popular articles it lists under the search; absent is 5. */
      popular: z.union([z.literal(0), z.literal(3), z.literal(5)]).optional(),
      ...linkWords,
    })
    .strict(),
  z
    .object({
      type: z.literal('help_topics'),
      ...own,
      categoryIds: z.array(helpCenterCategoryIdSchema).max(8),
      /** Topics as cards (absent) or as rows. */
      layout: z.enum(['cards', 'list']).optional(),
      /** Each topic's article count; absent is on. */
      showCounts: shown,
      /** How many of each topic's articles it lists under it; absent is none. */
      topArticles: z.union([z.literal(0), z.literal(2), z.literal(3)]).optional(),
      ...linkWords,
      ...whenEmpty,
    })
    .strict(),
  z
    .object({
      type: z.literal('status'),
      ...own,
      /** The incidents under way, under the status; absent is on. */
      showIncidents: shown,
      ...linkWords,
      ...whenEmpty,
    })
    .strict(),
  z
    .object({
      type: z.literal('contact'),
      ...own,
      /** Its line of words; absent is its usual one. */
      text: localizedUpTo(160).optional(),
      ...linkWords,
    })
    .strict(),
  z
    .object({
      type: z.literal('links'),
      ...own,
      /** Its heading; without one it reads "Links". */
      title: label.optional(),
      links: z.array(link).min(1).max(6),
    })
    .strict(),
])

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
                z.ZodLiteral<300>,
                z.ZodLiteral<400>,
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
            /**
             * What the header shows: the icon and the title (mark_and_name), or a
             * full logo image (wordmark). Designs stored before the logo was an
             * icon and a title may show the icon alone (mark) or the title alone (name).
             */
            display: z.enum(DESIGN_OPTIONS.logoDisplay),
            /**
             * The ink of the logo image the header shows, when it is dark or light
             * throughout on a clear background, so it can sit on a tile where it
             * would vanish into the header.
             */
            tone: z.enum(DESIGN_OPTIONS.logoTone).optional(),
            /**
             * The logo image is one ink throughout (a black or white wordmark),
             * so where it would vanish into the header it is drawn in the
             * header's text colour, as a brand's reversed logo is, not on a tile.
             */
            oneInk: z.boolean().optional(),
            /**
             * That one ink's colour, so where the header is that colour (a band
             * of the brand's own colour) the logo is drawn in the header's text.
             */
            ink: color.optional(),
            /** The title beside the icon; absent is the workspace's name. */
            name: z.string().trim().max(60).optional(),
            /** How tall the logo stands in the header, in px; absent is 32. */
            height: z.number().int().min(16).max(64).optional(),
          })
          .strict(),
        /**
         * When a brand match last ran into this design (ISO time). The builder
         * offers the match until one has run, whatever the design already holds:
         * onboarding's logo alone is not a matched brand.
         */
        matchedAt: z.string().datetime().optional(),
        /**
         * An image for the band, such as a photo or a pattern, with what it
         * shows for those who cannot see it, or marked as decoration.
         */
        bandImage: asset
          .extend({
            alt: z.string().trim().max(200).optional(),
            decorative: z.boolean().optional(),
            screenshot: screenshotSourceSchema.optional(),
            shade: imageShadeSchema.optional(),
            /** Shown in Home's hero only; the other pages' heroes keep their colour. */
            homeOnly: z.boolean().optional(),
          })
          .strict()
          .optional(),
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
        /**
         * The band's call to action as the other buttons are (absent), in the
         * brand colour while the other buttons are the text colour, or in the second.
         */
        action: z.enum(DESIGN_OPTIONS.action).optional(),
        /** Primary buttons in the brand colour or the text colour; absent is the brand colour. */
        fill: z.enum(DESIGN_OPTIONS.fill).optional(),
        /** Motion under the pointer; absent is none. */
        hover: z.enum(DESIGN_OPTIONS.hover).optional(),
      })
      .strict(),
    layout: z
      .object({
        header: z.enum(DESIGN_OPTIONS.header),
        /** Where an inline header's menu sits; absent is beside the logo. */
        menuAlign: z.enum(DESIGN_OPTIONS.menuAlign).optional(),
        nav: z.enum(DESIGN_OPTIONS.nav),
        /** The menu's other pages in the text colour; absent is the softer grey. */
        navText: z.enum(DESIGN_OPTIONS.navText).optional(),
        band: z.enum(DESIGN_OPTIONS.band),
        /** How a blend band runs; absent is linear. */
        blend: z.enum(DESIGN_OPTIONS.blend).optional(),
        /** Absent follows the header: centred under a centred header, else left. */
        bandAlign: z.enum(DESIGN_OPTIONS.bandAlign).optional(),
        /** Absent is full. */
        bandShape: z.enum(DESIGN_OPTIONS.bandShape).optional(),
        /** Absent is roomy. */
        bandHeight: z.enum(DESIGN_OPTIONS.bandHeight).optional(),
        /** The colour a brand-colour, tint or fade band is drawn in; absent is the brand colour. */
        bandColour: z.enum(DESIGN_OPTIONS.colourRole).optional(),
        /** Absent is the top. */
        fadeFrom: z.enum(DESIGN_OPTIONS.fadeFrom).optional(),
        /** A glow of light on a brand or second-colour band, and where it sits; absent is none. */
        bandGlow: z.enum(DESIGN_OPTIONS.bandGlow).optional(),
        /** The glow's colour; absent is a light of the band's own colour. */
        bandGlowColour: z.enum(DESIGN_OPTIONS.colourRole).optional(),
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
        /** An exact point the image is cropped toward, in percent across and down; over the side above. */
        imagePoint: z
          .object({ x: z.number().min(0).max(100), y: z.number().min(0).max(100) })
          .strict()
          .optional(),
        /** The band's image on phones; absent is shown. */
        imagePhone: z.enum(DESIGN_OPTIONS.imagePhone).optional(),
        /** The other pages' titles on the band, as Home's headline is; absent is plain. */
        pageTitles: z.enum(DESIGN_OPTIONS.pageTitles).optional(),
        /** Art in the brand's colours for a band without an image; absent is none. */
        bandArt: z.enum(DESIGN_OPTIONS.bandArt).optional(),
        cards: z.enum(DESIGN_OPTIONS.cards),
        density: z.enum(DESIGN_OPTIONS.density),
        width: z.enum(DESIGN_OPTIONS.width),
        filters: z.enum(DESIGN_OPTIONS.filters),
        /** What sits behind every page: absent is the page colour, as designs always had. */
        background: pageBackgroundSchema.optional(),
        /** Pages with a background of their own over the site's. */
        pageBackgrounds: pageBackgroundsSchema.optional(),
        /** What post cards leave out; absent shows everything. */
        postCardHides: z.array(z.enum(DESIGN_OPTIONS.postCardField)).max(3).optional(),
      })
      .strict(),
    pages: z
      .object({
        /** Blocks stored with widths, from before the grid, take places as they are read. */
        home: z.preprocess(
          withGridPlaces,
          z
            .object({
              headline,
              blocks: z.array(homeBlockSchema).max(12),
              /** Where its composer block shows; absent is on the grid. */
              composer: z.enum(DESIGN_OPTIONS.composerPlace).optional(),
              /** How wide the composer is in the band; absent draws as it always has. */
              composerWidth: z.enum(DESIGN_OPTIONS.composerWidth).optional(),
              /**
               * The hero's main action; absent is the composer when it sits in the
               * band, else none (main-action.ts).
               */
              mainAction: z.enum(DESIGN_OPTIONS.mainAction).optional(),
              /** The hero's call to action: where it goes, its words, and a quiet second one. */
              button: z
                .object({
                  to: z.enum(DESIGN_OPTIONS.heroButtonTo).optional(),
                  label: localizedUpTo(40).optional(),
                  second: z.boolean().optional(),
                  secondLabel: localizedUpTo(40).optional(),
                })
                .strict()
                .optional(),
            })
            .strict()
        ),
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
        /** Each page's own choices; a page left out, or a choice, draws as it always has. */
        changelog: changelogChoicesSchema.optional(),
        help: helpChoicesSchema.optional(),
        roadmap: roadmapChoicesSchema.optional(),
      })
      .strict(),
    nav: z
      .object({
        home: z.object({ on: z.boolean(), tab: z.boolean(), label: label.optional() }).strict(),
        items: z.array(navItem).min(1).max(16),
      })
      .strict(),
    /** Exact values under the choices above; each one left out keeps the choice's. */
    tune: tuneSchema.optional(),
    /** Each element kind's look in each state, over the choices above (style-tokens.ts). */
    style: styleSheetSchema.optional(),
    /** Dark mode's own colours over `style`; each left out is worked out from light's. */
    styleDark: darkStyleSheetSchema.optional(),
    /** Phones' own sizes and shapes over `style`; colours are the same on every screen. */
    stylePhone: phoneStyleSheetSchema.optional(),
    /** Looks set for one page or one part, over `style` (style-overrides.ts). */
    overrides: overridesSchema.optional(),
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
  }
}
