/**
 * What Quackback AI is told about the design. Ask AI's requests are made of
 * operations (opsPrompt), told from the block registry, the hero, the pages'
 * choices and Theme through the design context; the field guide below, the
 * document by its dotted paths, stays for what writes the document itself.
 *
 * The field guide: the design document: every field in the
 * words a person uses for it, with the values each takes from the design's
 * own option lists and schema and what each step gives in pixels, and
 * examples the tests keep valid. A request about one part reads only the
 * fields that part reaches.
 */
import { BLOCK_SIZES, BUNDLED_FONT_IDS, DESIGN_OPTIONS } from '@/lib/shared/design/options'
import type { HomeBlockType } from '@/lib/shared/design/home'
import { PORTAL_PARTS } from '@/lib/shared/design/parts'
import { tuneSchema } from '@/lib/shared/design/tune'
import { styleText } from '@/lib/shared/design/style-tokens'
import { STYLE_OPS_EXAMPLES } from './style-examples'
import { OVERRIDE_OPS_EXAMPLES } from './override-examples'
import { aiCatalogue, HEADLINE_MARKS, RICH_MARKS } from '@/lib/shared/design/design-context'
import { OP_KINDS, type AiPlaces, type FlatOp } from '@/lib/shared/design/design-ops'
import { OVERRIDE_RULE } from '@/lib/shared/design/override-ops'
import type { PortalDesign } from '@/lib/shared/design/schema'
import {
  effectiveValues,
  BUTTON_HEIGHT,
  BUTTON_PX,
  HEADING_PX,
  HEADLINE_PX,
  LABEL_PX,
  LABEL_WEIGHT,
  RADII_PX,
  TRACKING_EM,
} from '@/lib/shared/design/effective-values'

const px = (value: number) => (value >= 999 ? 'pill' : `${value}px`)

/** What each corner style gives buttons, fields and cards. */
const cornerSteps = (Object.keys(RADII_PX) as Array<keyof typeof RADII_PX>)
  .map((corner) => {
    const { control, field, panel } = RADII_PX[corner]
    return `${corner} (buttons ${px(control)}, fields ${px(field)}, cards ${px(panel)})`
  })
  .join(', ')

const UNITS: Record<string, string> = {
  size: 'px',
  height: 'px',
  radius: 'px',
  border: 'px',
  tracking: 'em',
}
const TUNE_GROUPS: Record<keyof typeof tuneSchema.shape, string> = {
  headline: 'page headlines',
  heading: 'section headings',
  label: 'the menu and button labels',
  button: 'primary buttons, where radius 999 is a pill',
  card: 'cards, with the post title',
  field: 'fields',
  subtitle: "the line under a page's headline",
  link: "links in text, such as a block's way on",
  secondary: 'buttons beside the main one, such as Log in',
  body: 'rich text and the text on cards',
}

/** One exact value's range or values, read from the schema that bounds it. */
function tuneField(key: string, field: unknown): string {
  const inner = (field as { unwrap: () => unknown }).unwrap() as {
    minValue?: number | null
    maxValue?: number | null
    options?: readonly unknown[]
  }
  if (typeof inner.minValue === 'number')
    return `${key}: ${inner.minValue} to ${inner.maxValue}${UNITS[key] ?? ''}`
  // A colour takes a brand role too (tune.ts), but the guide asks for the exact hex the brand shows.
  if (inner.options?.every((option) => typeof option === 'string'))
    return `${key}: ${inner.options.join(' or ')}`
  return `${key}: hex`
}

/** The exact values, each group with its fields' ranges as the schema sets them. */
export function tuneText(): string {
  const groups = Object.entries(tuneSchema.shape).map(([group, optional]) => {
    const fields = Object.entries(optional.unwrap().shape).map(([key, f]) => tuneField(key, f))
    return `tune.${group} (${TUNE_GROUPS[group as keyof typeof TUNE_GROUPS]}): {${fields.join(', ')}}`
  })
  return `tune: exact values under the choices; set one by its path, such as tune.headline.weight. ${groups.join('; ')}. An exact value overrides the choice it refines: where one is set, change the exact value, or set it to null along with the choice. Use them for an exact size, weight, spacing, colour or corner a person asks for, or a small step; the choices give only steps. Without them: headlines as brand.fonts.scale gives, section headings ${HEADING_PX}px, the menu and button labels ${LABEL_PX}px at ${LABEL_WEIGHT}, buttons ${BUTTON_HEIGHT}px tall.`
}

const CARD_LOOKS: Record<(typeof DESIGN_OPTIONS.cards)[number], string> = {
  bordered: 'cards with an edge',
  raised:
    'floating on a shadow, without an edge (tune.card.shadow sets how deep: soft, lifted, floating, deep)',
  list: 'rows divided by lines, no cards',
  filled: 'soft panels without an edge',
}

/** What the fields shared between parts reach. */
const SHARED =
  "Shared fields reach more than one part: shape.corners sets the cards, fields and buttons; tune.label styles both the menu and buttons; brand.fonts.heading is also the headlines' face while brand.fonts.display is null; brand.light.support also colours the band, the tint and the call to action. To change one part, prefer its own exact values. People call the band the hero: in replies and says, write hero, never band."

/** Each line of the guide with the fields it describes. */
function guideLines(
  blockTypes: readonly HomeBlockType[],
  writesCss: boolean
): Array<[fields: string[], text: string]> {
  const sizes = (Object.keys(BLOCK_SIZES) as HomeBlockType[])
    .map((type) => `${type} ${BLOCK_SIZES[type].size[0]} (least ${BLOCK_SIZES[type].min[0]})`)
    .join('; ')
  const lines: Array<[string[], string | false]> = [
    [['mode'], `mode: ${DESIGN_OPTIONS.mode.join(', ')} (auto follows the visitor's device)`],
    [
      ['brand.light', 'brand.dark'],
      'brand.light.accent (buttons, links, the band), brand.light.support (a second brand colour, for bands and highlights), brand.light.background (the page), brand.light.ink (text), brand.light.surface (cards), brand.light.raised (raised surfaces), brand.light.muted (secondary text), brand.light.border: hex such as #0f766e. brand.light.extra: up to two more brand colours, as a list, for bands and blocks. brand.dark.*: the same roles in dark mode, without accent. null clears an optional colour.',
    ],
    [
      ['brand.fonts'],
      `brand.fonts.heading and brand.fonts.body: ${BUNDLED_FONT_IDS.join(', ')}. brand.fonts.display: the page headlines' own face, for a brand whose hero type differs from its other headings, such as a condensed or poster face; null uses the heading font. brand.fonts.headingWeight: ${DESIGN_OPTIONS.headingWeight.join(', ')}. brand.fonts.scale (headline size): ${DESIGN_OPTIONS.typeScale.map((step) => `${step} (${HEADLINE_PX[step]}px)`).join(', ')}. brand.fonts.tracking (headlines' letter-spacing): ${DESIGN_OPTIONS.tracking.map((step) => `${step} (${TRACKING_EM[step]}em)`).join(', ')}. brand.fonts.headlineCase and brand.fonts.labelCase (the menu and buttons): ${DESIGN_OPTIONS.textCase.join(', ')}`,
    ],
    [
      ['brand.logo'],
      'The header shows an icon and a title in the heading font. brand.logo.name: the title (empty shows the workspace name). brand.logo.display: mark_and_name (the icon and title) or wordmark (a full logo image, only when one is uploaded). Images are uploaded in Theme.',
    ],
    [
      ['shape'],
      `shape.corners: ${cornerSteps}. shape.buttons (buttons' own shape; match follows the corners): match, ${(Object.keys(BUTTON_PX) as Array<keyof typeof BUTTON_PX>).map((step) => `${step} (${px(BUTTON_PX[step])})`).join(', ')}. shape.fill: accent, ink (primary buttons in the text colour, as a brand with black buttons has)`,
    ],
    [['layout.header'], 'layout.header: stacked (logo above the menu), inline (one row), centered'],
    [
      ['layout.nav', 'layout.navText'],
      `layout.nav (how the menu marks the current page): ${DESIGN_OPTIONS.nav.join(', ')}. layout.navText (the menu's other pages): muted (a softer grey, the default), ink (the text colour, as most brands' menus are)`,
    ],
    [
      [
        'layout.hero',
        'layout.heroColour',
        'layout.blend',
        'layout.heroAlign',
        'layout.heroShape',
        'layout.heroHeight',
        'layout.headerOnHero',
        'layout.imagePlace',
        'brand.heroImage',
      ],
      `layout.hero (behind a page headline): ${DESIGN_OPTIONS.hero.join(', ')}; support fills it with the second colour and blend runs the accent into it, as a line, with layout.blend mesh, a soft mesh beside the words, or with layout.blend ribbon, a diagonal ribbon sweeping past the words. It shows only with a headline; when you add one and there is no headline, write one. layout.heroAlign: ${DESIGN_OPTIONS.heroAlign.join(', ')}. layout.heroShape: full, inset (a rounded panel within the page), panel (the words on a block of the second colour), split (a rounded panel with the words on one half and a side band image flush in the other). layout.heroHeight: ${DESIGN_OPTIONS.heroHeight.join(', ')}, the room Home's hero gives its words; the other pages' heroes take Home's look at a compact height of their own. layout.headerOnHero: true puts the header in the band's colour. layout.heroColour (the colour a brand, tint or fade band is drawn in): ${DESIGN_OPTIONS.colourRole.join(', ')}, where extra1 and extra2 are brand.light.extra's; leave it out for the brand colour. layout.imagePlace (for an uploaded band image): ${DESIGN_OPTIONS.imagePlace.join(', ')}.`,
    ],
    [
      ['layout.status'],
      `layout.status (status markers): colour, ink (in the text colour), pill (tinted tags), brand (the logo's colours).`,
    ],
    [
      [
        'layout.heroArt',
        'layout.heroGlow',
        'layout.heroGlowColour',
        'layout.imageFocus',
        'layout.imagePoint',
        'layout.imagePhone',
        'layout.tint',
        'shape.action',
      ],
      `layout.heroArt (quiet art in the brand's colours for a band without an image): ${DESIGN_OPTIONS.heroArt.join(', ')}. layout.heroGlow (a soft glow of light on a brand or support band): ${DESIGN_OPTIONS.heroGlow.join(', ')}; layout.heroGlowColour: ${DESIGN_OPTIONS.colourRole.join(', ')} (leave it out for a light of the band's own colour). layout.imageFocus (where a cropped band image keeps its picture): ${DESIGN_OPTIONS.imageFocus.join(', ')}. layout.imagePoint {x, y}: an exact point, in percent, a cropped band image keeps in view. layout.imagePhone: ${DESIGN_OPTIONS.imagePhone.join(', ')} (hide leaves the band image off on phones). layout.tint: neutral, support (the second colour tints the vote box and the current menu item). shape.action: buttons (the band's call to action as the other buttons, the default), accent (in the brand colour while the other buttons are in the text colour), support (in the second colour).`,
    ],
    [
      ['brand.fonts.headlineColour'],
      'brand.fonts.headlineColour: ink, accent (headlines in the brand colour).',
    ],
    [['tune'], tuneText()],
    [['style', 'styleDark'], styleText()],
    [
      ['layout.cards', 'layout.density', 'layout.width', 'layout.filters', 'layout.postCardHides'],
      `layout.cards (how posts sit in the feed): ${DESIGN_OPTIONS.cards.map((look) => `${look} (${CARD_LOOKS[look]})`).join(', ')}. layout.density: ${DESIGN_OPTIONS.density.join(', ')}. layout.width: ${DESIGN_OPTIONS.width.join(', ')}. layout.filters: end (right), start (left). layout.postCardHides: what post cards leave out, any of ${DESIGN_OPTIONS.postCardField.join(', ')} (meta is the author, date and comments); leave it out to show everything`,
    ],
    [
      ['pages.feedback.headline'],
      'pages.feedback.headline.title and .subtitle: text by language, such as {"en":"Help us grow","de":"Hilf uns wachsen"}. Plain text sets the language the person sees; an empty string removes it. .accent: {"style": "colour", "highlight" or "muted" (lighter, as a two-tone headline’s second part), "text": a phrase of the title, by language}, setting that phrase apart; null removes it.',
    ],
    [
      ['pages.feedback.welcome'],
      'pages.feedback.welcome: {show, body}: the message above the feed; body is plain text, a blank line between paragraphs. When you turn it on with no text, write some.',
    ],
    [
      ['pages.feedback.defaultSort', 'pages.feedback.openOn'],
      `pages.feedback.defaultSort: ${DESIGN_OPTIONS.sort.join(', ')}. pages.feedback.openOn: the id of the board the feed opens on when the address names none; leave it out to open on every board.`,
    ],
    [
      ['pages.feedback.copy'],
      "pages.feedback.copy.prompt (the composer prompt, 60 characters), .submit (its button, 24), .emptyTitle (the empty feed, 60): text by language, like the headline. Leave them out to use the portal's own. Everywhere else, visitors read posts on boards.",
    ],
    [
      ['layout.pageTitles', 'pages.titles'],
      `layout.pageTitles: ${DESIGN_OPTIONS.pageTitles.join(', ')}; band puts the other pages' titles (roadmap, changelog, help, support) on the band, as Home's headline is, plain sets them on the page in the headline type. pages.titles.roadmap, .changelog, .help and .support: a page's own title, like the feedback headline; null gives it back its usual one.`,
    ],
    [
      ['pages.changelog'],
      `The Changelog page; leave a field out for its usual look. pages.changelog.entries: ${DESIGN_OPTIONS.changelogEntries.join(', ')} (timeline puts dates in a column beside each entry, cards puts each entry in a card, compact lists titles with a line of each); pages.changelog.images: ${DESIGN_OPTIONS.entryImage.join(', ')} (an entry's featured image: left off, across the entry, or small beside it); pages.changelog.subscribe: ${DESIGN_OPTIONS.titleAction.join(', ')} (the Subscribe button beside the title or under its words); pages.changelog.shipped: true or false (the posts an entry shipped from, with how many and their votes).`,
    ],
    [
      ['pages.help'],
      `The Help Center's home; leave a field out for its usual look. pages.help.topics: ${DESIGN_OPTIONS.helpTopics.join(', ')}; pages.help.popular: true or false (popular articles under the topics); pages.help.search: ${DESIGN_OPTIONS.searchSize.join(', ')} (the search under the title). The end of each article: pages.help.helpful: true or false (asks "Was this helpful?"); pages.help.related: 0, 2 or 4 (how many related articles it ends with); pages.help.contact: true or false (a Contact support link).`,
    ],
    [
      ['pages.support'],
      `The Support page; leave a field out for its usual look. pages.support.suggest: true or false (help articles suggested while a new request is written, with the help center on); pages.support.request: the New request button's words by language, like the headline, 24 characters; leave it out for the portal's own.`,
    ],
    [
      ['pages.roadmap'],
      `The Roadmap page; leave a field out for its usual look. pages.roadmap.board: ${DESIGN_OPTIONS.roadmapBoard.join(', ')} (a column per status, or one list grouped by status). Its cards always show votes.`,
    ],
    [
      ['pages.post'],
      `A post's own page, with three fixed parts; leave a field out for its usual look. pages.post.vote: ${DESIGN_OPTIONS.postVote.join(', ')} (where its one vote control sits: beside the title, or at the top of the details). pages.post.board, pages.post.tags, pages.post.date and pages.post.author: true or false (each detail beside the post; the status always shows). pages.post.subscribe: ${DESIGN_OPTIONS.postSubscribe.join(', ')} (Subscribe in the details, or beside the comments' heading). pages.post.comments: ${DESIGN_OPTIONS.commentOrder.join(', ')} (the comments' order; the pinned reply always leads).`,
    ],
    [
      [
        'pages.home.headline',
        'pages.home.composer',
        'pages.home.composerWidth',
        'pages.home.mainAction',
        'pages.home.button',
      ],
      `pages.home.headline: like the feedback headline, for Home. The hero's mainAction setting is Home's one main action under the headline: ${DESIGN_OPTIONS.mainAction.join(', ')} (composer: the post box in the band; search: the help centre's search box, with Ask AI where it is on, and only with the help centre on; button: one call to action; none: the headline and subtitle alone). Outside the hero the composer is a block on the grid. It is the hero's mainAction setting: "put a search box in the hero instead" is mainAction search. With button, the hero's buttonTo says where it goes: ${DESIGN_OPTIONS.heroButtonTo.join(', ')} (it opens the post box in place, or goes to the roadmap, the help center or support, each only while that page is on), and secondButton true adds a quiet second button: to the roadmap beside the post box, else to the post box. pages.home.composer: band puts the composer block in the band under the headline; block keeps it on the grid. pages.home.composerWidth: ${DESIGN_OPTIONS.composerWidth.join(', ')} (how wide the composer is in the band, narrowest first; full is the band's words' width; leave it out for its usual width: wide beside a side image or under centred words, else full; phones always run it full). It is the hero's composerWidth setting: "make the composer narrower" is one step narrower than it draws now.`,
    ],
    [
      ['pages.home.blocks'],
      `pages.home.blocks: Home's blocks on a grid of 12 columns and rows, like a dashboard's panels, at most 12: [{"type":..., "grid":{"x":column from 0,"y":row from 0,"w":columns,"h":rows}}]. Blocks float up to fill gaps and never overlap; one left without a grid goes under the rest at its usual size. Usual and least widths in columns: ${sizes}. Give each block h 1: a row is as tall as the tallest content in it; more rows only add height. Options: ideas {sort, count 3, 5 or 10, statusIds: the statuses its posts are in (the Complete ones with sort new for recently shipped), showVotes, showStatus, showComments}, boards {showCounts}, roadmap {statusIds: its columns, perColumn 2, 3 or 5, showVotes}, updates {count 2 to 4, showDate, showSummary}, help_search {popular 0, 3 or 5}, help_topics {layout cards or list, showCounts, topArticles 0, 2 or 3}, status {showIncidents}, welcome {body: plain text}, links {title, links: [{label, url}]} with only links the person gave; the show… settings are true or false. Their items are the workspace's own posts, entries, topics and status, never written here. Any block also takes heading {"<locale>": text}: its own heading in place of its usual one, and look {tone, align, colour}: tone ${DESIGN_OPTIONS.blockTone.join(', ')} (card is the site's card, plain has no card, tint is a pale wash of the brand colour, brand fills it with the brand colour), colour ${DESIGN_OPTIONS.colourRole.join(', ')} (the colour tint and brand use in place of the brand colour), align ${DESIGN_OPTIONS.blockAlign.join(', ')}; leave a field out to follow the site. This workspace can show: ${blockTypes.join(', ')}. Side by side, give blocks the same y and h and widths that add up to 12; pair the short ones (composer, status, contact, help_search, welcome with a line or two) with each other or full width, and the lists (ideas, boards, updates, roadmap, help_topics) with each other. To move or resize one block, set pages.home.blocks.<n>.grid.`,
    ],
    [
      ['nav.home'],
      'nav.home: {on, tab, label}: Home at / (on) and whether it has its own menu tab (tab). With Home off, the first menu page opens at /.',
    ],
    [
      ['nav.items'],
      'nav.items: the menu in order. Pages: {"type": feedback, roadmap, changelog, help, support or status, "shown": true or false, "label": optional}. Links: {"type":"link","id","label","url","newTab"}, only links the person gave. With Home off, show at least one page.',
    ],
    [
      ['css'],
      writesCss &&
        `css: the workspace's own CSS, in a layer over the design, styling the portal's parts by name, [data-qb-part="post-card"], and their states, [data-qb-part="vote-button"][data-state="voted"]. Parts: ${PORTAL_PARTS.map((part) => part.name).join(', ')}. Use it for the details that make the brand recognisable and that no field above sets: how its buttons, cards, links and headings are drawn, such as borders, underlines, letter-spacing, uppercase labels or shadows. Keep it short, take colours from the brand, and never use url() or @import.`,
    ],
    [['shape.corners', 'tune.label', 'brand.fonts.heading', 'brand.light.support'], SHARED],
  ]
  return lines.filter((line): line is [string[], string] => !!line[1])
}

const meets = (a: string, b: string) => a === b || a.startsWith(`${b}.`) || b.startsWith(`${a}.`)

/**
 * The design document's fields, in the words a person uses for them. Given
 * the fields a request may change, only the lines about them, and a word on
 * where everything else lives.
 */
export function fieldGuide(
  blockTypes: readonly HomeBlockType[],
  writesCss: boolean,
  reach?: readonly string[]
): string {
  const lines = guideLines(blockTypes, writesCss)
  if (!reach) return lines.map(([, text]) => text).join('\n')
  const own = lines.filter(([fields]) => fields.some((f) => reach.some((r) => meets(f, r))))
  return [
    ...own.map(([, text]) => text),
    'Other parts have fields of their own, outside the part picked.',
  ].join('\n')
}

/**
 * The design as it looks now where a choice gives pixels: what a relative
 * request such as "a little smaller" starts from. Each element's own look
 * comes first, as the canvas draws it; the headline's size is its widest.
 */
export function valuesNow(design: PortalDesign): string {
  const { headline, heading, label, button, card, field } = effectiveValues(design)
  const type = (t: { size: number; weight: number }) => `${t.size}px, weight ${t.weight}`
  return `Type and shapes now: headline ${type(headline)} on wide screens (smaller on phones), spacing ${headline.tracking}em; section headings ${type(heading)}; menu and button text ${type(label)}; buttons ${px(button.radius)} corners, ${button.height}px tall; cards ${px(card.radius)} corners; fields ${px(field.radius)} corners.`
}

/** An answer as the model writes it: each operation with what it does in a few words. */
export interface OpsAnswer {
  reply: string
  outOfScope: boolean
  ops: Array<Required<FlatOp> & { says: string }>
}

const op = (fields: Partial<FlatOp> & Pick<FlatOp, 'op'>, says: string) => ({
  target: '',
  key: '',
  value: '',
  ...fields,
  says,
})

/**
 * Answers to requests across the portal, kept valid by the tests: those with
 * `picked` are about one part, picked in the builder.
 */
export const OPS_EXAMPLES: Array<{ request: string; picked?: string; answer: OpsAnswer }> = [
  ...STYLE_OPS_EXAMPLES,
  ...OVERRIDE_OPS_EXAMPLES,
  {
    request: 'Make it feel calmer and give the cards more room',
    answer: {
      reply: 'I made the hero a pale tint, raised the cards and gave the feed more room.',
      outOfScope: false,
      ops: [
        op({ op: 'set', target: 'hero', key: 'look', value: 'tint' }, 'the hero to a pale tint'),
        op({ op: 'theme', key: 'cards', value: 'raised' }, 'the cards to raised'),
        op({ op: 'theme', key: 'density', value: 'spacious' }, 'the feed to more room'),
      ],
    },
  },
  {
    request: 'Put the roadmap first with the updates beside it, and show the 10 most voted posts',
    answer: {
      reply: 'The roadmap now leads Home with the updates beside it, and Top posts shows 10.',
      outOfScope: false,
      ops: [
        op({ op: 'move', target: 'roadmap', value: 'top' }, 'the roadmap to the top'),
        op({ op: 'move', target: 'updates', value: 'beside:roadmap' }, 'the updates beside it'),
        op({ op: 'set', target: 'ideas', key: 'sort', value: 'top' }, 'top posts to most voted'),
        op({ op: 'set', target: 'ideas', key: 'count', value: '10' }, 'top posts to show 10'),
      ],
    },
  },
  {
    request: 'Call Feedback “Posts” in the menu and hide the changelog',
    answer: {
      reply: 'The menu now says Posts, and the changelog is out of it.',
      outOfScope: false,
      ops: [
        op(
          { op: 'menu', target: 'feedback', key: 'rename', value: 'Posts' },
          'Feedback to Posts in the menu'
        ),
        op({ op: 'menu', target: 'changelog', key: 'hide' }, 'the changelog out of the menu'),
      ],
    },
  },
  {
    request: 'Use our amber #b45309, and title the feedback page Feedback welcome',
    answer: {
      reply: 'The brand colour is now amber and the feedback page reads Feedback welcome.',
      outOfScope: false,
      ops: [
        op({ op: 'theme', key: 'accent', value: '#b45309' }, 'the brand colour to amber'),
        op(
          { op: 'words', target: 'feedback', key: 'title', value: 'Feedback welcome' },
          'the feedback headline'
        ),
      ],
    },
  },
  {
    request: 'Make the page a soft blue gradient, and keep the help center plain',
    answer: {
      reply:
        'The page now runs from a soft blue at the top into the page colour, and the help center keeps its plain page.',
      outOfScope: false,
      ops: [
        op(
          {
            op: 'background',
            target: 'site',
            key: 'gradient',
            value: '{"stops":["#dbeafe","page"],"direction":"down"}',
          },
          'the page to a soft blue gradient'
        ),
        op({ op: 'background', target: 'help', key: 'solid' }, 'the help center to its plain page'),
      ],
    },
  },
  {
    request: 'Highlight “posts” in the feedback headline',
    picked: 'the feedback headline now "Share your posts with us"',
    answer: {
      reply: 'I highlighted “posts” in the feedback headline.',
      outOfScope: false,
      ops: [
        op(
          {
            op: 'words',
            target: 'feedback',
            key: 'title',
            value: 'Share your [posts]{highlight} with us',
          },
          'posts to highlighted in the feedback headline'
        ),
      ],
    },
  },
  {
    request: 'Make this one wider and a little smaller headline',
    picked: 'Top posts (ideas) picked; the headline is 48px now',
    answer: {
      reply: 'I widened Top posts; the headline belongs to the hero, so I left it alone.',
      outOfScope: true,
      ops: [op({ op: 'resize', target: 'ideas', value: 'wider' }, 'top posts wider')],
    },
  },
  {
    request: 'Give the cards a soft shadow',
    picked: 'the cards already raised',
    answer: {
      reply: 'The cards already have a soft shadow, so nothing changed.',
      outOfScope: false,
      ops: [],
    },
  },
]

/** The operations and the rules for them, as every Ask AI prompt tells them. */
export const OPS_RULES = `Operations (${OP_KINDS.join(', ')}):
- set: target a Home block (its id from the context, or its type when Home has one of it), "hero", or a page ("changelog page", "help page", "roadmap page", "support page", "feedback page"); key one of its settings below, or on a Home block its own look, style.<element>.<state>.<property>; value its new value.
- add: key a block type; target where it goes: top, bottom, above:<block>, below:<block> or beside:<block>; value its settings as JSON, such as {"count":5}, or "".
- move: target a Home block; value where it goes, as for add.
- resize: target a Home block; value full, half, third, two thirds, wider, narrower, taller, shorter, or columns of 12.
- remove: target a Home block.
- theme: key a Theme setting below, an exact value such as headline.size, or an element's style such as style.button.hover.background; value its new value; null clears an optional colour or a style.
- words: target a page (home, feedback, roadmap, changelog, help, support); key title or subtitle, or on the feedback page welcome, prompt, submit or empty; value the words.
- background: target "site" for every page, or one page (home, feedback, roadmap, changelog, help, support, status, post) for that page only; key the kind (solid, tint, gradient, pattern, image), reset (a page follows every page again) or dark (dark mode's own: value a background with its kind, or "auto" to work it out from light); value its settings as JSON, such as {"colour":"accent","strength":"soft"}; settings left out keep theirs. "The page" or "the background" means every page (target "site"), whatever page is shown; use one page only when the person names it or says "this page only". Only a person uploads an image: with one uploaded you may change how it shows, never add one.
- menu: target a menu item by its id or label; key rename (value the new name), hide, show, left, right, first, last, land (make it the first page visitors see), remove (a link), or addlink (target the link's label, value an address the person gave).
${OVERRIDE_RULE}
Marks: a title (a page's headline) takes ${HEADLINE_MARKS}. Write the whole title with the mark, its words exactly as "Headlines now" shows them, such as "make 'together' the accent" -> {"op":"words","target":"home","key":"title","value":"Build it [together]{accent}"}; to move a mark or change its look, write the title with the new one; to remove it, write the title with no mark. A mark is for a phrase within the title, never the whole title: the whole headline in the brand colour is {"op":"theme","key":"headlineColour","value":"accent"}. A lighter second half is a two-tone headline: the later half of its words, counted, such as "Share the posts [that shape what we build]{lighter}" (four words of eight), never its last word alone. Subtitles, block headings, prompt, submit and empty are plain words with no marks. Rich words (a Welcome block's body, set with set, and the feedback page's welcome) are markdown: ${RICH_MARKS}; write all of the words with every mark they have now (bold, italics, links, colours, headings and alignment, as "Rich words now" shows them), changing only what is asked: colouring one phrase keeps the colours others have. A link only to an address the person gave, never one made up.
Places and sizes are words, never coordinates. Boards, roadmaps and help topics are chosen by their names; never write an id the context does not give. Never invent a link or a file. Change only what the request is about. If what is asked is already so, make no operations and say so. If no operation does what is asked, make none and say what can be done instead. People call the band the hero: say hero.`

/** What Quackback AI is told for a request made of operations. */
export function opsPrompt(input: {
  blockTypes: readonly HomeBlockType[]
  writesCss: boolean
  places: AiPlaces
}): string {
  const examples = OPS_EXAMPLES.map(
    (example) =>
      `Example request${example.picked ? ` with ${example.picked}` : ''}: "${example.request}"\nExample answer: ${JSON.stringify(example.answer)}`
  )
  return `You change a company's customer feedback portal with operations, never by writing its document. Reply with JSON: reply (one short sentence in plain words a non-designer understands, said as done ("The Log in button is now black."): name colours by name, never hex codes, colour roles, ids, token or setting names, scores or px values the person did not give), outOfScope, and ops, a list of {op, target, key, value, says}. Every field is a string, "" when an operation does not use it; value is the new value as JSON or plain text; says is what the operation does in a few words that follow "I changed", such as "top posts to show 10".

${OPS_RULES}

${aiCatalogue({ blockTypes: input.blockTypes, places: input.places })}
Exact values (op theme, key such as headline.size): ${tuneText()}
Element styles (op theme; on one Home block, op set): ${styleText()}${input.writesCss ? `\nCSS (op theme, key css): ${fieldGuide([], true, ['css'])}` : ''}

${examples.join('\n\n')}`
}
