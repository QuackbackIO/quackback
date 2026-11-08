// @vitest-environment happy-dom
/**
 * The builder's canvas draws a draft through the code that draws the
 * published portal: the frame takes the draft whole, builds its view with
 * the server's code, and the portal reads that view where it reads the
 * published one. So a draft drawn in the frame looks exactly as the same
 * design does once published, for the reference designs and for drafts that
 * change every page.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'
import { IntlProvider } from 'react-intl'
import type { ReactNode } from 'react'

/** The route context the portal reads the published design from, and the page shown. */
const root = vi.hoisted(() => ({ portalDesign: undefined as unknown, path: '/' }))
vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ invalidate: vi.fn(), navigate: vi.fn(), state: { location: {} } }),
  useRouterState: ({ select }: { select: (state: unknown) => unknown }) =>
    select({ location: { pathname: root.path } }),
  useRouteContext: ({ select }: { select?: (context: unknown) => unknown } = {}) => {
    const context = {
      session: null,
      registeredAuthProviders: [],
      settings: {
        name: 'Harbor',
        featureFlags: DEFAULT_FEATURE_FLAGS,
        portalDesign: root.portalDesign,
      },
    }
    return select ? select(context) : context
  },
  Link: ({ to, children, ...rest }: { to: string; children: ReactNode }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}))
vi.mock('next-themes', () => ({ useTheme: () => ({ theme: 'light', setTheme: vi.fn() }) }))
vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: null }),
  queryOptions: <T,>(options: T) => options,
  useQueryClient: () => ({ invalidateQueries: vi.fn(), removeQueries: vi.fn() }),
}))
vi.mock('@/components/auth/auth-popover-context', () => ({
  useAuthPopoverSafe: () => ({ openAuthPopover: vi.fn() }),
}))
vi.mock('@/lib/server/functions/conversation', () => ({ getMyConversationsFn: vi.fn() }))
vi.mock('@/lib/client/hooks/use-auth-broadcast', () => ({ useAuthBroadcast: () => {} }))
vi.mock('@/lib/client/auth-client', () => ({ signOut: vi.fn() }))
vi.mock('@/components/notifications', () => ({ NotificationBell: () => null }))
vi.mock('@/components/shared/user-stats', () => ({ UserStatsBar: () => null }))
vi.mock('@/lib/shared/theme', async (actual) => ({
  ...(await actual<typeof import('@/lib/shared/theme')>()),
  loadBrandingFont: vi.fn(async () => {}),
}))

const { DEFAULT_FEATURE_FLAGS } = await import('@/lib/shared/types/settings')
const { portalDesign, defaultDesign } = await import('@/lib/shared/design/schema')
const { portalDesignView } = await import('@/lib/server/domains/design/engine')
const { useStatusColour } = await import('@/components/ui/status-badge')
const { designPreviewCss } = await import('@/components/admin/settings/appearance/use-design-draft')
const { PortalPreviewProvider } = await import('../portal-preview-listener')
const { PortalShell } = await import('../portal-shell')
const { PortalHeader } = await import('../portal-header')
const { PortalBand } = await import('../portal-band')
const { PortalPageTitle } = await import('../portal-page-title')
const { useDesignNav } = await import('../use-portal-paths')
const { useFeedCopy, usePageChoices, usePortalDesign } = await import('../preview-draft-context')

type Design = import('@/lib/shared/design/schema').PortalDesign
type View = import('@/lib/shared/design/view').PortalDesignView

/** The design as the server keeps it and builds the published view from. */
const serverView = (doc: unknown): View =>
  portalDesignView({ engine: 'v2', doc: portalDesign.parse(doc), revision: 7 })

/** The published view, without what only the server's build and the head use. */
const drawnPart = (view: View) => {
  if (view.engine !== 'v2') return view
  const { revision: _revision, fontLinks: _fontLinks, ...rest } = view
  return rest
}

const fixtures = {
  ...import.meta.glob<unknown>('../../../lib/shared/design/__tests__/fixtures/*.json', {
    eager: true,
    import: 'default',
  }),
  ...import.meta.glob<unknown>(
    '../../../lib/shared/design/__tests__/fixtures/no-overrides/*.json',
    {
      eager: true,
      import: 'default',
    }
  ),
}

const draft = (change: (d: Design) => void): Design => {
  const d = defaultDesign()
  change(d)
  return d
}

const words = (en: string) => ({ en })

/** Drafts that between them change every page the builder designs. */
const drafts: Record<string, Design> = {
  'Home with its hero, composer and blocks': draft((d) => {
    d.layout.hero = 'brand'
    d.nav.home = { on: true, tab: true, label: 'Start' }
    d.pages.home = {
      headline: {
        title: words('Make Harbor better'),
        subtitle: words('Tell us what to build'),
        accent: { style: 'colour', text: words('better'), colour: 'support' },
      },
      composer: 'band',
      composerWidth: 'narrow',
      blocks: [
        { id: 'composer01', type: 'composer', grid: { x: 0, y: 0, w: 12, h: 4 } },
        {
          id: 'ideas0001',
          type: 'ideas',
          grid: { x: 0, y: 4, w: 6, h: 8 },
          sort: 'trending',
          count: 3,
        },
      ],
    }
  }),
  'Home with a call to action': draft((d) => {
    d.layout.hero = 'tint'
    d.nav.home = { on: true, tab: false }
    d.pages.home.headline = { title: words('Hello'), subtitle: words('') }
    d.pages.home.mainAction = 'button'
    d.pages.home.button = {
      to: 'roadmap',
      label: words('See what is next'),
      second: true,
      secondLabel: words('Tell us'),
    }
  }),
  'the feed with its own words and welcome': draft((d) => {
    d.pages.feedback.headline = {
      title: words('Ideas'),
      subtitle: words('Vote on what matters'),
      accent: { style: 'highlight', text: words('matters') },
    }
    d.pages.feedback.copy = {
      prompt: words('What would help?'),
      submit: words('Send'),
      emptyTitle: words('Nothing yet'),
    }
    d.pages.feedback.welcome = {
      show: true,
      body: {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hi' }] }],
      },
    }
    d.pages.support = { request: words('Ask us') }
  }),
  'every titled page, on the band, with page choices': draft((d) => {
    d.layout.hero = 'brand'
    d.layout.pageTitles = 'band'
    d.pages.titles = {
      roadmap: { title: words('What is next'), subtitle: words('Planned') },
      changelog: { title: words('New'), subtitle: words('Shipped') },
      help: { title: words('Help'), subtitle: words('Guides') },
      support: { title: words('Talk to us'), subtitle: words('We reply') },
    }
    d.pages.changelog = { entries: 'compact', images: 'wide' }
    d.pages.help = { topics: 'list', search: 'large' }
    d.pages.roadmap = { votes: false }
  }),
  'the header, menu, logo, image and status colours': draft((d) => {
    d.layout.header = 'inline'
    d.layout.hero = 'brand'
    d.layout.status = 'brand'
    d.brand.logoColours = ['#e01e5a', '#36c5f0']
    d.brand.logo = {
      display: 'name',
      name: 'Harbor & Pine',
      wordmark: { light: null, dark: null },
      mark: { light: { key: 'header-logos/mark.png' }, dark: null },
    }
    d.brand.heroImage = {
      key: 'portal-images/room.webp',
      width: 2560,
      variants: [{ key: 'portal-images/room-640.webp', w: 640 }],
    }
    d.layout.imagePlace = 'cover'
    d.pages.feedback.headline = { title: words('Ideas'), subtitle: words('') }
    d.nav.items = [
      { type: 'roadmap', shown: true },
      { type: 'feedback', shown: true },
      { type: 'changelog', shown: false },
    ]
  }),
}

const cases = [
  ...Object.entries(fixtures).map(([path, doc]) => [path.split('/').pop()!, doc] as const),
  ...Object.entries(drafts),
]

/** What the portal reads from the design, beyond what its parts draw. */
function Reads() {
  const design = usePortalDesign()
  return (
    <pre data-testid="reads">
      {JSON.stringify({
        choices: usePageChoices(),
        copy: useFeedCopy(),
        nav: useDesignNav() ?? null,
        status: useStatusColour('#22c55e'),
        home: design?.engine === 'v2' ? design.home : null,
        welcome: design?.engine === 'v2' ? design.feedback.welcome : null,
      })}
    </pre>
  )
}

/** The portal's design-drawn parts, page by page. */
function Portal() {
  return (
    <PortalShell>
      <PortalHeader orgName="Harbor" orgLogo={null} userRole={null} showThemeToggle={false} />
      <PortalBand page="home" />
      <PortalBand page="feedback" />
      <PortalBand page="home">
        <form data-testid="composer" />
      </PortalBand>
      {(['roadmap', 'changelog', 'help', 'support'] as const).map((page) => (
        <PortalPageTitle key={page} page={page} title={`${page} title`} subtitle="usual">
          <span>{page} search</span>
        </PortalPageTitle>
      ))}
      <Reads />
    </PortalShell>
  )
}

/**
 * The page's markup with each element's attributes in name order: an update
 * may add an attribute after those already there, where a first render puts
 * it in the order the component writes them.
 */
function markup(element: Element): string {
  const attributes = element
    .getAttributeNames()
    .sort()
    .map((name) => ` ${name}="${element.getAttribute(name)}"`)
    .join('')
  const children = [...element.childNodes]
    .map((node) =>
      node.nodeType === Node.ELEMENT_NODE ? markup(node as Element) : (node.textContent ?? '')
    )
    .join('')
  return `<${element.localName}${attributes}>${children}</${element.localName}>`
}

const framer = { postMessage: vi.fn() } as unknown as Window

beforeEach(() => {
  vi.spyOn(window, 'top', 'get').mockReturnValue(framer)
  vi.spyOn(window, 'parent', 'get').mockReturnValue(framer)
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  root.portalDesign = undefined
  for (const name of document.documentElement.getAttributeNames())
    if (name.startsWith('data-qb-')) document.documentElement.removeAttribute(name)
})

/** The portal as visitors get it once the design is published. */
function drawPublished(doc: unknown): string {
  root.portalDesign = serverView(doc)
  const { container, unmount } = render(
    <IntlProvider locale="en" onError={() => {}}>
      {/* As the portal layout mounts it for every visitor: off. */}
      <PortalPreviewProvider enabled={false}>
        <div data-testid="page">
          <Portal />
        </div>
      </PortalPreviewProvider>
    </IntlProvider>
  )
  const html = markup(container.querySelector('[data-testid="page"]')!)
  unmount()
  return html
}

/** The portal in the builder's frame, over another published design, with the draft posted. */
async function drawInFrame(doc: unknown): Promise<string> {
  root.portalDesign = serverView(defaultDesign())
  const { container } = render(
    <IntlProvider locale="en" onError={() => {}}>
      <PortalPreviewProvider enabled>
        <div data-testid="page">
          <Portal />
        </div>
      </PortalPreviewProvider>
    </IntlProvider>
  )
  act(() => {
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { type: 'quackback:preview-design', design: structuredClone(doc) },
        origin: window.location.origin,
        source: framer,
      })
    )
  })
  await act(async () => {
    await vi.dynamicImportSettled()
  })
  return markup(container.querySelector('[data-testid="page"]')!)
}

describe('a draft in the builder’s frame', () => {
  it.each(cases)('builds the view the server publishes: %s', async (_name, doc) => {
    const { readDraftView } = await import('../portal-preview-design')
    expect(drawnPart(readDraftView(structuredClone(doc))!)).toEqual(drawnPart(serverView(doc)))
  })

  it.each(cases)('draws as the published portal does: %s', async (_name, doc) => {
    const published = drawPublished(doc)
    const framed = await drawInFrame(doc)
    expect(framed).toBe(published)
    // The design's own stylesheet and structure, as the server's head carries them.
    const view = serverView(doc)
    if (view.engine !== 'v2') throw new Error('not a design')
    expect(document.querySelector('style[data-preview-design]')?.textContent).toBe(
      [view.themeStyles, view.customCss].filter(Boolean).join('\n')
    )
    // The very text the builder waits for before it reads what the frame drew.
    expect(document.querySelector('style[data-preview-design]')?.textContent).toBe(
      designPreviewCss(portalDesign.parse(doc))
    )
    for (const [name, value] of Object.entries(view.attributes))
      expect(document.documentElement.getAttribute(name), name).toBe(value)
  })

  it('differs from the published design underneath, so the comparison can fail', async () => {
    const doc = drafts['every titled page, on the band, with page choices']!
    expect(await drawInFrame(doc)).not.toBe(drawPublished(defaultDesign()))
  })
})
