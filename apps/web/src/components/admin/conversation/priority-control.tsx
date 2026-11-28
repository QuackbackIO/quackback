import { useOptionalIntl } from '@/components/ui/use-optional-intl'
import { memo } from 'react'
import { useMutation } from '@tanstack/react-query'
import { ChevronDownIcon, CheckIcon } from '@heroicons/react/24/solid'
import { toast } from 'sonner'
import type { ConversationId } from '@quackback/ids'
import type { ConversationPriority } from '@/lib/shared/conversation/types'
import { setConversationPriorityFn } from '@/lib/server/functions/conversation'
import { priorityMeta, PRIORITY_OPTIONS } from '@/lib/shared/conversation/priority-meta'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { PRIORITY_LABELS, PRIORITY_PLACEHOLDER } from './inbox-labels'
import { cn } from '@/lib/shared/utils'

/** A small colored dot for a conversation's priority (hidden for 'none'). */
export function PriorityDot({
  priority,
  className,
}: {
  priority: ConversationPriority
  className?: string
}) {
  const intl = useOptionalIntl()
  if (priority === 'none') return null
  const meta = priorityMeta(priority)
  return (
    <span
      className={cn('inline-block size-2 shrink-0 rounded-full', className)}
      style={{ backgroundColor: meta.color }}
      aria-label={intl.formatMessage(
        { id: 'admin.inbox.priorityControl.ariaLabel', defaultMessage: '{priority} priority' },
        { priority: intl.formatMessage(PRIORITY_LABELS[priority]) }
      )}
    />
  )
}

/**
 * The priority option rows for a dropdown — shared by the thread control and
 * the inbox list filter so the dot/label/check rendering lives in one place.
 * Always renders a dot (including the grey 'none' dot), unlike PriorityDot.
 */
export function PriorityMenuItems({
  selected,
  onSelect,
}: {
  selected?: ConversationPriority
  onSelect: (priority: ConversationPriority) => void
}) {
  const intl = useOptionalIntl()
  return (
    <>
      {PRIORITY_OPTIONS.map((opt) => (
        <DropdownMenuItem
          key={opt.value}
          onClick={() => onSelect(opt.value)}
          className="flex items-center gap-2"
        >
          <span
            className="inline-block size-2 shrink-0 rounded-full"
            style={{ backgroundColor: opt.color }}
          />
          {intl.formatMessage(PRIORITY_LABELS[opt.value])}
          {opt.value === selected && <CheckIcon className="ms-auto h-3.5 w-3.5 text-primary" />}
        </DropdownMenuItem>
      ))}
    </>
  )
}

/** Header control to view + change a conversation's triage priority. */
export const PriorityControl = memo(function PriorityControl({
  conversationId,
  value,
  onChanged,
}: {
  conversationId: ConversationId
  value: ConversationPriority
  onChanged?: () => void
}) {
  const intl = useOptionalIntl()
  const mutation = useMutation({
    mutationFn: (priority: ConversationPriority) =>
      setConversationPriorityFn({ data: { conversationId, priority } }),
    onSuccess: () => onChanged?.(),
    onError: () =>
      toast.error(
        intl.formatMessage({
          id: 'admin.inbox.priorityControl.failedToSetPriority',
          defaultMessage: 'Failed to set priority',
        })
      ),
  })

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={mutation.isPending}
          className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-muted"
        >
          <PriorityDot priority={value} />
          {intl.formatMessage(value === 'none' ? PRIORITY_PLACEHOLDER : PRIORITY_LABELS[value])}
          <ChevronDownIcon className="size-3.5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <PriorityMenuItems selected={value} onSelect={(p) => mutation.mutate(p)} />
      </DropdownMenuContent>
    </DropdownMenu>
  )
})
