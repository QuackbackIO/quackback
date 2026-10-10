import { PlusIcon } from '@heroicons/react/16/solid'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

interface PaneAddButtonProps {
  label: string
  onClick: () => void
}

/** The 20px "+" in a side-pane section header. */
export function PaneAddButton({ label, onClick }: PaneAddButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label={label}
            onClick={onClick}
            className="flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          />
        }
      >
        <PlusIcon className="size-3.5" />
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}
