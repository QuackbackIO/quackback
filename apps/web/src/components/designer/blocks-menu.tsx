import { CheckIcon } from '@heroicons/react/16/solid'
import { Squares2X2Icon } from '@heroicons/react/24/outline'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { HomeBlock } from '@/lib/shared/design/home'
import { blockKey, type Selection } from '@/lib/shared/design/outline'
import { BlockIcon } from './block-icon'

/**
 * Every block on the page shown, in reading order, as a list of layers: the
 * keyboard's way to pick one, as a click on the canvas does. A Home block
 * shows its icon and its size on the grid; the picked one has a check.
 */
export function BlocksMenu({
  parts,
  picked,
  onPick,
  blocks = [],
}: {
  parts: readonly { key: Selection; label: string }[]
  picked: Selection | null
  onPick: (key: Selection) => void
  /** Home's blocks, for each one's icon and size. */
  blocks?: readonly HomeBlock[]
}) {
  const home = new Map(blocks.map((block, i) => [blockKey(block, i), block]))
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Blocks on this page"
              data-blocks-menu=""
            >
              <Squares2X2Icon className="size-4" aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>Blocks on this page</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="start" className="w-64" aria-label="Blocks on this page">
        {parts.map((part) => {
          const block = home.get(part.key)
          const current = part.key === picked
          return (
            <DropdownMenuItem
              key={part.key}
              data-current={current || undefined}
              className="gap-2 text-[13px] data-[current]:font-medium"
              onClick={() => onPick(part.key)}
            >
              {block ? <BlockIcon type={block.type} /> : <span className="size-3.5" />}
              <span className="min-w-0 flex-1 truncate">{part.label}</span>
              {block && (
                <span className="text-[11px] text-muted-foreground tabular-nums">
                  {`${block.grid.w}×${block.grid.h}`}
                </span>
              )}
              {current ? (
                <CheckIcon className="size-3.5" aria-label="Picked" />
              ) : (
                <span className="size-3.5" />
              )}
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
