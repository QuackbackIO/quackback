/**
 * The portal's public parts: the elements a workspace's own CSS styles by
 * name, `[data-qb-part="post-card"]`, rather than by class names that change
 * with the code. Each part lists the states it takes (`data-state`), the
 * tokens that style it, and the files that draw it.
 *
 * A part keeps its name. One that is renamed keeps working through
 * `PART_ALIASES` for at least a minor release, with a lint warning, and the
 * release notes list the change.
 */

export type PartState = 'active' | 'voted' | 'open' | 'done'

export interface PortalPart {
  name: string
  /** What it is, as the parts guide says it. */
  description: string
  states: readonly PartState[]
  /** The tokens it reads, which the design sets and a workspace's CSS may override. */
  tokens: readonly string[]
  /** The source files that mark it, under `apps/web/src`. */
  files: readonly string[]
}

export const PORTAL_PARTS = [
  {
    name: 'header',
    description: 'The bar at the top of every portal page.',
    states: [],
    tokens: ['--qb-header-bg', '--qb-header-ink', '--qb-header-rule'],
    files: ['components/public/portal-header.tsx'],
  },
  {
    name: 'logo',
    description: 'The logo or initial and the workspace name, linking home.',
    states: [],
    tokens: [],
    files: ['components/public/portal-header.tsx'],
  },
  {
    name: 'nav-item',
    description: 'A page or link in the menu. The current page is active.',
    states: ['active'],
    tokens: ['--qb-nav-ink', '--qb-nav-active-bg', '--qb-nav-active-ink', '--qb-nav-radius'],
    files: ['components/public/portal-header.tsx'],
  },
  {
    name: 'band',
    description: 'The band behind a page headline.',
    states: [],
    tokens: ['--qb-band-bg', '--qb-band-ink', '--qb-band-muted'],
    files: ['components/public/portal-band.tsx'],
  },
  {
    name: 'band-image',
    description: "The band's image, when it sits beside the words.",
    states: [],
    tokens: ['--qb-radius-panel'],
    files: ['components/public/portal-band.tsx'],
  },
  {
    name: 'headline',
    description: "A page's headline, in the band.",
    states: [],
    tokens: [
      '--qb-font-heading',
      '--qb-heading-weight',
      '--qb-band-ink',
      '--qb-headline-size',
      '--qb-headline-tracking',
      '--qb-band-accent',
    ],
    files: ['components/public/portal-band.tsx'],
  },
  {
    name: 'home-block',
    description: 'A block on Home. `data-qb-block` names its type, such as status.',
    states: [],
    tokens: ['--qb-card-padding', '--qb-radius-panel', '--qb-feed-gap'],
    files: ['components/public/home/home-blocks.tsx'],
  },
  {
    name: 'composer',
    description: 'Where a visitor starts a new post. Open while they write.',
    states: ['open'],
    tokens: ['--qb-radius-panel', '--qb-radius-composer'],
    files: [
      'components/public/feedback/feedback-header-animated.tsx',
      'components/public/feedback/feedback-header.tsx',
    ],
  },
  {
    name: 'post-card',
    description: 'A post in the feed. Done once its status is complete or closed.',
    states: ['done'],
    tokens: ['--qb-card-padding', '--qb-radius-panel', '--qb-feed-gap'],
    files: ['components/public/post-card.tsx'],
  },
  {
    name: 'post-title',
    description: "A post card's title.",
    states: [],
    tokens: ['--qb-title-size', '--qb-font-heading'],
    files: ['components/public/post-card.tsx'],
  },
  {
    name: 'post-heading',
    description: "A post's title on its own page.",
    states: [],
    tokens: ['--qb-page-title-size', '--qb-font-heading'],
    files: ['components/public/post-detail/post-content-section.tsx'],
  },
  {
    name: 'vote-button',
    description:
      'The vote box at the start of a card, and on a post. Voted once the visitor votes.',
    states: ['voted'],
    tokens: ['--qb-vote-active', '--qb-radius-control'],
    files: ['components/public/post-card.tsx', 'components/public/vote-button.tsx'],
  },
  {
    name: 'tag',
    description:
      "A post's or update's tag, tinted with its colour as status markers are, and plain when they are in the ink.",
    states: [],
    tokens: [],
    files: [
      'components/public/post-card.tsx',
      'components/public/post-detail/metadata-sidebar.tsx',
      'components/portal/changelog/changelog-entry-card.tsx',
    ],
  },
  {
    name: 'search-field',
    description: 'Where a visitor searches the help centre, on its pages and on Home.',
    states: [],
    tokens: ['--qb-radius-composer'],
    files: ['components/help-center/help-center-search.tsx'],
  },
  {
    name: 'status-badge',
    description: "A post's status, with its colour.",
    states: [],
    tokens: [],
    files: ['components/ui/status-badge.tsx'],
  },
  {
    name: 'filter-panel',
    description: "The feed's filters beside it on a wide screen.",
    states: [],
    tokens: ['--qb-radius-panel'],
    files: ['components/public/feedback/feedback-sidebar.tsx'],
  },
] as const satisfies readonly PortalPart[]

export type PortalPartName = (typeof PORTAL_PARTS)[number]['name']

/** Old part names, each with the name it became. */
export const PART_ALIASES: Readonly<Record<string, PortalPartName>> = {}

/** Whether a name is a part's, today's or an alias. */
export function isPartName(name: string): boolean {
  return PORTAL_PARTS.some((part) => part.name === name) || name in PART_ALIASES
}

/**
 * The CSS with each renamed part's old name replaced, so a workspace's CSS
 * keeps working across a rename. Running it twice changes nothing more.
 */
export function rewritePartAliases(
  css: string,
  aliases: Readonly<Record<string, string>> = PART_ALIASES
): string {
  let next = css
  for (const [from, to] of Object.entries(aliases)) {
    next = next.replace(new RegExp(`(data-qb-part=["']?)${from}(["']?\\])`, 'g'), `$1${to}$2`)
  }
  return next
}
