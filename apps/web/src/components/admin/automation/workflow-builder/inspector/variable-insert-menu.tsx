/**
 * The "insert variable" dropdown shared by every inspector editor that lets
 * an admin insert a `{key}` workflow-variable token without hand-typing it:
 * block-body-field.tsx's rich-text prompt. The caller owns the trigger
 * affordance and what inserting a picked key does.
 */
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { WORKFLOW_VARIABLE_CATALOGUE } from '@/lib/shared/workflows/message-variables'

export function VariableInsertMenu({
  onInsert,
  trigger,
  align = 'start',
}: {
  /** Called with the picked catalogue key (e.g. `first_name`) — the caller
   *  owns turning that into a rich-text insertion. */
  onInsert: (key: string) => void
  /** The dropdown's trigger element, rendered via `asChild` — callers own
   *  its own button styling, label, and aria-label. */
  trigger: React.ReactNode
  align?: 'start' | 'end'
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent align={align}>
        {WORKFLOW_VARIABLE_CATALOGUE.map((v) => (
          <DropdownMenuItem key={v.key} onSelect={() => onInsert(v.key)}>
            {v.label}
            <span className="ml-auto font-mono text-[11px] text-muted-foreground">
              {`{${v.key}}`}
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
