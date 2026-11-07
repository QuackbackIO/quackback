import { useEffect, useMemo, useRef, useState } from 'react'
import { useSuspenseQuery } from '@tanstack/react-query'
import { ClientOnly } from '@tanstack/react-router'
import { MotionConfig } from 'framer-motion'
import { cn } from '@/lib/shared/utils'
import { DraftNotices } from '@/components/admin/settings/appearance/draft-notices'
import {
  designPreview,
  useDesignDraft,
} from '@/components/admin/settings/appearance/use-design-draft'
import { trackBuilder } from '@/lib/client/builder-events'
import { portalDesignQueries } from '@/lib/client/queries/portal-design'
import { deviceCaption, escapeStep, panelView } from '@/lib/shared/design/builder-chrome'
import { panelFor } from '@/lib/shared/design/panel-routes'
import { designChecks } from '@/lib/shared/design/checks'
import type { HomeBlockType } from '@/lib/shared/design/home'
import { locationOfPath, outlineOf, PAGE_NAMES, type Selection } from '@/lib/shared/design/outline'
import { AiPane } from './ai-pane'
import { BuilderColumns, type Pane } from './builder-columns'
import { useBuilderDialogs } from './builder-dialogs'
import { BuilderSettings } from './builder-settings'
import { BuilderTopBar } from './builder-top-bar'
import { CanvasBar } from './canvas-bar'
import { CanvasLayer } from './canvas-layer'
import { DesignerAi } from './designer-ai'
import { DesignerCanvas } from './designer-canvas'
import { ElementPanel, elementPanelKey } from './element-panel'
import { usePickReach } from './use-pick-reach'
import { backgroundPageOf } from '@/lib/shared/design/page-background'
import { partOf, partSelector } from '@/lib/shared/design/parts-registry'
import { pickLabel, pickName } from '@/lib/shared/design/element-pick'
import { blockFindActions, elementFindItems } from '@/lib/shared/design/quick-find'
import { ADD_LAYOUTS } from './add-sheet'
import { revealSetting } from './quick-find'
import type { StyleOverride } from '@/lib/shared/design/style-overrides'
import { STYLE_ELEMENTS, type StyleState } from '@/lib/shared/design/style-tokens'
import type { DesignerPage } from '@/lib/shared/design/outline'
import { useCanvasDesign } from './look-preview'
import { MenuLayer } from './menu-layer'
import { WordsLayer } from './words/words-layer'
import { useMenuCoach } from './menu-coach-mark'
import { PreviewBar } from './preview-bar'
import { usePublishFlow } from './publish-flow'
import { ReturnVisitNote } from './return-visit-note'
import { ReviewCompare } from './review-compare'
import { AddDragCard, AddDropLayer, useAddDrag } from './use-add-drag'
import { focusBlocks, focusSettings, inSettings } from './settings-focus'
import { useAiPane } from './use-ai-pane'
import { useBlockActions } from './use-block-actions'
import { useBuilderPanel } from './use-builder-panel'
import { useCanvasInput } from './use-canvas-input'
import { useCanvasSelection } from './use-canvas-selection'
import { useCanvasView } from './use-canvas-view'
import { useCountedUpdate, useDesignerEvents } from './use-designer-events'
import { useDesignerAi } from './use-designer-ai'
import { useDesignerPage } from './use-designer-page'
import { useMatchOnArrival } from './use-match-on-arrival'
import { useMenuEditing } from './use-menu-editing'
import { usePreviewFollow } from './use-preview-follow'
import { usePreviewMode } from './use-preview-mode'
import { useSaid } from './use-said'

/** Escape inside these belongs to them. */
const OWNS_ESCAPE =
  '[role=dialog], [role=alertdialog], [role=listbox], [role=menu], input, textarea'

/**
 * The customer portal builder: Ask AI on the left, the page someone was on
 * in the middle, drawn from the design draft at a true width, and the
 * properties on the right: the page's own with nothing picked, else the
 * picked part's, as panel-routes.ts says, with Theme and Add as sheets over
 * them. Escape climbs a level at a time and closes only the page's panel.
 * It edits the same draft as Appearance, with the same undo and publish.
 */
export function DesignerShell({
  returnPath,
  workspaceName,
  logoUrl,
}: {
  returnPath: string
  workspaceName: string
  logoUrl: string | null
}) {
  const draft = useDesignDraft()
  const { design } = draft
  const { data: editor } = useSuspenseQuery(portalDesignQueries.editor())
  const view = useDesignerPage(returnPath, design)
  const { gates, pages, page, setPage, postPath, noPost } = view
  const nodes = useMemo(() => outlineOf(design, page), [design, page])
  const canvas = useCanvasView(design.mode)
  const { size, theme, locale } = canvas
  // The column shown in a narrow window; a pick on the page leads to its settings.
  const [pane, setPane] = useState<Pane>('page')
  const { previewing, enter: startPreview, leave: leavePreview } = usePreviewMode()
  const follow = usePreviewFollow({ previewing, ...view, homeOn: design.nav.home.on })
  const panel = useBuilderPanel()
  const aiPane = useAiPane(previewing, () => setPane('ai'))
  // Quackback AI's conversation.
  const { ai } = useDesignerAi(draft, { page, locale }, workspaceName)
  const [now] = useState(() => new Date())
  const livePreview = useMemo(() => designPreview(draft.live), [draft.live])
  const canvasDesign = useCanvasDesign(draft.preview)
  const checks = useMemo(() => designChecks(design), [design])

  const { said, say, undo, redo } = useSaid(draft)
  const picking = useCanvasSelection({
    nodes,
    design,
    page,
    // The brand kit and the styles are in Theme; the styles under More options.
    onPanel: (part) => panel.dispatch({ type: 'open', sheet: 'theme', more: part === 'styles' }),
    onPicked: () => setPane('settings'),
    say,
  })
  const { selection, setSelection, pick, nameOf, stepBack } = picking
  // The page's own panel shows with nothing picked, until Escape closes it; any pick opens it again.
  const [pageClosed, setPageClosed] = useState(false)
  useEffect(() => {
    if (selection || picking.elementKey) setPageClosed(false)
  }, [selection, picking.elementKey])
  // The picked element's state, which the canvas draws it in; a new pick starts at rest.
  const [elementState, setElementState] = useState<StyleState>('base')
  useEffect(() => setElementState('base'), [picking.elementKey])
  // An override picked from Theme's list: its page shows, then its element is picked there.
  const [jump, setJump] = useState<StyleOverride | null>(null)
  const jumpTo = (o: StyleOverride) => {
    const part = o.target.scope === 'part' ? partOf(design, o.target.part) : null
    const shown = backgroundPageOf(page)
    const to =
      o.target.scope === 'page'
        ? o.target.page
        : part?.pages.includes(shown!)
          ? shown
          : part?.pages[0]
    if (to && to !== shown && pages.includes(to as DesignerPage)) setPage(to as DesignerPage)
    panel.close()
    setJump(o)
  }
  const selectRef = useRef(picking.select)
  selectRef.current = picking.select
  useEffect(() => {
    if (!jump) return
    let tries = 0
    const timer = setInterval(() => {
      const doc = document.querySelector<HTMLIFrameElement>(
        'iframe[data-designer-canvas]'
      )?.contentDocument
      const el = STYLE_ELEMENTS[jump.target.element]
      const part = jump.target.scope === 'part' ? partOf(design, jump.target.part) : null
      const selector = part
        ? partSelector(part, jump.target.element)
        : `[data-qb-page=${jump.target.scope === 'page' ? jump.target.page : ''}] ${el.selector}`
      const node = doc?.querySelector(selector)
      if (node || ++tries > 30) {
        clearInterval(timer)
        setJump(null)
        if (node)
          selectRef.current(
            node.closest('[data-qb-section]')?.getAttribute('data-qb-section') ?? null,
            null,
            node
          )
      }
    }, 300)
    return () => clearInterval(timer)
  }, [jump, design])
  const pickedElement = picking.element
  const pickReach = usePickReach(pickedElement, design, backgroundPageOf(page))
  // The picked element's own settings are found where they are, under More or not.
  const elementName = pickedElement ? pickName(pickedElement, design, backgroundPageOf(page)) : null
  const findHere = useMemo(
    () =>
      pickedElement && elementName ? elementFindItems(pickedElement.element, elementName) : [],
    [pickedElement?.element, elementName]
  )
  const dialogs = useBuilderDialogs({
    draft,
    nodes,
    page,
    pages,
    onSelect: pick,
    onPage: setPage,
    extra: findHere,
    // Read as quick find opens, so they act on what is picked then.
    actions: () =>
      blockFindActions({
        picked: pickedBlock,
        onAdd: () => panel.dispatch({ type: 'open', sheet: 'add' }),
        onLayouts: () => {
          panel.dispatch({ type: 'open', sheet: 'add' })
          revealSetting(ADD_LAYOUTS)
        },
        onDuplicate: selection ? () => blocks.duplicateBlock(selection) : undefined,
        onRemove: selection ? () => blocks.removeBlock(selection) : undefined,
      }),
  })
  // A sheet's way back names what the panel under it shows: the element, the pick, or the page.
  const shown = panelView(
    panel.state,
    selection,
    elementName ?? nameOf(selection) ?? PAGE_NAMES[page]
  )
  // The element's own panel shows in place of its block's, though not under a sheet.
  const route = panelFor(selection, !!pickedElement && !shown.sheet, page, nameOf)
  const settingsOpen = !pageClosed || !!selection || !!shown.sheet || !!pickedElement
  // A narrow window shows the page when there are no settings to show.
  const column: Pane = pane === 'settings' && !settingsOpen ? 'page' : pane

  // Each change is named for the part it changes, so undo says what it takes back.
  const update = useCountedUpdate(draft, page)
  const blocks = useBlockActions({ draft, selection, setSelection: pick, nameOf, say })
  const { structural, onWords } = useCanvasInput(design, update, locale)
  const menu = useMenuEditing({ design, gates, update, page, setPage, pick, say })
  // A block dragged from Add onto the page: dropped, it is picked and the sheet closes.
  const addDrag = useAddDrag({
    design,
    gates,
    page,
    update,
    begin: draft.begin,
    end: draft.end,
    say,
    onAdded: (key) => {
      pick(key)
      panel.dispatch({ type: 'added' })
      setPane('settings')
    },
  })
  const coach = useMenuCoach()

  useDesignerEvents({
    page,
    selection,
    panel: aiPane.collapsed ? 'settings' : 'ai',
    design,
    versions: dialogs.open === 'versions',
    help: dialogs.open === 'keys',
  })
  const publishing = usePublishFlow({
    draft,
    gates,
    failingChecks: draft.report.errors.length,
    checks,
    onShowCheck: (part) => pickAndFocus(part),
    compare: () => (
      <ReviewCompare
        page={view.realPage}
        pages={pages.filter((each) => each !== 'post' || !!postPath)}
        postPath={postPath}
        item={view.here.item}
        theme={design.mode === 'auto' ? theme : design.mode}
        locale={locale}
        sort={design.pages.feedback.defaultSort}
        live={livePreview}
        draft={draft.preview}
      />
    ),
  })
  const discard = () => {
    trackBuilder('designer_draft_discarded', { changes: draft.changes.length })
    void draft.discard()
    say('Draft discarded. Undo brings it back.')
  }
  const exit = async () => {
    await draft.flush()
    window.location.assign(returnPath)
  }
  const addBlock = (type: HomeBlockType) => {
    if (page !== 'home') setPage('home')
    blocks.addBlock(type)
    panel.dispatch({ type: 'added' })
    setPane('settings')
  }
  const openTheme = (more = false) => panel.dispatch({ type: 'open', sheet: 'theme', more })
  // Onboarding's /design?match=<site>: the brand match runs into the draft; or the Brand kit opens.
  useMatchOnArrival({
    start: (site) => ai.ask(site, 'site'),
    showAi: aiPane.expand,
    openBrandKit: () => openTheme(),
  })
  const pickAndFocus = (key: Selection) => {
    pick(key)
    focusSettings()
  }
  const pickedBlock = selection?.startsWith('block-') ? (nameOf(selection) ?? null) : null
  const caption = deviceCaption(size)

  return (
    <MotionConfig reducedMotion="user">
      <div
        className="flex h-dvh flex-col overflow-clip bg-muted/60"
        onKeyDown={(event) => {
          if (previewing) {
            if (event.key === 'Escape') leavePreview()
            return
          }
          blocks.blockKeys(event, () => dialogs.show('keys'))
          if (event.key !== 'Escape' || event.defaultPrevented) return
          if ((event.target as Element).closest(OWNS_ESCAPE)) return
          const step = escapeStep(panel.state, selection ?? picking.elementKey, settingsOpen)
          if (step === 'close-sheet') panel.close()
          else if (step === 'up') {
            // The panel stays, a level up: focus in it stays in it.
            const kept = inSettings()
            stepBack()
            if (kept) focusSettings()
          } else if (step === 'close-page') {
            const lost = inSettings()
            setPageClosed(true)
            if (lost) focusBlocks()
          }
        }}
      >
        {settingsOpen && (
          <a
            href="#designer-settings"
            className="sr-only focus:not-sr-only focus:absolute focus:start-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-background focus:px-3 focus:py-2 focus:text-sm focus:ring-2 focus:ring-muted-foreground"
          >
            Skip to properties
          </a>
        )}
        {previewing ? (
          <PreviewBar
            page={page}
            view={view}
            size={size}
            onSize={canvas.setSize}
            onDone={() => leavePreview()}
          />
        ) : (
          <BuilderTopBar
            returnPath={returnPath}
            workspaceName={workspaceName}
            onExit={() => void exit()}
            draft={draft}
            view={view}
            canvas={canvas}
            nodes={nodes}
            selection={selection}
            onPick={pickAndFocus}
            checks={checks}
            onUndo={undo}
            onRedo={redo}
            onTurnOn={() => menu.setAdding(true)}
            sheet={panel.state.sheet}
            onSheet={(next) => {
              panel.dispatch({ type: 'toggle', sheet: next })
              setPane('settings')
            }}
            onPreview={startPreview}
            onPublish={() => void publishing.start()}
            onDiscard={discard}
            onDialog={dialogs.show}
          />
        )}

        {!previewing && (
          <BuilderColumns
            pane={column}
            onPane={(next) => {
              if (next === 'settings') setPageClosed(false)
              setPane(next)
            }}
          />
        )}
        <div className="flex min-h-0 flex-1">
          {!previewing && (
            <AiPane pane={aiPane} hidden={column !== 'ai'}>
              <DesignerAi
                ai={ai}
                draft={draft}
                selection={selection}
                selectionName={nameOf(selection) ?? null}
                element={
                  picking.element
                    ? { element: picking.element.element, part: picking.element.part }
                    : null
                }
                elementName={
                  pickedElement ? pickLabel(pickedElement, design, backgroundPageOf(page)) : null
                }
                pageName={PAGE_NAMES[page]}
                update={update}
                onClearSelection={() => setSelection(null)}
                onCollapse={aiPane.collapse}
                gates={gates}
              />
            </AiPane>
          )}
          <main
            aria-label="Page being edited"
            className={cn(
              'flex min-h-0 min-w-0 flex-1 flex-col p-4 pb-3',
              !previewing && column !== 'page' && 'max-[1100px]:hidden'
            )}
          >
            <p role="status" className="sr-only">
              {said}
            </p>
            {!previewing && (
              <div className="mb-2 space-y-2 empty:hidden">
                <DraftNotices draft={draft} />
                {!draft.undoLabel && (
                  <ReturnVisitNote savedAt={editor.draftSavedAt} now={now} onDiscard={discard} />
                )}
              </div>
            )}
            {!previewing && <CanvasBar view={view} note={follow.note} onBack={follow.back} />}
            {caption && !previewing && (
              <p className="pb-2 text-center text-xs text-muted-foreground">{caption}</p>
            )}
            <ClientOnly>
              {page === 'post' && !postPath ? (
                <p className="p-6 text-[13px] text-muted-foreground">
                  {noPost ? 'There are no posts to show yet.' : 'Finding a post…'}
                </p>
              ) : (
                <DesignerCanvas
                  page={page}
                  postPath={view.here.item}
                  visitor={view.visitor}
                  sample={view.sample}
                  onLocation={follow.onLocation}
                  size={size}
                  theme={design.mode === 'auto' ? theme : design.mode}
                  locale={locale}
                  sort={design.pages.feedback.defaultSort}
                  refreshKey={`${draft.published?.number ?? 0}`}
                  design={canvasDesign}
                  structural={structural}
                  zoom={previewing ? 'fit' : canvas.zoom}
                  trying={previewing}
                  onSelect={(section, link, target) => {
                    menu.dismiss()
                    setPageClosed(false)
                    picking.select(section, link, target)
                  }}
                  onFollow={(link) => {
                    const at = locationOfPath(link, design.nav.home.on)
                    if (at && pages.includes(at.page)) setPage(at.page, at.item)
                  }}
                  onHover={picking.hover}
                  onMenu={(target, how, node) => {
                    menu.onMenu(target, how)
                    // A menu item, the logo or sign in is picked too, so its look can be set.
                    if (how === 'click' && node) picking.select('header', null, node)
                  }}
                  onMenuHover={menu.setHovered}
                  onWords={onWords}
                  onKey={(key) => (key === 'undo' ? undo() : redo())}
                  onEscape={() => {
                    if (previewing) leavePreview()
                    else if (!menu.dismiss()) stepBack()
                  }}
                  onLoad={picking.reload}
                  layer={(frame) =>
                    previewing ? null : (
                      <>
                        <CanvasLayer
                          canvas={frame}
                          hovered={picking.hovered}
                          picked={selection}
                          name={nameOf(selection) ?? null}
                          homeOn={design.nav.home.on}
                          pages={pages}
                          onPage={setPage}
                          onDuplicate={blocks.duplicateBlock}
                          onRemove={blocks.removeBlock}
                          onDeselect={stepBack}
                          grid={{ design, gates, update, begin: draft.begin, end: draft.end, say }}
                          elements={{
                            design,
                            page: backgroundPageOf(page),
                            hovered: picking.hoveredElement,
                            picked: picking.elementKey,
                            force: elementState,
                            onPick: picking.pickElement,
                            say,
                          }}
                        />
                        <WordsLayer canvas={frame} design={design} locale={locale} say={say} />
                        <MenuLayer
                          canvas={frame}
                          design={design}
                          gates={gates}
                          settings={view.settings}
                          update={update}
                          editing={menu}
                          headerHot={picking.hovered === 'header' || selection === 'header'}
                          coach={coach}
                          onSample={view.showSample}
                        />
                        <AddDropLayer canvas={frame} drag={addDrag} />
                      </>
                    )
                  }
                />
              )}
            </ClientOnly>
          </main>
          {!previewing && (
            <BuilderSettings
              hidden={column !== 'settings'}
              open={settingsOpen}
              shown={shown}
              route={route}
              panel={panel}
              selection={selection}
              page={page}
              pages={pages.length}
              nodes={nodes}
              design={design}
              update={update}
              gates={gates}
              locale={locale}
              phone={size === 'phone'}
              onPhone={(next) => canvas.setSize(next ? 'phone' : 'desktop')}
              checks={checks}
              logoUrl={logoUrl}
              cssWarnings={draft.report.css}
              menu={menu}
              pickedBlock={pickedBlock}
              onSelect={pick}
              onAdd={addBlock}
              drag={addDrag}
              onTheme={(more) => openTheme(more)}
              say={say}
              onOverride={jumpTo}
              onBlock={(id) => {
                if (page !== 'home' && pages.includes('home')) setPage('home')
                panel.close()
                pick(`block-${id}`)
              }}
              element={
                pickedElement && route.panel === 'element' ? (
                  <ElementPanel
                    key={elementPanelKey(pickedElement)}
                    pick={pickedElement}
                    page={page}
                    blockName={
                      pickedElement.section
                        ? (nameOf(pickedElement.section as Selection) ?? null)
                        : null
                    }
                    design={design}
                    update={update}
                    state={elementState}
                    onState={setElementState}
                    screen={size === 'phone' ? 'phone' : 'all'}
                    onScreen={(next) => canvas.setSize(next === 'phone' ? 'phone' : 'desktop')}
                    onUp={() => picking.pickElement(null)}
                    reach={pickReach.reach}
                    measure={pickReach.measure}
                    onJump={(place) => {
                      if (place.block) return pick(`block-${place.block}` as Selection)
                      const to =
                        place.page ?? (place.part ? partOf(design, place.part)?.pages[0] : null)
                      if (to && to !== page && pages.includes(to as DesignerPage))
                        setPage(to as DesignerPage)
                    }}
                  />
                ) : undefined
              }
            />
          )}
        </div>

        <AddDragCard drag={addDrag} />
        {publishing.dialogs}
        {dialogs.dialogs}
      </div>
    </MotionConfig>
  )
}
