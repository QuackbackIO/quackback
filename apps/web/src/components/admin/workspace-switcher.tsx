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
import type { OwnerSiblingWorkspace } from '@/lib/server/control-plane/client'

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
}: {
  siblings: OwnerSiblingWorkspace[]
  onOpen: (instanceId: string) => void
  defaultOpen?: boolean
}) {
  if (siblings.length === 0) return null

  return (
    <DropdownMenu defaultOpen={defaultOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="relative flex size-9 items-center justify-center rounded-lg text-muted-foreground/70 transition-all duration-200 hover:bg-muted/50 hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ArrowsRightLeftIcon className="size-5" />
              <span className="sr-only">Switch workspace</span>
            </button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="right" sideOffset={8}>
          Switch workspace
        </TooltipContent>
      </Tooltip>
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
