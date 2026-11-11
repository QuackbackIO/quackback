/**
 * A Home block panel's own sections, on the properties frame: its Words (the
 * words it draws, shown and opened on the canvas, never retyped here), its
 * Layout (its place and size on Home's grid) and its Look (background,
 * colour and alignment, shared by every Home block unless this one is set
 * apart, and the elements it draws, opened in the element panel).
 */
import { useId, useMemo, useState } from 'react'
import { ArrowDownIcon, ArrowUpIcon, PlusIcon } from '@heroicons/react/16/solid'
import { WelcomeBodyEditor } from '@/components/admin/settings/branding/welcome-body-editor'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { TiptapContent } from '@/lib/shared/db-types'
import { blockOf, type SettingField } from '@/lib/shared/design/blocks'
import { hiddenOnPhones } from '@/lib/shared/design/block-look'
import { movedWords, resizedWords, type GridChange } from '@/lib/shared/design/grid-edit'
import type { HomeBlock } from '@/lib/shared/design/home'
import { homeGridItems } from '@/lib/shared/design/home'
import { MAX_ROWS, GRID_COLUMNS, settle } from '@/lib/shared/design/home-grid'
import { inLanguage } from '@/lib/shared/design/labels'
import type { PortalPageGates } from '@/lib/shared/design/paths'
import { docText, type WordsDoc } from '@/lib/shared/design/rich-words'
import type { PortalDesign } from '@/lib/shared/design/schema'
import { STYLE_ELEMENTS, type StyleElement } from '@/lib/shared/design/style-tokens'
import { isValidWords } from '@/lib/shared/design/words-schema'
import { cn } from '@/lib/shared/utils'
import {
  CONTACT_USUAL,
  LOOK_DEFAULTS,
  sharedLook,
  takesLook,
  usualWords,
  widthTiles,
  type LookProp,
  type LookScope,
} from './block-panel'
import { dispatcher } from './dispatcher'
import { FIND } from './find-rows'
import { PropertyRow, PropertySection, PropertyTiles } from './properties/properties-panel'
import { ScopeLine } from './properties/scope-line'
import { ScrubNumber } from './properties/scrub-number'
import { TokenField } from './properties/token-field'
import { colourTokens } from './properties/tokens'
import { BLOCK_SECTIONS, BLOCK_TONES, BLOCK_WORDS, WORDS, resetTo } from './properties/words'
import { editOnCanvas } from './words/edit-on-canvas'
import { TextButton, textButton } from './text-button'

/** Changes the draft under a name, so undo says what it takes back. */
type NamedUpdate = (change: (draft: PortalDesign) => void, label?: string) => void

/** The words fields a block draws: its heading, and the words it keeps where they sit. */
export const wordsFieldsOf = (type: string): SettingField[] =>
  (blockOf(type)?.fields ?? []).filter(
    (field) =>
      field.kind === 'words' ||
      (field.kind === 'text' && (field.key === 'heading' || field.inPlace))
  )

/**
 * The words a Home block draws, a row each: what it says (its usual words in
 * grey while it has none of its own), and Edit, which opens them on the
 * canvas. Its own words carry a dot and Reset; a block that draws no heading
 * offers to add one. A Welcome message holding more than the canvas edits,
 * such as images or tables, opens its full editor here.
 */
export function BlockWords({
  block,
  locale,
  roadmap,
  onChange,
  onBody,
}: {
  block: HomeBlock & { id: string }
  locale: string
  /** The name of the roadmap a Roadmap block shows, which is its usual heading. */
  roadmap?: string
  /** Sets one of its words in the language shown; empty gives the usual words back. */
  onChange: (key: string, value: string) => void
  /** Replaces a Welcome message in full, from its full editor. */
  onBody: (body: TiptapContent) => void
}) {
  const [full, setFull] = useState(false)
  const fields = wordsFieldsOf(block.type)
  if (!fields.length) return null
  const usual = usualWords(block, { roadmap })
  const values = block as Record<string, unknown>
  const at = (key: string) => `block-${block.id}.${key}`
  const rows = fields.map((field) => {
    if (field.kind === 'words') {
      const body = values[field.key] as WordsDoc | undefined
      const label = BLOCK_WORDS.message
      if (body && !isValidWords(body, 'rich'))
        return (
          <PropertyRow key={field.key} label={label}>
            <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
              {BLOCK_WORDS.holdsMore}
            </span>
            <TextButton onClick={() => setFull(true)}>{BLOCK_WORDS.editHere}</TextButton>
          </PropertyRow>
        )
      const text = docText(body)
      return (
        <WordsRow
          key={field.key}
          label={label}
          text={text || null}
          usual={null}
          set={false}
          onEdit={() => editOnCanvas(at(field.key))}
        />
      )
    }
    const words = (values[field.key] as Record<string, string> | undefined) ?? {}
    const own = words[locale]
    const others = Object.entries(words)
      .filter(([other, text]) => other !== locale && text)
      .map(([, text]) => text)
    const usualText =
      field.key === 'heading' ? usual.heading : field.key === 'link' ? usual.link : CONTACT_USUAL
    return (
      <WordsRow
        key={field.key}
        label={inLanguage(field.label, locale)}
        text={own || null}
        usual={usualText}
        set={!!own}
        others={others}
        resetLabel={usualText ? `${WORDS.reset} to “${usualText}”` : undefined}
        onReset={() => onChange(field.key, '')}
        onEdit={() => editOnCanvas(at(field.key))}
        onAdd={
          field.key === 'heading' && usualText === null
            ? () => {
                onChange(field.key, blockOf(block.type)!.name)
                editOnCanvas(at(field.key))
              }
            : undefined
        }
      />
    )
  })
  return (
    <PropertySection title={BLOCK_SECTIONS.words}>
      {rows}
      {block.type === 'welcome' && (
        <Dialog open={full} onOpenChange={setFull}>
          <DialogContent className="max-w-2xl">
            <DialogTitle>{BLOCK_WORDS.message}</DialogTitle>
            <WelcomeBodyEditor value={(block as { body: TiptapContent }).body} onChange={onBody} />
          </DialogContent>
        </Dialog>
      )}
    </PropertySection>
  )
}

/** One of a block's words: what it says, read only, with Edit on the canvas. */
export function WordsRow({
  label,
  find,
  text,
  usual,
  set,
  others = [],
  resetLabel,
  onReset,
  onEdit,
  onAdd,
}: {
  label: string
  /** Its stable name, which quick find shares. */
  find?: string
  /** Its own words, or null. */
  text: string | null
  /** What the page draws without them; null where it draws nothing. */
  usual: string | null
  set: boolean
  /** The same words in other languages, on hover. */
  others?: readonly string[]
  resetLabel?: string
  onReset?: () => void
  onEdit: () => void
  /** Offered where the block draws none: adds them on the canvas. */
  onAdd?: () => void
}) {
  const shown = text ?? usual
  return (
    <PropertyRow label={label} find={find} set={set} resetLabel={resetLabel} onReset={onReset}>
      <span
        data-words-row=""
        title={others.length ? others.join(' · ') : undefined}
        onDoubleClick={shown ? onEdit : undefined}
        className={cn(
          'min-w-0 flex-1 truncate text-xs',
          !text && 'text-muted-foreground',
          !text && usual && 'italic'
        )}
      >
        {shown ?? BLOCK_WORDS.none}
      </span>
      {onAdd && !shown ? (
        <button
          type="button"
          className={textButton({ className: 'flex items-center gap-0.5' })}
          aria-label={`${BLOCK_WORDS.add} ${label.toLowerCase()}`}
          onClick={onAdd}
        >
          <PlusIcon className="size-3" aria-hidden="true" />
          {BLOCK_WORDS.add}
        </button>
      ) : (
        <button
          type="button"
          className={textButton()}
          aria-label={`${BLOCK_WORDS.edit} ${label.toLowerCase()}`}
          onClick={onEdit}
        >
          {BLOCK_WORDS.edit}
        </button>
      )}
    </PropertyRow>
  )
}

/**
 * A Home block's place and size on the grid, as the page lays it out: width
 * tiles (none narrower than the block can be) and its column, row and height
 * to drag or step. A place is always the block's own, so nothing here has a
 * Reset. On a phone the blocks stack, and it says so instead.
 */
export function BlockLayout({
  design,
  gates,
  block,
  name,
  phone,
  update,
  say,
}: {
  design: PortalDesign
  gates: PortalPageGates
  block: HomeBlock & { id: string }
  name: string
  phone: boolean
  update: NamedUpdate
  say: (words: string) => void
}) {
  const id = useId()
  const def = blockOf(block.type)
  const place = useMemo(
    () => settle(homeGridItems(design.pages.home, gates)).find((item) => item.id === block.id),
    [design, gates, block.id]
  )
  if (!def?.grid || !place) return null
  if (phone) {
    const shown = !hiddenOnPhones(block)
    return (
      <PropertySection title={BLOCK_SECTIONS.layout}>
        <PropertyRow label={BLOCK_WORDS.showOnPhones} htmlFor={`${id}-phone`}>
          <Switch
            id={`${id}-phone`}
            checked={shown}
            className="ms-auto"
            onCheckedChange={(next) =>
              dispatcher(design, update)(
                { op: 'block.phoneHidden', id: block.id, hidden: !next },
                `${name}: ${BLOCK_WORDS.showOnPhones.toLowerCase()}`
              )
            }
          />
        </PropertyRow>
        {shown && <p className="py-1 text-xs text-muted-foreground">{BLOCK_WORDS.stacks}</p>}
      </PropertySection>
    )
  }
  const change = (what: string, grid: GridChange) => {
    const same =
      'move' in grid
        ? grid.move.x === place.x && grid.move.y === place.y
        : 'size' in grid && grid.size.w === place.w && grid.size.h === place.h
    if (same) return
    const done = dispatcher(design, update)(
      { op: 'block.grid', id: block.id, change: grid, gates },
      `${name}: ${what}`
    )
    if (done.ok && done.place) say(('size' in grid ? resizedWords : movedWords)(name, done.place))
  }
  const width = String(place.w)
  const tiles = widthTiles(def.grid.minW)
  // Fit is the least height, which rows grow from to fit what is in it; Taller, the block's usual or a row more.
  const fit = def.grid.minH
  const taller = Math.max(def.grid.h, fit + 1)
  const height = place.h === fit ? 'fit' : place.h === taller ? 'taller' : undefined
  const step = (by: -1 | 1) =>
    change(by < 0 ? BLOCK_WORDS.moveUp.toLowerCase() : BLOCK_WORDS.moveDown.toLowerCase(), {
      move: { x: place.x, y: place.y + by },
    })
  return (
    <PropertySection
      title={BLOCK_SECTIONS.layout}
      more={
        <>
          <PropertyRow label={BLOCK_WORDS.column} htmlFor={`${id}-x`}>
            <ScrubNumber
              id={`${id}-x`}
              label={BLOCK_WORDS.column}
              value={place.x + 1}
              min={1}
              max={GRID_COLUMNS - place.w + 1}
              onChange={(x) =>
                x !== undefined &&
                change(BLOCK_WORDS.column.toLowerCase(), { move: { x: x - 1, y: place.y } })
              }
            />
          </PropertyRow>
          <PropertyRow label={BLOCK_WORDS.row} htmlFor={`${id}-y`}>
            <ScrubNumber
              id={`${id}-y`}
              label={BLOCK_WORDS.row}
              value={place.y + 1}
              min={1}
              max={999}
              onChange={(y) =>
                y !== undefined &&
                change(BLOCK_WORDS.row.toLowerCase(), { move: { x: place.x, y: y - 1 } })
              }
            />
          </PropertyRow>
          <PropertyRow label={BLOCK_WORDS.rows} htmlFor={`${id}-h`}>
            <ScrubNumber
              id={`${id}-h`}
              label={BLOCK_WORDS.rows}
              value={place.h}
              min={def.grid.minH}
              max={MAX_ROWS}
              unit={place.h === 1 ? 'row' : 'rows'}
              onChange={(h) =>
                h !== undefined &&
                change(BLOCK_WORDS.height.toLowerCase(), { size: { w: place.w, h } })
              }
            />
          </PropertyRow>
        </>
      }
    >
      <PropertyRow label={FIND.blockWidth.label} find={FIND.blockWidth.id}>
        <PropertyTiles
          label={BLOCK_WORDS.width}
          value={tiles.some(([w]) => w === width) ? width : undefined}
          options={tiles}
          onChange={(w) =>
            change(BLOCK_WORDS.width.toLowerCase(), { size: { w: Number(w), h: place.h } })
          }
        />
      </PropertyRow>
      <PropertyRow label={BLOCK_WORDS.height}>
        <PropertyTiles
          label={BLOCK_WORDS.height}
          value={height}
          options={[
            ['fit', BLOCK_WORDS.fit],
            ['taller', BLOCK_WORDS.taller],
          ]}
          onChange={(next) =>
            change(BLOCK_WORDS.height.toLowerCase(), {
              size: { w: place.w, h: next === 'fit' ? fit : taller },
            })
          }
        />
      </PropertyRow>
      <PropertyRow label={BLOCK_WORDS.move}>
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon-sm"
            className="size-7"
            aria-label={BLOCK_WORDS.moveUp}
            disabled={place.y === 0}
            onClick={() => step(-1)}
          >
            <ArrowUpIcon className="size-3.5" aria-hidden="true" />
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            className="size-7"
            aria-label={BLOCK_WORDS.moveDown}
            onClick={() => step(1)}
          >
            <ArrowDownIcon className="size-3.5" aria-hidden="true" />
          </Button>
        </div>
      </PropertyRow>
    </PropertySection>
  )
}

/** The shared scope of a Home block's look, Home being the page's name. */
const EVERY_HOME_BLOCK = 'every Home block'

/** The colour roles a tint or a brand-colour background can be drawn in. */
const LOOK_ROLES = ['accent', 'support', 'extra1', 'extra2'] as const

/** What a look field reads as in the panel: "background", "align". */
export const LOOK_NAMES: Record<LookProp, string> = {
  tone: BLOCK_WORDS.background.toLowerCase(),
  colour: BLOCK_WORDS.colour.toLowerCase(),
  align: BLOCK_WORDS.align.toLowerCase(),
}

/**
 * A Home block's look: the scope line (every Home block, by default, or just
 * this one), its background, the colour a tint or brand background is drawn
 * in, and its alignment; then "+ Element", listing only the elements the
 * block draws, and a row for each element this block sets its own look for.
 */
export function BlockLook({
  design,
  block,
  name,
  scope,
  onScope,
  update,
  elements,
  onElement,
}: {
  design: PortalDesign
  block: HomeBlock & { id: string }
  name: string
  scope: LookScope
  onScope: (scope: LookScope) => void
  update: NamedUpdate
  /** The elements the block draws, which "+ Element" offers. */
  elements: readonly StyleElement[]
  /** Opens an element's look, in the element panel. */
  onElement: (element: StyleElement) => void
}) {
  const id = useId()
  const tokens = useMemo(() => colourTokens(design, LOOK_ROLES), [design])
  const blocks = design.pages.home.blocks.filter(takesLook)
  const own = (prop: LookProp) => block.look?.[prop]
  const shared = (prop: LookProp) => sharedLook(design, block.id, prop)
  const inherited = (prop: LookProp) =>
    (scope === 'one' ? shared(prop) : undefined) ?? LOOK_DEFAULTS[prop]
  const isSet = (prop: LookProp) =>
    scope === 'one'
      ? own(prop) !== undefined && own(prop) !== shared(prop)
      : own(prop) !== undefined
  const where = scope === 'one' ? 'just this one' : EVERY_HOME_BLOCK
  const dispatch = dispatcher(design, update)
  const write = (prop: LookProp, value: string | undefined) =>
    dispatch(
      { op: 'block.look', id: block.id, scope, prop, value },
      `${name}: ${LOOK_NAMES[prop]}, ${where}`
    )
  const reset = (prop: LookProp) =>
    dispatch(
      { op: 'block.lookReset', id: block.id, scope, prop },
      `${name}: ${LOOK_NAMES[prop]}, ${where}`
    )
  const fromWhere = scope === 'one' ? `From ${EVERY_HOME_BLOCK}` : undefined
  const resetLabel = (prop: LookProp, names: Record<string, string>) => {
    const back = scope === 'one' ? (shared(prop) ?? LOOK_DEFAULTS[prop]) : LOOK_DEFAULTS[prop]
    const named = names[back] ?? back
    return fromWhere ? resetTo(named, fromWhere) : `${WORDS.reset} to ${named}`
  }
  const tone = own('tone') ?? inherited('tone')
  const style = (block.look?.style ?? {}) as Partial<Record<StyleElement, Record<string, object>>>
  const styled = elements.filter((el) => Object.keys(style[el] ?? {}).length > 0)
  const count = (el: StyleElement) =>
    Object.values(style[el] ?? {}).reduce((n, props) => n + Object.keys(props ?? {}).length, 0)
  const offered = elements.filter((el) => !styled.includes(el))
  const roleNames = Object.fromEntries(tokens.map((t) => [t.id, t.name]))

  return (
    <PropertySection title={BLOCK_SECTIONS.look}>
      <ScopeLine
        className="pb-1.5"
        one={BLOCK_WORDS.homeBlock}
        widest={{ id: 'every', phrase: EVERY_HOME_BLOCK, count: blocks.length }}
        narrower={[
          {
            id: 'one',
            link: WORDS.justThisOne,
            phrase: WORDS.justThisOne.toLowerCase(),
            detail: name,
          },
        ]}
        value={scope}
        onChange={onScope}
      />
      <PropertyRow
        label={FIND.blockBackground.label}
        find={FIND.blockBackground.id}
        set={isSet('tone')}
        source={fromWhere}
        resetLabel={resetLabel('tone', BLOCK_TONES)}
        onReset={() => reset('tone')}
      >
        <PropertyTiles
          id={`${id}-tone`}
          label={BLOCK_WORDS.background}
          value={own('tone')}
          inherited={inherited('tone') as keyof typeof BLOCK_TONES}
          options={Object.entries(BLOCK_TONES) as Array<[keyof typeof BLOCK_TONES, string]>}
          onChange={(value) => write('tone', value)}
        />
      </PropertyRow>
      {(tone === 'tint' || tone === 'brand') && (
        <PropertyRow
          label={BLOCK_WORDS.colour}
          set={isSet('colour')}
          source={fromWhere}
          resetLabel={resetLabel('colour', roleNames)}
          onReset={() => reset('colour')}
        >
          <TokenField
            id={`${id}-colour`}
            label={BLOCK_WORDS.colour}
            value={own('colour')}
            inherited={inherited('colour')}
            tokens={tokens}
            onChange={(value) => {
              // A block's colour is one of the brand's roles, never an exact colour.
              if (value === undefined || (LOOK_ROLES as readonly string[]).includes(value))
                write('colour', value)
            }}
          />
        </PropertyRow>
      )}
      <PropertyRow
        label={BLOCK_WORDS.align}
        set={isSet('align')}
        source={fromWhere}
        resetLabel={resetLabel('align', {
          start: WORDS.alignment.start,
          centre: WORDS.alignment.centre,
        })}
        onReset={() => reset('align')}
      >
        <PropertyTiles
          id={`${id}-align`}
          label={BLOCK_WORDS.align}
          value={own('align')}
          inherited={inherited('align') as 'start' | 'centre'}
          options={[
            ['start', WORDS.alignment.start],
            ['centre', WORDS.alignment.centre],
          ]}
          onChange={(value) => write('align', value)}
        />
      </PropertyRow>
      <ElementRows
        elements={styled}
        offered={offered}
        count={count}
        onElement={onElement}
        onReset={(el) =>
          dispatch(
            { op: 'block.styleReset', id: block.id, element: el },
            `${name}: ${STYLE_ELEMENTS[el].label.toLowerCase()}, just this one`
          )
        }
      />
    </PropertySection>
  )
}

/**
 * The elements a block sets its own look for, each opening the element
 * panel, and "+ Element" for the rest it draws.
 */
export function ElementRows({
  elements = [],
  offered,
  count,
  onElement,
  onReset,
}: {
  elements?: readonly StyleElement[]
  offered: readonly StyleElement[]
  count?: (element: StyleElement) => number
  onElement: (element: StyleElement) => void
  onReset?: (element: StyleElement) => void
}) {
  return (
    <>
      {elements.map((el) => (
        <PropertyRow
          key={el}
          label={STYLE_ELEMENTS[el].label}
          set
          resetLabel={`${WORDS.reset} ${STYLE_ELEMENTS[el].label.toLowerCase()}`}
          onReset={onReset ? () => onReset(el) : undefined}
        >
          <button
            type="button"
            className="min-w-0 flex-1 truncate rounded text-start text-xs hover:underline focus-ring"
            onClick={() => onElement(el)}
          >
            {`${count?.(el) ?? 0} set`}
          </button>
        </PropertyRow>
      ))}
      {offered.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="xs" className="-ms-2 gap-1 text-muted-foreground">
              <PlusIcon className="size-3.5" aria-hidden="true" />
              {BLOCK_WORDS.element}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-52">
            {offered.map((el) => (
              <DropdownMenuItem key={el} className="text-ui" onClick={() => onElement(el)}>
                {STYLE_ELEMENTS[el].label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </>
  )
}
