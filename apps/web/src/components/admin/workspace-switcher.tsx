import { ArrowsRightLeftIcon } from '@heroicons/react/24/solid'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { MENU_LABEL, MENU_ROW } from '@/components/ui/menu'
import type { OwnerWorkspace } from '@/lib/server/control-plane/client'

const GENERATED_SYSTEM_LABEL = /^ws-[0-9a-f]{24}$/i

export function friendlySiblingAddress(url: string | null | undefined): string | null {
  if (!url) return null
  try {
    const host = new URL(url).hostname
    const label = host.split('.')[0] ?? ''
    if (GENERATED_SYSTEM_LABEL.test(label)) return null
    return host
  } catch {
    return null
  }
}

export function WorkspaceSwitcher({
  siblings,
  onOpen,
  defaultOpen = false,
  labeled = false,
}: {
  siblings: OwnerWorkspace[]
  onOpen: (instanceId: string) => void
  defaultOpen?: boolean
  labeled?: boolean
}) {
  if (siblings.length === 0) return null

  const trigger = (
    <DropdownMenuTrigger asChild>
      <button
        type="button"
        data-admin-rail-item={labeled ? '' : undefined}
        className={
          labeled
            ? 'relative flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-muted-foreground/70 transition-all duration-200 hover:bg-muted/50 hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring'
            : 'relative flex size-9 items-center justify-center rounded-lg text-muted-foreground/70 transition-all duration-200 hover:bg-muted/50 hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring'
        }
      >
        <ArrowsRightLeftIcon className="size-5 shrink-0" />
        {labeled ? (
          <span className="min-w-0 flex-1 truncate text-left">Switch workspace</span>
        ) : (
          <span className="sr-only">Switch workspace</span>
        )}
      </button>
    </DropdownMenuTrigger>
  )

  return (
    <DropdownMenu defaultOpen={defaultOpen}>
      {labeled ? (
        trigger
      ) : (
        <Tooltip>
          <TooltipTrigger asChild>{trigger}</TooltipTrigger>
          <TooltipContent side="right" sideOffset={8}>
            Switch workspace
          </TooltipContent>
        </Tooltip>
      )}
      <DropdownMenuContent align="start" side="right" sideOffset={8} className="w-56">
        <DropdownMenuLabel className={MENU_LABEL}>Workspaces</DropdownMenuLabel>
        {siblings.map((sibling) => {
          const address = friendlySiblingAddress(sibling.url)
          return (
            <DropdownMenuItem
              key={sibling.instanceId}
              className={MENU_ROW}
              onClick={() => onOpen(sibling.instanceId)}
            >
              <span className="flex min-w-0 flex-col">
                <span className="truncate">{sibling.displayName}</span>
                {address ? (
                  <span className="truncate text-[11px] text-muted-foreground">{address}</span>
                ) : null}
              </span>
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
