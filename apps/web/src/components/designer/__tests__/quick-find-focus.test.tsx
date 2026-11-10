// @vitest-environment happy-dom
/**
 * Every entry quick find's index holds is opened in the builder's real right
 * panel (BuilderSettings, with Theme as a sheet over it), the way the
 * builder opens it, and focus has to land on the entry's own control: never
 * on the page's body, never on another row, and never in a sheet the entry
 * is not in.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MotionConfig } from 'framer-motion'
import { useMemo, useReducer, useRef, useState } from 'react'
import { NO_SHEET, panelReducer, panelView } from '@/lib/shared/design/builder-chrome'
import { newBlock } from '@/lib/shared/design/home'
import {
  outlineOf,
  PAGE_NAMES,
  type DesignerPage,
  type Selection,
} from '@/lib/shared/design/outline'
import { panelFor } from '@/lib/shared/design/panel-routes'
import type { PortalPageGates } from '@/lib/shared/design/paths'
import { defaultDesign, type PortalDesign } from '@/lib/shared/design/schema'

vi.mock('@/lib/client/builder-events', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  trackBuilder: vi.fn(),
  designerAdvancedOpened: vi.fn(),
  designerLookChosen: vi.fn(),
}))
// Site images' link preview reads the workspace's name and address.
vi.mock('@/lib/client/hooks/use-root-context', () => ({
  useWorkspaceSettings: () => ({ name: 'Acme' }),
  useBaseUrl: () => 'https://acme.test',
  useSessionContext: () => null,
}))
vi.mock('@/lib/client/queries/portal-design', () => ({
  portalDesignQueries: {
    aiStatus: () => ({ queryKey: ['ai-status'], queryFn: async () => ({ available: true }) }),
    saved: () => ({ queryKey: ['saved'], queryFn: async () => ({ checkpoints: [], looks: [] }) }),
  },
}))
vi.mock('@/lib/server/functions/portal-design-saved', () => ({
  listPortalDesignSavedFn: async () => ({ checkpoints: [], looks: [] }),
  savePortalDesignFn: vi.fn(),
  getPortalDesignCheckpointFn: vi.fn(),
  deletePortalDesignSavedFn: vi.fn(),
}))
vi.mock('@/lib/server/functions/uploads', () => ({
  getWordmarkUploadUrlFn: vi.fn(),
  getFaviconUploadUrlFn: vi.fn(),
  getShareImageUploadUrlFn: vi.fn(),
  getBandImageUploadUrlFn: vi.fn(),
  getFontUploadUrlFn: vi.fn(),
  checkS3ConfiguredFn: async () => ({ configured: true }),
}))
vi.mock('@/components/admin/settings/branding/custom-css-editor', () => ({
  CustomCssEditor: ({ value }: { value: string }) => (
    <textarea aria-label="CSS" value={value} readOnly />
  ),
}))
vi.mock('@/components/admin/settings/branding/welcome-body-editor', () => ({
  WelcomeBodyEditor: () => null,
}))
vi.mock('../use-block-sources', () => ({
  useBlockSources: () => ({ boards: [['board_1', 'Mobile']], roadmaps: [], categories: [] }),
}))
vi.mock('@/lib/client/image-palette', () => ({
  imageInk: async () => null,
  imagePalette: async () => [],
}))

const { BuilderSettings } = await import('../builder-settings')
const { findIndex, findPath } = await import('../find-index')
const { FIND_ROOTS } = await import('../find-reveal')
const { builderNavigation, followFind } = await import('../quick-find')
const { nodeLabel } = await import('../use-canvas-selection')
const { ElementPanel } = await import('../element-panel')
const { elementFindItems } = await import('../find-index')
type FindItem = import('../find-index').FindItem
type FindNavigation = import('../quick-find').FindNavigation

const ALL_ON: PortalPageGates = {
  feedback: true,
  roadmap: true,
  changelog: true,
  help: true,
  support: true,
  status: true,
}
const PAGES: DesignerPage[] = [
  'home',
  'feedback',
  'roadmap',
  'changelog',
  'help',
  'support',
  'post',
  'status',
]

/** A design that draws its conditional rows: a hero with art, an inline header, a second colour. */
function drawsMost(): PortalDesign {
  const design = defaultDesign()
  design.nav.home.on = true
  design.mode = 'auto'
  design.layout.hero = 'brand'
  design.layout.header = 'inline'
  design.brand.light.support = '#0ea5e9'
  design.pages.home.blocks = [
    { ...newBlock('ideas'), id: 'ideas0001' },
    { ...newBlock('status', { y: 1 }), id: 'status001' },
  ]
  return design
}

/** The other half: a hero image and a full logo image. */
function drawsTheRest(): PortalDesign {
  const design = drawsMost()
  design.brand.heroImage = { key: 'portal-images/room.jpg' }
  design.brand.logo.display = 'wordmark'
  return design
}

/** The builder's right column, with its sheet, pick and page, moved as the builder moves them. */
function mountBuilder(start: PortalDesign, startPage: DesignerPage, pickedButton = false) {
  const live: { navigation: FindNavigation | null; page: DesignerPage } = {
    navigation: null,
    page: startPage,
  }
  function Builder() {
    const [design, setDesign] = useState(start)
    const [page, setPage] = useState(startPage)
    const [state, dispatch] = useReducer(panelReducer, NO_SHEET)
    const [selection, setSelection] = useState<Selection | null>(null)
    const nodes = useMemo(() => outlineOf(design, page), [design, page])
    const nameOf = (key: Selection | null) => nodeLabel(nodes, key)
    const designRef = useRef(design)
    designRef.current = design
    live.page = page
    live.navigation = builderNavigation({
      dispatch,
      page,
      setPage,
      pick: setSelection,
      setSelection,
      open: () => {},
    })
    return (
      <BuilderSettings
        hidden={false}
        shown={panelView(state, selection, nameOf(selection) ?? PAGE_NAMES[page])}
        route={panelFor(selection, false, page, nameOf)}
        panel={{ state, dispatch, close: () => dispatch({ type: 'close' }) }}
        selection={selection}
        page={page}
        pages={PAGES.length}
        nodes={nodes}
        design={design}
        update={(change) => {
          const next = structuredClone(designRef.current)
          change(next)
          setDesign(next)
        }}
        gates={ALL_ON}
        locale="en"
        phone={false}
        checks={[]}
        logoUrl={null}
        cssWarnings={[]}
        menu={
          {
            act: vi.fn(),
            land: vi.fn(),
            setAdding: vi.fn(),
          } as unknown as Parameters<typeof BuilderSettings>[0]['menu']
        }
        pickedBlock={null}
        onSelect={setSelection}
        onAdd={vi.fn()}
        onTheme={(more) => dispatch({ type: 'open', sheet: 'theme', more })}
        say={vi.fn()}
        element={
          pickedButton ? (
            <ElementPanel
              pick={{ element: 'button', part: null, section: 'hero', index: 0 }}
              page={page}
              blockName="Hero"
              design={design}
              update={vi.fn()}
              state="base"
              onState={vi.fn()}
              screen="all"
              onUp={vi.fn()}
            />
          ) : undefined
        }
      />
    )
  }
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MotionConfig reducedMotion="always">
        <Builder />
      </MotionConfig>
    </QueryClientProvider>
  )
  return live
}

/** Opens an entry as quick find does and says where focus landed, or what went wrong. */
async function landing(item: FindItem, navigation: FindNavigation): Promise<string> {
  // The builder's steps render as act ends; the row is then waited for as the dialog waits.
  let pending!: Promise<HTMLElement | null>
  await act(async () => {
    pending = followFind(item, navigation, 800)
  })
  const focused = await pending
  const active = document.activeElement
  if (!active || active === document.body) return 'body'
  if (item.target.kind === 'part')
    return active.id === 'designer-settings'
      ? 'ok'
      : `not the panel: ${active.outerHTML.slice(0, 80)}`
  if (item.target.kind !== 'row') return 'ok'
  const root = document.querySelector(
    item.target.place.kind === 'theme' ? FIND_ROOTS.theme : FIND_ROOTS.panel
  )
  const row = root?.querySelector(`[data-find="${item.target.row}"]`)
  if (!row) return 'row not drawn'
  if (focused !== active || !row.contains(active))
    return `focus elsewhere: ${active.outerHTML.slice(0, 80)}`
  // A row under the panel is reachable: no sheet lies over it.
  if (item.target.place.kind === 'part' && root!.hasAttribute('inert')) return 'under a sheet'
  return 'ok'
}

async function landAll(
  design: PortalDesign,
  page: DesignerPage,
  only?: (item: FindItem) => boolean
) {
  const live = mountBuilder(design, page)
  const items = findIndex({
    design,
    gates: ALL_ON,
    nodes: outlineOf(design, page),
    page,
    pages: PAGES,
  }).filter(
    (item) => (item.target.kind === 'row' || item.target.kind === 'part') && (only?.(item) ?? true)
  )
  const wrong: string[] = []
  for (const item of items) {
    // Each entry goes from wherever the last one left the builder.
    const result = await landing(item, live.navigation!)
    if (result !== 'ok') wrong.push(`${findPath(item)}: ${result}`)
  }
  cleanup()
  return { count: items.length, wrong }
}

// The panel's slides run as plain frames, not the page's own animations, which a test cancels midway.
const animate = Element.prototype.animate
beforeAll(() => {
  Reflect.deleteProperty(Element.prototype, 'animate')
  Element.prototype.scrollIntoView = vi.fn()
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(null, { status: 200 }))
  )
})
afterAll(() => {
  Element.prototype.animate = animate
  vi.unstubAllGlobals()
})

describe('every quick find entry, opened', () => {
  it('lands focus on its own control', async () => {
    const { count, wrong } = await landAll(drawsMost(), 'roadmap')
    expect(wrong).toEqual([])
    expect(count).toBeGreaterThan(200)
  }, 120_000)

  it('lands on each row of the element picked on the canvas, in its panel', async () => {
    const live = mountBuilder(drawsMost(), 'home', true)
    const items = elementFindItems('button', 'Call to action')
    const wrong: string[] = []
    for (const item of items) {
      const result = await landing(item, live.navigation!)
      if (result !== 'ok') wrong.push(`${findPath(item)}: ${result}`)
    }
    cleanup()
    expect(wrong).toEqual([])
    expect(items.length).toBeGreaterThan(10)
  }, 30_000)

  it('lands on the rows only an image or a full logo draws', async () => {
    const { count, wrong } = await landAll(drawsTheRest(), 'home', (item) =>
      ['hero-image', 'hero-phones', 'logo-image'].includes(
        item.target.kind === 'row' ? item.target.row : ''
      )
    )
    expect(wrong).toEqual([])
    expect(count).toBe(3)
  }, 30_000)
})
