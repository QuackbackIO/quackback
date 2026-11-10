import { useEffect, useState } from 'react'
import { PlusIcon } from '@heroicons/react/16/solid'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { outlineBox, plusPlacement, type Rect } from '@/lib/shared/design/layer-geometry'
import { menuParts } from '@/lib/shared/design/menu'
import { HEADER_COPY } from '@/lib/shared/design/menu-actions'
import type { PageGateSettings, PortalPageGates } from '@/lib/shared/design/paths'
import type { SamplePage } from '@/lib/shared/design/sample-pages'
import type { PortalDesign } from '@/lib/shared/design/schema'
import type { CanvasFrame } from './designer-canvas'
import { MenuAdd } from './menu-add'
import { MenuClickMenu } from './menu-click-menu'
import { MenuCoachMark, menuHintShown } from './menu-coach-mark'
import type { NamedUpdate } from './menu-link-form'
import { MenuRename } from './menu-rename'
import { menuItemFont, menuKey, MENU_ROW_KEY, useFrameRects } from './use-frame-rects'
import { useMenuDrag } from './use-menu-drag'
import { isMenuPart, type MenuEditing } from './use-menu-editing'

/** The layer's own blue, as the picked block's outline uses it. */
const BLUE = '#2563eb'

/** Keeps a true value a moment longer, so the pointer can cross from the page to "+". */
function useLinger(value: boolean, ms = 400): boolean {
  const [kept, setKept] = useState(value)
  useEffect(() => {
    if (value) return setKept(true)
    const timer = setTimeout(() => setKept(false), ms)
    return () => clearTimeout(timer)
  }, [value, ms])
  return value || kept
}

/**
 * The portal's menu, edited on the page: the item under the pointer and the
 * one open are outlined, the row is marked while the header is in play with
 * "+" at its end, a clicked item opens its own menu beside it, and a
 * double-clicked one is renamed in place. The page under it keeps the pointer.
 */
export function MenuLayer({
  canvas,
  design,
  gates,
  settings,
  update,
  editing,
  headerHot,
  coach,
  onSample,
}: {
  canvas: CanvasFrame
  design: PortalDesign
  gates: PortalPageGates
  settings: PageGateSettings
  update: NamedUpdate
  editing: MenuEditing
  /** Whether the header is under the pointer or picked. */
  headerHot: boolean
  coach: { show: boolean; dismiss: () => void }
  onSample?: (page: SamplePage) => void
}) {
  const { open, menu, hovered, adding, setAdding } = editing
  const [onPlus, setOnPlus] = useState(false)
  const rects = useFrameRects(canvas.frame, canvas.scale, [
    MENU_ROW_KEY,
    // The header, which the menu's hint sits under.
    coach.show ? 'header' : null,
    hovered && menuKey(hovered),
    open && menuKey(open.target),
  ])
  const drag = useMenuDrag({
    frame: canvas.frame,
    scale: canvas.scale,
    design,
    gates,
    editing,
  })
  const row = rects[MENU_ROW_KEY] ?? null
  const hoveredBox = hovered && hovered !== open?.target && !drag ? rects[menuKey(hovered)] : null
  const openBox = open ? (rects[menuKey(open.target)] ?? null) : null
  const rowShown = useLinger(headerHot || !!hovered || !!open || adding || onPlus)
  // The hint shows only while the menu is in play, under the header so it never covers it.
  const hint = menuHintShown({
    show: coach.show,
    hasRow: !!row,
    hot: headerHot || !!hovered,
    open: !!open,
    dragging: !!drag,
  })
  // The open item's outline, which its menu opens against.
  const [anchor, setAnchor] = useState<HTMLDivElement | null>(null)
  // An item that went, such as after its page changed, closes what was open for it.
  const { close } = editing
  const lost = open && !openBox ? open.target : null
  useEffect(() => {
    if (!lost) return
    const timer = setTimeout(() => close(lost), 600)
    return () => clearTimeout(timer)
  }, [lost, close])

  const part =
    open && isMenuPart(open.target)
      ? menuParts(design, gates).find((each) => each.id === open.target)
      : undefined
  const plus = row ? plusPlacement(row, canvas.room) : null
  // Menus opened on the page stay within the canvas, as on a phone.
  const boundary = canvas.frame?.parentElement ?? undefined
  const outline = (box: Rect, width: number) => outlineBox(box, width, canvas.room)
  return (
    <div data-menu-layer="" className="pointer-events-none absolute inset-0 overflow-hidden">
      {row && rowShown && (
        <div
          aria-hidden="true"
          className="absolute rounded-lg"
          style={{ ...outline(row, 4), outline: `1px dashed ${BLUE}99` }}
        />
      )}
      {hoveredBox && (
        <div
          aria-hidden="true"
          data-menu-hover=""
          className="absolute rounded-md"
          style={{ ...outline(hoveredBox, 1), outline: `1px solid ${BLUE}66` }}
        />
      )}
      {openBox && (
        <div
          ref={setAnchor}
          aria-hidden="true"
          data-menu-open=""
          className="absolute rounded-md"
          style={{
            ...outline(openBox, 2),
            outline: `2px solid ${BLUE}`,
            boxShadow: '0 0 0 1px #fff, inset 0 0 0 1px #fff',
          }}
        />
      )}
      {drag?.bar && (
        <div
          aria-hidden="true"
          data-menu-drop-bar=""
          className="absolute rounded-full"
          style={{ ...drag.bar, background: BLUE, boxShadow: '0 0 0 1px #fff' }}
        />
      )}
      {drag && (
        <div
          aria-hidden="true"
          data-menu-drag-ghost=""
          className="absolute max-w-48 truncate rounded-md border bg-background px-2.5 py-1 text-sm font-medium text-foreground opacity-90 shadow-lg"
          style={{
            left: drag.pointer.left + 8,
            top: drag.pointer.top + 8,
            borderColor: BLUE,
          }}
        >
          {drag.label}
        </div>
      )}
      {plus && (rowShown || adding) && (
        <Popover open={adding} onOpenChange={setAdding}>
          <Tooltip>
            <TooltipTrigger asChild>
              <PopoverTrigger
                aria-label={HEADER_COPY.add}
                onPointerEnter={() => setOnPlus(true)}
                onPointerLeave={() => setOnPlus(false)}
                className="pointer-events-auto absolute grid size-6 place-items-center rounded-full border border-dashed bg-background text-[#2563eb] shadow-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-muted-foreground"
                style={{ left: plus.left, top: plus.top, borderColor: BLUE }}
              >
                <PlusIcon className="size-3.5" aria-hidden="true" />
              </PopoverTrigger>
            </TooltipTrigger>
            <TooltipContent side="bottom">{HEADER_COPY.add}</TooltipContent>
          </Tooltip>
          <PopoverContent align="start" className="w-80" aria-label={HEADER_COPY.add}>
            <MenuAdd
              design={design}
              gates={gates}
              settings={settings}
              update={update}
              onSample={onSample}
              onDone={() => setAdding(false)}
            />
          </PopoverContent>
        </Popover>
      )}
      {open?.mode === 'menu' && menu && openBox && (
        <MenuClickMenu
          key={`${open.target}:${open.seq}`}
          menu={menu}
          anchor={anchor}
          boundary={boundary}
          onAction={(action) => editing.act(open.target, action)}
          onClose={() => editing.close(open.target)}
        />
      )}
      {open?.mode === 'rename' && part && openBox && (
        <MenuRename
          key={open.target}
          box={openBox}
          font={menuItemFont(canvas.frame, open.target)}
          scale={canvas.scale}
          name={part.label}
          onSave={(text) => editing.rename(part.id, text)}
          onCancel={() => editing.close(part.id)}
        />
      )}
      {hint && row && (
        <MenuCoachMark
          row={row}
          below={rects.header ?? null}
          room={canvas.room}
          onDismiss={coach.dismiss}
        />
      )}
    </div>
  )
}
