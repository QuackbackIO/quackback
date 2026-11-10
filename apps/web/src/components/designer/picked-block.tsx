import { useState } from 'react'
import { ExclamationTriangleIcon } from '@heroicons/react/16/solid'
import { LinksOptions } from '@/components/admin/settings/appearance/home-section'
import type { useDesignDraft } from '@/components/admin/settings/appearance/use-design-draft'
import type { TiptapContent } from '@/lib/shared/db-types'
import { blockOf, sectionOf, type SectionType } from '@/lib/shared/design/blocks'
import { sectionTypeOf } from '@/lib/shared/design/builder-chrome'
import { settingLabel as labelOf } from '@/lib/shared/design/dispatch'
import type { StyleState, StyleElement } from '@/lib/shared/design/style-tokens'
import { blockPageOff, type HomeBlock } from '@/lib/shared/design/home'
import { PAGE_NAMES } from '@/lib/shared/design/names'
import type { PortalPageGates } from '@/lib/shared/design/paths'
import { blockKey, type DesignerPage, type Selection } from '@/lib/shared/design/outline'
import type { PortalDesign } from '@/lib/shared/design/schema'
import type { Screen } from '@/lib/shared/design/override-cascade'
import {
  LOOK_DEFAULTS,
  SECTION_ELEMENTS,
  elementsOf,
  lookOutliers,
  type LookScope,
} from './block-panel'
import { BlockIcon } from './block-icon'
import { BlockPanel, SourceList } from './block-settings-panel'
import type { Crumb } from './properties/properties-panel'
import { BlockLayout, BlockLook, BlockWords, ElementRows, LOOK_NAMES } from './block-sections'
import { dispatcher } from './dispatcher'
import { ElementPanel } from './element-panel'
import { RequestWords } from './feed-words'
import { PropertySection } from './properties/properties-panel'
import { ReachNote } from './properties/scope-line'
import { BLOCK_ACTIONS, BLOCK_SECTIONS, BLOCK_TONES, WORDS } from './properties/words'
import { useBlockActions } from './use-block-actions'
import type { FontSlot } from './element-style-section'
import { useBlockSources } from './use-block-sources'
import { FIND } from './find-rows'
import { PropertyRow } from './properties/properties-panel'

/** Changes the draft under a name, so undo says what it takes back. */
type NamedUpdate = (change: (draft: PortalDesign) => void, label?: string) => void

/** Every page's gates open, for a panel shown without them. */
const ALL_PAGES: PortalPageGates = {
  feedback: true,
  roadmap: true,
  changelog: true,
  help: true,
  support: true,
  status: true,
}

/**
 * The picked block's own panel, from the block registry: a Home block, or a
 * section of a portal page that a visitor would know as a block. A change is
 * checked against the design's schema before it reaches the draft; a refusal
 * is said aloud instead. A Home block's panel has its own actions (duplicate,
 * move up or down in reading order, remove), its Words, Content, Layout and
 * Look; a section's has its Content and the elements it draws. An element
 * picked from Look opens the element panel in place, with the block in its trail.
 */
/** What the Recently shipped row's button does, as a verb. */
export const SHOW_SHIPPED = 'Show shipped posts'

export function PickedBlock({
  selection,
  crumbs,
  design,
  update,
  locale,
  gates,
  phone = false,
  onPhone,
  checks = [],
  onSelect,
  onFonts,
  say,
}: {
  selection: Selection
  /** Where it is, from the route table; its own when not given. */
  crumbs?: readonly Crumb[]
  design: PortalDesign
  update: NamedUpdate
  locale: string
  /** Which pages exist; a block whose page is off says visitors do not see it. */
  gates?: PortalPageGates
  /** Whether the canvas shows a phone, where Home's blocks stack. */
  phone?: boolean
  /** Shows the canvas as a phone, or on every screen; without it, an element's phone values are hidden. */
  onPhone?: (phone: boolean) => void
  /** What the checks found in this block, said in its panel. */
  checks?: readonly string[]
  /** Picks another part, such as the copy a duplicate makes; without it, the block has no actions. */
  onSelect?: (selection: Selection | null) => void
  /** Opens the brand kit's fonts at a slot, from a heading's font row. */
  onFonts?: (slot: FontSlot) => void
  say: (words: string) => void
}) {
  const [element, setElement] = useState<StyleElement | null>(null)
  const [state, setState] = useState<StyleState>('base')
  // The canvas's own screen: phone values follow what the canvas shows.
  const screen: Screen = phone ? 'phone' : 'all'
  const [scope, setScope] = useState<LookScope>('every')
  const blocks = design.pages.home.blocks
  const dispatch = dispatcher(design, update)
  const nameOf = (key: Selection) => {
    const at = blocks.find((each, i) => blockKey(each, i) === key)
    return at ? blockOf(at.type)?.name : undefined
  }
  const actions = useBlockActions({
    draft: { design, update } as unknown as Pick<
      ReturnType<typeof useDesignDraft>,
      'design' | 'update'
    >,
    selection,
    setSelection: (next) => {
      setElement(null)
      onSelect?.(next)
    },
    nameOf,
    say,
    gates: gates ?? ALL_PAGES,
  })
  const picked = blocks.find((each, i) => blockKey(each, i) === selection)
  const sources = useBlockSources(picked?.type === 'roadmap' ? picked.roadmapId : null)
  const shipped = sources.shipped ?? []
  const found = checks.map((text) => (
    <p key={text} className="flex items-start gap-1.5 text-foreground">
      <ExclamationTriangleIcon
        className="mt-0.5 size-3.5 shrink-0 text-warning"
        aria-hidden="true"
      />
      {text}
    </p>
  ))
  const section = sectionTypeOf(selection)
  const pageOf = (type: string): DesignerPage =>
    (blockOf(type)?.pages[0] as DesignerPage | undefined) ?? 'home'

  if (element) {
    const type = section ?? picked?.type
    return (
      <ElementPanel
        key={`${selection}:${element}`}
        pick={{ element, part: null, section: selection, index: 0 }}
        page={type ? pageOf(type) : 'home'}
        blockName={(type && blockOf(type)?.name) || null}
        design={design}
        update={update}
        state={state}
        onState={setState}
        screen={screen}
        onScreen={onPhone ? (next) => onPhone(next === 'phone') : undefined}
        // A Home block's element opens at the block; a page section's, at every one of its kind.
        initialScope={section ? undefined : 'block'}
        onUp={() => setElement(null)}
        onFonts={onFonts}
        onJump={(place) => {
          if (place.block) onSelect?.(`block-${place.block}` as Selection)
        }}
      />
    )
  }

  if (section) {
    const block = sectionOf(design, section)
    const def = blockOf(section)!
    const page = pageOf(section)
    return (
      <BlockPanel
        key={selection}
        block={block}
        locale={locale}
        sources={sources}
        crumbs={crumbs ?? [{ label: PAGE_NAMES[page] }, { label: def.name }]}
        notes={found.length ? found : undefined}
        words={
          section === 'support.request' ? (
            <RequestWords design={design} update={update} locale={locale} />
          ) : undefined
        }
        look={
          <SectionLook
            section={section}
            name={def.name}
            // A post's parts are every post's.
            page={page === 'post' ? 'every post' : PAGE_NAMES[page]}
            onElement={setElement}
          />
        }
        onChange={(key, value) => {
          const done = dispatch(
            { op: 'section.set', type: section, key, value, locale },
            labelOf(section, key)
          )
          if (!done.ok) say(done.refusal)
        }}
      />
    )
  }
  const index = blocks.findIndex((each, i) => blockKey(each, i) === selection)
  const block = blocks[index]
  if (!block) return null
  const def = blockOf(block.type)!
  const name = def.name
  const off = gates ? blockPageOff(block.type, gates) : null
  const offNote = off ? (
    <p>{`Visitors don’t see this block while the ${PAGE_NAMES[off]} page is off.`}</p>
  ) : null
  const set = (key: string, value: unknown, label = labelOf(block.type, key)) => {
    const done = dispatch({ op: 'block.set', block: index, key, value, locale }, label)
    if (!done.ok) say(done.refusal)
  }
  const owned = block.id ? (block as HomeBlock & { id: string }) : null
  const roadmap =
    block.type === 'roadmap' && block.roadmapId
      ? sources.roadmaps?.find(([id]) => id === block.roadmapId)?.[1]
      : undefined
  const outliers = owned && scope === 'every' ? lookOutliers(design, owned.id) : []
  const lookName = (id: string) => {
    const other = blocks.find((each) => each.id === id)
    return other ? (blockOf(other.type)?.name ?? WORDS.thisBlock) : WORDS.thisBlock
  }
  const notes = found.length || offNote ? [offNote, ...found] : undefined
  return (
    <BlockPanel
      key={selection}
      block={block}
      locale={locale}
      sources={sources}
      crumbs={crumbs ?? [{ label: PAGE_NAMES.home }, { label: name }]}
      icon={<BlockIcon type={block.type} className="size-4" />}
      actions={
        onSelect
          ? [
              {
                label: BLOCK_ACTIONS.duplicate,
                keys: 'Ctrl+D',
                onSelect: () => actions.duplicateBlock(selection),
              },
              {
                label: BLOCK_ACTIONS.moveUp,
                disabled: index <= 0,
                onSelect: () => actions.moveBlock(selection, -1),
              },
              {
                label: BLOCK_ACTIONS.moveDown,
                disabled: index >= blocks.length - 1,
                onSelect: () => actions.moveBlock(selection, 1),
              },
              {
                label: BLOCK_ACTIONS.remove,
                keys: 'Delete',
                onSelect: () => actions.removeBlock(selection),
              },
            ]
          : undefined
      }
      notes={notes}
      words={
        owned && (
          <BlockWords
            block={owned}
            locale={locale}
            roadmap={roadmap}
            onChange={set}
            onBody={(body: TiptapContent) => set('body', body)}
          />
        )
      }
      layout={
        owned && (
          <BlockLayout
            design={design}
            gates={gates ?? ALL_PAGES}
            block={owned}
            name={name}
            phone={phone}
            update={update}
            say={say}
          />
        )
      }
      look={
        owned && (
          <BlockLook
            design={design}
            block={owned}
            name={name}
            scope={scope}
            onScope={setScope}
            update={update}
            elements={elementsOf(block.type)}
            onElement={setElement}
          />
        )
      }
      overrides={outliers.map((place) => ({
        key: place.id,
        label: lookName(place.id),
        detail: place.props
          .map((prop) => {
            const other = blocks.find((each) => each.id === place.id)
            const value = other?.look?.[prop] ?? LOOK_DEFAULTS[prop]
            return `${LOOK_NAMES[prop]} ${prop === 'tone' ? BLOCK_TONES[value as keyof typeof BLOCK_TONES] : value}`
          })
          .join(', '),
        onReset: () =>
          dispatch(
            { op: 'block.matchLook', id: place.id, to: owned!.id },
            `${lookName(place.id)}: ${WORDS.reset.toLowerCase()}`
          ),
        onGo: onSelect ? () => onSelect(`block-${place.id}` as Selection) : undefined,
      }))}
      onChange={set}
      renderField={(field) => {
        if (field.kind === 'links' && block.type === 'links')
          return (
            <LinksOptions
              key={selection}
              block={block}
              withHeading={false}
              change={(apply) => {
                // The links edit a copy of the block; its links are set as any setting is.
                const edited = structuredClone(block)
                apply(edited)
                set('links', edited.links)
              }}
            />
          )
        if (field.key === 'statusIds' && block.type === 'ideas')
          return (
            <>
              <SourceList
                field={field as Extract<typeof field, { kind: 'source' }>}
                value={block.statusIds}
                sources={sources}
                onChange={(value) => set('statusIds', value)}
              />
              <PropertyRow label={FIND.recentlyShipped.label} find={FIND.recentlyShipped.id}>
                {shipped.length === 0 ? (
                  <span className="text-xs text-muted-foreground">
                    No statuses in the Complete category yet
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      // The shipped statuses, newest first, as one step.
                      const done = dispatch(
                        {
                          op: 'block.setEach',
                          block: index,
                          settings: { statusIds: shipped.slice(0, 12), sort: 'new' },
                        },
                        `${name}: ${FIND.recentlyShipped.label.toLowerCase()}`
                      )
                      if (!done.ok) say(done.refusal)
                    }}
                    className="inline-flex h-6 items-center rounded-md border border-border px-2 text-xs hover:bg-muted focus-visible:ring-2 focus-visible:ring-muted-foreground focus-visible:outline-none"
                  >
                    {SHOW_SHIPPED}
                  </button>
                )}
              </PropertyRow>
            </>
          )
        return field.kind === 'links' ? null : undefined
      }}
    />
  )
}

/**
 * A page section's look: it is the product's own interface, so it holds
 * only what it reaches and the elements it draws, each opened in the element panel.
 */
function SectionLook({
  section,
  name,
  page,
  onElement,
}: {
  section: SectionType
  name: string
  page: string
  onElement: (element: StyleElement) => void
}) {
  return (
    <PropertySection title={BLOCK_SECTIONS.look}>
      <ReachNote className="pb-1.5" phrase={`${name} on ${page}`} />
      <ElementRows offered={SECTION_ELEMENTS[section]} onElement={onElement} />
    </PropertySection>
  )
}
