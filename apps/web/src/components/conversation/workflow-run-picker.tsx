/**
 * The agent composer's manual workflow-run picker — lets a teammate fire a
 * live workflow against the open conversation as a deliberate one-off action,
 * mirroring macro-picker.tsx's shape (Popover + cmdk Command list) but for
 * automations instead of canned replies. See functions/workflows.ts's
 * runWorkflowManuallyFn for why this bypasses the dispatcher's trigger-time
 * targeting (channel/audience/send-window/frequency-cap) entirely: those are
 * trigger-time guards, and this is a human choosing to run the workflow now.
 */
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { PlayIcon } from '@heroicons/react/24/solid'
import type { ConversationId } from '@quackback/ids'
import { runnableWorkflowsQuery } from '@/lib/client/queries/workflows'
import { runWorkflowManuallyFn } from '@/lib/server/functions/workflows'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { Badge } from '@/components/ui/badge'
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandItem,
} from '@/components/ui/command'

/** The friendly toast copy for each structured failure reason
 *  runWorkflowManuallyFn can return — see its own doc for what each means. */
const FAILURE_TOASTS: Record<'locked' | 'nothing_to_do' | 'not_live', string> = {
  locked: 'A customer-facing workflow is already active on this conversation.',
  nothing_to_do: 'Workflow had nothing to do on this conversation.',
  not_live: 'This workflow is no longer live.',
}

export function WorkflowRunPicker({
  conversationId,
  onApplied,
  disabled,
}: {
  conversationId: ConversationId
  /** Called after a workflow successfully starts, so the thread can refresh. */
  onApplied?: () => void
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [running, setRunning] = useState(false)
  const { data } = useQuery(runnableWorkflowsQuery())
  const workflows = data ?? []

  if (workflows.length === 0) return null

  async function run(workflowId: string) {
    setRunning(true)
    try {
      const result = await runWorkflowManuallyFn({ data: { workflowId, conversationId } })
      setOpen(false)
      if (result.ok) {
        toast.success('Workflow started')
        onApplied?.()
      } else {
        toast.error(FAILURE_TOASTS[result.reason])
      }
    } catch {
      toast.error('Failed to run workflow')
    } finally {
      setRunning(false)
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <button
              type="button"
              disabled={disabled || running}
              className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted disabled:opacity-40 transition-colors"
              aria-label="Run a workflow"
            >
              <PlayIcon className="h-4 w-4" />
            </button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>Run a workflow</TooltipContent>
      </Tooltip>
      <PopoverContent align="start" className="w-80 p-0">
        <Command>
          <CommandInput placeholder="Search workflows…" />
          <CommandList>
            <CommandEmpty>No workflows found.</CommandEmpty>
            {workflows.map((w) => (
              <CommandItem
                key={w.id}
                value={w.name}
                onSelect={() => void run(w.id)}
                className="flex items-center justify-between gap-2"
              >
                <span className="truncate font-medium">{w.name}</span>
                {w.class === 'customer_facing' && (
                  <Badge size="sm" variant="secondary" shape="pill">
                    bot
                  </Badge>
                )}
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
