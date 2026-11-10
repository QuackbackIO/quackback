import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { trackBuilder } from '@/lib/client/builder-events'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import type { DesignerPage, OutlineNode, Selection } from '@/lib/shared/design/outline'
import { quickFindItems, type FindGroup, type FindItem } from '@/lib/shared/design/quick-find'
import type { PortalDesign } from '@/lib/shared/design/schema'
import { BlockIcon } from './block-icon'

const GROUPS: FindGroup[] = ['Blocks', 'Settings', 'Actions', 'Pages']

/**
 * Ctrl+K or Cmd+K, on the designer or its canvas, finds a block, an element,
 * a page, a setting or an action by name. A setting selects its block and
 * brings its control into view; an action is done.
 */
export function QuickFind({
  nodes,
  page,
  pages,
  onSelect,
  onPage,
  opened,
  onOpened,
  extra,
  design,
  actions,
}: {
  /** More to find, such as the picked element's own settings. */
  extra?: readonly FindItem[]
  /** The design, for each Home block's own settings. */
  design?: PortalDesign
  /** The actions on offer as it opens, such as duplicating the picked block. */
  actions?: () => readonly FindItem[]
  nodes: readonly OutlineNode[]
  page: DesignerPage
  pages: readonly DesignerPage[]
  onSelect: (selection: Selection) => void
  onPage: (page: DesignerPage) => void
  /** Open from elsewhere, such as the More menu; it opens itself on Ctrl+K too. */
  opened?: boolean
  onOpened?: (open: boolean) => void
}) {
  const [own, setOwn] = useState(false)
  const open = opened ?? own
  const told = useRef(onOpened)
  told.current = onOpened
  const setOpen = useCallback((next: boolean) => {
    setOwn(next)
    told.current?.(next)
  }, [])
  // A setting takes focus itself, so closing does not hand it back.
  const toSetting = useRef(false)
  useEffect(() => {
    if (open) trackBuilder('designer_panel_opened', { panel: 'quick_find' })
  }, [open])
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setOpen(true)
      }
    }
    // The canvas hands its Ctrl+K over, from this page's own frames only.
    const onMessage = (event: MessageEvent) => {
      const message = event.data as { type?: unknown; key?: unknown } | null
      if (
        event.origin === window.location.origin &&
        message?.type === 'quackback:preview-key' &&
        message.key === 'find'
      )
        setOpen(true)
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('message', onMessage)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('message', onMessage)
    }
  }, [setOpen])
  const items = useMemo(
    () => [...(extra ?? []), ...quickFindItems(nodes, page, pages, design)],
    [nodes, page, pages, extra, design]
  )
  const offered = useMemo(() => (open ? (actions?.() ?? []) : []), [open, actions])
  const go = (item: FindItem) => {
    const target = item.target
    toSetting.current = false
    setOpen(false)
    if (target.kind === 'page') return onPage(target.page)
    if (target.kind === 'action') return target.run()
    if (target.kind === 'here') {
      toSetting.current = true
      return revealSetting(target.setting)
    }
    if (target.page) onPage(target.page)
    onSelect(target.selection)
    toSetting.current = !!target.setting
    if (target.setting) revealSetting(target.setting)
  }
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        showCloseButton={false}
        finalFocus={() => !toSetting.current}
        className="max-w-lg overflow-hidden p-0"
      >
        <DialogTitle className="sr-only">Find</DialogTitle>
        <Command className="border-0 shadow-none">
          <CommandInput placeholder="Find a block, page, setting or action…" />
          <CommandList>
            <CommandEmpty>Nothing by that name.</CommandEmpty>
            {GROUPS.map((group) => (
              <CommandGroup key={group} heading={group}>
                {[...items, ...offered]
                  .filter((item) => item.group === group)
                  .map((item) => (
                    <CommandItem
                      key={`${group}:${item.where ?? ''}:${item.label}`}
                      value={[item.label, item.where, item.terms, group].filter(Boolean).join(' ')}
                      onSelect={() => go(item)}
                    >
                      {item.icon && <BlockIcon type={item.icon} />}
                      <span>{item.label}</span>
                      {item.where && (
                        <span className="ms-auto text-xs text-muted-foreground">{item.where}</span>
                      )}
                    </CommandItem>
                  ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Brings the control under a label in the settings into view and focuses it,
 * once the part's settings have drawn.
 */
export function revealSetting(label: string, tries = 20): void {
  requestAnimationFrame(() => {
    const settings = document.getElementById('designer-settings')
    const wanted = label.toLowerCase()
    const found = settings
      ? [...settings.querySelectorAll<HTMLElement>('label, legend, h3, p, span')].find(
          (each) => each.textContent?.trim().toLowerCase() === wanted
        )
      : undefined
    if (!found) {
      if (tries > 0) revealSetting(label, tries - 1)
      return
    }
    // A setting under Advanced opens it first.
    for (
      let shut = found.closest('details');
      shut;
      shut = shut.parentElement?.closest('details') ?? null
    )
      shut.open = true
    found.scrollIntoView({ block: 'center' })
    const field =
      (found instanceof HTMLLabelElement && found.htmlFor
        ? document.getElementById(found.htmlFor)
        : null) ??
      found
        .closest('fieldset, section, div')
        ?.querySelector<HTMLElement>(
          'input, textarea, select, button:not([disabled]), [role=radio][tabindex="0"], [role=switch]'
        )
    field?.focus({ preventScroll: true })
  })
}
