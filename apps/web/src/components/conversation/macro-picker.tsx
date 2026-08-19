/**
 * The agent composer's macro picker (replaces the old canned-reply popover).
 * Searchable list of the workspace's support macros; choosing one renders its
 * body against the live conversation and runs its bundled actions server-side
 * (on use, not on send), then inserts the rendered text and toasts what ran.
 */
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ChatBubbleBottomCenterTextIcon } from '@heroicons/react/24/solid'
import type { ConversationId } from '@quackback/ids'
import { macrosQuery } from '@/lib/client/queries/macros'
import { applyMacroFn } from '@/lib/server/functions/macros'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandItem,
} from '@/components/ui/command'

export function MacroPicker({
  conversationId,
  onInsert,
  onApplied,
  disabled,
  open: controlledOpen,
  onOpenChange,
}: {
  conversationId: ConversationId
  onInsert: (body: string) => void
  /** Called after a macro's bundled actions run, so the thread can refresh. */
  onApplied?: () => void
  disabled?: boolean
  /** Controlled open state; when omitted the trigger button owns it. The
      thread passes both so the inbox's `m` shortcut can open the picker. */
  open?: boolean
  onOpenChange?: (open: boolean) => void
}) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false)
  const open = controlledOpen ?? uncontrolledOpen
  const setOpen = (next: boolean) => {
    setUncontrolledOpen(next)
    onOpenChange?.(next)
  }
  const [applying, setApplying] = useState(false)
  const { data } = useQuery(macrosQuery('support'))
  const macros = data?.macros ?? []

  if (macros.length === 0) return null

  async function use(macroId: string) {
    setApplying(true)
    try {
      const { body, applied } = await applyMacroFn({ data: { conversationId, macroId } })
      onInsert(body)
      setOpen(false)
      if (applied.length > 0) {
        toast.success(`Applied: ${applied.join(', ')}`)
        onApplied?.()
      }
    } catch {
      toast.error('Failed to apply macro')
    } finally {
      setApplying(false)
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled || applying}
          className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted disabled:opacity-40 transition-colors"
          aria-label="Macros"
        >
          <ChatBubbleBottomCenterTextIcon className="h-4 w-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-0">
        <Command>
          <CommandInput placeholder="Search macros…" />
          <CommandList>
            <CommandEmpty>No macros found.</CommandEmpty>
            {macros.map((m) => (
              <CommandItem
                key={m.id}
                value={`${m.name} ${m.body}`}
                onSelect={() => void use(m.id)}
                className="flex-col items-start gap-0.5"
              >
                <span className="font-medium">{m.name}</span>
                <span className="block w-full truncate text-xs text-muted-foreground">
                  {m.body}
                </span>
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
