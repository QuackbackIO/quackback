/**
 * What Quackback AI is told about the design document: every field in the
 * words a person uses for it, with the values each takes from the design's
 * own option lists, and examples the tests keep valid.
 */
import { BLOCK_WIDTHS, BUNDLED_FONT_IDS, DESIGN_OPTIONS } from '@/lib/shared/design/options'
import type { HomeBlockType } from '@/lib/shared/design/home'
import { PORTAL_PARTS } from '@/lib/shared/design/parts'

/** The design document's fields, in the words a person uses for them. */
export function fieldGuide(blockTypes: readonly HomeBlockType[], writesCss: boolean): string {
  const widths = (Object.keys(BLOCK_WIDTHS) as HomeBlockType[])
    .map((type) => `${type} (${BLOCK_WIDTHS[type].join(', ')})`)
    .join('; ')
  return [
    `mode: ${DESIGN_OPTIONS.mode.join(', ')} (auto follows the visitor's device)`,
    'brand.light.accent (buttons, links, the band), brand.light.background (the page), brand.light.ink (text), brand.light.surface (cards), brand.light.raised (raised surfaces), brand.light.muted (secondary text), brand.light.border: hex such as #0f766e. brand.dark.*: the same roles in dark mode, without accent. null clears an optional colour.',
    `brand.fonts.heading and brand.fonts.body: ${BUNDLED_FONT_IDS.join(', ')}. brand.fonts.headingWeight: ${DESIGN_OPTIONS.headingWeight.join(', ')}`,
    'brand.logo.display: mark_and_name, mark, wordmark (the logo files themselves are uploaded in Settings)',
    `shape.corners: ${DESIGN_OPTIONS.corners.join(', ')}`,
    'layout.header: stacked (logo above the menu), inline (one row), centered',
    `layout.nav (how the menu marks the current page): ${DESIGN_OPTIONS.nav.join(', ')}`,
    'layout.band (behind a page headline): none, tint, fade, brand. It shows only with a headline; when you add one and there is no headline, write one.',
    `layout.cards: ${DESIGN_OPTIONS.cards.join(', ')}. layout.density: ${DESIGN_OPTIONS.density.join(', ')}. layout.width: ${DESIGN_OPTIONS.width.join(', ')}. layout.filters: end (right), start (left)`,
    'pages.feedback.headline.title and .subtitle: text by language, such as {"en":"Help us grow","de":"Hilf uns wachsen"}. Plain text sets English; an empty string removes it.',
    'pages.feedback.welcome: {show, body}: the message above the feed; body is plain text, a blank line between paragraphs. When you turn it on with no text, write some.',
    `pages.feedback.defaultSort: ${DESIGN_OPTIONS.sort.join(', ')}`,
    'pages.feedback.copy.prompt (the composer prompt, 60 characters), .submit (its button, 24), .emptyTitle (the empty feed, 60): text by language, like the headline. Leave them out to use the chosen word.',
    'pages.home.headline: like the feedback headline, for Home.',
    `pages.home.blocks: Home's blocks in order on a six-column grid, at most 12: [{"type":..., "width":...}]. Types with their widths: ${widths}. Options: ideas {sort, count 3 or 5}, updates {count 2 to 4}, welcome {body: plain text}, links {title, links: [{label, url}]} with only links the person gave. This workspace can show: ${blockTypes.join(', ')}. Blocks in a row share its height, so pair blocks of a like height: the short ones (composer, status, contact, help_search, welcome with a line or two) with each other or full width, and the lists (ideas, updates, roadmap, help_topics) with each other. A row's last block grows to fill it.`,
    'nav.home: {on, tab, label}: Home at / (on) and whether it has its own menu tab (tab). With Home off, the first menu page opens at /.',
    'nav.items: the menu in order. Pages: {"type": feedback, roadmap, changelog, help, support or status, "shown": true or false, "label": optional}. Links: {"type":"link","id","label","url","newTab"}, only links the person gave. With Home off, show at least one page.',
    `vocabulary.post (what visitors post): ${DESIGN_OPTIONS.postWord.join(', ')}. vocabulary.board (what groups them): ${DESIGN_OPTIONS.boardWord.join(', ')}.`,
    writesCss &&
      `css: the workspace's own CSS, styling the portal's parts by name, [data-qb-part="post-card"]. Parts: ${PORTAL_PARTS.map((part) => part.name).join(', ')}. Only for what no field above can do; no url() or @import.`,
  ]
    .filter(Boolean)
    .join('\n')
}

/** Examples of answers, kept valid against the design by the tests. */
export const EDIT_EXAMPLES = [
  {
    request: 'Make it feel calmer and give the cards more room',
    answer: {
      reply: 'I rounded the corners fully, raised the cards and gave the feed more room.',
      outOfScope: false,
      changes: [
        { path: 'shape.corners', value: '"pill"' },
        { path: 'layout.cards', value: '"raised"' },
        { path: 'layout.density', value: '"spacious"' },
      ],
    },
  },
  {
    request: 'Make us a Home page: a welcome, then status next to the composer, then our top ideas',
    answer: {
      reply: 'Home is on, with a welcome, status beside the composer and your top ideas.',
      outOfScope: false,
      changes: [
        { path: 'nav.home.on', value: 'true' },
        { path: 'pages.home.headline.title', value: '"Welcome to our community"' },
        {
          path: 'pages.home.blocks',
          value:
            '[{"type":"welcome","width":"full","body":"Share an idea, see what is coming and find help."},{"type":"composer","width":"two_thirds"},{"type":"status","width":"third"},{"type":"ideas","width":"full","sort":"top","count":5}]',
        },
      ],
    },
  },
  {
    request:
      'We call them feature requests, sorted into categories. Hide the changelog from the menu.',
    answer: {
      reply: 'Visitors now post feature requests in categories, and the changelog is off the menu.',
      outOfScope: false,
      changes: [
        { path: 'vocabulary.post', value: '"feature_request"' },
        { path: 'vocabulary.board', value: '"category"' },
        {
          path: 'nav.items',
          value:
            '[{"type":"feedback","shown":true},{"type":"roadmap","shown":true},{"type":"changelog","shown":false},{"type":"help","shown":true},{"type":"support","shown":true},{"type":"status","shown":true}]',
        },
      ],
    },
  },
] as const

export function editPrompt(blockTypes: readonly HomeBlockType[], writesCss: boolean): string {
  return `You design a company's customer feedback portal by changing its design document. You may set any field below, by its dotted path, to any value it takes; numbers index lists (pages.home.blocks.0.width). To replace a list or a whole part, set its path to the whole new value.

${fieldGuide(blockTypes, writesCss)}

Reply with JSON: a one or two sentence reply to the person, outOfScope, and the changes as a list of {path, value}, where value is the new value written as JSON: "text" in quotes, a number, true or false, null, an object or a list. Change only what the request is about. Never invent a link, an uploaded file or a field. If the request is not about the portal, make no changes and say so.

${EDIT_EXAMPLES.map((example) => `Example request: "${example.request}"\nExample answer: ${JSON.stringify(example.answer)}`).join('\n\n')}`
}
