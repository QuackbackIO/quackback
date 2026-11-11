import type { RefObject } from 'react'
import { useMemo } from 'react'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { BlockIcon } from './block-icon'
import { findScore, type FindGroup, type FindItem } from './find-index'

const GROUPS: FindGroup[] = ['Blocks', 'Settings', 'Actions', 'Pages']

/**
 * Quick find's dialog: a box to type in over what it finds, grouped, each
 * with where it is. Loaded the first time quick find opens.
 */
export function QuickFindDialog({
  open,
  onOpenChange: setOpen,
  items,
  onGo: go,
  keepFocus: toSetting,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  items: readonly FindItem[]
  onGo: (item: FindItem) => void
  /** True once an entry was chosen whose setting takes focus itself, so closing does not hand it back. */
  keepFocus: RefObject<boolean>
}) {
  const byId = useMemo(() => new Map(items.map((item) => [item.id, item])), [items])
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        showCloseButton={false}
        finalFocus={() => !toSetting.current}
        data-quick-find=""
        className="top-[15vh] max-w-lg translate-y-0 overflow-hidden p-0"
      >
        <DialogTitle className="sr-only">Find</DialogTitle>
        <Command
          className="border-0 shadow-none"
          filter={(value, search) => {
            const item = byId.get(value)
            return item ? findScore(item, search) : 0
          }}
        >
          <CommandInput placeholder="Find a block, page, setting or action…" />
          <CommandList>
            <CommandEmpty>Nothing by that name.</CommandEmpty>
            {GROUPS.map((group) => (
              <CommandGroup key={group} heading={group}>
                {items
                  .filter((item) => item.group === group)
                  .map((item) => (
                    <CommandItem
                      key={item.id}
                      value={item.id}
                      data-find-item={item.id}
                      disabled={!!item.off}
                      onSelect={() => go(item)}
                    >
                      {item.icon && <BlockIcon type={item.icon} />}
                      <span className="min-w-0 truncate">
                        {item.path.map((step, at) => (
                          <span key={at} className="text-muted-foreground">
                            {step} ›{' '}
                          </span>
                        ))}
                        {item.label}
                      </span>
                      {item.off && (
                        <span className="ms-auto shrink-0 text-xs text-muted-foreground">
                          {item.off}
                        </span>
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
