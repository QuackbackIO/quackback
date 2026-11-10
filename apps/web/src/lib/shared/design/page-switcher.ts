/**
 * The page switcher: every page the builder can show, by module, each
 * module saying how it shows in the menu. A single post, entry or article is
 * chosen from a list; parts that are off are offered as samples.
 */
import { MENU_WORDS } from './menu-words'
import { landingOf, menuParts, type MenuPart } from './menu'
import { PAGE_NAMES, type CanvasLocation, type DesignerPage } from './outline'
import { portalFeedbackPath, type PortalPageGates, type PortalPageType } from './paths'
import { isSamplePage, NOT_FOUND_SAMPLE, SAMPLE_NAMES, type SamplePage } from './sample-pages'
import type { PortalDesign } from './schema'

/** A place in the portal with its own address. */
export interface DesignerPlace {
  id: string
  title: string
  path: string
}

/** What the switcher lists beyond the pages, as a signed-out visitor sees them. */
export interface DesignerPlaces {
  boards: Array<{ id: string; name: string; slug: string }>
  roadmaps: Array<{ id: string; name: string }>
  /** Help center topics, top level only. */
  categories: Array<{ id: string; name: string; path: string }>
  /** The public roadmaps' columns, each by its status, for Quackback AI to pick by name. */
  columns?: Array<{ id: string; name: string }>
  /** The posts' statuses, for Quackback AI to pick by name, such as for recently shipped posts. */
  statuses?: Array<{ id: string; name: string }>
  posts: DesignerPlace[]
  entries: DesignerPlace[]
  articles: DesignerPlace[]
}

export const NO_PLACES: DesignerPlaces = {
  boards: [],
  roadmaps: [],
  categories: [],
  posts: [],
  entries: [],
  articles: [],
}

/** The lists "Choose one" opens. */
export type ChooseList = 'posts' | 'entries' | 'articles'

export const CHOOSE_TITLES: Record<ChooseList, string> = {
  posts: 'Choose a post',
  entries: 'Choose an entry',
  articles: 'Choose an article',
}

/** The page a chosen item opens on. */
export const CHOOSE_PAGES: Record<ChooseList, DesignerPage> = {
  posts: 'post',
  entries: 'changelog',
  articles: 'help',
}

export type SwitcherGo =
  | { kind: 'page'; page: DesignerPage; item: string | null }
  | { kind: 'choose'; list: ChooseList }
  | { kind: 'sample'; page: SamplePage }
  /** The widget, drawn in the design: a sample to look at, set in Settings > Widget. */
  | { kind: 'widget' }
  | { kind: 'turn-on' }
  /** Not drawn by the builder yet. */
  | { kind: 'none' }

export interface SwitcherRow {
  key: string
  label: string
  /** Under the row before it, such as a board under All boards. */
  indent?: boolean
  hint?: string
  /** The page shown. */
  current?: boolean
  go: SwitcherGo
  /** Other words it is found by: its module, its name in the menu. */
  keywords: string[]
}

export interface SwitcherColumn {
  key: 'general' | PortalPageType | 'off'
  title: string
  note: string
  /** Whether the note says how it shows in the menu. */
  menuNote: boolean
  rows: SwitcherRow[]
}

export const SWITCHER_COPY = {
  search: 'Find a page, board, entry or article',
  keys: 'Arrow keys move, Enter goes',
  empty: 'No page matches.',
  here: 'You are here',
  lands: MENU_WORDS.landingPage,
  choose: 'Choose one',
  sample: 'Sample',
  widget: 'Widget',
  turnOn: 'Turn one on',
  hidden: MENU_WORDS.hidden,
  back: 'All pages',
  page: 'Page:',
  findOne: 'Search',
  loading: 'Loading…',
  nothing: 'Nothing to choose yet.',
} as const

const MODULE_TITLES: Record<PortalPageType, string> = {
  feedback: 'Feedback',
  roadmap: 'Roadmap',
  changelog: 'Changelog',
  help: 'Help Center',
  support: 'Support',
  status: 'Status',
}

const ORDER: PortalPageType[] = ['feedback', 'roadmap', 'changelog', 'help', 'support', 'status']

/** The feed filtered to a board, at the feed's own address. */
export function boardPath(feedbackPath: string, slug: string): string {
  return `${feedbackPath}?board=${encodeURIComponent(slug)}`
}

/** The roadmap page showing one roadmap. */
export function roadmapPath(id: string): string {
  return `/roadmap?roadmap=${encodeURIComponent(id)}`
}

const pageGo = (page: DesignerPage, item: string | null = null): SwitcherGo => ({
  kind: 'page',
  page,
  item,
})

export function switcherColumns({
  design,
  gates,
  places,
  here,
  sample,
  widget = false,
}: {
  design: PortalDesign
  gates: PortalPageGates
  places: DesignerPlaces
  here: CanvasLocation
  sample: SamplePage | null
  /** Whether the widget's sample is shown. */
  widget?: boolean
}): SwitcherColumn[] {
  const parts = menuParts(design, gates)
  const landing = landingOf(design, gates)
  const partOf = (type: PortalPageType) => parts.find((part) => part.id === type)
  const isHere = (go: SwitcherGo, alsoWhenNoItem = false) => {
    if (widget) return go.kind === 'widget'
    if (go.kind === 'widget') return false
    if (sample) return go.kind === 'sample' && go.page === sample
    if (go.kind === 'choose')
      return (
        here.page === CHOOSE_PAGES[go.list] &&
        (go.list === 'posts' || places[go.list].some((each) => each.path === here.item))
      )
    if (go.kind !== 'page' || go.page !== here.page) return false
    return go.item === here.item || (alsoWhenNoItem && here.item === null)
  }
  const row = (
    key: string,
    label: string,
    go: SwitcherGo,
    options: { indent?: boolean; hint?: string; keywords?: string[]; firstOfPage?: boolean } = {}
  ): SwitcherRow => {
    const current = isHere(go, options.firstOfPage)
    const hint = current ? SWITCHER_COPY.here : options.hint
    return {
      key,
      label,
      go,
      keywords: options.keywords ?? [],
      ...(options.indent ? { indent: true } : {}),
      ...(hint ? { hint } : {}),
      ...(current ? { current: true } : {}),
    }
  }
  const landsHint = (type: 'home' | PortalPageType) =>
    landing === type ? SWITCHER_COPY.lands : undefined
  const noteOf = (part: MenuPart | undefined) =>
    part?.shown ? `In the menu as "${part.label}"` : SWITCHER_COPY.hidden

  const general: SwitcherColumn = {
    key: 'general',
    title: 'General',
    note: '',
    menuNote: false,
    rows: [
      ...(design.nav.home.on
        ? [
            row('home', parts[0]?.id === 'home' ? parts[0].label : 'Home', pageGo('home'), {
              hint: landsHint('home'),
              keywords: ['Home'],
            }),
          ]
        : []),
      row(
        'widget',
        SWITCHER_COPY.widget,
        { kind: 'widget' },
        { hint: SWITCHER_COPY.sample, keywords: ['Widget', 'messenger', 'sample'] }
      ),
      // The page an address with nothing at it shows: the brand, and its words.
      row(
        `sample:${NOT_FOUND_SAMPLE}`,
        SAMPLE_NAMES[NOT_FOUND_SAMPLE],
        { kind: 'sample', page: NOT_FOUND_SAMPLE },
        { hint: SWITCHER_COPY.sample, keywords: ['404', 'missing', 'error', 'sample'] }
      ),
    ],
  }

  const modules = ORDER.filter((type) => gates[type]).map((type): SwitcherColumn => {
    const part = partOf(type)
    const title = MODULE_TITLES[type]
    const name = part?.label ?? PAGE_NAMES[type]
    const keywords = [title, name]
    const rows: SwitcherRow[] = []
    if (type === 'feedback') {
      const feed = portalFeedbackPath({ engine: 'v2', nav: design.nav }, gates)
      rows.push(
        row('feedback', 'All boards', pageGo('feedback'), { hint: landsHint(type), keywords }),
        ...places.boards.map((board) =>
          row(`board:${board.id}`, board.name, pageGo('feedback', boardPath(feed, board.slug)), {
            indent: true,
            keywords,
          })
        ),
        row(
          'post',
          'A post',
          { kind: 'choose', list: 'posts' },
          {
            hint: SWITCHER_COPY.choose,
            keywords: [...keywords, 'post'],
          }
        )
      )
    } else if (type === 'roadmap') {
      if (places.roadmaps.length === 0)
        rows.push(row('roadmap', name, pageGo('roadmap'), { hint: landsHint(type), keywords }))
      places.roadmaps.forEach((roadmap, index) =>
        rows.push(
          row(`roadmap:${roadmap.id}`, roadmap.name, pageGo('roadmap', roadmapPath(roadmap.id)), {
            hint: index === 0 ? landsHint(type) : undefined,
            keywords,
            firstOfPage: index === 0,
          })
        )
      )
    } else if (type === 'changelog') {
      rows.push(
        row('changelog', name, pageGo('changelog'), { hint: landsHint(type), keywords }),
        row(
          'entry',
          'An entry',
          { kind: 'choose', list: 'entries' },
          {
            hint: SWITCHER_COPY.choose,
            keywords: [...keywords, 'entry'],
          }
        )
      )
    } else if (type === 'help') {
      rows.push(
        row('help', 'Help home', pageGo('help'), { hint: landsHint(type), keywords }),
        ...places.categories.map((category) =>
          row(`category:${category.id}`, category.name, pageGo('help', category.path), {
            indent: true,
            keywords,
          })
        ),
        row(
          'article',
          'An article',
          { kind: 'choose', list: 'articles' },
          {
            hint: SWITCHER_COPY.choose,
            keywords: [...keywords, 'article'],
          }
        )
      )
    } else {
      rows.push(row(type, name, pageGo(type), { hint: landsHint(type), keywords }))
    }
    return { key: type, title, note: noteOf(part), menuNote: true, rows }
  })

  const off = ORDER.filter((type) => !gates[type])
  const turnedOff: SwitcherColumn[] = off.length
    ? [
        {
          key: 'off',
          title: 'Turned off',
          note: 'Samples until you turn them on',
          menuNote: false,
          rows: [
            ...off.flatMap((type) =>
              isSamplePage(type)
                ? [
                    row(
                      `sample:${type}`,
                      PAGE_NAMES[type],
                      { kind: 'sample', page: type },
                      {
                        hint: SWITCHER_COPY.sample,
                        keywords: [MODULE_TITLES[type], 'sample'],
                      }
                    ),
                  ]
                : []
            ),
            row('turn-on', SWITCHER_COPY.turnOn, { kind: 'turn-on' }, { keywords: ['add'] }),
          ],
        },
      ]
    : []

  return [general, ...modules, ...turnedOff]
}
