/**
 * The floating bulk-action bar (support platform §4.6): appears while a
 * multi-selection is active (or while a value menu is being surfaced for the
 * single open conversation) and applies one action — macro reply, assign, team,
 * priority, snooze, label, or close — to the whole target set. It owns no server logic: the
 * inbox route wires each control to the bulk mutation (many rows) or the single
 * conversation fns (the active thread), and toasts the summary.
 *
 * The value menus are controlled (`openMenu`) so the command bar / keyboard layer
 * can pop the right one open without a second source of truth.
 */
import { XMarkIcon, ChevronUpIcon } from '@heroicons/react/24/solid'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { ConversationPriority } from '@/lib/shared/conversation/types'
import { useTeamMembers } from '@/lib/client/hooks/use-team-members'
import { useConversationTags } from '@/lib/client/hooks/use-conversation-tags'
import { useInboxTeams } from '@/components/admin/conversation/inbox-nav-sidebar'
import { PriorityMenuItems } from '@/components/admin/conversation/priority-control'
import { AssigneeMenuItems } from '@/components/admin/conversation/assignee-control'
import { macrosQuery } from '@/lib/client/queries/macros'
import { tomorrowAt, inHours, nextMondayAt } from '@/lib/shared/utils'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { cn } from '@/lib/shared/utils'

/** The value menus the bar can pop open on demand. */
export type BulkMenuId = 'assign' | 'assign_team' | 'priority' | 'snooze' | 'tag' | 'macro'

export interface BulkActionBarProps {
  /** Number of conversations the action targets. */
  count: number
  /** True when the target is the single open conversation, not a multi-selection. */
  solo: boolean
  pending: boolean
  /** Which value menu is open (command-bar / keyboard driven); null = none. */
  openMenu: BulkMenuId | null
  onOpenMenuChange: (menu: BulkMenuId | null) => void
  /** Clear the selection (or dismiss the bar in solo mode). */
  onClear: () => void
  onAssign: (assignTo: string | null) => void
  onAssignTeam: (teamId: string) => void
  onPriority: (priority: ConversationPriority) => void
  onSnooze: (until: string | null) => void
  /** Apply an existing label to the whole target set. */
  onTag: (tagId: string) => void
  /** Reply to every target with a macro: the rendered body posts immediately. */
  onMacro: (macroId: string) => void
  onClose: () => void
  /** True when the target includes at least one ticket — snooze has no
   *  ticket-row equivalent (UNIFIED-INBOX-SPEC.md §2.5), so its trigger is
   *  disabled rather than silently no-op'd. */
  disableSnooze?: boolean
  /** True when the target includes at least one ticket — tickets carry no
   *  labels, so the trigger is disabled for the same reason as snooze. */
  disableTag?: boolean
  /** True when the target includes at least one ticket — a macro reply posts
   *  a conversation message, so the trigger is disabled for ticket targets. */
  disableMacro?: boolean
  /** Spam-view mode: the bar offers ONLY the spam-lifecycle actions (restore,
   *  delete forever) — triage actions are meaningless on a spam-ended thread. */
  spam?: boolean
  /** Restore every spam-ended target to the open queue. */
  onRestore?: () => void
  /** Permanently delete every spam-ended target (confirmed in the bar). */
  onDeleteForever?: () => void
}

const triggerClass =
  'inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-[13px] font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-50'

export function BulkActionBar({
  count,
  solo,
  pending,
  openMenu,
  onOpenMenuChange,
  onClear,
  onAssign,
  onAssignTeam,
  onPriority,
  onSnooze,
  onTag,
  onMacro,
  onClose,
  disableSnooze,
  disableTag,
  disableMacro,
  spam,
  onRestore,
  onDeleteForever,
}: BulkActionBarProps) {
  const { data: members } = useTeamMembers()
  const { data: teams } = useInboxTeams()
  // Only fetch the label taxonomy once its menu is actually open.
  const { data: tags } = useConversationTags({ enabled: openMenu === 'tag' })
  // Same lazy fetch for the macro list — the support-surface macros only.
  const { data: macros } = useQuery({ ...macrosQuery('support'), enabled: openMenu === 'macro' })
  // Two-step gate for the one irreversible action the bar offers.
  const [confirmDelete, setConfirmDelete] = useState(false)

  // Controlled open/close for one menu, so the command bar can pop it open.
  const menuOpen = (id: BulkMenuId) => ({
    open: openMenu === id,
    onOpenChange: (o: boolean) => onOpenMenuChange(o ? id : null),
  })

  // Spam-view mode: only the spam-lifecycle actions. Triage menus (assign,
  // priority, snooze, tag, macro, close) operate on live threads and would be
  // no-ops or lies against a spam-ended one.
  if (spam) {
    return (
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-40 flex justify-center px-4">
        <div
          role="toolbar"
          aria-label="Bulk actions"
          className="pointer-events-auto flex items-center gap-0.5 rounded-full border border-border bg-background/95 px-2 py-1.5 shadow-lg backdrop-blur"
        >
          <button
            type="button"
            onClick={onClear}
            aria-label={solo ? 'Dismiss' : 'Clear selection'}
            className="flex size-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <XMarkIcon className="size-4" />
          </button>
          <span className="px-1.5 text-xs font-semibold whitespace-nowrap">
            {solo ? 'This conversation' : `${count} selected`}
          </span>
          <span className="mx-1 h-5 w-px bg-border" />
          <button type="button" onClick={onRestore} disabled={pending} className={triggerClass}>
            Restore
          </button>
          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            disabled={pending}
            className={cn(triggerClass, 'text-destructive hover:bg-destructive/10')}
          >
            Delete forever
          </button>
        </div>
        <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                Delete {solo ? 'this conversation' : `${count} conversations`} forever?
              </AlertDialogTitle>
              <AlertDialogDescription>
                This permanently deletes the conversation and its entire history. This action cannot
                be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  setConfirmDelete(false)
                  onDeleteForever?.()
                }}
              >
                Delete permanently
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    )
  }

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-40 flex justify-center px-4">
      <div
        role="toolbar"
        aria-label="Bulk actions"
        className="pointer-events-auto flex items-center gap-0.5 rounded-full border border-border bg-background/95 px-2 py-1.5 shadow-lg backdrop-blur"
      >
        <button
          type="button"
          onClick={onClear}
          aria-label={solo ? 'Dismiss' : 'Clear selection'}
          className="flex size-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <XMarkIcon className="size-4" />
        </button>
        <span className="px-1.5 text-xs font-semibold whitespace-nowrap">
          {solo ? 'This conversation' : `${count} selected`}
        </span>
        <span className="mx-1 h-5 w-px bg-border" />

        {/* Macro. Replies to every target at once: the body renders against
            each conversation's own visitor context and posts immediately, then
            the macro's bundled actions run. A macro reply is a conversation
            message, so the trigger is disabled for ticket targets. */}
        <DropdownMenu {...menuOpen('macro')}>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              disabled={pending || disableMacro}
              title={disableMacro ? 'Not available for tickets' : undefined}
              className={triggerClass}
            >
              Macro
              <ChevronUpIcon className="size-3" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="center" side="top" className="max-h-72 overflow-y-auto">
            {macros?.macros && macros.macros.length > 0 ? (
              macros.macros.map((m) => (
                <DropdownMenuItem
                  key={m.id}
                  onClick={() => onMacro(m.id)}
                  className="flex items-center gap-2"
                >
                  <span className="truncate">{m.name}</span>
                </DropdownMenuItem>
              ))
            ) : (
              <DropdownMenuItem disabled>No macros</DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Assign to a teammate */}
        <DropdownMenu {...menuOpen('assign')}>
          <DropdownMenuTrigger asChild>
            <button type="button" disabled={pending} className={triggerClass}>
              Assign
              <ChevronUpIcon className="size-3" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="center" side="top" className="max-h-72 overflow-y-auto">
            <AssigneeMenuItems members={members} onSelect={onAssign} />
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Assign to a team */}
        <DropdownMenu {...menuOpen('assign_team')}>
          <DropdownMenuTrigger asChild>
            <button type="button" disabled={pending} className={triggerClass}>
              Team
              <ChevronUpIcon className="size-3" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="center" side="top" className="max-h-72 overflow-y-auto">
            {teams && teams.length > 0 ? (
              teams.map((t) => (
                <DropdownMenuItem
                  key={t.id}
                  onClick={() => onAssignTeam(t.id)}
                  className="flex items-center gap-2"
                >
                  <span
                    className={cn('inline-block size-2 shrink-0 rounded-full')}
                    style={{ backgroundColor: t.color }}
                  />
                  <span className="truncate">{t.name}</span>
                </DropdownMenuItem>
              ))
            ) : (
              <DropdownMenuItem disabled>No teams</DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Priority */}
        <DropdownMenu {...menuOpen('priority')}>
          <DropdownMenuTrigger asChild>
            <button type="button" disabled={pending} className={triggerClass}>
              Priority
              <ChevronUpIcon className="size-3" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="center" side="top">
            <PriorityMenuItems onSelect={onPriority} />
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Tag. Applies an EXISTING tag to every target — creating taxonomy
            stays in the per-conversation editor, which holds the color picker
            and the manage_tags-gated create. Tickets carry no tags, so the
            trigger is disabled rather than silently no-op'd. */}
        <DropdownMenu {...menuOpen('tag')}>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              disabled={pending || disableTag}
              title={disableTag ? 'Not available for tickets' : undefined}
              className={triggerClass}
            >
              Tag
              <ChevronUpIcon className="size-3" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="center" side="top" className="max-h-72 overflow-y-auto">
            {tags && tags.length > 0 ? (
              tags.map((t) => (
                <DropdownMenuItem
                  key={t.id}
                  onClick={() => onTag(t.id)}
                  className="flex items-center gap-2"
                >
                  <span
                    className="inline-block size-2 shrink-0 rounded-full"
                    style={{ backgroundColor: t.color }}
                  />
                  <span className="truncate">{t.name}</span>
                </DropdownMenuItem>
              ))
            ) : (
              <DropdownMenuItem disabled>No tags</DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Snooze (presets mirror the single-conversation status control). No
            ticket-row equivalent, so it's disabled rather than silently
            no-op'd whenever the target includes a ticket. */}
        <DropdownMenu {...menuOpen('snooze')}>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              disabled={pending || disableSnooze}
              title={disableSnooze ? 'Not available for tickets' : undefined}
              className={triggerClass}
            >
              Snooze
              <ChevronUpIcon className="size-3" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="center" side="top">
            <DropdownMenuLabel className="text-[11px] font-normal text-muted-foreground">
              Snooze until
            </DropdownMenuLabel>
            <DropdownMenuItem onClick={() => onSnooze(inHours(4).toISOString())}>
              Later today
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onSnooze(tomorrowAt(9).toISOString())}>
              Tomorrow
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onSnooze(nextMondayAt(9).toISOString())}>
              Next week
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onSnooze(null)}>Until they reply</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <span className="mx-1 h-5 w-px bg-border" />
        <button
          type="button"
          onClick={onClose}
          disabled={pending}
          className={cn(triggerClass, 'text-muted-foreground hover:text-foreground')}
        >
          Close
        </button>
      </div>
    </div>
  )
}
