/**
 * The inbox command bar (support platform §4.6): a controlled Cmd-K palette over
 * the cmdk-backed ui/command primitives, wrapped in a Dialog (the primitive has
 * no CommandDialog export). Reads INBOX_ACTIONS for its rows, fuzzy-filters by
 * label, groups by `group`, greys out actions that can't run in the current
 * context, and reports the chosen id to the parent. It owns no behavior — the
 * parent supplies `onAction`.
 */
import {
  INBOX_ACTIONS,
  INBOX_ACTION_GROUP_ORDER,
  isInboxActionEnabled,
  type InboxActionId,
} from '@/lib/shared/conversation/inbox-actions'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'

export interface InboxCommandBarProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onAction: (id: InboxActionId) => void
  hasSelection: boolean
  hasActiveConversation: boolean
  /** True when the target (selection, or the solo active item) includes a
   *  ticket — disables the Snooze row (UNIFIED-INBOX-SPEC.md §2.5). */
  hasTicketTarget?: boolean
  /** True when the detail panel's Copilot tab exists for this viewer right
   *  now (flag + copilot.use + ≥xl viewport) — gates the Ask Copilot row. */
  copilotAvailable?: boolean
}

export function InboxCommandBar({
  open,
  onOpenChange,
  onAction,
  hasSelection,
  hasActiveConversation,
  hasTicketTarget,
  copilotAvailable,
}: InboxCommandBarProps) {
  function run(id: InboxActionId) {
    onAction(id)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false} className="max-w-lg overflow-hidden p-0">
        <DialogTitle className="sr-only">Inbox commands</DialogTitle>
        <Command
          // cmdk defaults to filtering by an item's `value`; we set that to the
          // label so search matches what the user reads.
          className="[&_[cmdk-group-heading]]:px-3"
        >
          <CommandInput placeholder="Type a command…" />
          <CommandList>
            <CommandEmpty>No commands found.</CommandEmpty>
            {INBOX_ACTION_GROUP_ORDER.map((group) => {
              const items = INBOX_ACTIONS.filter((a) => a.group === group)
              if (items.length === 0) return null
              return (
                <CommandGroup key={group} heading={group}>
                  {items.map((action) => {
                    const disabled = !isInboxActionEnabled(action, {
                      hasActiveConversation,
                      hasSelection,
                      hasTicketTarget,
                      copilotAvailable,
                    })
                    return (
                      <CommandItem
                        key={action.id}
                        value={action.label}
                        keywords={[action.id, action.group]}
                        disabled={disabled}
                        onSelect={() => run(action.id)}
                      >
                        <span>{action.label}</span>
                        {action.shortcut && (
                          <kbd className="bg-muted text-muted-foreground ml-auto rounded border px-1.5 py-0.5 text-[10px]">
                            {action.shortcut}
                          </kbd>
                        )}
                      </CommandItem>
                    )
                  })}
                </CommandGroup>
              )
            })}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  )
}
