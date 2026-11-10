import { useCallback, useEffect, useRef, useState } from 'react'
import { trackBuilder, type MENU_CHANGES, type MENU_FROM } from '@/lib/client/builder-events'
import type { MenuPartId } from '@/lib/shared/design/menu'
import {
  clickMenu,
  goTarget,
  landingStep,
  menuPlaceStep,
  menuStep,
  renameStep,
  SIGN_IN_SETTINGS,
  type MenuAction,
  type MenuStepKind,
  type MenuTarget,
} from '@/lib/shared/design/menu-actions'
import type { DesignerPage, Selection } from '@/lib/shared/design/outline'
import type { PortalPageGates, PortalPageType } from '@/lib/shared/design/paths'
import type { PortalDesign } from '@/lib/shared/design/schema'
import type { NamedUpdate } from './menu-link-form'

/** A menu item open on the page: its own menu, or renaming in place. */
export interface OpenMenuItem {
  target: MenuTarget
  mode: 'menu' | 'rename'
  /** Counts clicks, so a click on the item already open hands its menu the keyboard again. */
  seq: number
}

/** Whether a target is a part of the menu, which can be renamed and changed. */
export const isMenuPart = (target: MenuTarget): target is MenuPartId =>
  target !== 'logo' && target !== 'sign-in'

const STEP_CHANGES: Record<MenuStepKind, (typeof MENU_CHANGES)[number]> = {
  land: 'land',
  hide: 'hide',
  show: 'show',
  left: 'move',
  right: 'move',
  up: 'move',
  down: 'move',
  remove: 'remove',
}

/**
 * The portal's menu, edited where it is drawn: a click on an item opens its
 * own menu, a double-click renames it in place, "+" adds to it. The header's
 * panel takes the same actions from the keyboard. Every change is a named
 * step of the draft, so undo says what it takes back.
 */
export function useMenuEditing({
  design,
  gates,
  update,
  page,
  setPage,
  pick,
  say,
}: {
  design: PortalDesign
  gates: PortalPageGates
  update: NamedUpdate
  page: DesignerPage
  setPage: (page: DesignerPage, item?: string | null) => void
  pick: (selection: Selection | null) => void
  say: (words: string) => void
}) {
  const [open, setOpen] = useState<OpenMenuItem | null>(null)
  // What is open now, for a handler that runs before the next render.
  const openNow = useRef(open)
  openNow.current = open
  const [hovered, setHovered] = useState<MenuTarget | null>(null)
  const [adding, setAddingState] = useState(false)
  // A new page draws a new menu: what was open belonged to the last one.
  useEffect(() => {
    setOpen(null)
    setHovered(null)
  }, [page])

  const setAdding = useCallback((next: boolean) => {
    setAddingState(next)
    if (next) {
      setOpen(null)
      trackBuilder('designer_panel_opened', { panel: 'menu_add' })
    }
  }, [])

  /** A click or double-click on an item in the page. */
  const onMenu = useCallback((target: MenuTarget, how: 'click' | 'rename') => {
    if (how === 'rename') {
      if (isMenuPart(target)) setOpen({ target, mode: 'rename', seq: 0 })
      return
    }
    setOpen((before) => {
      if (before?.target === target)
        // Renaming stays; a menu already open takes the keyboard again.
        return before.mode === 'rename' ? before : { ...before, seq: before.seq + 1 }
      trackBuilder('designer_panel_opened', { panel: 'menu_item' })
      return { target, mode: 'menu', seq: 0 }
    })
  }, [])

  /** A click elsewhere on the page, or Escape there: an item's menu closes. Whether one was open. */
  const dismiss = useCallback(() => {
    if (openNow.current?.mode !== 'menu') return false
    setOpen(null)
    return true
  }, [])

  /** Closes what is open for an item, and only for that item. */
  const close = useCallback(
    (target: MenuTarget) => setOpen((before) => (before?.target === target ? null : before)),
    []
  )

  const step = (id: MenuPartId, kind: MenuStepKind, from: (typeof MENU_FROM)[number]) => {
    const made = menuStep(design, gates, id, kind)
    if (!made) return
    update(made.change, made.label)
    say(made.said ?? `${made.label}. Undo takes it back.`)
    trackBuilder('designer_menu_changed', { change: STEP_CHANGES[kind], from })
  }

  /** An item dragged to a place among the parts that can move, as one step; whether it moved. */
  const drop = (id: MenuPartId, place: number) => {
    const made = menuPlaceStep(design, gates, id, place)
    if (!made) return false
    update(made.change, made.label)
    say(made.said ?? made.label)
    trackBuilder('designer_menu_changed', { change: 'move', from: 'canvas' })
    return true
  }

  /** An action from an item's menu, or from the header's panel. */
  const act = (
    target: MenuTarget,
    action: MenuAction | 'show' | 'up' | 'down',
    from: (typeof MENU_FROM)[number] = 'canvas'
  ) => {
    if (action === 'go') {
      const to = goTarget(design, gates, target)
      if (!to) return
      setPage(to, null)
      trackBuilder('designer_menu_changed', { change: 'go', from })
      return
    }
    if (action === 'sign-in-settings') {
      window.open(SIGN_IN_SETTINGS, '_blank', 'noopener')
      trackBuilder('designer_menu_changed', { change: 'sign_in_settings', from })
      return
    }
    if (!isMenuPart(target)) return
    if (action === 'rename') return setOpen({ target, mode: 'rename', seq: 0 })
    if (action === 'edit-link') {
      pick(target as Selection)
      trackBuilder('designer_menu_changed', { change: 'edit_link', from })
      return
    }
    step(target, action, from)
  }

  /** A name typed in place, or in the header's panel. */
  const rename = (
    target: MenuPartId,
    text: string,
    from: (typeof MENU_FROM)[number] = 'canvas'
  ) => {
    setOpen((before) => (before?.target === target ? null : before))
    const made = renameStep(design, gates, target, text)
    if (!made) return
    update(made.change, made.label)
    say(`${made.label}. Undo takes it back.`)
    trackBuilder('designer_menu_changed', { change: 'rename', from })
  }

  /** Where visitors land, from the header's panel; the page goes there too. */
  const land = (target: 'home' | PortalPageType) => {
    const made = landingStep(design, gates, target)
    if (!made) return
    update(made.change, made.label)
    setPage(target, null)
    say(`${made.label}. Undo takes it back.`)
    trackBuilder('designer_menu_changed', { change: 'land', from: 'panel' })
  }

  const menu = open?.mode === 'menu' ? clickMenu(design, gates, open.target) : null
  return {
    open,
    /** The open item's menu, while it has one. */
    menu,
    hovered,
    setHovered,
    adding,
    setAdding,
    onMenu,
    dismiss,
    close,
    act,
    rename,
    land,
    drop,
    say,
  }
}

export type MenuEditing = ReturnType<typeof useMenuEditing>
