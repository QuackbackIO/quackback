import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'
import { Toolbar } from '@base-ui/react/toolbar'
import {
  ArrowDownIcon,
  ArrowUpIcon,
  DocumentDuplicateIcon,
  TrashIcon,
} from '@heroicons/react/16/solid'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import { BLOCK_ACTIONS } from './properties/words'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { chipPlacement, outlineBox, type Rect } from '@/lib/shared/design/layer-geometry'

/** The picked block's outline and chip: blue, edged in white, so it reads on any brand colour. */
const PICKED = '#2563eb'

/** What changed, outlined: neutral grey, never the brand's colour or the pick's blue. */
const CHANGED = '#71717a'

/** A chip size to place it by until it has been measured. */
const CHIP_GUESS = { width: 220, height: 28 }

/** How the outline and chip glide from one pick to the next. */
const GLIDE = 'left 160ms ease-out, top 160ms ease-out, width 160ms ease-out, height 160ms ease-out'

/**
 * Whether the picked outline is gliding to a new pick: true for a moment
 * after the pick changes, so it moves smoothly between picks yet follows
 * scrolling and dragging exactly.
 */
export function useGlide(key: string | null | undefined, ms = 200): boolean {
  const [gliding, setGliding] = useState(false)
  const last = useRef(key)
  useEffect(() => {
    const before = last.current
    last.current = key
    if (!before || !key || before === key) return
    setGliding(true)
    const timer = setTimeout(() => setGliding(false), ms)
    return () => clearTimeout(timer)
  }, [key, ms])
  return gliding
}

/** Six dots: the handle a block is dragged by. */
function GripIcon() {
  return (
    <svg viewBox="0 0 16 16" className="size-3.5" aria-hidden="true" fill="currentColor">
      {[5, 11].map((x) =>
        [3.5, 8, 12.5].map((y) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.25" />)
      )}
    </svg>
  )
}

const BUTTON =
  'inline-flex h-6 shrink-0 items-center gap-1 rounded-md px-1.5 text-xs font-medium text-white ' +
  'hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-300 ' +
  'data-[disabled]:cursor-default data-[disabled]:opacity-50 data-[disabled]:hover:bg-transparent'

function ChipButton({
  label,
  tip,
  disabled,
  onClick,
  children,
  ...rest
}: {
  label: string
  tip: string
  disabled?: boolean
  onClick?: () => void
  onPointerDown?: (event: ReactPointerEvent) => void
  onKeyDown?: (event: ReactKeyboardEvent) => void
  className?: string
  children: ReactNode
} & Record<`data-${string}` | `aria-${string}`, string | undefined>) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Toolbar.Button
          aria-label={label}
          className={BUTTON}
          disabled={disabled}
          onClick={onClick}
          {...rest}
        >
          {children}
        </Toolbar.Button>
      </TooltipTrigger>
      <TooltipContent side="top">{tip}</TooltipContent>
    </Tooltip>
  )
}

/**
 * What the builder draws over the canvas: a quiet outline on the block under
 * the pointer, and on the picked block an outline and a chip on its top edge
 * (inside it when there is no room above) with its grip, its name and
 * Remove; right-clicking the chip, or the block on the page, opens the
 * block's actions, as its ⋯ does. Open belongs to
 * the link or item it opens, on that element's own chip. The page under it
 * still takes the pointer; only the chip does not let it through.
 */
export function EditingLayer({
  room,
  hovered,
  picked,
  pickedKey,
  avoid,
  name,
  onDuplicate,
  onRemove,
  onMove,
  onSettings,
  onDown,
  grip,
  children,
  changed = null,
}: {
  /** The canvas's visible size on the layer. */
  room: { width: number; height: number }
  hovered: Rect | null
  picked: Rect | null
  /** Which block is picked, so the outline and chip glide to a new pick. */
  pickedKey?: string | null
  /** What the chip keeps clear of beside something small, such as the menu's items. */
  avoid?: readonly Rect[]
  /** The picked block's name. */
  name: string | null
  /** Copies or removes the picked block; absent for parts of a page that cannot be. */
  onDuplicate?: () => void
  onRemove?: () => void
  /** Moves the picked block a place up or down; null where it cannot go further. */
  onMove?: { up: (() => void) | null; down: (() => void) | null }
  /** Leads to the picked block's settings. */
  onSettings: () => void
  /** Goes down from the block to its first element (Down arrow on its name). */
  onDown?: () => void
  /**
   * The picked block's grip, for a block on Home's grid: dragged, it moves
   * the block; focused, the arrow keys move it and Shift and the arrows resize it.
   */
  grip?: {
    onPointerDown: (event: ReactPointerEvent) => void
    onKeyDown: (event: ReactKeyboardEvent) => void
  }
  /** More for the layer to draw, such as a block's resize handles. */
  children?: ReactNode
  /** What a change touched, outlined for a moment; `seq` starts each outline afresh. */
  changed?: { rects: Rect[]; seq: number } | null
}) {
  const chip = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState(CHIP_GUESS)
  useLayoutEffect(() => {
    const element = chip.current
    if (!element) return
    const next = { width: element.offsetWidth, height: element.offsetHeight }
    if (next.width && (next.width !== size.width || next.height !== size.height)) setSize(next)
  })
  const place = picked && name ? chipPlacement(picked, size, room, avoid) : null
  const glide = useGlide(pickedKey) ? GLIDE : undefined
  return (
    <div data-editing-layer="" className="pointer-events-none absolute inset-0 overflow-hidden">
      {hovered && (
        <div
          data-hover-outline=""
          aria-hidden="true"
          className="absolute rounded-[3px]"
          style={{ ...outlineBox(hovered, 1, room), outline: `1px solid ${PICKED}66` }}
        />
      )}
      {picked && (
        <div
          data-picked-outline=""
          aria-hidden="true"
          className="absolute rounded-[3px]"
          style={{
            ...outlineBox(picked, 2, room),
            outline: `2px solid ${PICKED}`,
            boxShadow: '0 0 0 1px #fff, inset 0 0 0 1px #fff',
            transition: glide,
          }}
        />
      )}
      {changed?.rects.map((rect, at) => (
        <ChangeOutline key={`${changed.seq}-${at}`} rect={rect} room={room} />
      ))}
      {children}
      {place && name && (
        <ChipMenu name={name} onDuplicate={onDuplicate} onRemove={onRemove} onMove={onMove}>
          <Toolbar.Root
            ref={chip}
            aria-label={`${name}, picked`}
            data-chip-for={pickedKey ?? undefined}
            data-chip-inside={place.inside ? '' : undefined}
            // Words edited on the page take the chip's place for their format bar.
            className="pointer-events-auto absolute flex items-center gap-px rounded-lg p-0.5 shadow-md [[data-words-editing]_&]:hidden"
            style={{ left: place.left, top: place.top, background: PICKED, transition: glide }}
          >
            {grip && (
              <ChipButton
                label={`Move ${name}`}
                tip="Drag to move. Arrow keys move it, Shift and arrow keys resize it"
                data-drag-handle=""
                aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight Shift+ArrowUp Shift+ArrowDown Shift+ArrowLeft Shift+ArrowRight"
                className={`${BUTTON} cursor-grab touch-none active:cursor-grabbing`}
                onPointerDown={grip.onPointerDown}
                onKeyDown={grip.onKeyDown}
              >
                <GripIcon />
              </ChipButton>
            )}
            <ChipButton
              label={`${name}: settings`}
              tip={
                onDown
                  ? 'Its settings are on the right. Down arrow picks what is in it'
                  : 'Its settings are on the right'
              }
              onClick={onSettings}
              data-chip-name=""
              onKeyDown={
                onDown
                  ? (event) => {
                      if (event.key !== 'ArrowDown') return
                      event.preventDefault()
                      onDown()
                    }
                  : undefined
              }
            >
              <span className="max-w-48 truncate">{name}</span>
            </ChipButton>
            {onRemove && (
              <>
                <Toolbar.Separator className="mx-0.5 h-3.5 w-px bg-white/40" />
                <ChipButton label={`Remove ${name}`} tip="Remove" onClick={onRemove}>
                  <TrashIcon className="size-3.5" aria-hidden="true" />
                </ChipButton>
              </>
            )}
          </Toolbar.Root>
        </ChipMenu>
      )}
    </div>
  )
}

/**
 * One thing a change touched, outlined in grey, edged in white so it reads on
 * any colour. It fades once shown; with less motion asked for, it stays still
 * until the canvas takes it away.
 */
function ChangeOutline({ rect, room }: { rect: Rect; room: { width: number; height: number } }) {
  const [fading, setFading] = useState(false)
  useEffect(() => {
    const frame = requestAnimationFrame(() => setFading(true))
    return () => cancelAnimationFrame(frame)
  }, [])
  return (
    <div
      data-change-outline=""
      aria-hidden="true"
      className={`absolute rounded-[3px] transition-opacity delay-500 duration-1000 ease-in motion-reduce:transition-none ${fading ? 'motion-safe:opacity-0' : 'opacity-100'}`}
      style={{
        ...outlineBox(rect, 2, room),
        outline: `2px solid ${CHANGED}`,
        boxShadow: '0 0 0 1px #fff, inset 0 0 0 1px #fff',
      }}
    />
  )
}

/** The picked block chip's right-click menu: the block's actions, as its ⋯ offers them. */
function ChipMenu({
  name,
  onDuplicate,
  onRemove,
  onMove,
  children,
}: {
  name: string
  onDuplicate?: () => void
  onRemove?: () => void
  onMove?: { up: (() => void) | null; down: (() => void) | null }
  children: ReactNode
}) {
  if (!onDuplicate) return children
  return (
    <ContextMenu>
      <ContextMenuTrigger className="contents">{children}</ContextMenuTrigger>
      <ContextMenuContent aria-label={`${name}: more`}>
        <ContextMenuItem onClick={onDuplicate}>
          <DocumentDuplicateIcon aria-hidden="true" />
          {BLOCK_ACTIONS.duplicate}
          <ContextMenuShortcut>Ctrl+D</ContextMenuShortcut>
        </ContextMenuItem>
        {onMove && (
          <>
            <ContextMenuItem disabled={!onMove.up} onClick={() => onMove.up?.()}>
              <ArrowUpIcon aria-hidden="true" />
              {BLOCK_ACTIONS.moveUp}
            </ContextMenuItem>
            <ContextMenuItem disabled={!onMove.down} onClick={() => onMove.down?.()}>
              <ArrowDownIcon aria-hidden="true" />
              {BLOCK_ACTIONS.moveDown}
            </ContextMenuItem>
          </>
        )}
        {onRemove && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem onClick={onRemove}>
              <TrashIcon aria-hidden="true" />
              {BLOCK_ACTIONS.remove}
              <ContextMenuShortcut>Delete</ContextMenuShortcut>
            </ContextMenuItem>
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  )
}
