import { memo } from 'react'
import { Link } from '@tanstack/react-router'
import { ArrowUturnLeftIcon, ArrowUturnRightIcon, ChevronLeftIcon } from '@heroicons/react/20/solid'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

interface CustomiseTopBarProps {
  /** How many settings differ from what is live. */
  changes: number
  canUndo: boolean
  canRedo: boolean
  publishing: boolean
  onUndo: () => void
  onRedo: () => void
  onDiscard: () => void
  onPublish: () => void
}

/**
 * Back, history and publishing. Preview controls live on the canvas.
 *
 * Memoised: it shows how many settings changed, not what they are, so typing
 * on in a field leaves it as it was. Every handler must keep its identity.
 */
export const CustomiseTopBar = memo(function CustomiseTopBar({
  changes,
  canUndo,
  canRedo,
  publishing,
  onUndo,
  onRedo,
  onDiscard,
  onPublish,
}: CustomiseTopBarProps) {
  return (
    <div className="flex h-[52px] shrink-0 items-center gap-2 border-b border-border px-3 sm:gap-3">
      <Button variant="ghost" size="sm" asChild className="gap-1 text-muted-foreground">
        <Link to="/admin/settings/portal">
          <ChevronLeftIcon className="size-4" aria-hidden="true" />
          Portal
        </Link>
      </Button>
      <span className="h-5 w-px bg-border max-sm:hidden" aria-hidden="true" />
      <h2 className="text-sm font-semibold max-sm:sr-only">Customise</h2>

      <div className="ms-auto flex items-center gap-1 sm:gap-1.5">
        <HistoryButton label="Undo" shortcut="Ctrl Z" disabled={!canUndo} onClick={onUndo}>
          <ArrowUturnLeftIcon className="size-4" aria-hidden="true" />
        </HistoryButton>
        <HistoryButton label="Redo" shortcut="Ctrl Shift Z" disabled={!canRedo} onClick={onRedo}>
          <ArrowUturnRightIcon className="size-4" aria-hidden="true" />
        </HistoryButton>
        {changes > 0 ? (
          <>
            <span className="ms-2 flex items-center gap-1.5 text-[13px] text-muted-foreground max-sm:hidden">
              <span className="size-1.5 rounded-full bg-primary" aria-hidden="true" />
              {changes === 1 ? '1 change' : `${changes} changes`}
            </span>
            <Button variant="ghost" size="sm" onClick={onDiscard} disabled={publishing}>
              Discard
            </Button>
          </>
        ) : null}
        <Button size="sm" onClick={onPublish} disabled={changes === 0 || publishing}>
          {publishing ? 'Publishing…' : 'Publish'}
        </Button>
      </div>
    </div>
  )
})

function HistoryButton({
  label,
  shortcut,
  disabled,
  onClick,
  children,
}: {
  label: string
  shortcut: string
  disabled: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={label}
          aria-keyshortcuts={shortcut.replaceAll(' ', '+')}
          disabled={disabled}
          onClick={onClick}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        {label} <span className="text-muted-foreground">{shortcut}</span>
      </TooltipContent>
    </Tooltip>
  )
}
