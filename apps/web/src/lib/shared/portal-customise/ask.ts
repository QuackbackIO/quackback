/**
 * Ask in Customise (PORTAL-CUSTOMISE-SPEC §6.8): the request and response
 * shapes, the replies, and the local fast path that answers plain requests
 * without the model.
 *
 * The fast path is pure and client-safe, so the editor may run it before
 * calling the server; the server runs it first as well, so a plain request
 * works with AI off or the allowance used up.
 */
import { z } from 'zod'
import { BRANDING_FONTS, type BrandingFontId } from '@/lib/shared/theme/fonts'
import { CARD_STYLES, type CardStyle } from '@/lib/shared/theme/types'
import {
  CORNER_STOPS,
  HEADER_SHOWS,
  SAME_AS_TEXT_FONT,
  type CornerStop,
  type PortalDraftPatch,
} from './draft-patch'

// ---------------------------------------------------------------------------
// Request
// ---------------------------------------------------------------------------

const colourSummary = z
  .object({
    main: z.string().max(16).optional(),
    background: z.string().max(16).optional(),
    text: z.string().max(16).optional(),
    /** The header bar's own colour; left out while it is the page's. */
    header: z.string().max(16).optional(),
  })
  .strict()

/**
 * What the server is told about the draft: only what the prompt and the fast
 * path need. Never Advanced CSS, logo keys or uploaded font files.
 */
export const askDraftContextSchema = z
  .object({
    themeMode: z.enum(['light', 'dark', 'user']),
    buttonShape: z.enum(['pill', 'corners']),
    /** The corner radius in rem. */
    corners: z.number().min(0).max(10),
    /** A listed font id, or null for an uploaded or unlisted font. */
    font: z.string().max(64).nullable(),
    /** A listed font id, "same_as_text", or null for an uploaded or unlisted headings font. */
    headingFont: z.string().max(64).nullable(),
    cardStyle: z.enum(CARD_STYLES),
    /** The name the header shows: its own, else the workspace's. */
    portalName: z.string().max(100),
    /** The workspace's name, which an empty portal name puts back. */
    workspaceName: z.string().max(100),
    headerShows: z.enum(HEADER_SHOWS),
    /** Whether a logo is uploaded, so the header can show it. Never its key. */
    hasLogo: z.boolean(),
    colours: z.object({ light: colourSummary, dark: colourSummary }).strict(),
    tabs: z
      .array(
        z
          .object({
            id: z.string().min(1).max(64),
            type: z.enum(['feedback', 'roadmap', 'changelog', 'help', 'support', 'status', 'link']),
            label: z.string().max(30).optional(),
            enabled: z.boolean(),
          })
          .strict()
      )
      .max(20),
    welcomeMessage: z.string().max(2000),
    /** Null when the person cannot edit the Help Center home. */
    helpCenter: z
      .object({
        homepageTitle: z.string().max(200),
        homepageDescription: z.string().max(500),
        headerLinks: z
          .array(z.object({ label: z.string().max(60), url: z.string().max(500) }).strict())
          .max(3),
      })
      .strict()
      .nullable(),
  })
  .strict()

export type AskDraftContext = z.infer<typeof askDraftContextSchema>

/** The page the preview shows, so "this page" requests land on the right section. */
export const ASK_PAGES = ['feedback', 'roadmap', 'changelog', 'help'] as const
export type AskPage = (typeof ASK_PAGES)[number]

export const askPortalCustomiseSchema = z
  .object({
    request: z.string().trim().min(1).max(500),
    draft: askDraftContextSchema,
    page: z.enum(ASK_PAGES).optional(),
  })
  .strict()

// ---------------------------------------------------------------------------
// Response
// ---------------------------------------------------------------------------

export type PortalAskResponse =
  /** Apply `patch` to the draft (see `applyDraftPatch`) and show `reply` with Undo. */
  | { outcome: 'patch'; handled: 'local' | 'model'; patch: PortalDraftPatch; reply: string }
  /** Step the editor's history back. */
  | { outcome: 'undo'; handled: 'local'; reply: string }
  /** Run Import your brand for `host`. */
  | { outcome: 'import'; handled: 'local' | 'model'; host: string; reply: string }
  /** Nothing to change; show `reply`. */
  | { outcome: 'refused'; handled: 'local' | 'refused'; reply: string }
  /** AI is off or the allowance is used up; show `reply`. */
  | { outcome: 'unavailable'; handled: 'refused'; reply: string }

/** Plain replies (§6.8): one sentence, no hex unless the person typed it. */
export const ASK_REPLIES = {
  outOfReach:
    "I can't do that one. I can match a website, and change colours, fonts, cards, corners, buttons, the header, tabs and the welcome message.",
  poweredBy: 'Powered by depends on your plan.',
  layout: "That isn't a setting. Your own CSS rules can do it, on the Business plan.",
  notUnderstood: "I couldn't work that one out. Try saying it another way.",
  aiOff: "Ask isn't available here. You can still change everything in the sections above.",
  allowanceUsed:
    'Ask has used up its AI allowance for now. You can still change everything in the sections above.',
  undone: 'Undone.',
  feedbackAlwaysOn: 'Feedback is always on.',
  noLogo: 'Upload a logo first, then the header can show it.',
  done: 'Done. Have a look at the preview.',
} as const

const THEME_MODE_REPLIES = {
  user: 'Visitors can now choose light or dark.',
  light: 'The portal is light only now.',
  dark: 'The portal is dark only now.',
} as const

const CARD_STYLE_REPLIES: Record<CardStyle, string> = {
  border: 'Cards have a border again.',
  shadow: 'Cards have a shadow now.',
  flat: 'Cards are flat now.',
}

/** A one-sentence reply for a patch, from what it changes. Never quotes values. */
export function replyForPatch(patch: PortalDraftPatch): string {
  const parts = Object.keys(patch).filter(
    (key) => patch[key as keyof PortalDraftPatch] !== undefined
  )
  if (parts.length !== 1) return ASK_REPLIES.done
  if (patch.themeMode) return THEME_MODE_REPLIES[patch.themeMode]
  if (patch.buttonShape) {
    return patch.buttonShape === 'pill'
      ? 'Buttons are pill shaped now.'
      : 'Buttons match the corners now.'
  }
  if (patch.corners !== undefined) return 'Corners updated.'
  if (patch.font) return `Font changed to ${fontName(patch.font)}.`
  if (patch.headingFont) {
    return patch.headingFont === SAME_AS_TEXT_FONT
      ? 'Headings match the text font again.'
      : `Headings are now in ${fontName(patch.headingFont)}.`
  }
  if (patch.cardStyle) return CARD_STYLE_REPLIES[patch.cardStyle]
  if (patch.portalName !== undefined) {
    return patch.portalName.trim()
      ? `The header now says ${patch.portalName.trim()}.`
      : 'The header shows your workspace name again.'
  }
  if (patch.headerShows) {
    return patch.headerShows === 'logo'
      ? 'The header shows your logo now.'
      : 'The header shows your icon and name now.'
  }
  if (patch.colours) return 'Colours updated.'
  if (patch.tabs) return 'Tabs updated.'
  if (patch.welcomeMessage !== undefined) {
    return patch.welcomeMessage.trim() ? 'Welcome message updated.' : 'Welcome message hidden.'
  }
  return 'Help Center home updated.'
}

// ---------------------------------------------------------------------------
// Fast path
// ---------------------------------------------------------------------------

/** Names that differ from the family in the stack (@fontsource calls Geist "Geist Sans"). */
const FONT_NAME_OVERRIDES: Partial<Record<BrandingFontId, string>> = {
  inter: 'Inter',
  system: 'System UI',
  geist: 'Geist',
}

/** Each listed font's name as the Font picker shows it. */
const FONT_NAMES = Object.fromEntries(
  BRANDING_FONTS.map((font) => [
    font.id,
    FONT_NAME_OVERRIDES[font.id] ?? /^"([^"]+)"/.exec(font.value)?.[1] ?? font.id,
  ])
) as Record<BrandingFontId, string>

const fontName = (id: BrandingFontId) => FONT_NAMES[id]

/** Default names people use for each built-in tab. */
const TAB_NAMES: Record<string, string[]> = {
  feedback: ['feedback'],
  roadmap: ['roadmap'],
  changelog: ['changelog', 'updates'],
  help: ['help center', 'help centre', 'help'],
  support: ['support'],
  status: ['status'],
}

type Tab = AskDraftContext['tabs'][number]

/** A tab's name as the portal shows it: its own label, or its built-in name. */
export const tabDisplayName = (tab: Pick<Tab, 'type' | 'label'>) =>
  tab.label ??
  (tab.type === 'help' ? 'Help Center' : tab.type.charAt(0).toUpperCase() + tab.type.slice(1))

function findTab(name: string, tabs: Tab[]): Tab | null {
  const wanted = name.trim().toLowerCase()
  const matches = tabs.filter(
    (tab) => tab.label?.toLowerCase() === wanted || (TAB_NAMES[tab.type] ?? []).includes(wanted)
  )
  return matches.length === 1 ? matches[0]! : null
}

const HOST_NAME = '(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\\.)+[a-zA-Z]{2,24}'
const HOST = new RegExp(`^(?:https?://)?(?:www\\.)?(${HOST_NAME})/?$`, 'i')

/** A bare website host for Import, such as `example.com`. */
export const websiteHostSchema = z
  .string()
  .max(253)
  .regex(new RegExp(`^${HOST_NAME}$`))

function nextStop(current: number, direction: 'down' | 'up'): CornerStop | null {
  const stops = direction === 'down' ? [...CORNER_STOPS].reverse() : [...CORNER_STOPS]
  return stops.find((stop) => (direction === 'down' ? stop < current : stop > current)) ?? null
}

const LESS_ROUND = /\b(less round(?:ed)?|sharper|squarer|square|not (?:so )?round(?:ed)?)\b/
const MORE_ROUND = /\b(more round(?:ed)?|rounder|softer)\b/

const patch = (p: PortalDraftPatch, reply = replyForPatch(p)): PortalAskResponse => ({
  outcome: 'patch',
  handled: 'local',
  patch: p,
  reply,
})
const refuse = (reply: string): PortalAskResponse => ({
  outcome: 'refused',
  handled: 'local',
  reply,
})

const COLOUR_WORDS = new Set(
  (
    'use make set change try switch to the a it our my main primary brand colour color ' +
    'background page text header bar in for of light dark mode theme as be is'
  ).split(' ')
)

function answerColour(text: string, ctx: AskDraftContext): PortalAskResponse | null {
  const hexes = text.match(/#(?:[0-9a-f]{6}|[0-9a-f]{3})\b/g) ?? []
  if (hexes.length !== 1) return null
  // Every other word must be one this path understands; "border" or "button"
  // name something it cannot place, so the model decides.
  const words = text.replace(hexes[0]!, ' ').split(/\s+/).filter(Boolean)
  if (!words.every((word) => COLOUR_WORDS.has(word))) return null
  let hex = hexes[0]!
  if (hex.length === 4) hex = `#${[...hex.slice(1)].map((c) => c + c).join('')}`
  const background = /\b(background|page)\b/.test(text)
  const textRole = /\b(text|font colou?r|writing)\b/.test(text)
  const header = /\b(header|bar)\b/.test(text)
  // "Header background" or "header text" is not one colour this path can place.
  if ([background, textRole, header].filter(Boolean).length > 1) return null
  const role = background ? 'background' : textRole ? 'text' : header ? 'header' : 'main'
  const named = /\bdark\b/.test(text) ? 'dark' : /\blight\b/.test(text) ? 'light' : null
  const mode = named ?? (ctx.themeMode === 'dark' ? 'dark' : 'light')
  const label = { main: 'Main colour', background: 'Background', text: 'Text', header: 'Header' }[
    role
  ]
  // Nothing carries a header colour from light to dark, so both sides get it
  // when visitors choose and the request names neither.
  const colours =
    role === 'header' && !named && ctx.themeMode === 'user'
      ? { light: { header: hex }, dark: { header: hex } }
      : { [mode]: { [role]: hex } }
  return patch({ colours }, `${label} is now ${hex}.`)
}

function answerShape(text: string, ctx: AskDraftContext): PortalAskResponse | null {
  const buttons = /\bbuttons?\b/.test(text)
  const corners = /\bcorners?\b/.test(text)
  if (buttons && corners) {
    return /\bmatch/.test(text) ? patch({ buttonShape: 'corners' }) : null
  }
  if (buttons) {
    if (/\bpills?\b/.test(text)) return patch({ buttonShape: 'pill' })
    if (LESS_ROUND.test(text)) {
      if (ctx.buttonShape === 'pill') return patch({ buttonShape: 'corners' })
      const stop = nextStop(ctx.corners, 'down')
      return stop === null ? refuse('Buttons are already square.') : patch({ corners: stop })
    }
    if (MORE_ROUND.test(text)) {
      if (ctx.buttonShape === 'pill') return refuse('Buttons are already fully rounded.')
      const stop = nextStop(ctx.corners, 'up')
      return stop === null ? patch({ buttonShape: 'pill' }) : patch({ corners: stop })
    }
    return null
  }
  if (corners) {
    if (/\b(square|sharp|no round(?:ing)?)\b/.test(text) && !/\bsharper\b/.test(text)) {
      return patch({ corners: 0 })
    }
    const direction = LESS_ROUND.test(text) ? 'down' : MORE_ROUND.test(text) ? 'up' : null
    if (!direction) return null
    const stop = nextStop(ctx.corners, direction)
    if (stop === null) {
      return refuse(
        direction === 'down'
          ? 'Corners are already square.'
          : 'Corners are already as round as they go.'
      )
    }
    return patch({ corners: stop })
  }
  return null
}

function answerTabs(raw: string, text: string, ctx: AskDraftContext): PortalAskResponse | null {
  const move =
    /^(?:put|move|make) (?:the )?(.+?)(?: tab)? (first|to the (?:front|start|beginning|left)|last|to the (?:end|back|right))$/.exec(
      text
    )
  if (move) {
    const tab = findTab(move[1]!, ctx.tabs)
    if (!tab) return null
    const rest = ctx.tabs.filter((t) => t.id !== tab.id).map((t) => t.id)
    const last = /last|end|back|right/.test(move[2]!)
    return patch(
      { tabs: { order: last ? [...rest, tab.id] : [tab.id, ...rest] } },
      `${tabDisplayName(tab)} is ${last ? 'last' : 'first'} now.`
    )
  }

  // Run on the request as typed so the new label keeps its casing.
  const rename = /^rename (?:the )?(.+?)(?: tab)? (?:to|as) ["'“‘]?(.+?)["'”’]?$/i.exec(raw)
  if (rename) {
    const tab = findTab(rename[1]!, ctx.tabs)
    const label = rename[2]!.trim()
    if (!tab || !label || label.length > 30) return null
    return patch({ tabs: { changes: [{ id: tab.id, label }] } }, `That tab is now called ${label}.`)
  }

  const toggle =
    /^(hide|remove|turn off|disable|show|unhide|turn on|enable|bring back) (?:the )?(.+?)(?: tab)?$/.exec(
      text
    )
  if (toggle) {
    const tab = findTab(toggle[2]!, ctx.tabs)
    if (!tab) return null
    const enabled = /^(show|unhide|turn on|enable|bring back)$/.test(toggle[1]!)
    if (!enabled && tab.type === 'feedback') return refuse(ASK_REPLIES.feedbackAlwaysOn)
    const name = tabDisplayName(tab)
    return patch(
      { tabs: { changes: [{ id: tab.id, enabled }] } },
      enabled ? `${name} is showing now.` : `${name} is hidden now.`
    )
  }
  return null
}

function answerFont(text: string): PortalAskResponse | null {
  const match =
    /^(?:use|switch to|change the font to|set the font to|make the font) (.+?)(?: font)?$/.exec(
      text
    )
  if (!match) return null
  const id = fontIdNamed(match[1]!)
  return id ? patch({ font: id }) : null
}

/** A listed font by the name the Font picker shows, as typed in any case. */
function fontIdNamed(name: string): BrandingFontId | null {
  const wanted = name.trim()
  return (
    (Object.keys(FONT_NAMES) as BrandingFontId[]).find(
      (key) => FONT_NAMES[key].toLowerCase() === wanted
    ) ?? null
  )
}

const HEADINGS = '(?:the )?(?:headings?|titles?)'

function answerHeadingFont(text: string): PortalAskResponse | null {
  if (
    new RegExp(
      `^(?:make |set |put )?${HEADINGS}(?: font)? (?:to |in |back to )?(?:match|the same as|same as) (?:the )?(?:text|body)(?: font)?(?: again)?$`
    ).test(text)
  ) {
    return patch({ headingFont: SAME_AS_TEXT_FONT })
  }
  const named =
    new RegExp(`^(?:use )?(.+?)(?: font)? for ${HEADINGS}$`).exec(text) ??
    new RegExp(`^(?:set|make|change|put) ${HEADINGS}(?: font)? (?:to |in )?(.+?)(?: font)?$`).exec(
      text
    )
  const id = named ? fontIdNamed(named[1]!) : null
  return id ? patch({ headingFont: id }) : null
}

const CARD_WORDS: Record<string, CardStyle> = {
  flat: 'flat',
  shadow: 'shadow',
  shadowed: 'shadow',
  border: 'border',
  bordered: 'border',
}

function answerCards(text: string): PortalAskResponse | null {
  const match =
    /^(?:use )?(flat|shadowed|bordered) cards$/.exec(text) ??
    /^make (?:the )?cards (flat|shadowed|bordered)$/.exec(text) ??
    /^give (?:the )?cards (?:a )?(shadow|border)s?$/.exec(text) ??
    /^cards with (?:a )?(shadow|border)s?$/.exec(text) ??
    /^add (?:a )?(shadow|border)s? to (?:the )?cards$/.exec(text)
  const style = match ? CARD_WORDS[match[1]!] : undefined
  return style ? patch({ cardStyle: style }) : null
}

/** "Show the logo" or "show the icon and name": the header's two choices. */
function answerHeaderShows(text: string, ctx: AskDraftContext): PortalAskResponse | null {
  if (
    /^(?:show|use) (?:the |our |my )?icon and (?:the |our |my )?name(?: in the header)?$/.test(text)
  ) {
    return patch({ headerShows: 'icon_and_name' })
  }
  if (
    /^(?:show|use) (?:just |only )?(?:the |our |my )?logo(?: only| alone)?(?: in the header)?$/.test(
      text
    )
  ) {
    return ctx.hasLogo ? patch({ headerShows: 'logo' }) : refuse(ASK_REPLIES.noLogo)
  }
  return null
}

/** "Call the portal Acme Ideas": run on the request as typed so the name keeps its casing. */
function answerPortalName(raw: string): PortalAskResponse | null {
  const match =
    /^(?:call the portal|rename the portal (?:to|as)|(?:change|set) the portal(?:'s)? name to) ["'“‘]?(.+?)["'”’]?$/i.exec(
      raw
    )
  const name = match?.[1]?.trim()
  return name && name.length <= 100 ? patch({ portalName: name }) : null
}

function answerThemeMode(text: string): PortalAskResponse | null {
  if (
    // "Too" (or "as well", "also") is what makes it both; "enable dark mode"
    // alone could mean dark only, so the model decides.
    /^(?:add|enable|support|offer|turn on|allow) (?:a )?dark (?:mode|theme) (?:too|as well|also)$/.test(
      text
    ) ||
    /^add (?:a )?dark (?:mode|theme)$/.test(text) ||
    /^let (?:visitors|people|users|customers) (?:choose|pick) (?:between )?(?:light or dark|dark or light)(?: mode)?$/.test(
      text
    )
  ) {
    return patch({ themeMode: 'user' })
  }
  const only = /^(?:(light|dark) (?:mode |theme )?only|only (light|dark)(?: mode| theme)?)$/.exec(
    text
  )
  if (only) return patch({ themeMode: (only[1] ?? only[2]) as 'light' | 'dark' })
  return null
}

/**
 * Answer a plain request without the model, or null to ask the model.
 * Conservative: anything with more than one intent, or a name it cannot
 * place exactly, goes to the model.
 */
export function answerLocally(request: string, ctx: AskDraftContext): PortalAskResponse | null {
  const raw = request
    .trim()
    .replace(/[.!?]+$/, '')
    .replace(/^(?:please |can you |could you )/i, '')
    .trim()
  const text = raw.toLowerCase()
  if (!text) return null

  if (
    /^(?:undo(?: that| it| the last change)?|revert(?: that| it)?|go back|take that back)$/.test(
      text
    )
  ) {
    return { outcome: 'undo', handled: 'local', reply: ASK_REPLIES.undone }
  }

  const site =
    /^(?:(?:match|import|copy|use the brand from|match the brand of|brand like) )?(\S+)$/.exec(text)
  const host = site ? HOST.exec(site[1]!)?.[1] : undefined
  if (host && !host.startsWith('#')) {
    return { outcome: 'import', handled: 'local', host, reply: `Matching ${host}.` }
  }

  // "Icon and name" is one choice, not two intents.
  const headerShows = answerHeaderShows(text, ctx)
  if (headerShows) return headerShows

  // One intent only: anything joined up is the model's.
  if (/,|;|\band\b|\bthen\b/.test(text)) return null

  return (
    answerThemeMode(text) ??
    answerColour(text, ctx) ??
    answerShape(text, ctx) ??
    answerTabs(raw, text, ctx) ??
    answerPortalName(raw) ??
    answerHeadingFont(text) ??
    answerCards(text) ??
    answerFont(text)
  )
}
