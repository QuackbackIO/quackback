/**
 * The patch Ask may make to the Customise draft (PORTAL-CUSTOMISE-SPEC §6.8).
 *
 * A patch names settings, not CSS: a colour role, a font from the list, a
 * corner stop, a tab by id. The editor applies it to its own draft
 * (components/admin/settings/portal-customise/ask-draft.ts) through the same
 * writes its sections use, and it goes live only through Publish.
 *
 * Client-safe: imports from the server domain are types only.
 */
import { z } from 'zod'
import type { TiptapContent } from '@/lib/shared/db-types'
import { BUTTON_SHAPES } from '@/lib/shared/schemas/settings'
import { helpCenterHeaderLinkSchema } from '@/lib/shared/schemas/help-center'
import { BRANDING_FONTS, type BrandingFontId } from '@/lib/shared/theme/fonts'
import { CARD_STYLES } from '@/lib/shared/theme/types'
import type { PortalNavItemConfig } from '@/lib/server/domains/settings'

/** The corner stops the Font and shape section offers, in rem. */
export const CORNER_STOPS = [0, 0.25, 0.5, 1] as const
export type CornerStop = (typeof CORNER_STOPS)[number]

export const BRANDING_FONT_IDS = BRANDING_FONTS.map((font) => font.id) as [
  BrandingFontId,
  ...BrandingFontId[],
]

/** Six-digit lowercase-or-uppercase hex: the only colour form a patch carries. */
const hexColour = z.string().regex(/^#[0-9a-fA-F]{6}$/)

/**
 * A colour back on Auto: the header bar is the page's own colour again, the
 * background the unbranded one, the text the one that reads on the background.
 */
export const COLOUR_AUTO = 'auto'

/** Headings back in the text font: a word, never null (see the header colour). */
export const SAME_AS_TEXT_FONT = 'same_as_text'

/** What the header shows: the uploaded logo alone, or the icon with the name beside it. */
export const HEADER_SHOWS = ['logo', 'icon_and_name'] as const
export type HeaderShows = (typeof HEADER_SHOWS)[number]

/** The colour a patch sets, or "auto" to put it back on Auto. */
const colourOrAuto = z.union([hexColour, z.literal(COLOUR_AUTO)])

const palettePatchSchema = z
  .object({
    main: hexColour.optional(),
    /**
     * Background, text and the header bar may go back on Auto. A word clears
     * them, never null: a model that fills every optional field with null
     * would otherwise clear them without being asked.
     */
    background: colourOrAuto.optional(),
    text: colourOrAuto.optional(),
    header: colourOrAuto.optional(),
  })
  .strict()

/** Tab ids as the nav stores them (built-ins use their type, links a UUID). */
const tabId = z.string().min(1).max(64)

/**
 * What Ask may change. Strict at every level, so CSS, logo keys, uploaded
 * fonts, tab addresses or any setting not on the page are refused. No
 * transforms: the prompt-only fallback sends this as JSON Schema.
 */
export const portalDraftPatchSchema = z
  .object({
    themeMode: z.enum(['light', 'dark', 'user']).optional(),
    colours: z
      .object({ light: palettePatchSchema.optional(), dark: palettePatchSchema.optional() })
      .strict()
      .optional(),
    font: z.enum(BRANDING_FONT_IDS).optional(),
    /** The font of titles and headings, or "same_as_text" for the text font. */
    headingFont: z.enum([...BRANDING_FONT_IDS, SAME_AS_TEXT_FONT]).optional(),
    cardStyle: z.enum(CARD_STYLES).optional(),
    corners: z
      .union(
        CORNER_STOPS.map((stop) => z.literal(stop)) as [
          z.ZodLiteral<CornerStop>,
          ...z.ZodLiteral<CornerStop>[],
        ]
      )
      .optional(),
    buttonShape: z.enum(BUTTON_SHAPES).optional(),
    /**
     * The name in the header. Never empty: a model that fills every field
     * would otherwise clear a name nobody asked about. The workspace's own
     * name puts it back.
     */
    portalName: z.string().min(1).max(100).regex(/\S/).optional(),
    /** Showing the logo needs one uploaded: the editor ignores it otherwise. */
    headerShows: z.enum(HEADER_SHOWS).optional(),
    tabs: z
      .object({
        /** Ids to put first, in this order; the rest keep their order after them. */
        order: z.array(tabId).max(20).optional(),
        changes: z
          .array(
            z
              .object({
                id: tabId,
                label: z.string().min(1).max(30).optional(),
                enabled: z.boolean().optional(),
              })
              .strict()
          )
          .max(20)
          .optional(),
      })
      .strict()
      .optional(),
    /** Plain text; blank lines separate paragraphs. Empty hides the message. */
    welcomeMessage: z.string().max(2000).optional(),
    helpCenter: z
      .object({
        homepageTitle: z.string().min(1).max(200).optional(),
        homepageDescription: z.string().max(500).optional(),
        headerLinks: z.array(helpCenterHeaderLinkSchema.strict()).max(3).optional(),
      })
      .strict()
      .optional(),
  })
  .strict()

export type PortalDraftPatch = z.infer<typeof portalDraftPatchSchema>

/**
 * The patch's colour roles as theme variables, background first: it brings an
 * automatic text colour that a text colour in the same patch then overrides.
 */
export const PATCH_COLOUR_ROLES = [
  ['background', 'background'],
  ['text', 'foreground'],
  ['main', 'primary'],
  ['header', 'header'],
] as const

/** Plain text to the welcome message's document, one paragraph per blank-line block. */
export function welcomeTextToDoc(text: string): TiptapContent {
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
  if (paragraphs.length === 0) return { type: 'doc', content: [{ type: 'paragraph' }] }
  return {
    type: 'doc',
    content: paragraphs.map((p) => ({ type: 'paragraph', content: [{ type: 'text', text: p }] })),
  }
}

/** The welcome message's text, paragraphs separated by a blank line. */
export function welcomeDocToText(doc: TiptapContent | null | undefined): string {
  const textOf = (node: { text?: string; content?: unknown[] }): string =>
    (node.text ?? '') +
    (node.content ?? []).map((child) => textOf(child as { text?: string })).join('')
  return (doc?.content ?? [])
    .map((block) => textOf(block as { text?: string }).trim())
    .filter(Boolean)
    .join('\n\n')
}

/**
 * The tabs with a patch's order and changes applied. Ids the tabs do not have
 * are ignored, and Feedback stays on.
 */
export function applyTabsPatch(
  nav: PortalNavItemConfig[],
  tabs: NonNullable<PortalDraftPatch['tabs']>
): PortalNavItemConfig[] {
  const changes = new Map((tabs.changes ?? []).map((change) => [change.id, change]))
  let next = nav.map((item) => {
    const change = changes.get(item.id)
    if (!change) return item
    const updated = { ...item }
    if (change.label !== undefined) updated.label = change.label
    // Feedback is always on.
    if (change.enabled !== undefined && item.type !== 'feedback') updated.enabled = change.enabled
    return updated
  })
  if (tabs.order) {
    const byId = new Map(next.map((item) => [item.id, item]))
    const first = [...new Set(tabs.order)].filter((id) => byId.has(id))
    const firstSet = new Set(first)
    next = [...first.map((id) => byId.get(id)!), ...next.filter((item) => !firstSet.has(item.id))]
  }
  return next
}
